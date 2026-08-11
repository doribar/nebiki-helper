import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getActualWeekdayLabel,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  normalizeAreaCountRecords,
  shouldForceAreaCountFallbackWeekdayGroup,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
  upsertRemoteAreaCountRecord,
} from "../src/domain/areaCountRemoteStorage.ts";
import {
  normalizeDemandCycle,
  resolveDemandCycleFromEvidence,
} from "../src/domain/demandCycle.ts";
import {
  DEMAND_CYCLE_STORAGE_KEYS,
  loadDemandCycleState,
  loadSummerAreaCountRecords,
  lockDemandCycleForDate,
  normalizeDemandCycleState,
  saveDemandCycleState,
  saveSummerAreaCountRecords,
  selectDemandCycleForDate,
  updateDemandCyclePreference,
} from "../src/domain/demandCycleStorage.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  cloneAppState,
  createNavigationSnapshot,
} from "../src/domain/navigationHistory.ts";
import {
  buildNormalRateDecisionSnapshot,
  normalizeRateDecisionSnapshot,
} from "../src/domain/rateDecisionSnapshot.ts";
import {
  buildReview19ExportPayload,
  createInitialReview19Result,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import {
  loadDailySessionSnapshots,
  loadReview19Records,
  STORAGE_KEYS,
} from "../src/domain/storage.ts";
import type {
  AppState,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
} from "../src/domain/types.ts";
import {
  createReview19DaySnapshot,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  createInitialState,
  normalizeLoadedState,
  normalizeSessionDraft,
} from "../src/hooks/nebikiApp/stateNormalization.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [];

function test(name: string, run: TestCase["run"]): void {
  tests.push({ name, run });
}

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function weekdayForDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function yearForDate(date: string): number {
  return Number(date.slice(0, 4));
}

function makeRecord(params: {
  date: string;
  count: number;
  demandCycle?: DemandCycle;
  discountTime?: DiscountTime;
  sessionSuffix?: string;
}): AreaCountRecord {
  const discountTime = params.discountTime ?? "17";
  const weekday = weekdayForDate(params.date);
  const suffix = params.sessionSuffix ?? "00";
  return {
    date: params.date,
    sessionStartedAt: `${params.date}T08:${suffix}:00.000Z`,
    recordedAt: `${params.date}T08:${suffix}:30.000Z`,
    areaId: "bento_men",
    discountTime,
    actualWeekday: getActualWeekdayLabel(weekday),
    actualWeekdayGroup: getAreaCountFallbackWeekdayGroup({
      date: params.date,
      weekday,
      discountTime,
    }),
    count: params.count,
    ...(params.demandCycle ? { demandCycle: params.demandCycle } : {}),
  };
}

function collectDates(params: {
  before: string;
  weekday: number;
  count: number;
  yearMatches: (year: number) => boolean;
  discountTime?: DiscountTime;
  weekdayGroup?: AreaCountRecord["actualWeekdayGroup"];
}): string[] {
  const cursor = new Date(`${params.before}T00:00:00Z`);
  const result: string[] = [];
  const discountTime = params.discountTime ?? "17";

  for (let attempts = 0; attempts < 5000 && result.length < params.count; attempts += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    if (weekday !== params.weekday || !params.yearMatches(cursor.getUTCFullYear())) {
      continue;
    }
    if (
      params.weekdayGroup &&
      getAreaCountFallbackWeekdayGroup({ date, weekday, discountTime }) !==
        params.weekdayGroup
    ) {
      continue;
    }
    result.push(date);
  }

  assert.equal(result.length, params.count, "test fixture dates could not be generated");
  return result;
}

const TARGET_DATE = "2027-07-05";
const TARGET_WEEKDAY = weekdayForDate(TARGET_DATE);
const TARGET_GROUP = getAreaCountFallbackWeekdayGroup({
  date: TARGET_DATE,
  weekday: TARGET_WEEKDAY,
  discountTime: "17",
});
const CURRENT_YEAR_WEEKDAYS = collectDates({
  before: TARGET_DATE,
  weekday: TARGET_WEEKDAY,
  count: 4,
  yearMatches: (year) => year === 2027,
});
const CURRENT_YEAR_GROUP_OTHER_DAYS = collectDates({
  before: TARGET_DATE,
  weekday: 3,
  count: 6,
  yearMatches: (year) => year === 2027,
  weekdayGroup: TARGET_GROUP,
});
const PRIOR_YEAR_WEEKDAYS = collectDates({
  before: TARGET_DATE,
  weekday: TARGET_WEEKDAY,
  count: 8,
  yearMatches: (year) => year < 2027,
});
const PRIOR_YEAR_GROUP_OTHER_DAYS = collectDates({
  before: TARGET_DATE,
  weekday: 3,
  count: 10,
  yearMatches: (year) => year < 2027,
  weekdayGroup: TARGET_GROUP,
});

function recommendation(params: {
  records: AreaCountRecord[];
  demandCycle: DemandCycle;
  date?: string;
  discountTime?: DiscountTime;
  count?: number;
}) {
  const date = params.date ?? TARGET_DATE;
  return getAreaCountRecommendation({
    records: params.records,
    areaId: "bento_men",
    discountTime: params.discountTime ?? "17",
    weekday: weekdayForDate(date),
    date,
    demandCycle: params.demandCycle,
    count: params.count ?? 10,
  });
}

function recordsForDates(
  dates: string[],
  count: number,
  demandCycle: DemandCycle,
  discountTime: DiscountTime = "17",
): AreaCountRecord[] {
  return dates.map((date) => makeRecord({ date, count, demandCycle, discountTime }));
}

function createActiveState(demandCycle: DemandCycle): AppState {
  const draft = normalizeSessionDraft({
    date: TARGET_DATE,
    weekday: TARGET_WEEKDAY,
    discountTime: "17",
    demandCycle,
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
  });
  const state = createInitialState(draft);
  state.session = {
    ...draft,
    startedAt: `${TARGET_DATE}T08:00:00.000Z`,
  };
  return state;
}

function assertApproximately(actual: number | undefined, expected: number): void {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs((actual as number) - expected) < 1e-9);
}

