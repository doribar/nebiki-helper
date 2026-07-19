import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAreaCountDecisionBasis,
  getAreaCountFallbackWeekdayGroup,
  getAreaCountRecommendation,
  normalizeAreaCountDecisionBasis,
  normalizeAreaCountRecords,
  type AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import { normalizeRemoteAreaCountRows } from "../src/domain/areaCountRemoteStorage.ts";
import {
  isThreeDayHolidayMiddle,
} from "../src/domain/japaneseHoliday.ts";
import {
  shouldShowDayBeforeHolidayNotice,
  shouldShowThreeDayHolidayMiddleNotice,
} from "../src/domain/dayBeforeHolidayNotice.ts";
import {
  ThreeDayHolidayMiddleNotice,
  THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT,
} from "../src/components/common/DayBeforeHolidayNotice.ts";
import { getNormalTimeRateDisplay } from "../src/domain/discount.ts";
import { getBasisGuideDisplay } from "../src/domain/weekdayBase.ts";
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

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function makeRecord(params: {
  date: string;
  discountTime: DiscountTime;
  count: number;
  savedGroup?: ActualWeekdayGroup;
  recordedAtSuffix?: string;
}): AreaCountRecord {
  const weekday = weekdayForDate(params.date);
  return {
    date: params.date,
    sessionStartedAt: `${params.date}T08:00:00.000Z`,
    recordedAt: `${params.date}T08:01:${params.recordedAtSuffix ?? "00"}.000Z`,
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

function datesForGroup(params: {
  group: "火木日" | "金土";
  discountTime: DiscountTime;
  count: number;
}): string[] {
  const dates: string[] = [];
  let date = "2026-01-05";
  while (date < "2026-07-19" && dates.length < params.count) {
    const weekday = weekdayForDate(date);
    if (
      getAreaCountFallbackWeekdayGroup({
        date,
        weekday,
        discountTime: params.discountTime,
      }) === params.group
    ) {
      dates.push(date);
    }
    date = addDays(date, 1);
  }
  assert.equal(dates.length, params.count);
  return dates;
}

function groupRecords(params: {
  discountTime: DiscountTime;
  fireThursdaySundayCounts?: number[];
  fridaySaturdayCounts?: number[];
}): AreaCountRecord[] {
  const fireCounts = params.fireThursdaySundayCounts ?? [];
  const fridayCounts = params.fridaySaturdayCounts ?? [];
  return [
    ...datesForGroup({ group: "火木日", discountTime: params.discountTime, count: fireCounts.length })
      .map((date, index) => makeRecord({ date, discountTime: params.discountTime, count: fireCounts[index] as number })),
    ...datesForGroup({ group: "金土", discountTime: params.discountTime, count: fridayCounts.length })
      .map((date, index) => makeRecord({ date, discountTime: params.discountTime, count: fridayCounts[index] as number })),
  ];
}

function middleRecommendation(params: {
  discountTime: DiscountTime;
  fireThursdaySundayCounts?: number[];
  fridaySaturdayCounts?: number[];
  extraRecords?: AreaCountRecord[];
  count?: number;
}) {
  return getAreaCountRecommendation({
    records: [
      ...groupRecords(params),
      ...(params.extraRecords ?? []),
    ],
    areaId: "bento_men",
    discountTime: params.discountTime,
    weekday: 0,
    date: "2026-07-19",
    count: params.count ?? 15,
  });
}

function specialNotice(date: string, discountTime: DiscountTime, trainingStep: TrainingStep) {
  return shouldShowThreeDayHolidayMiddleNotice({
    sessionDate: date,
    discountTime,
    trainingStep,
  });
}

test("1. 2026年7月18日（土）は中日ではない", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-07-18"), false);
});

test("2. 2026年7月19日（日）は三連休の中日", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-07-19"), true);
});

test("3. 2026年7月20日（月・祝）は中日ではない", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-07-20"), false);
});

test("4. 金曜祝日・土曜・日曜の並びでは土曜が中日", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-03-21"), true);
});

test("5. 通常の土日だけでは中日にならない", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-07-11"), false);
  assert.equal(isThreeDayHolidayMiddle("2026-07-12"), false);
});

test("6. 4日以上の連続休日の内部日は中日にしない", () => {
  assert.equal(isThreeDayHolidayMiddle("2026-05-03"), false);
  assert.equal(isThreeDayHolidayMiddle("2026-05-04"), false);
  assert.equal(isThreeDayHolidayMiddle("2026-05-05"), false);
});

test("7. 三連休中日の15時は金土日", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-19", weekday: 0, discountTime: "15" }), "金土日");
});

