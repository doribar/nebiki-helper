import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getAreaCountComparisonWeekdayGroup,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import {
  isHolidayBeforeNormalWeekday,
  isJapaneseHolidayOrObserved,
  isNormalWeekday,
  isThreeDayHolidayMiddle,
} from "../src/domain/japaneseHoliday.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowHolidayBeforeNormalWeekdayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../src/domain/dayBeforeHolidayNotice.ts";
import {
  HolidayBeforeNormalWeekdayNotice,
  HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT,
} from "../src/components/common/DayBeforeHolidayNotice.ts";
import { getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import { TRAINING_STEPS, type TrainingStep } from "../src/domain/trainingMode.ts";
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

function weekdayForDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function weekdayLabel(weekday: number): ActualWeekdayLabel {
  return (["日", "月", "火", "水", "木", "金", "土"] as const)[weekday] ?? "日";
}

function makeRecord(params: {
  date: string;
  discountTime: DiscountTime;
  count: number;
  savedGroup?: ActualWeekdayGroup;
  sessionSuffix?: string;
}): AreaCountRecord {
  const weekday = weekdayForDate(params.date);
  const suffix = params.sessionSuffix ?? "00";
  return {
    date: params.date,
    sessionStartedAt: `${params.date}T08:${suffix}:00.000Z`,
    recordedAt: `${params.date}T08:${suffix}:30.000Z`,
    areaId: "bento_men",
    discountTime: params.discountTime,
    actualWeekday: weekdayLabel(weekday),
    actualWeekdayGroup: params.savedGroup ?? getAreaCountFallbackWeekdayGroup({
      date: params.date,
      weekday,
      discountTime: params.discountTime,
    }),
    count: params.count,
  };
}

function recommendation(params: {
  date: string;
  discountTime: DiscountTime;
  records: AreaCountRecord[];
  count?: number;
}) {
  return getAreaCountRecommendation({
    records: params.records,
    areaId: "bento_men",
    discountTime: params.discountTime,
    weekday: weekdayForDate(params.date),
    date: params.date,
    count: params.count ?? 15,
  });
}

function normalGroupRecords(discountTime: DiscountTime, count: number): AreaCountRecord[] {
  const dates = discountTime === "15"
    ? ["2026-07-03", "2026-07-04", "2026-07-05"]
    : ["2026-07-07", "2026-07-09", "2026-07-12"];
  return dates.map((date) => makeRecord({ date, discountTime, count }));
}

function targetNotice(date: string, discountTime: DiscountTime, trainingStep: TrainingStep) {
  return shouldShowHolidayBeforeNormalWeekdayNotice({
    sessionDate: date,
    discountTime,
    trainingStep,
  });
}

function weatherFor(discountTime: DiscountTime) {
  return resolveWeatherInputForDiscount(
    { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    discountTime,
  );
}

test("1. 2026年7月20日（月・祝）は対象になる", () => {
  assert.equal(isJapaneseHolidayOrObserved("2026-07-20"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2026-07-20"), true);
});

test("2. 翌日の2026年7月21日（火）は通常の平日", () => {
  assert.equal(isNormalWeekday("2026-07-21"), true);
});

test("3. 祝日だが翌日が土曜日の場合は対象外", () => {
  assert.equal(isJapaneseHolidayOrObserved("2026-03-20"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2026-03-20"), false);
});

test("4. 祝日だが翌日が日曜日の場合は対象外", () => {
  assert.equal(isJapaneseHolidayOrObserved("2028-01-01"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2028-01-01"), false);
});

test("5. 祝日だが翌日も祝日の場合は対象外", () => {
  assert.equal(isJapaneseHolidayOrObserved("2026-05-04"), true);
  assert.equal(isJapaneseHolidayOrObserved("2026-05-05"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2026-05-04"), false);
});

test("6. 通常の平日は対象外", () => {
  assert.equal(isHolidayBeforeNormalWeekday("2026-07-21"), false);
});

test("7. 通常の日曜日は対象外", () => {
  assert.equal(isHolidayBeforeNormalWeekday("2026-07-12"), false);
});

test("8. 振替休日で翌日が通常の平日なら対象になる", () => {
  assert.equal(isJapaneseHolidayOrObserved("2026-05-06"), true);
  assert.equal(isNormalWeekday("2026-05-07"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2026-05-06"), true);
});

test("9. 対象日の15時は金土日を比較基準にする", () => {
  assert.equal(getAreaCountComparisonWeekdayGroup({ date: "2026-07-20", weekday: 1, discountTime: "15" }), "金土日");
});

for (const [number, discountTime] of [[10, "17"], [11, "18"], [12, "19"], [13, "20"]] as const) {
  test(`${number}. 対象日の${discountTime}時系は火木日を比較基準にする`, () => {
    assert.equal(getAreaCountComparisonWeekdayGroup({ date: "2026-07-20", weekday: 1, discountTime }), "火木日");
  });
}

test("14. 通常の日曜15時は金土日", () => {
  assert.equal(getAreaCountComparisonWeekdayGroup({ date: "2026-07-12", weekday: 0, discountTime: "15" }), "金土日");
});

test("15. 通常の日曜17時は火木日", () => {
  assert.equal(getAreaCountComparisonWeekdayGroup({ date: "2026-07-12", weekday: 0, discountTime: "17" }), "火木日");
});

test("16. 通常の祝前日17時は金土", () => {
  assert.equal(getAreaCountComparisonWeekdayGroup({ date: "2026-11-02", weekday: 1, discountTime: "17" }), "金土");
});

test("17. 三連休中日17時は既存の50対50中間基準", () => {
  const records = [
    ...normalGroupRecords("17", 10),
    ...["2026-06-26", "2026-07-03", "2026-07-04"].map((date) => makeRecord({ date, discountTime: "17", count: 20 })),
  ];
  const result = recommendation({ date: "2026-07-19", discountTime: "17", records });
  assert.equal(result.comparisonMode, "three_day_holiday_middle");
  assert.equal(result.medianCount, 15);
});

test("18. 三連休中日の判定を最優先して隔離する", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-07-19"), true);
  assert.equal(isHolidayBeforeNormalWeekday("2026-07-19"), false);
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-19", weekday: 0, discountTime: "17" }), "三連休中日");
});

test("19. 対象日は実曜日グループより優先される", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-20", weekday: 1, discountTime: "15" }), "翌日平日祝日");
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-20", weekday: 1, discountTime: "17" }), "翌日平日祝日");
});

test("20. 対象外の祝前日は従来どおり金土", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-11-02", weekday: 1, discountTime: "17" }), "金土");
});

test("21. 通常日は従来の曜日グループ", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-13", weekday: 1, discountTime: "15" }), "月水");
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-17", weekday: 5, discountTime: "17" }), "金土");
});

test("22. 対象日の新規履歴は全時刻で翌日平日祝日として保存", () => {
  for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
    assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-20", weekday: 1, discountTime }), "翌日平日祝日");
  }
  const hookSource = readFileSync("src/hooks/useNebikiApp.ts", "utf8");
  assert.ok(hookSource.includes("actualWeekdayGroup: getAreaCountFallbackWeekdayGroup"));
});

test("23. 対象日の15時履歴は通常の金土日履歴へ混ざらない", () => {
  const targetHistory = makeRecord({ date: "2026-07-20", discountTime: "15", count: 99, savedGroup: "金土日" });
  const result = recommendation({
    date: "2026-08-11",
    discountTime: "15",
    records: [...normalGroupRecords("15", 10), targetHistory],
  });
  assert.equal(result.comparisonMode, "holiday_before_normal_weekday");
  assert.equal(result.medianCount, 10);
  assert.equal(result.matchedRecords.some((record) => record.date === "2026-07-20"), false);
});

test("24. 対象日の17時以降履歴は通常の火木日履歴へ混ざらない", () => {
  const targetHistory = makeRecord({ date: "2026-07-20", discountTime: "17", count: 99, savedGroup: "火木日" });
  const result = recommendation({
    date: "2026-08-11",
    discountTime: "17",
    records: [...normalGroupRecords("17", 20), targetHistory],
  });
  assert.equal(result.comparisonMode, "holiday_before_normal_weekday");
  assert.equal(result.medianCount, 20);
  assert.equal(result.matchedRecords.some((record) => record.date === "2026-07-20"), false);
});

test("25. 過去の対象日履歴は旧グループ名でも再分類", () => {
  const oldGroups: ActualWeekdayGroup[] = ["月水", "火木", "火木日", "金土", "金土日"];
  const normalized = normalizeAreaCountRecords(oldGroups.map((savedGroup, index) => makeRecord({
    date: "2026-07-20",
    discountTime: index === 0 ? "15" : "17",
    count: index + 1,
    savedGroup,
    sessionSuffix: `0${index}`,
  })));
  assert.equal(normalized.length, oldGroups.length);
  assert.ok(normalized.every((record) => record.actualWeekdayGroup === "翌日平日祝日"));
});

test("26. ローカル履歴とSupabase履歴で同じ正規化結果", () => {
  const local = makeRecord({ date: "2026-07-20", discountTime: "17", count: 8, savedGroup: "月水" });
  const localNormalized = normalizeAreaCountRecords([local])[0];
  const remoteNormalized = normalizeRemoteAreaCountRows([{
    date: local.date,
    session_started_at: local.sessionStartedAt,
    recorded_at: local.recordedAt,
    area_id: local.areaId,
    discount_time: local.discountTime,
    actual_weekday: local.actualWeekday,
    actual_weekday_group: "金土日",
    count: local.count,
  }])[0];
  assert.equal(localNormalized?.actualWeekdayGroup, "翌日平日祝日");
  assert.equal(remoteNormalized?.actualWeekdayGroup, localNormalized?.actualWeekdayGroup);
});

test("27. 三連休中日の履歴分類へ影響しない", () => {
  const normalized = normalizeAreaCountRecords([
    makeRecord({ date: "2026-07-19", discountTime: "17", count: 9, savedGroup: "火木日" }),
  ])[0];
  assert.equal(normalized?.actualWeekdayGroup, "三連休中日");
});

test("28. 新旧履歴混在時に重複や欠落がない", () => {
  const mixed = [
    makeRecord({ date: "2026-05-06", discountTime: "17", count: 7, savedGroup: "火木日" }),
    makeRecord({ date: "2026-07-20", discountTime: "17", count: 8, savedGroup: "翌日平日祝日" }),
  ];
  const normalized = normalizeAreaCountRecords(mixed);
  assert.equal(normalized.length, 2);
  assert.equal(new Set(normalized.map((record) => record.date)).size, 2);
  assert.ok(normalized.every((record) => record.actualWeekdayGroup === "翌日平日祝日"));
});

test("29. 対象日のStep1では専用注意を表示しない", () => {
  for (const discountTime of ["15", "17", "18", "19", "20"] as const) {
    assert.equal(targetNotice("2026-07-20", discountTime, "step1"), false);
  }
});

test("30. 対象日のStep2〜Step8では専用注意を表示", () => {
  for (const trainingStep of TRAINING_STEPS.filter((step) => step !== "step1")) {
    assert.equal(targetNotice("2026-07-20", "15", trainingStep), true);
    assert.equal(targetNotice("2026-07-20", "17", trainingStep), true);
  }
  const markup = renderToStaticMarkup(createElement(HolidayBeforeNormalWeekdayNotice, { visible: true }));
  assert.ok(markup.includes(HOLIDAY_BEFORE_NORMAL_WEEKDAY_NOTICE_TEXT));
  assert.ok(markup.includes("border:"));
  assert.ok(markup.includes("background:"));
});

test("31. 15時でも専用注意を表示", () => {
  assert.equal(targetNotice("2026-07-20", "15", "step2"), true);
});

test("32. 17時以降でも専用注意を表示", () => {
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    assert.equal(targetNotice("2026-07-20", discountTime, "step8"), true);
  }
});

test("33. 三連休中日の注意と二重表示しない", () => {
  assert.equal(targetNotice("2026-07-19", "17", "step5"), false);
  assert.equal(shouldShowThreeDayHolidayMiddleNotice({ sessionDate: "2026-07-19", discountTime: "17", trainingStep: "step5" }), true);
});

test("34. 一般の祝前日注意と二重表示しない", () => {
  assert.equal(targetNotice("2026-07-20", "17", "step5"), true);
  assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-07-20", discountTime: "17", trainingStep: "step5" }), false);
});

test("35. 通常日には専用注意を表示しない", () => {
  assert.equal(targetNotice("2026-07-21", "15", "step5"), false);
  assert.equal(targetNotice("2026-07-12", "17", "step5"), false);
});

test("36. 基準案内は全時刻で日曜日の同時刻と一致", () => {
  const expected = new Map<DiscountTime, string>([
    ["15", "日曜日の15時を基準に考えて"],
    ["17", "日曜日の17時を基準に考えて"],
    ["18", "日曜日の18時30分を基準に考えて"],
    ["19", "日曜日の19時30分を基準に考えて"],
    ["20", "日曜日の20時30分を基準に考えて"],
  ]);
  for (const [discountTime, referenceText] of expected) {
    assert.equal(getBasisGuideDisplay({
      date: "2026-07-20",
      weekday: 1,
      discountTime,
      weather: weatherFor(discountTime),
    }).referenceText, referenceText);
  }
});

test("37. 表示条件によって値引計算結果は変化しない", () => {
  const input = {
    discountTime: "17" as const,
    weatherBonus: 0,
    areaJudge: "normal" as const,
    isSunday: false,
    ignoreTimeRateCap: false,
    weekdayBase: "月水" as const,
  };
  const before = getNormalTimeRateDisplay(input);
  targetNotice("2026-07-20", "17", "step5");
  const after = getNormalTimeRateDisplay(input);
  assert.deepEqual(after, before);

  const sql = readFileSync("supabase_area_count_records.sql", "utf8");
  assert.ok(sql.includes("翌日平日祝日"));
});

if (process.exitCode) {
  console.error(`\n翌日平日祝日テスト: ${passed}/37件成功`);
} else {
  console.log(`\n翌日平日祝日テスト: ${passed}/37件成功`);
}
