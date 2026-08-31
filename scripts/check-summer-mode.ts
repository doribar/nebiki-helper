import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getDemandCycleBasisLabel,
  getDemandCycleDisplayName,
  getDemandCycleShortName,
  isSummerModeAvailable,
  shouldShowSummerModeJudgeHint,
} from "../src/domain/demandCycle.ts";
import {
  DEMAND_CYCLE_STORAGE_KEYS,
  loadDemandCycleState,
  loadFixedTimeDemandCycleState,
  lockDemandCycleForDate,
  normalizeDemandCycleState,
  normalizeDemandCycleStateForBusinessDate,
  saveDemandCycleState,
  saveFixedTimeDemandCycleState,
  selectDemandCycleForDate,
  updateDemandCyclePreference,
} from "../src/domain/demandCycleStorage.ts";

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

function assertNoUserFacingLegacyCycleName(source: string): void {
  // 内部の型・変数名 demandCycle は互換用に残す。ここでは日本語の
  // ユーザー向け文字列だけを対象にする。
  assert.doesNotMatch(source, /["'`][^\r\n"'`]*需要サイクル[^\r\n"'`]*["'`]/);
}

test("01. 6月30日は夏季モード対象外", () => {
  assert.equal(isSummerModeAvailable("2026-06-30"), false);
});

test("02. 7月1日は夏季モード対象", () => {
  assert.equal(isSummerModeAvailable("2026-07-01"), true);
});

test("03. 9月30日は夏季モード対象", () => {
  assert.equal(isSummerModeAvailable("2026-09-30"), true);
});

test("04. 10月1日は夏季モード対象外", () => {
  assert.equal(isSummerModeAvailable("2026-10-01"), false);
});

test("05. 不正日付や省略形式を夏季モード対象にしない", () => {
  for (const invalid of [
    "",
    "2026-7-01",
    "2026-07-1",
    "2026-00-01",
    "2026-09-31",
    "2026-13-01",
    "not-a-date",
  ]) {
    assert.equal(isSummerModeAvailable(invalid), false, invalid);
  }
});

test("06. 期間外のsummer選択と日次ロックはnormalへ正規化", () => {
  const summer = lockDemandCycleForDate(
    updateDemandCyclePreference(normalizeDemandCycleState(null), "summer"),
    "2026-09-30",
    "summer",
  );
  assert.deepEqual(normalizeDemandCycleStateForBusinessDate(summer, "2026-10-01"), {
    selectedCycle: "normal",
    lockedDate: null,
    lockedCycle: null,
  });
});

test("07. 期間外でOFFになった状態は翌年7月に勝手にONへ戻らない", () => {
  const oldSummer = updateDemandCyclePreference(
    normalizeDemandCycleState(null),
    "summer",
  );
  const normalizedInOctober = normalizeDemandCycleStateForBusinessDate(
    oldSummer,
    "2026-10-01",
  );
  const nextSummer = normalizeDemandCycleStateForBusinessDate(
    normalizedInOctober,
    "2027-07-01",
  );
  assert.equal(selectDemandCycleForDate(nextSummer, "2027-07-01"), "normal");
});

test("08. 本番用と時間固定用の保存キーは独立", () => {
  assert.notEqual(
    DEMAND_CYCLE_STORAGE_KEYS.state,
    DEMAND_CYCLE_STORAGE_KEYS.fixedTimeState,
  );
  assert.equal(
    DEMAND_CYCLE_STORAGE_KEYS.fixedTimeState,
    "nebiki-helper/fixed-time-demand-cycle-state-v1",
  );
});

test("09. 時間固定モードの変更は本番状態を変更しない", () => {
  localStorage.clear();
  const production = lockDemandCycleForDate(
    normalizeDemandCycleState(null),
    "2026-08-10",
    "normal",
  );
  const fixed = lockDemandCycleForDate(
    updateDemandCyclePreference(normalizeDemandCycleState(null), "summer"),
    "2026-08-15",
    "summer",
  );
  saveDemandCycleState(production);
  saveFixedTimeDemandCycleState(fixed);

  assert.deepEqual(loadDemandCycleState(), production);
  assert.deepEqual(loadFixedTimeDemandCycleState(), fixed);

  saveFixedTimeDemandCycleState(
    updateDemandCyclePreference(loadFixedTimeDemandCycleState(), "normal"),
  );
  assert.deepEqual(loadDemandCycleState(), production);
});

test("10. 時間固定モードの選択と日次ロックは再読み込み後も復元", () => {
  localStorage.clear();
  const locked = lockDemandCycleForDate(
    updateDemandCyclePreference(normalizeDemandCycleState(null), "summer"),
    "2026-08-15",
    "summer",
  );
  saveFixedTimeDemandCycleState(locked);

  const reloaded = loadFixedTimeDemandCycleState();
  assert.deepEqual(reloaded, locked);
  assert.equal(selectDemandCycleForDate(reloaded, "2026-08-15"), "summer");

  const preferenceChangedAfterLock = updateDemandCyclePreference(
    reloaded,
    "normal",
  );
  assert.equal(
    selectDemandCycleForDate(preferenceChangedAfterLock, "2026-08-15"),
    "summer",
  );
});

