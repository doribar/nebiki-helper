import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  isDayBeforeJapaneseHoliday,
} from "../src/domain/japaneseHoliday.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../src/domain/dayBeforeHolidayNotice.ts";
import {
  DayBeforeHolidayNotice,
  DAY_BEFORE_HOLIDAY_NOTICE_TEXT,
  ThreeDayHolidayMiddleNotice,
  THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT,
} from "../src/components/common/DayBeforeHolidayNotice.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import type {
  ActualWeekdayGroup,
  ActualWeekdayLabel,
  DiscountTime,
} from "../src/domain/types.ts";

let passed = 0;

function test(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function expectGroup(params: {
  date: string;
  weekday: number;
  discountTime: DiscountTime;
  expected: ActualWeekdayGroup;
}) {
  assert.equal(getAreaCountFallbackWeekdayGroup(params), params.expected);
}

function makeRecord(params: {
  date: string;
  actualWeekday: ActualWeekdayLabel;
  actualWeekdayGroup: ActualWeekdayGroup;
  count: number;
  discountTime?: DiscountTime;
}): AreaCountRecord {
  return {
    date: params.date,
    sessionStartedAt: `${params.date}T08:00:00.000Z`,
    recordedAt: `${params.date}T08:01:00.000Z`,
    areaId: "bento_men",
    discountTime: params.discountTime ?? "17",
    actualWeekday: params.actualWeekday,
    actualWeekdayGroup: params.actualWeekdayGroup,
    count: params.count,
  };
}

test("1. 通常の月曜15時は月水", () => {
  expectGroup({ date: "2026-07-13", weekday: 1, discountTime: "15", expected: "月水" });
});

test("2. 通常の月曜17時は月水", () => {
  expectGroup({ date: "2026-07-13", weekday: 1, discountTime: "17", expected: "月水" });
});

test("3. 通常の火曜15時は火木", () => {
  expectGroup({ date: "2026-07-14", weekday: 2, discountTime: "15", expected: "火木" });
});

test("4. 通常の火曜17時は火木日", () => {
  expectGroup({ date: "2026-07-14", weekday: 2, discountTime: "17", expected: "火木日" });
});

test("5. 通常の金曜15時は金土日", () => {
  expectGroup({ date: "2026-07-17", weekday: 5, discountTime: "15", expected: "金土日" });
});

test("6. 通常の金曜17時は金土", () => {
  expectGroup({ date: "2026-07-17", weekday: 5, discountTime: "17", expected: "金土" });
});

test("7. 通常の日曜15時は金土日", () => {
  expectGroup({ date: "2026-07-12", weekday: 0, discountTime: "15", expected: "金土日" });
});

test("8. 通常の日曜17時は火木日", () => {
  expectGroup({ date: "2026-07-12", weekday: 0, discountTime: "17", expected: "火木日" });
});

test("9. 通常の日曜20時30分は火木日", () => {
  expectGroup({ date: "2026-07-12", weekday: 0, discountTime: "20", expected: "火木日" });
});

test("10. 2026年7月19日の15時は祝前日グループ金土日", () => {
  expectGroup({ date: "2026-07-19", weekday: 0, discountTime: "15", expected: "金土日" });
});

test("11. 2026年7月19日の17時は三連休中日", () => {
  expectGroup({ date: "2026-07-19", weekday: 0, discountTime: "17", expected: "三連休中日" });
});

test("12. 2026年7月19日の20時30分は三連休中日", () => {
  expectGroup({ date: "2026-07-19", weekday: 0, discountTime: "20", expected: "三連休中日" });
});

test("13. 平日の祝前日15時は金土日", () => {
  expectGroup({ date: "2026-11-02", weekday: 1, discountTime: "15", expected: "金土日" });
});

test("14. 平日の祝前日17時以降は金土", () => {
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    expectGroup({ date: "2026-11-02", weekday: 1, discountTime, expected: "金土" });
  }
});