test("01. 旧データの初期値は通常サイクル", () => {
  assert.equal(normalizeDemandCycle(undefined), "normal");
  assert.equal(normalizeSessionDraft({}).demandCycle, "normal");
  assert.deepEqual(normalizeDemandCycleState(null), {
    selectedCycle: "normal",
    lockedDate: null,
    lockedCycle: null,
  });
});

test("02. 通常から夏へ手動切替できる", () => {
  const normal = normalizeDemandCycleState(null);
  const summer = updateDemandCyclePreference(normal, "summer");
  assert.equal(summer.selectedCycle, "summer");
  assert.equal(selectDemandCycleForDate(summer, TARGET_DATE), "summer");

  const startScreenSource = readRepoFile("src/components/screens/StartScreen.tsx");
  const hookSource = readRepoFile("src/hooks/useNebikiApp.ts");
  assert.ok(startScreenSource.includes("window.confirm"));
  assert.ok(startScreenSource.includes("onChangeDemandCycle(nextDemandCycle)"));
  assert.ok(hookSource.includes("function changeDemandCycle"));
});

test("03. 選択状態は翌日へ引き継がれる", () => {
  const nextDate = "2027-07-06";
  const lockedToday = lockDemandCycleForDate(
    normalizeDemandCycleState(null),
    TARGET_DATE,
    "summer",
  );
  assert.equal(selectDemandCycleForDate(lockedToday, nextDate), "summer");

  // start画面に前日session/snapshotが残っていても、それらは翌日の
  // operation evidenceにはならず、翌日は引継ぎ選択値から開始する。
  assert.equal(
    resolveDemandCycleFromEvidence(nextDate, [
      { date: TARGET_DATE, demandCycle: "normal" },
      { date: TARGET_DATE, demandCycle: "summer" },
    ]),
    null,
  );
  const hookSource = readRepoFile("src/hooks/useNebikiApp.ts");
  assert.ok(hookSource.includes('state.screen === "start"'));
  assert.ok(hookSource.includes("? state.sessionDraft.date"));
  assert.ok(hookSource.includes("date: snapshot.session.date"));
});