for (const [number, discountTime, label] of [
  [8, "17", "17時"],
  [9, "18", "18時30分"],
  [10, "19", "19時30分"],
  [11, "20", "20時30分"],
] as const) {
  test(`${number}. 三連休中日の${label}は中間基準`, () => {
    const recommendation = middleRecommendation({
      discountTime,
      fireThursdaySundayCounts: [10, 10, 10],
      fridaySaturdayCounts: [20, 20, 20],
    });
    assert.equal(recommendation.status, "ready");
    assert.equal(recommendation.actualWeekdayGroup, "三連休中日");
    assert.equal(recommendation.comparisonMode, "three_day_holiday_middle");
    assert.equal(recommendation.medianCount, 15);
  });
}

test("12. 通常の日曜17時は火木日", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-12", weekday: 0, discountTime: "17" }), "火木日");
});

test("13. 通常の金曜17時は金土", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-17", weekday: 5, discountTime: "17" }), "金土");
});

test("14. 中日ではない祝前日17時は金土", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-11-02", weekday: 1, discountTime: "17" }), "金土");
});

test("15. 火木日10・金土20なら中間基準は15", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [20, 20, 20],
  });
  assert.equal(recommendation.medianCount, 15);
  assert.equal(recommendation.threeDayHolidayMiddleReference?.adoptedSource, "both");
});

test("16. 小数の中間値を丸めず判定と保存根拠へ渡す", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [11, 11, 11],
    count: 9,
  });
  assert.equal(recommendation.medianCount, 10.5);
  assert.equal(recommendation.lowerSmallThreshold, 8.5);
  assert.equal(recommendation.baseEvaluation, "normal");
  const normalizedBasis = normalizeAreaCountDecisionBasis(
    buildAreaCountDecisionBasis({ recommendation }),
  );
  assert.equal(normalizedBasis?.medianCount, 10.5);
  assert.equal(normalizedBasis?.lowerSmallThreshold, 8.5);
});

test("17. 火木日だけ有効なら火木日基準を使用", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [20, 20],
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.medianCount, 10);
  assert.equal(recommendation.threeDayHolidayMiddleReference?.adoptedSource, "火木日");
});

test("18. 金土だけ有効なら金土基準を使用", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10],
    fridaySaturdayCounts: [20, 20, 20],
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.medianCount, 20);
  assert.equal(recommendation.threeDayHolidayMiddleReference?.adoptedSource, "金土");
});

test("19. 両方無効なら既存の履歴不足処理", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10],
    fridaySaturdayCounts: [20, 20],
  });
  assert.equal(recommendation.status, "insufficient");
  assert.equal(recommendation.threeDayHolidayMiddleReference?.adoptedSource, "none");
});

test("20. 履歴件数差があっても50対50で合成", () => {
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: Array.from({ length: 16 }, () => 10),
    fridaySaturdayCounts: [20, 20, 20],
  });
  assert.equal(recommendation.medianCount, 15);
  assert.notEqual(recommendation.medianCount, (10 * 16 + 20 * 3) / 19);
});

test("21. 新規の三連休中日17時履歴は専用グループで保存", () => {
  assert.equal(getAreaCountFallbackWeekdayGroup({ date: "2026-07-19", weekday: 0, discountTime: "17" }), "三連休中日");
  const hookSource = readFileSync(new URL("../src/hooks/useNebikiApp.ts", import.meta.url), "utf8");
  assert.ok(hookSource.includes("actualWeekdayGroup: getAreaCountFallbackWeekdayGroup"));
  const sqlSource = readFileSync(
    new URL("../supabase_area_count_records.sql", import.meta.url),
    "utf8",
  );
  assert.ok(sqlSource.includes("'三連休中日'"));
});

test("22. 過去の中日履歴は旧グループ名でも専用グループへ再分類", () => {
  const legacyGroups: ActualWeekdayGroup[] = ["金土", "火木日", "金土日", "火木"];
  const normalized = normalizeAreaCountRecords(
    legacyGroups.map((savedGroup, index) => makeRecord({
      date: "2026-03-21",
      discountTime: "17",
      count: 10 + index,
      savedGroup,
      recordedAtSuffix: `0${index}`,
    })),
  );
  assert.equal(normalized.length, legacyGroups.length);
  assert.ok(normalized.every((record) => record.actualWeekdayGroup === "三連休中日"));
});

test("23. 三連休中日の実績は火木日基準へ混ざらない", () => {
  const legacyMiddle = makeRecord({
    date: "2026-03-21",
    discountTime: "17",
    count: 999,
    savedGroup: "火木日",
  });
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [20, 20, 20],
    extraRecords: [legacyMiddle],
  });
  assert.equal(recommendation.threeDayHolidayMiddleReference?.fireThursdaySundayMedianCount, 10);
  assert.ok(recommendation.matchedRecords.every((record) => record.date !== "2026-03-21"));
});

test("24. 三連休中日の実績は金土基準へ混ざらない", () => {
  const legacyMiddle = makeRecord({
    date: "2026-03-21",
    discountTime: "17",
    count: 999,
    savedGroup: "金土",
  });
  const recommendation = middleRecommendation({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [20, 20, 20],
    extraRecords: [legacyMiddle],
  });
  assert.equal(recommendation.threeDayHolidayMiddleReference?.fridaySaturdayMedianCount, 20);
  assert.ok(recommendation.matchedRecords.every((record) => record.date !== "2026-03-21"));
});

