import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAY_BEFORE_HOLIDAY_NOTICE_TEXT,
  HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT,
  THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT,
} from "../src/components/common/DayBeforeHolidayNotice.ts";
import { shouldShowDayBeforeHolidayNotice } from "../src/domain/dayBeforeHolidayNotice.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  getBasisGuideDisplay,
  getIndividualAmountReferenceContext,
} from "../src/domain/weekdayBase.ts";
import type { DiscountTime } from "../src/domain/types.ts";

type TestEntry = { name: string; run: () => void | Promise<void> };
const tests: TestEntry[] = [];

function test(name: string, run: TestEntry["run"]): void {
  tests.push({ name, run });
}

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function referenceText(params: {
  date: string;
  weekday: number;
  discountTime?: DiscountTime;
}): string {
  const discountTime = params.discountTime ?? "17";
  return getBasisGuideDisplay({
    date: params.date,
    weekday: params.weekday,
    discountTime,
    weather: resolveWeatherInputForDiscount(
      {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      discountTime,
    ),
  }).referenceText;
}

test("天候確認画面は行名だけを天気へ変更", () => {
  const weatherPanel = source(
    "src/components/screens/WeatherConfirmationPanel.tsx",
  );
  assert.match(weatherPanel, /入力した天候を確認してください/);
  assert.match(weatherPanel, /aria-label="入力した天候の確認"/);
  assert.match(weatherPanel, /<th scope="row" style=\{rowHeaderStyle\}>\s*天気/);
  assert.doesNotMatch(
    weatherPanel,
    /<th scope="row" style=\{rowHeaderStyle\}>\s*天候/,
  );

  // 確認画面以外の既存UI用語まで一括置換していないことを確認する。
  assert.match(source("src/components/screens/StartScreen.tsx"), />天候</);
});

test("個別量の通常日は実曜日・同時刻を表示", () => {
  const context = getIndividualAmountReferenceContext({
    date: "2026-08-18",
    weekday: 2,
    discountTime: "17",
  });
  assert.deepEqual(
    {
      kind: context.kind,
      comparisonMode: context.comparisonMode,
      referenceWeekday: context.referenceWeekday,
      referenceWeekdayGroup: context.referenceWeekdayGroup,
      reason: context.reason,
    },
    {
      kind: "actual_weekday",
      comparisonMode: "weekday",
      referenceWeekday: 2,
      referenceWeekdayGroup: null,
      reason: "actual_weekday",
    },
  );
  assert.equal(
    referenceText({ date: "2026-08-18", weekday: 2 }),
    "火曜日の17時を基準に考えて",
  );
});

test("個別量の祝日前日は金曜日・土曜日を参照", () => {
  const context = getIndividualAmountReferenceContext({
    date: "2026-11-02",
    weekday: 1,
    discountTime: "17",
  });
  assert.equal(context.kind, "day_before_holiday");
  assert.equal(context.comparisonMode, "weekday_group");
  assert.equal(context.referenceWeekday, null);
  assert.equal(context.referenceWeekdayGroup, "金土");
  assert.equal(
    referenceText({ date: "2026-11-02", weekday: 1 }),
    "金曜日・土曜日の17時を基準に考えて",
  );
});

test("個別量の祝日当日は日曜日を参照", () => {
  const context = getIndividualAmountReferenceContext({
    date: "2026-07-20",
    weekday: 1,
    discountTime: "17",
  });
  assert.equal(context.kind, "holiday");
  assert.equal(context.comparisonMode, "weekday");
  assert.equal(context.referenceWeekday, 0);
  assert.equal(context.referenceWeekdayGroup, null);
  assert.equal(
    referenceText({ date: "2026-07-20", weekday: 1 }),
    "日曜日の17時を基準に考えて",
  );
});

test("三連休中日の既存特殊基準を祝日前日より優先", () => {
  const context = getIndividualAmountReferenceContext({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "17",
  });
  assert.equal(context.kind, "three_day_holiday_middle");
  assert.equal(context.comparisonMode, "three_day_holiday_middle");
  assert.equal(context.referenceWeekday, 0);
  assert.equal(context.referenceWeekdayGroup, "金土");
  assert.equal(
    referenceText({ date: "2026-07-19", weekday: 0 }),
    "通常の日曜夜と金曜・土曜夜の中間を基準に考えて",
  );
});

test("祝日当日かつ翌日も祝日の場合は祝日前日扱いせず日曜基準", () => {
  const context = getIndividualAmountReferenceContext({
    date: "2026-05-04",
    weekday: 1,
    discountTime: "17",
  });
  assert.equal(context.kind, "holiday");
  assert.equal(context.referenceWeekday, 0);
  assert.equal(context.referenceWeekdayGroup, null);
  assert.equal(context.referenceText, "日曜日の17時を基準に考えて");
  assert.equal(
    shouldShowDayBeforeHolidayNotice({
      sessionDate: "2026-05-04",
      discountTime: "17",
    }),
    false,
  );
});

test("三連休の初日・中日15時・最終日は既存の個別量基準を維持", () => {
  const first = getIndividualAmountReferenceContext({
    date: "2026-07-18",
    weekday: 6,
    discountTime: "17",
  });
  assert.equal(first.kind, "actual_weekday");
  assert.equal(first.referenceText, "土曜日の17時を基準に考えて");

  const middleAt15 = getIndividualAmountReferenceContext({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "15",
  });
  assert.equal(middleAt15.kind, "actual_weekday");
  assert.equal(middleAt15.referenceText, "日曜日の15時を基準に考えて");

  const last = getIndividualAmountReferenceContext({
    date: "2026-07-20",
    weekday: 1,
    discountTime: "17",
  });
  assert.equal(last.kind, "holiday");
  assert.equal(last.referenceText, "日曜日の17時を基準に考えて");
});

test("祝日説明は指示ではなく適用中基準の受動説明", () => {
  for (const text of [
    DAY_BEFORE_HOLIDAY_NOTICE_TEXT,
    HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT,
    THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT,
  ]) {
    assert.match(text, /基準になっています/);
    assert.doesNotMatch(text, /判断してください/);
  }
});

test("夏季モードの個別量表示に中黒区切りの夏接頭辞を付ける", () => {
  const rateScreen = source("src/components/screens/RateDisplayScreen.tsx");
  const router = source("src/app/AppRouter.tsx");
  const guide = getBasisGuideDisplay({
    date: "2026-08-04",
    weekday: 2,
    discountTime: "17",
    demandCycle: "summer",
    weather: resolveWeatherInputForDiscount(
      {
        hourlyForecasts: createDefaultHourlyForecasts(),
        afterRainSky: null,
      },
      "17",
    ),
  });
  assert.equal(guide.referenceConditionLabel, "夏・火曜日・17時");
  assert.match(rateScreen, /basisGuide\.referenceConditionLabel/);
  assert.match(router, /<RateDisplayScreen[\s\S]*?demandCycle=\{derived\.demandCycle\}/);
});

test("夏季モードの手動エリア判定へ基準を明示", () => {
  const areaScreen = source("src/components/screens/AreaJudgeScreen.tsx");
  const router = source("src/app/AppRouter.tsx");
  assert.match(areaScreen, /demandCycle === "summer"/);
  assert.match(areaScreen, /夏季モード基準：夏の残数基準で手動判定します。/);
  assert.doesNotMatch(areaScreen, /夏の\{weekdayText\}・\{timeText\}/);
  assert.match(router, /<AreaJudgeScreen[\s\S]*?demandCycle=\{derived\.demandCycle\}/);
});

test("迷ったらUIとstateはエリア判定だけ削除し個別量側は維持", () => {
  const areaScreen = source("src/components/screens/AreaJudgeScreen.tsx");
  const rateScreen = source("src/components/screens/RateDisplayScreen.tsx");
  const judgeHint = source("src/components/common/JudgeHintDialog.tsx");
  assert.doesNotMatch(areaScreen, /迷ったら…/);
  assert.doesNotMatch(areaScreen, /showJudgeHint/);
  assert.doesNotMatch(areaScreen, /JudgeHintDialog/);
  assert.match(rateScreen, /迷ったら…/);
  assert.match(rateScreen, /showJudgeHint/);
  assert.match(rateScreen, /JudgeHintDialog/);
  assert.doesNotMatch(judgeHint, /アウトパック/);
  assert.match(judgeHint, /大パックだけ値引/);
  assert.match(judgeHint, /近いものだけ値引/);
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

const summary = `${passed}/${tests.length} analysis metadata UI checks passed`;
if (process.exitCode) console.error(summary);
else console.log(summary);
