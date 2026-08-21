import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import {
  STORAGE_KEYS,
  attemptStorageOperationWithAuxiliaryRecovery,
  upsertDailySessionSnapshotSafely,
} from "../src/domain/storage.ts";
import type { DailySessionSnapshot, DiscountTime } from "../src/domain/types.ts";
import { getNextDoneDiscountInfo } from "../src/hooks/nebikiApp/clock.ts";
import {
  buildAutoTimeSwitchDialogText,
  shouldPrioritizeUnfinishedAreasOnAutoTransition,
} from "../src/hooks/nebikiApp/timeTransitions.ts";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

class QuotaFixtureStorage implements Storage {
  private readonly values = new Map<string, string>();
  private dailySnapshotFailuresRemaining = 0;
  dailySnapshotWriteAttempts = 0;

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

  setDailySnapshotFailures(count: number): void {
    this.dailySnapshotFailuresRemaining = count;
    this.dailySnapshotWriteAttempts = 0;
  }

  setItem(key: string, value: string): void {
    if (key === STORAGE_KEYS.dailySessionSnapshots) {
      this.dailySnapshotWriteAttempts += 1;
      if (this.dailySnapshotFailuresRemaining > 0) {
        this.dailySnapshotFailuresRemaining -= 1;
        throw new DOMException("synthetic quota", "QuotaExceededError");
      }
    }
    this.values.set(key, String(value));
  }
}