test("04. 当日運用開始後は切替できない", () => {
  const locked = lockDemandCycleForDate(
    normalizeDemandCycleState(null),
    TARGET_DATE,
    "normal",
  );
  const preferenceChanged = updateDemandCyclePreference(locked, "summer");
  assert.equal(selectDemandCycleForDate(preferenceChanged, TARGET_DATE), "normal");
  assert.equal(
    resolveDemandCycleFromEvidence(TARGET_DATE, [
      { date: TARGET_DATE, demandCycle: "normal" },
    ]),
    "normal",
  );

  const source = readRepoFile("src/hooks/useNebikiApp.ts");
  assert.ok(source.includes("!inferredOperationDemandCycle"));
  assert.ok(source.includes("!persistedDemandCycleLock"));
  assert.ok(source.includes("if (!canChangeDemandCycle) return false"));
});

test("05. 当日データがなければ切替できる", () => {
  const unlocked = normalizeDemandCycleState({ selectedCycle: "normal" });
  assert.equal(resolveDemandCycleFromEvidence(TARGET_DATE, []), null);
  const changed = updateDemandCyclePreference(unlocked, "summer");
  assert.equal(selectDemandCycleForDate(changed, TARGET_DATE), "summer");
});

test("06. 再読み込み後も当日のサイクルが変わらない", () => {
  localStorage.clear();
  const locked = lockDemandCycleForDate(
    normalizeDemandCycleState(null),
    TARGET_DATE,
    "summer",
  );
  saveDemandCycleState(locked);
  const reloaded = loadDemandCycleState();
  assert.deepEqual(reloaded, locked);
  assert.equal(selectDemandCycleForDate(reloaded, TARGET_DATE), "summer");
});

test("07. 戻る操作と自動遷移でもサイクルが維持される", () => {
  const state = createActiveState("summer");
  state.sessionDraft.demandCycle = "normal";
  const cloned = cloneAppState(state);
  assert.equal(cloned.session?.demandCycle, "summer");
  assert.equal(cloned.sessionDraft.demandCycle, "summer");

  const navigation = createNavigationSnapshot({
    state,
    areaJudgeSelection: null,
    resumeTargetScreen: null,
    nextSessionSkipRecords: [],
    lastSessionWeather: null,
  });
  assert.equal(navigation.state.session?.demandCycle, "summer");
  assert.equal(navigation.state.sessionDraft.demandCycle, "summer");
  assert.ok(readRepoFile("src/hooks/useNebikiApp.ts").includes("demandCycle: activeDemandCycle"));
});

test("08. 通常履歴は夏判定へ混ざらない", () => {
  const result = recommendation({
    records: recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 99, "normal"),
    demandCycle: "summer",
  });
  assert.equal(result.status, "insufficient");
  assert.equal(result.sampleSize, 0);
});

test("09. 夏履歴は通常判定へ混ざらない", () => {
  const result = recommendation({
    records: recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 9, "summer"),
    demandCycle: "normal",
  });
  assert.equal(result.status, "insufficient");
  assert.equal(result.sampleSize, 0);
});

test("10. 需要サイクルなし履歴は通常として扱われる", () => {
  const legacyRecords = CURRENT_YEAR_WEEKDAYS.slice(0, 3).map((date) => {
    const record = makeRecord({ date, count: 12 });
    delete record.demandCycle;
    return record;
  });
  const normalized = normalizeAreaCountRecords(legacyRecords);
  assert.ok(normalized.every((record) => record.demandCycle === "normal"));
  assert.equal(
    recommendation({ records: legacyRecords, demandCycle: "normal" }).status,
    "ready",
  );
});