test("15. 旧仕様の金曜17時履歴を金土として比較に利用", () => {
  const records = [
    makeRecord({ date: "2026-06-26", actualWeekday: "金", actualWeekdayGroup: "金土日", count: 10 }),
    makeRecord({ date: "2026-07-03", actualWeekday: "金", actualWeekdayGroup: "金土日", count: 12 }),
    makeRecord({ date: "2026-07-10", actualWeekday: "金", actualWeekdayGroup: "金土日", count: 14 }),
  ];
  const normalized = normalizeAreaCountRecords(records);
  assert.deepEqual(normalized.map((record) => record.actualWeekdayGroup), ["金土", "金土", "金土"]);

  const recommendation = getAreaCountRecommendation({
    records,
    areaId: "bento_men",
    discountTime: "17",
    weekday: 6,
    date: "2026-07-18",
    count: 12,
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.comparisonMode, "fallback_group");
  assert.equal(recommendation.matchedRecords.length, 3);
});

test("16. 旧仕様の日曜17時履歴を火木日として比較に利用", () => {
  const records = [
    makeRecord({ date: "2026-06-21", actualWeekday: "日", actualWeekdayGroup: "火木", count: 5 }),
    makeRecord({ date: "2026-06-28", actualWeekday: "日", actualWeekdayGroup: "火木", count: 7 }),
    makeRecord({ date: "2026-07-05", actualWeekday: "日", actualWeekdayGroup: "火木", count: 9 }),
  ];
  const normalized = normalizeAreaCountRecords(records);
  assert.deepEqual(normalized.map((record) => record.actualWeekdayGroup), ["火木日", "火木日", "火木日"]);

  const recommendation = getAreaCountRecommendation({
    records,
    areaId: "bento_men",
    discountTime: "17",
    weekday: 2,
    date: "2026-07-14",
    count: 7,
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.comparisonMode, "fallback_group");
  assert.equal(recommendation.matchedRecords.length, 3);
});

test("17. 三連休中日の旧履歴を日付と時刻から専用グループへ正規化", () => {
  const [normalized] = normalizeAreaCountRecords([
    makeRecord({
      date: "2026-07-19",
      actualWeekday: "日",
      actualWeekdayGroup: "金土日",
      count: 11,
    }),
  ]);
  assert.equal(normalized.actualWeekdayGroup, "三連休中日");
});

test("18. 新旧形式混在履歴を欠落・増殖なく中央値計算に利用", () => {
  const records = [
    makeRecord({ date: "2026-07-07", actualWeekday: "火", actualWeekdayGroup: "火木", count: 4 }),
    makeRecord({ date: "2026-07-14", actualWeekday: "火", actualWeekdayGroup: "火木日", count: 8 }),
    makeRecord({ date: "2026-07-09", actualWeekday: "木", actualWeekdayGroup: "火木", count: 6 }),
    makeRecord({ date: "2026-07-16", actualWeekday: "木", actualWeekdayGroup: "火木日", count: 10 }),
  ];
  const normalized = normalizeAreaCountRecords(records);
  assert.equal(normalized.length, records.length);
  assert.equal(new Set(normalized.map((record) => `${record.date}:${record.sessionStartedAt}`)).size, records.length);
  assert.ok(normalized.every((record) => record.actualWeekdayGroup === "火木日"));

  const recommendation = getAreaCountRecommendation({
    records,
    areaId: "bento_men",
    discountTime: "17",
    weekday: 0,
    date: "2026-08-02",
    count: 7,
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.comparisonMode, "fallback_group");
  assert.equal(recommendation.matchedRecords.length, 4);
  assert.equal(recommendation.medianCount, 7);
});

function getNoticeVisibility(params: {
  date: string;
  discountTime: DiscountTime;
}) {
  return shouldShowDayBeforeHolidayNotice({
    sessionDate: params.date,
    discountTime: params.discountTime,
  });
}

function getMiddleNoticeVisibility(params: {
  date: string;
  discountTime: DiscountTime;
}) {
  return shouldShowThreeDayHolidayMiddleNotice({
    sessionDate: params.date,
    discountTime: params.discountTime,
  });
}

test("注意1. 三連休中日の15時では一般注意も専用注意も表示しない", () => {
  const visible = getNoticeVisibility({
    date: "2026-07-19",
    discountTime: "15",
  });
  assert.equal(visible, false);
  assert.equal(getMiddleNoticeVisibility({ date: "2026-07-19", discountTime: "15" }), false);
  assert.equal(
    renderToStaticMarkup(createElement(DayBeforeHolidayNotice, { visible })),
    "",
  );
});

test("注意2. 三連休中日の17時では一般注意を表示しない", () => {
  assert.equal(
    getNoticeVisibility({
      date: "2026-07-19",
      discountTime: "17",
    }),
    false,
  );
});

test("注意3. 三連休中日の20時30分では専用注意を表示する", () => {
  assert.equal(
    getMiddleNoticeVisibility({
      date: "2026-07-19",
      discountTime: "20",
    }),
    true,
  );
});

test("注意4. 動作確認用に解決された祝前日は注意を表示する", () => {
  const resolvedTestDate = "2026-11-02";
  assert.equal(isDayBeforeJapaneseHoliday(resolvedTestDate), true);
  assert.equal(
    getNoticeVisibility({
      date: resolvedTestDate,
      discountTime: "18",
    }),
    true,
  );
});

test("注意5. 三連休中日は一般注意を出さず17時以降に専用注意を表示", () => {
  assert.equal(getNoticeVisibility({ date: "2026-07-19", discountTime: "15" }), false);
  assert.equal(getMiddleNoticeVisibility({ date: "2026-07-19", discountTime: "15" }), false);
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    assert.equal(getNoticeVisibility({ date: "2026-07-19", discountTime }), false);
    assert.equal(getMiddleNoticeVisibility({ date: "2026-07-19", discountTime }), true);
  }

  const markup = renderToStaticMarkup(createElement(DayBeforeHolidayNotice, { visible: true }));
  assert.ok(markup.includes(DAY_BEFORE_HOLIDAY_NOTICE_TEXT));
  assert.ok(markup.includes('role="note"'));
  assert.ok(markup.includes("font-weight:600") || markup.includes("<strong>"));
  assert.ok(markup.includes("border:"));
  assert.ok(markup.includes("background:"));
});

test("注意6. 三連休中日の19時では専用注意を表示する", () => {
  assert.equal(
    getMiddleNoticeVisibility({
      date: "2026-07-19",
      discountTime: "19",
    }),
    true,
  );
});

test("注意7. 三連休中日の20時30分では専用注意を表示する", () => {
  assert.equal(
    getMiddleNoticeVisibility({
      date: "2026-07-19",
      discountTime: "20",
    }),
    true,
  );
});

test("注意8. 通常日は全値引時刻で表示しない", () => {
  for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
      assert.equal(
        getNoticeVisibility({
          date: "2026-07-12",
          discountTime,
        }),
        false,
      );
  }
});

test("注意9. 注意表示条件は値引計算結果を変更しない", () => {
  const calculationInput = {
    discountTime: "17" as const,
    weatherBonus: 0,
    areaJudge: "normal" as const,
    isSunday: true,
    ignoreTimeRateCap: false,
    weekdayBase: "金土" as const,
  };
  const withoutNotice = getNormalTimeRateDisplay(calculationInput);
  assert.equal(
    getNoticeVisibility({
      date: "2026-07-19",
      discountTime: "17",
    }),
    false,
  );
  assert.equal(
    getNoticeVisibility({
      date: "2026-07-19",
      discountTime: "17",
    }),
    false,
  );
  assert.equal(
    getMiddleNoticeVisibility({
      date: "2026-07-19",
      discountTime: "17",
    }),
    true,
  );
  const withNotice = getNormalTimeRateDisplay(calculationInput);
  assert.deepEqual(withNotice, withoutNotice);
});

test("注意10. 三連休中日は15時が金土日、17時以降が専用グループ", () => {
  expectGroup({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "15",
    expected: "金土日",
  });
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    expectGroup({
      date: "2026-07-19",
      weekday: 0,
      discountTime,
      expected: "三連休中日",
    });
  }
});

