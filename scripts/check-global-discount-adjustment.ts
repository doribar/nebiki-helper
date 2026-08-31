import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyGlobalDiscountAdjustmentToRate,
  GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS,
  loadGlobalDiscountAdjustmentState,
  saveGlobalDiscountAdjustmentState,
} from "../src/domain/globalDiscountAdjustment.ts";
import { createDefaultHourlyForecasts, resolveWeatherInputForDiscount } from "../src/domain/hourlyWeather.ts";
import {
  buildFinalDiscountGuideSnapshot,
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
  reconstructRateDisplayFromSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import type { AppState, ResolvedWeatherInput, SessionData } from "../src/domain/types.ts";
import { getBasisGuideDisplay, getWeekdayBaseInfo } from "../src/domain/weekdayBase.ts";
import {
  createInitialAreaProgressMap,
  normalizeLoadedState,
} from "../src/hooks/nebikiApp/stateNormalization.ts";
import { createDailySessionSnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const resolvedWeather: ResolvedWeatherInput = {
  nearTermWeather: "other",
  hasLaterPrecip: false,
  laterPrecipType: null,
  precipitationRateBonus: 0,
  precipitationRateBonusLabel: null,
  windLevel: "2orLess",
  tempLevel: "21to25",
  weatherPointScore: 0,
  weatherPointShift: 0,
  weatherPointRangeText: null,
  next18TempDropShift: 0,
  next18WindWorsenShift: 0,
  next18WindWorsenKind: null,
  afterRainSky: null,
};

const common = {
  confirmedAt: "2026-08-26T06:10:00.000Z",
  sessionDiscountTime: "17" as const,
  resolvedWeather,
  weatherComfortAdjustmentPercent: 5,
  areaRateAdjustment: 5 as const,
  areaJudge: "normal" as const,
};

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS: ${String(passed).padStart(2, "0")}. ${name}`);
}

test("rateは-5/0/+5 percentage pointsを最終段で加減し0..50へclampする", () => {
  assert.equal(applyGlobalDiscountAdjustmentToRate(20, 0), 20);
  assert.equal(applyGlobalDiscountAdjustmentToRate(20, 5), 25);
  assert.equal(applyGlobalDiscountAdjustmentToRate(20, -5), 15);
  assert.equal(applyGlobalDiscountAdjustmentToRate(0, -5), 0);
  assert.equal(applyGlobalDiscountAdjustmentToRate(0, 5), 5);
  assert.equal(applyGlobalDiscountAdjustmentToRate(45, 5), 50);
  assert.equal(applyGlobalDiscountAdjustmentToRate(50, 5), 50);
});

test("snapshotはbase 20と+5後25を分離しresume roundtripで二重適用しない", () => {
  const snapshot = buildNormalRateDecisionSnapshot({
    ...common,
    globalDiscountAdjustmentPercent: 5,
  });
  assert.equal(snapshot.normalRatePercent, 20);
  assert.equal(snapshot.displayedRateBeforeGlobalAdjustmentPercent, 20);
  assert.equal(snapshot.globalDiscountAdjustmentPercent, 5);
  assert.equal(snapshot.displayedRatePercent, 25);
  assert.equal(snapshot.display?.normal.main, "25%");

  const restored = normalizeRateDecisionSnapshot(
    JSON.parse(JSON.stringify(snapshot)) as unknown,
  );
  assert.ok(restored);
  assert.equal(restored.normalRatePercent, 20);
  assert.equal(restored.displayedRatePercent, 25);
  assert.equal(reconstructRateDisplayFromSnapshot(restored)?.normal.main, "25%");
});

test("-5/0/+5で同一baseの既存rateを一度だけ調整する", () => {
  const minus = buildNormalRateDecisionSnapshot({
    ...common,
    globalDiscountAdjustmentPercent: -5,
  });
  const none = buildNormalRateDecisionSnapshot({
    ...common,
    globalDiscountAdjustmentPercent: 0,
  });
  const plus = buildNormalRateDecisionSnapshot({
    ...common,
    globalDiscountAdjustmentPercent: 5,
  });
  assert.deepEqual(
    [minus.normalRatePercent, none.normalRatePercent, plus.normalRatePercent],
    [20, 20, 20],
  );
  assert.deepEqual(
    [minus.displayedRatePercent, none.displayedRatePercent, plus.displayedRatePercent],
    [15, 20, 25],
  );
});

test("20:30 forced final guideはglobal adjustment対象外で50%を維持する", () => {
  const finalSnapshot = buildFinalDiscountGuideSnapshot({
    confirmedAt: common.confirmedAt,
    resolvedWeather,
    finalGuide: {
      count1: { main: "50%" },
      count2: { main: "50%" },
      count3OrMore: { main: "50%" },
      score: 2,
      scoreThreshold: 1,
      scoreBreakdown: { weekdayShiftPoints: 0, rateBonusPoints: 2 },
    },
  });
  assert.equal(finalSnapshot.calculationMode, "final");
  assert.equal(finalSnapshot.displayedRatePercent, 50);
  assert.equal(finalSnapshot.displayedManyRatePercent, 50);
  assert.equal(finalSnapshot.globalDiscountAdjustmentPercent, undefined);
});

test("新business dateは前日の+5を継承せず0へresetする", () => {
  const storage = new MemoryStorage();
  assert.equal(
    saveGlobalDiscountAdjustmentState({
      state: { version: 1, date: "2026-08-26", adjustmentPercent: 5 },
      fixedTime: false,
      storage,
    }).ok,
    true,
  );
  assert.equal(
    loadGlobalDiscountAdjustmentState({
      date: "2026-08-26",
      fixedTime: false,
      storage,
    }).adjustmentPercent,
    5,
  );
  assert.equal(
    loadGlobalDiscountAdjustmentState({
      date: "2026-08-27",
      fixedTime: false,
      storage,
    }).adjustmentPercent,
    0,
  );
});

test("productionとfixed-timeは別storage keyで隔離する", () => {
  const storage = new MemoryStorage();
  saveGlobalDiscountAdjustmentState({
    state: { version: 1, date: "2026-08-26", adjustmentPercent: 5 },
    fixedTime: false,
    storage,
  });
  saveGlobalDiscountAdjustmentState({
    state: { version: 1, date: "2026-08-26", adjustmentPercent: -5 },
    fixedTime: true,
    storage,
  });
  assert.notEqual(
    GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.production,
    GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.fixedTime,
  );
  assert.equal(
    loadGlobalDiscountAdjustmentState({ date: "2026-08-26", fixedTime: false, storage })
      .adjustmentPercent,
    5,
  );
  assert.equal(
    loadGlobalDiscountAdjustmentState({ date: "2026-08-26", fixedTime: true, storage })
      .adjustmentPercent,
    -5,
  );
});

test("day setting write失敗はshared storage boundaryのstructured resultで返す", () => {
  class QuotaStorage extends MemoryStorage {
    override setItem(): void {
      throw new DOMException("fixture quota", "QuotaExceededError");
    }
  }
  const result = saveGlobalDiscountAdjustmentState({
    state: { version: 1, date: "2026-08-26", adjustmentPercent: 5 },
    fixedTime: false,
    storage: new QuotaStorage(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.key, GLOBAL_DISCOUNT_ADJUSTMENT_STORAGE_KEYS.production);
    assert.equal(result.operation, "set");
    assert.equal(result.errorName, "QuotaExceededError");
    assert.equal(result.quotaExceeded, true);
  }
});

function makeSession(adjustment: -5 | 0 | 5): SessionData {
  return {
    dataSchemaVersion: 3,
    appVersion: "2026.8.9-13-test",
    buildId: "build-global-adjustment-test",
    date: "2026-08-26",
    weekday: 3,
    discountTime: "17",
    demandCycle: "normal",
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
    startedAt: "2026-08-26T08:00:00.000Z",
    globalDiscountAdjustmentPercent: adjustment,
  };
}

function makeState(session: SessionData): AppState {
  return {
    screen: "done",
    session,
    sessionDraft: {
      date: session.date,
      weekday: session.weekday,
      discountTime: session.discountTime,
      demandCycle: session.demandCycle,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: session.weather,
    },
    areaProgressMap: createInitialAreaProgressMap(),
    currentAreaId: null,
    lastReferenceAreaId: null,
    currentFlow: "normal",
    pendingDeferredAreaIds: [],
    timeSwitchNotice: null,
    finalTimeStep: "counts",
    review19: null,
    review19ExcludedAreaIds: [],
  };
}

test("session snapshotへ採用値を保存し途中変更で過去snapshotを書き換えない", () => {
  const session15 = { ...makeSession(0), discountTime: "15" as const };
  const state15 = makeState(session15);
  const weather15 = resolveWeatherInputForDiscount(session15.weather, "15");
  const basis15 = getWeekdayBaseInfo(session15.weekday, "15", weather15, session15.date);
  const guide15 = getBasisGuideDisplay({
    date: session15.date,
    weekday: session15.weekday,
    discountTime: "15",
    weather: weather15,
  });
  const snapshot15 = createDailySessionSnapshot({
    capturedAt: "2026-08-26T06:30:00.000Z",
    state: state15,
    resolvedWeather: weather15,
    weekdayBaseInfo: basis15,
    basisGuide: guide15,
    lateTimeBonus: 0,
    doneSummaryItems: [],
  });

  const session17 = makeSession(5);
  const state17 = makeState(session17);
  const weather17 = resolveWeatherInputForDiscount(session17.weather, "17");
  const basis17 = getWeekdayBaseInfo(session17.weekday, "17", weather17, session17.date);
  const guide17 = getBasisGuideDisplay({
    date: session17.date,
    weekday: session17.weekday,
    discountTime: "17",
    weather: weather17,
  });
  const snapshot17 = createDailySessionSnapshot({
    capturedAt: "2026-08-26T08:30:00.000Z",
    state: state17,
    resolvedWeather: weather17,
    weekdayBaseInfo: basis17,
    basisGuide: guide17,
    lateTimeBonus: 0,
    doneSummaryItems: [],
  });
  assert.equal(snapshot15?.session.globalDiscountAdjustmentPercent, 0);
  assert.equal(snapshot17?.session.globalDiscountAdjustmentPercent, 5);
  assert.equal(snapshot15?.session.globalDiscountAdjustmentPercent, 0);
});

test("旧session field欠損は物理migrationなしで0としてnormalizeする", () => {
  const session = makeSession(0);
  const initialDraft = makeState(session).sessionDraft;
  const raw = makeState(session) as AppState & {
    session: SessionData & { globalDiscountAdjustmentPercent?: -5 | 0 | 5 };
  };
  delete raw.session.globalDiscountAdjustmentPercent;
  const normalized = normalizeLoadedState(raw, initialDraft);
  assert.equal(normalized.session?.globalDiscountAdjustmentPercent, 0);
});

test("StartScreen/RateDisplayは選択UIと非0補正の内訳を正規sourceから表示する", () => {
  const startSource = readFileSync(
    resolve(import.meta.dirname, "../src/components/screens/StartScreen.tsx"),
    "utf8",
  );
  const rateSource = readFileSync(
    resolve(import.meta.dirname, "../src/components/screens/RateDisplayScreen.tsx"),
    "utf8",
  );
  const routerSource = readFileSync(
    resolve(import.meta.dirname, "../src/app/AppRouter.tsx"),
    "utf8",
  );
  assert.match(startSource, /全体値引補正/);
  assert.match(startSource, /\[-5, 0, 5\]/);
  assert.match(startSource, /adjustmentPercent > 0/);
  assert.doesNotMatch(startSource, /通常の値引率へ最後に5ポイント加減します/);
  assert.doesNotMatch(startSource, /20時30分の固定値引には適用されません/);
  assert.match(rateSource, /全体補正/);
  assert.match(rateSource, /rateDisplayBeforeGlobalAdjustment/);
  assert.match(routerSource, /globalDiscountAdjustmentPercent/);
  assert.match(routerSource, /changeGlobalDiscountAdjustment/);
});

console.log(`Global discount adjustment checks passed: ${passed}/${passed}`);