test("11. 19時チェック・日次スナップショット・エクスポートに需要サイクルが保存される", () => {
  const review = createInitialReview19Result({
    date: TARGET_DATE,
    sessionStartedAt: `${TARGET_DATE}T10:00:00.000Z`,
    demandCycle: "summer",
  });
  assert.equal(review.demandCycle, "summer");
  assert.equal(typeof review.appVersion, "string");
  assert.equal(typeof review.buildId, "string");

  const normalRecord = makeRecord({
    date: TARGET_DATE,
    count: 90,
    demandCycle: "normal",
    discountTime: "19",
  });
  const summerRecord = makeRecord({
    date: TARGET_DATE,
    count: 9,
    demandCycle: "summer",
    discountTime: "19",
  });
  const daySnapshot = createReview19DaySnapshot({
    capturedAt: `${TARGET_DATE}T10:05:00.000Z`,
    date: TARGET_DATE,
    demandCycle: "summer",
    areaCountRecords: [normalRecord, summerRecord],
    sessions: [],
  });
  assert.equal(daySnapshot.demandCycle, "summer");
  assert.deepEqual(daySnapshot.areaCountRecords.map((record) => record.count), [9]);

  const exported = buildReview19ExportPayload({
    records: [review],
    exportedAt: `${TARGET_DATE}T11:00:00.000Z`,
  });
  assert.equal(exported.records[0]?.demandCycle, "summer");
});

test("12. 20時30分中央値もサイクル別になる", () => {
  const normal = recordsForDates(
    CURRENT_YEAR_WEEKDAYS.slice(0, 3),
    90,
    "normal",
    "20",
  );
  const summer = recordsForDates(
    CURRENT_YEAR_WEEKDAYS.slice(0, 3),
    9,
    "summer",
    "20",
  );
  const normalResult = recommendation({
    records: [...normal, ...summer],
    demandCycle: "normal",
    discountTime: "20",
  });
  const summerResult = recommendation({
    records: [...normal, ...summer],
    demandCycle: "summer",
    discountTime: "20",
  });
  assert.equal(normalResult.medianCount, 90);
  assert.equal(summerResult.medianCount, 9);
});

test("13. 減少率履歴もサイクル別になる", () => {
  const records: AreaCountRecord[] = [];
  for (const date of CURRENT_YEAR_WEEKDAYS.slice(0, 3)) {
    records.push(
      makeRecord({ date, count: 10, demandCycle: "summer", discountTime: "15" }),
      makeRecord({ date, count: 2, demandCycle: "summer", discountTime: "17" }),
      makeRecord({ date, count: 10, demandCycle: "normal", discountTime: "15" }),
      makeRecord({ date, count: 10, demandCycle: "normal", discountTime: "17" }),
    );
  }
  records.push(
    makeRecord({ date: TARGET_DATE, count: 10, demandCycle: "summer", discountTime: "15" }),
    makeRecord({ date: TARGET_DATE, count: 10, demandCycle: "normal", discountTime: "15" }),
  );

  const summer = recommendation({ records, demandCycle: "summer", count: 6 });
  const normal = recommendation({ records, demandCycle: "normal", count: 6 });
  assert.equal(summer.status, "ready");
  assert.equal(normal.status, "ready");
  assertApproximately(summer.decreaseRecommendation?.medianDecreaseRate, 0.8);
  assertApproximately(normal.decreaseRecommendation?.medianDecreaseRate, 0);
  assert.equal(summer.decreaseRecommendation?.direction, "more_many");
  assert.equal(normal.decreaseRecommendation?.direction, "more_few");
});