test("注意11. 既存文言・表示位置・注意デザインを維持", () => {
  const weather = resolveWeatherInputForDiscount(
    { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    "17",
  );
  const guide = getBasisGuideDisplay({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "17",
    weather,
  });
  assert.equal(guide.referenceText, "通常の日曜夜と金曜・土曜夜の中間を基準に考えて");
  assert.equal(
    DAY_BEFORE_HOLIDAY_NOTICE_TEXT,
    "明日は祝日のため、金曜日・土曜日と同じ基準になっています。",
  );
  const middleMarkup = renderToStaticMarkup(
    createElement(ThreeDayHolidayMiddleNotice, { visible: true }),
  );
  assert.ok(middleMarkup.includes(THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT));
  assert.ok(middleMarkup.includes('aria-label="三連休中日の注意"'));

  const source = readFileSync(
    new URL("../src/components/screens/RateDisplayScreen.tsx", import.meta.url),
    "utf8",
  );
  const existingGuideIndex = source.indexOf("」のどれかを確認してください。");
  const noticeIndex = source.indexOf("<DayBeforeHolidayNotice", existingGuideIndex);
  const middleNoticeIndex = source.indexOf("<ThreeDayHolidayMiddleNotice", noticeIndex);
  const instructionIndex = source.indexOf("{currentRateInstructionStep", existingGuideIndex);
  assert.ok(existingGuideIndex >= 0);
  assert.ok(noticeIndex > existingGuideIndex);
  assert.ok(middleNoticeIndex > noticeIndex);
  assert.ok(instructionIndex > middleNoticeIndex);
});

if (process.exitCode) {
  console.error(`\n曜日グループ・祝前日注意テスト: ${passed}/29件成功`);
} else {
  console.log(`\n曜日グループ・祝前日注意テスト: ${passed}/29件成功`);
}