function createSnapshot(discountTime: DiscountTime = "15"): DailySessionSnapshot {
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: "fixture-app",
    buildId: "fixture-build",
    capturedAt: "2026-08-16T15:30:00+09:00",
    demandCycle: "normal",
    sessionEndReason: "completed",
    screen: "done",
    session: {
      dataSchemaVersion: 3,
      appVersion: "fixture-app",
      buildId: "fixture-build",
      date: "2026-08-16",
      weekday: 0,
      discountTime,
      demandCycle: "normal",
      startedAt: `2026-08-16T${discountTime === "15" ? "15:00" : "17:00"}:00+09:00`,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather: {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      resolvedWeather: {
        weather: "sunny",
        tempC: 25,
        windMs: 2,
      },
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
    },
    areas: {},
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const storage = new QuotaFixtureStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

try {
  test("通常容量ではdaily snapshotを1回で保存", () => {
    storage.clear();
    storage.setDailySnapshotFailures(0);
    const result = upsertDailySessionSnapshotSafely(createSnapshot(), {
      protectedDate: "2026-08-16",
    });
    assert.equal(result.ok, true);
    assert.equal(result.retried, false);
    assert.equal(storage.dailySnapshotWriteAttempts, 1);
  });

  test("Quotaが1回だけなら整理後の1回retryで保存", () => {
    storage.clear();
    storage.setDailySnapshotFailures(1);
    const result = upsertDailySessionSnapshotSafely(createSnapshot(), {
      protectedDate: "2026-08-16",
    });
    assert.equal(result.ok, true);
    assert.equal(result.retried, true);
    assert.equal(storage.dailySnapshotWriteAttempts, 2);
  });

  test("Quotaが継続しても例外を外へ漏らさずretryは最大1回", () => {
    storage.clear();
    storage.setDailySnapshotFailures(2);
    const result = upsertDailySessionSnapshotSafely(createSnapshot(), {
      protectedDate: "2026-08-16",
    });
    assert.equal(result.ok, false);
    assert.equal(result.quotaExceeded, true);
    assert.equal(result.retried, true);
    assert.equal(storage.dailySnapshotWriteAttempts, 2);
    assert.equal(result.failure?.ok, false);
  });

  test("15→17、17→18:30、18:30→19:30、19:30→20:30境界を維持", () => {
    const at = (hour: number, minute: number) =>
      new Date(2026, 7, 16, hour, minute, 0, 0);
    const transitions: Array<{
      from: DiscountTime;
      hour: number;
      minute: number;
      to: DiscountTime;
    }> = [
      { from: "15", hour: 16, minute: 40, to: "17" },
      { from: "17", hour: 18, minute: 25, to: "18" },
      { from: "18", hour: 19, minute: 25, to: "19" },
      { from: "19", hour: 20, minute: 25, to: "20" },
    ];

    for (const transition of transitions) {
      const info = getNextDoneDiscountInfo(
        transition.from,
        at(transition.hour, transition.minute),
      );
      assert.equal(info?.canStart, true);
      assert.equal(info?.targetDiscountTime, transition.to);
      const dialog = buildAutoTimeSwitchDialogText({
        from: transition.from,
        to: transition.to,
        prioritizeUnfinishedAreas: false,
      });
      assert.match(dialog, /次の値引時刻に近づいたため/);
    }
    assert.equal(getNextDoneDiscountInfo("20", at(21, 0)), null);
  });

  test("doneは未完了エリア優先対象ではなく、作業中画面だけを優先", () => {
    assert.equal(shouldPrioritizeUnfinishedAreasOnAutoTransition("done"), false);
    assert.equal(shouldPrioritizeUnfinishedAreasOnAutoTransition("area_judge"), true);
    assert.equal(shouldPrioritizeUnfinishedAreasOnAutoTransition("rate_display"), true);
  });

  test("hook内3経路はraw upsertを使わずsafe boundaryを通る", () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const source = readFileSync(
      `${projectRoot}/src/hooks/useNebikiApp.ts`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    assert.equal(
      [...source.matchAll(/\bupsertDailySessionSnapshotSafely\(/g)].length,
      3,
    );
    assert.doesNotMatch(source, /\bupsertDailySessionSnapshot\(/);
    assert.match(source, /daily-session-completion/);
    assert.match(source, /final-session-snapshot/);
    assert.match(source, /auto-time-transition-snapshot/);
  });

  test("自動遷移はsnapshot結果に関係なく次入力とdialogを続行", () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const source = readFileSync(
      `${projectRoot}/src/hooks/useNebikiApp.ts`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    const start = source.indexOf("function startNextDoneSession");
    const end = source.indexOf("function persistFinalizedDayMemo", start);
    const body = source.slice(start, end);
    const persistenceIndex = body.indexOf("upsertDailySessionSnapshotSafely");
    const dialogIndex = body.indexOf("window.alert(buildAutoTimeSwitchDialogText");
    const openIndex = body.indexOf("openNextSessionInput(nextInfo.targetDiscountTime");
    assert.ok(persistenceIndex >= 0);
    assert.ok(openIndex > persistenceIndex);
    assert.ok(dialogIndex > openIndex);
    assert.match(body, /const transitionOpened = openNextSessionInput/);
    assert.match(body, /options\?\.autoTransition && transitionOpened/);
    assert.match(body, /reportStorageOperationFailures\([\s\S]*?snapshotWriteResult\.attempts/);
    assert.doesNotMatch(
      body,
      /if\s*\(\s*!snapshotWriteResult\.ok[\s\S]{0,300}?\breturn\b/,
    );
  });

  test("StrictModeのeffect再実行でも同一sessionの自動遷移を二重実行しない", () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const source = readFileSync(
      `${projectRoot}/src/hooks/useNebikiApp.ts`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    const start = source.indexOf("function startNextDoneSession");
    const end = source.indexOf("function persistFinalizedDayMemo", start);
    const body = source.slice(start, end);

    assert.match(
      source,
      /const autoTransitionInFlightKeyRef = useRef<string \| null>\(null\)/,
    );
    assert.match(
      body,
      /const autoTransitionKey = options\?\.autoTransition[\s\S]*?state\.session\.date[\s\S]*?state\.session\.startedAt[\s\S]*?previousDiscountTime[\s\S]*?nextInfo\.targetDiscountTime/,
    );
    assert.match(
      body,
      /if \(autoTransitionInFlightKeyRef\.current === autoTransitionKey\) return;/,
    );
    assert.match(
      body,
      /autoTransitionInFlightKeyRef\.current = autoTransitionKey;/,
    );
    assert.match(
      body,
      /if \(autoTransitionKey && !transitionOpened\) \{\s*autoTransitionInFlightKeyRef\.current = null;/,
    );

    const guardStart = body.indexOf("const autoTransitionKey");
    const transitionedAt = body.indexOf("const transitionedAt");
    assert.ok(guardStart >= 0 && guardStart < transitionedAt);
    assert.match(
      body.slice(guardStart, transitionedAt),
      /options\?\.autoTransition/,
      "manual transitionはin-flight guardの対象にしない",
    );
  });

  test("20:30正本保存失敗時は完了stateを偽装しない", () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const source = readFileSync(
      `${projectRoot}/src/hooks/useNebikiApp.ts`,
      "utf8",
    ).replaceAll("\r\n", "\n");
    const finalizeStart = source.indexOf("function finalizeFinalDayData");
    const finalizeEnd = source.indexOf("function judgeCurrentArea", finalizeStart);
    const finalizeBody = source.slice(finalizeStart, finalizeEnd);
    assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);
    assert.match(finalizeBody, /persistFinalizedDayOperationSafely/);
    assert.match(finalizeBody, /storageFailed:\s*true/);
    assert.match(source, /if \(finalizedDayData\.storageFailed\) return;/);
  });

  test("共通authoritative境界はstorage不在のno-opを成功扱いしない", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    try {
      const result = attemptStorageOperationWithAuxiliaryRecovery({
        key: "fixture/authoritative",
        operation: "set",
        run: () => undefined,
      });
      assert.equal(result.ok, false);
      assert.equal(result.retried, false);
      assert.equal(result.finalResult.ok, false);
      assert.equal(
        result.finalResult.ok ? null : result.finalResult.errorName,
        "StorageUnavailableError",
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: storage,
      });
    }
  });

  let passed = 0;
  for (const entry of tests) {
    entry.run();
    passed += 1;
    console.log(`PASS ${passed}: ${entry.name}`);
  }
  console.log(`Session completion storage safety checks passed: ${passed}/${tests.length}`);
} finally {
  if (previousStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", previousStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}