for (const [number, count] of [[14, 0], [15, 1], [16, 2]] as const) {
  test(`${String(number).padStart(2, "0")}. 今年の夏グループ${count}件では手動判定`, () => {
    const records = recordsForDates(
      CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, count),
      10,
      "summer",
    );
    const result = recommendation({ records, demandCycle: "summer" });
    assert.equal(result.status, "insufficient");
    assert.equal(result.sampleSize, count);
    assert.equal(result.requiredSampleSize, 3);
  });
}

test("17. 今年の夏グループ3件でグループ自動判定を開始する", () => {
  const result = recommendation({
    records: recordsForDates(
      CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 3),
      10,
      "summer",
    ),
    demandCycle: "summer",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.sampleSize, 3);
});

test("18. 前年以前に大量の夏データがあっても今年0〜2件なら手動", () => {
  const records = [
    ...recordsForDates(PRIOR_YEAR_GROUP_OTHER_DAYS.slice(0, 10), 80, "summer"),
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 2), 10, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.status, "insufficient");
  assert.equal(result.sampleSize, 2);
});

test("19. 前年以前の夏データは今年の3件判定へ含まれない", () => {
  const records = [
    ...recordsForDates(PRIOR_YEAR_GROUP_OTHER_DAYS.slice(0, 6), 80, "summer"),
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 2), 10, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.sampleSize, 2);
  assert.ok(result.matchedRecords.every((record) => yearForDate(record.date) === 2027));
});

test("20. 同じ曜日が3件未満でグループが3件以上ならグループ判定", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 2), 10, "summer"),
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 1), 11, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "fallback_group");
});

test("21. 同じ曜日が3件に達したら曜日単体判定へ切り替わる", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 3), 30, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "weekday");
  assert.equal(result.medianCount, 10);
});

test("22. 別曜日データは同じ曜日3件へ含まれない", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 2), 10, "summer"),
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 5), 30, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(
    result.matchedRecords.filter(
      (record) => record.actualWeekday === getActualWeekdayLabel(TARGET_WEEKDAY),
    ).length,
    2,
  );
});

test("23. 現行の祝日・強制グループ例外が維持される", () => {
  const date = "2026-03-20";
  assert.equal(
    shouldForceAreaCountFallbackWeekdayGroup({
      date,
      weekday: weekdayForDate(date),
    }),
    true,
  );
  const records = recordsForDates(
    ["2026-03-13", "2026-03-06", "2026-02-27"],
    12,
    "summer",
  );
  const result = recommendation({ records, demandCycle: "summer", date });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "fallback_group");
});

test("24. 夏短期は今年の夏データだけ", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 3), 100, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.shortMedianCount, 10);
  assert.equal(result.shortSampleSize, 3);
  assert.ok(result.matchedRecords.every((record) => yearForDate(record.date) === 2027));
});

test("25. 夏短期へ前年夏が混ざらない", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 8), 100, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.shortSampleSize, 3);
  assert.equal(result.shortMedianCount, 10);
  assert.equal(result.matchedRecords.some((record) => yearForDate(record.date) < 2027), false);
});

test("26. 夏長期は前年以前の夏データだけ", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 3), 15, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.longSampleSize, 3);
  assert.equal(result.longMedianCount, 15);
});

test("27. 夏長期へ今年の夏データが混ざらない", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 4), 1, "summer"),
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 3), 20, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.longSampleSize, 3);
  assert.equal(result.longMedianCount, 20);
});

test("28. 前年以前の夏データなしでも今年3件で自動判定できる", () => {
  const result = recommendation({
    records: recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    demandCycle: "summer",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "weekday");
  assert.equal(result.longSampleSize, 0);
  assert.equal(result.longMedianCount, undefined);
  assert.equal(result.medianCount, 10);
});

test("29. 同じ曜日判定では今年短期と前年以前長期の最大2個ガードが働く", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 3), 15, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.comparisonMode, "weekday");
  assert.equal(result.shortMedianCount, 10);
  assert.equal(result.longMedianCount, 15);
  assert.equal(result.medianCount, 13);
  assert.equal(result.medianDownGuardApplied, true);
});