test("25. ローカル履歴とSupabase履歴へ同じ正規化を適用", () => {
  const localRecord = makeRecord({
    date: "2026-03-21",
    discountTime: "17",
    count: 12,
    savedGroup: "金土",
  });
  const [localNormalized] = normalizeAreaCountRecords([localRecord]);
  const [remoteNormalized] = normalizeRemoteAreaCountRows([{
    date: localRecord.date,
    session_started_at: localRecord.sessionStartedAt,
    recorded_at: localRecord.recordedAt,
    area_id: localRecord.areaId,
    discount_time: localRecord.discountTime,
    actual_weekday: localRecord.actualWeekday,
    actual_weekday_group: "金土",
    count: localRecord.count,
  }]);
  assert.equal(localNormalized?.actualWeekdayGroup, "三連休中日");
  assert.equal(remoteNormalized?.actualWeekdayGroup, localNormalized?.actualWeekdayGroup);
});

test("26. 新旧形式混在でも比較時に重複・欠落しない", () => {
  const records = groupRecords({
    discountTime: "17",
    fireThursdaySundayCounts: [10, 10, 10],
    fridaySaturdayCounts: [20, 20, 20],
  });
  const duplicate = {
    ...records[0] as AreaCountRecord,
    recordedAt: `${records[0]?.date}T09:00:00.000Z`,
    actualWeekdayGroup: "火木" as const,
  };
  const recommendation = middleRecommendation({
    discountTime: "17",
    extraRecords: [...records, duplicate],
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.matchedRecords.length, 6);
  assert.equal(new Set(recommendation.matchedRecords.map((record) => record.date)).size, 6);
  assert.equal(recommendation.medianCount, 15);
});

test("27. 三連休中日のStep1では専用注意を表示しない", () => {
  for (const discountTime of ["17", "18", "19", "20"] as const) {
    assert.equal(specialNotice("2026-07-19", discountTime, "step1"), false);
  }
});

test("28. Step2〜Step8の17時以降は専用注意を表示", () => {
  for (const trainingStep of TRAINING_STEPS.filter((step) => step !== "step1")) {
    for (const discountTime of ["17", "18", "19", "20"] as const) {
      assert.equal(specialNotice("2026-07-19", discountTime, trainingStep), true);
    }
  }
  const markup = renderToStaticMarkup(
    createElement(ThreeDayHolidayMiddleNotice, { visible: true }),
  );
  assert.ok(markup.includes(THREE_DAY_HOLIDAY_MIDDLE_NOTICE_TEXT));
  assert.ok(markup.includes("border:"));
  assert.ok(markup.includes("background:"));
});

test("29. 三連休中日の15時では専用注意を表示しない", () => {
  for (const trainingStep of TRAINING_STEPS) {
    assert.equal(specialNotice("2026-07-19", "15", trainingStep), false);
    assert.equal(shouldShowDayBeforeHolidayNotice({
      sessionDate: "2026-07-19",
      discountTime: "15",
      trainingStep,
    }), false);
  }
});

test("30. 三連休中日は一般の祝前日注意と二重表示しない", () => {
  assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-07-19", discountTime: "17", trainingStep: "step5" }), false);
  assert.equal(specialNotice("2026-07-19", "17", "step5"), true);
});

test("31. 通常の日曜には専用注意を表示しない", () => {
  assert.equal(specialNotice("2026-07-12", "17", "step5"), false);
});

test("32. 中日ではない祝前日は従来の一般注意を表示", () => {
  assert.equal(shouldShowDayBeforeHolidayNotice({ sessionDate: "2026-11-02", discountTime: "17", trainingStep: "step5" }), true);
  assert.equal(specialNotice("2026-11-02", "17", "step5"), false);
});

test("33. 表示条件は値引率計算を変えず、中間の基準案内だけを変更", () => {
  const input = {
    discountTime: "17" as const,
    weatherBonus: 0,
    areaJudge: "normal" as const,
    isSunday: true,
    ignoreTimeRateCap: false,
    weekdayBase: "金土" as const,
  };
  const before = getNormalTimeRateDisplay(input);
  specialNotice("2026-07-19", "17", "step5");
  const after = getNormalTimeRateDisplay(input);
  assert.deepEqual(after, before);

  const weather = resolveWeatherInputForDiscount(
    { hourlyForecasts: createDefaultHourlyForecasts(), afterRainSky: null },
    "17",
  );
  assert.equal(
    getBasisGuideDisplay({ date: "2026-07-19", weekday: 0, discountTime: "17", weather }).referenceText,
    "通常の日曜夜と金曜・土曜夜の中間を基準に考えて",
  );
});

if (process.exitCode) {
  console.error(`\n三連休中日テスト: ${passed}/33件成功`);
} else {
  console.log(`\n三連休中日テスト: ${passed}/33件成功`);
}