test("11. 固定日時を期間外へ移すとOFFになり、期間内へ戻しても復活しない", () => {
  localStorage.clear();
  saveFixedTimeDemandCycleState(
    updateDemandCyclePreference(normalizeDemandCycleState(null), "summer"),
  );

  const october = normalizeDemandCycleStateForBusinessDate(
    loadFixedTimeDemandCycleState(),
    "2026-10-01",
  );
  saveFixedTimeDemandCycleState(october);
  const augustAgain = normalizeDemandCycleStateForBusinessDate(
    loadFixedTimeDemandCycleState(),
    "2026-08-15",
  );

  assert.equal(selectDemandCycleForDate(augustAgain, "2026-08-15"), "normal");
});

test("12. ユーザー向け表示名は夏季モードON/OFFへ統一", () => {
  assert.equal(getDemandCycleDisplayName("summer"), "夏季モード");
  assert.equal(getDemandCycleShortName("summer"), "ON");
  assert.equal(getDemandCycleShortName("normal"), "OFF");
  assert.equal(getDemandCycleBasisLabel("summer"), "夏季モード基準");
  assert.equal(getDemandCycleBasisLabel("normal"), "通常基準");
});

test("13. UIから旧ユーザー名称を除去し、夏季モード表示を接続", () => {
  const startSource = readRepoFile("src/components/screens/StartScreen.tsx");
  const appSource = readRepoFile("src/app/App.tsx");
  const routerSource = readRepoFile("src/app/AppRouter.tsx");
  const hookSource = readRepoFile("src/hooks/useNebikiApp.ts");

  assertNoUserFacingLegacyCycleName(startSource);
  assertNoUserFacingLegacyCycleName(appSource);
  assertNoUserFacingLegacyCycleName(hookSource);
  assert.match(startSource, /夏季モード/);
  assert.match(hookSource, /isSummerModeAvailable/);
  assert.match(hookSource, /loadFixedTimeDemandCycleState/);
  assert.match(hookSource, /saveFixedTimeDemandCycleState/);
  assert.match(startSource, /summerModeAvailable\s*\?\s*\(/);
  assert.match(routerSource, /isSummerModeAvailable\(state\.sessionDraft\.date\)/);
});

test("14. 夏季モードON・JST 17:59までは迷った時案内を表示", () => {
  const at1759Jst = Date.UTC(2026, 7, 15, 8, 59, 0);
  assert.equal(
    shouldShowSummerModeJudgeHint({
      demandCycle: "summer",
      businessDate: "2026-08-15",
      nowMs: at1759Jst,
    }),
    true,
  );

  assert.equal(
    shouldShowSummerModeJudgeHint({
      demandCycle: "normal",
      businessDate: "2026-08-15",
      nowMs: at1759Jst,
    }),
    false,
  );
  assert.equal(
    shouldShowSummerModeJudgeHint({
      demandCycle: "summer",
      businessDate: "2026-06-15",
      nowMs: Date.UTC(2026, 5, 15, 8, 59, 0),
    }),
    false,
  );
  assert.equal(
    shouldShowSummerModeJudgeHint({
      demandCycle: "summer",
      businessDate: "2026-08-14",
      nowMs: at1759Jst,
    }),
    false,
  );
});

test("15. JST 18:00以降は夏季モードの迷った時案内を表示しない", () => {
  const at1800Jst = Date.UTC(2026, 7, 15, 9, 0, 0);
  assert.equal(
    shouldShowSummerModeJudgeHint({
      demandCycle: "summer",
      businessDate: "2026-08-15",
      nowMs: at1800Jst,
    }),
    false,
  );
});

test("16. 迷った時案内はmode別に15/17境界と17/18境界だけを表示", () => {
  const dialogSource = readRepoFile("src/components/common/JudgeHintDialog.tsx");
  const rateSource = readRepoFile("src/components/screens/RateDisplayScreen.tsx");

  assert.match(dialogSource, /15時：/);
  assert.match(dialogSource, /17時以降：/);
  assert.match(dialogSource, /15時・17時：/);
  assert.match(dialogSource, /18時以降：/);
  assert.match(dialogSource, /少ない側/);
  assert.match(dialogSource, /多い側/);
  assert.match(dialogSource, /明らかに多い/);
  assert.match(dialogSource, /夕方.*夜/);
  assert.doesNotMatch(dialogSource, /夏季モード中（17:59まで）/);
  assert.match(rateSource, /<JudgeHintDialog[\s\S]*?demandCycle=\{demandCycle\}/);
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.run();
    passed += 1;
    console.log(`PASS: ${entry.name}`);
  } catch (error) {
    console.error(`FAIL: ${entry.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error(`${passed}/${tests.length} summer mode checks passed`);
} else {
  console.log(`${passed}/${tests.length} summer mode checks passed`);
}