test("30. 曜日グループ判定では長期ガードを適用しない", () => {
  const records = [
    ...recordsForDates(CURRENT_YEAR_GROUP_OTHER_DAYS.slice(0, 3), 10, "summer"),
    ...recordsForDates(PRIOR_YEAR_GROUP_OTHER_DAYS.slice(0, 3), 15, "summer"),
  ];
  const result = recommendation({ records, demandCycle: "summer" });
  assert.equal(result.comparisonMode, "fallback_group");
  assert.equal(result.shortMedianCount, 10);
  assert.equal(result.longMedianCount, 15);
  assert.equal(result.medianCount, 10);
  assert.equal(result.medianDownGuardApplied, false);
});

test("31. 通常サイクルの既存短期・長期挙動は変わらない", () => {
  const records = [
    ...recordsForDates(PRIOR_YEAR_WEEKDAYS.slice(0, 3), 15, "normal"),
    ...recordsForDates(CURRENT_YEAR_WEEKDAYS.slice(0, 3), 10, "normal"),
  ];
  const result = recommendation({ records, demandCycle: "normal" });
  assert.equal(result.status, "ready");
  assert.equal(result.comparisonMode, "weekday");
  assert.equal(result.shortSampleSize, 6);
  assert.equal(result.longSampleSize, 6);
  assert.equal(result.shortMedianCount, 13);
  assert.equal(result.longMedianCount, 13);
  assert.equal(result.medianCount, 13);
});

test("32. 需要サイクル項目のない旧セッションを読み込める", () => {
  const legacyState = createActiveState("summer");
  delete legacyState.sessionDraft.demandCycle;
  if (legacyState.session) delete legacyState.session.demandCycle;

  const restored = normalizeLoadedState(
    legacyState,
    normalizeSessionDraft({ demandCycle: "summer" }),
  );
  assert.equal(restored.session?.demandCycle, "normal");
  assert.equal(restored.sessionDraft.demandCycle, "normal");
});

test("33. 需要サイクル項目のない旧日次・rateDecisionスナップショットを読み込める", () => {
  localStorage.clear();
  const weather = {
    hourlyForecasts: createDefaultHourlyForecasts(),
    afterRainSky: null,
  };
  const resolvedWeather = resolveWeatherInputForDiscount(weather, "17");
  const rateSnapshot = JSON.parse(JSON.stringify(buildNormalRateDecisionSnapshot({
    confirmedAt: `${TARGET_DATE}T08:15:00.000Z`,
    sessionDiscountTime: "17",
    demandCycle: "summer",
    weatherComfortAdjustmentPercent: 0,
    areaJudge: "normal",
    resolvedWeather,
    weekday: TARGET_WEEKDAY,
    date: TARGET_DATE,
  }))) as ReturnType<typeof buildNormalRateDecisionSnapshot>;
  delete rateSnapshot.demandCycle;
  assert.equal(normalizeRateDecisionSnapshot(rateSnapshot)?.demandCycle, "normal");

  const legacySnapshot = {
    version: 1,
    capturedAt: `${TARGET_DATE}T12:00:00`,
    screen: "done",
    session: {
      date: TARGET_DATE,
      weekday: TARGET_WEEKDAY,
      discountTime: "17",
      startedAt: `${TARGET_DATE}T08:00:00`,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather,
      resolvedWeather,
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
    },
    areas: {
      bento_men: {
        areaId: "bento_men",
        areaName: "弁当・麺",
        status: "completed",
        areaJudge: "normal",
        judgeText: "普通",
        rateText: "20%",
        rateDecisionSnapshot: rateSnapshot,
        rateDecisionSnapshotStatus: "captured",
        areaCountDecisionBasis: {
          ruleVersion: "area_count_median_v1",
          recommendationStatus: "ready",
          sampleSize: 3,
          requiredSampleSize: 3,
        },
      },
    },
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  } as unknown as DailySessionSnapshot;
  localStorage.setItem(
    STORAGE_KEYS.dailySessionSnapshots,
    JSON.stringify([legacySnapshot]),
  );

  const [restored] = loadDailySessionSnapshots();
  assert.ok(restored);
  assert.equal(restored.demandCycle, "normal");
  assert.equal(restored.session.demandCycle, "normal");
  assert.equal(restored.areas.bento_men.rateDecisionSnapshot?.demandCycle, "normal");
  assert.equal(restored.areas.bento_men.areaCountDecisionBasis?.demandCycle, "normal");
});

test("34. 需要サイクル項目のない旧19時チェックを読み込める", () => {
  localStorage.clear();
  const legacy = createInitialReview19Result({
    date: TARGET_DATE,
    sessionStartedAt: `${TARGET_DATE}T10:00:00.000Z`,
  });
  delete legacy.demandCycle;
  localStorage.setItem(STORAGE_KEYS.review19Records, JSON.stringify([legacy]));

  const [restored] = loadReview19Records();
  assert.ok(restored);
  assert.equal(restored.demandCycle, "normal");
  assert.equal(normalizeReview19Result(legacy)?.demandCycle, "normal");
});

test("35. Supabase新スキーマでsummerをnormalと分離して保存・復元できる", async () => {
  localStorage.clear();
  const summerRecord = makeRecord({
    date: CURRENT_YEAR_WEEKDAYS[0],
    count: 7,
    demandCycle: "summer",
  });
  summerRecord.decisionBasis = {
    ruleVersion: "area_count_median_v1",
    recommendationStatus: "ready",
    sampleSize: 3,
    requiredSampleSize: 3,
  };
  saveSummerAreaCountRecords([summerRecord]);
  assert.equal(loadSummerAreaCountRecords()[0]?.demandCycle, "summer");
  assert.equal(
    loadSummerAreaCountRecords()[0]?.decisionBasis?.demandCycle,
    "summer",
  );
  assert.ok(localStorage.getItem(DEMAND_CYCLE_STORAGE_KEYS.summerAreaCountRecords));

  const remoteRow = buildRemoteAreaCountRow(summerRecord);
  assert.equal(remoteRow.demand_cycle, "summer");
  const [restoredRemote] = normalizeRemoteAreaCountRows([remoteRow]);
  assert.equal(restoredRemote?.demandCycle, "summer");
  assert.equal(restoredRemote?.decisionBasis?.demandCycle, "summer");
  assert.deepEqual(await upsertRemoteAreaCountRecord(summerRecord), {
    status: "disabled",
  });

  for (const file of [
    "supabase_area_count_records.sql",
    "supabase_area_count_records_backup.sql",
    "supabase_area_count_records_migration.sql",
    "supabase_area_count_records_rollback.sql",
    "supabase_area_count_records_verify.sql",
  ]) {
    assert.doesNotMatch(readRepoFile(file), /demand[_ ]cycle/i, file);
  }
  const cloudMigration = readRepoFile(
    "supabase_area_count_records_cloud_sync_migration.sql",
  );
  assert.match(cloudMigration, /demand_cycle/i);
  assert.match(cloudMigration, /record_details\s+jsonb/i);
  assert.match(cloudMigration, /review19_records/i);
});

let passed = 0;
let failed = 0;
for (const item of tests) {
  try {
    await item.run();
    passed += 1;
    console.log(`PASS: ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${item.name}`);
    console.error(error);
  }
}

assert.equal(tests.length, 35, "demand-cycle regression must retain all 35 numbered checks");
if (failed > 0) {
  console.error(`FAIL: demand-cycle regression ${passed}/${tests.length}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: demand-cycle regression ${passed}/${tests.length}`);
}
