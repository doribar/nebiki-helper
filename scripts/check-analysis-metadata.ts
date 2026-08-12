import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAnalysisWeatherContext,
  buildProductionAnalysis,
  buildProductionShortageSuspicion,
  buildSessionAnalysisCalendarContext,
  chooseBestAnalysisWeatherContext,
  mergeProductionAnalyses,
  normalizeAnalysisCalendarContext,
  normalizeProductionAnalysis,
  type ProductionAnalysis,
  type ProductionShortageCheckpoint,
} from "../src/domain/analysisMetadata.ts";
import type {
  AreaCountDecisionBasis,
  AreaCountRecord,
} from "../src/domain/areaCountHistory.ts";
import {
  buildRemoteAreaCountRow,
  normalizeRemoteAreaCountRows,
} from "../src/domain/areaCountRemoteStorage.ts";
import { buildAllDataExportPayload } from "../src/domain/allDataExport.ts";
import { getNormalRoute } from "../src/domain/area.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import {
  createHumanEvaluationSelection,
  createReview19HumanEvaluationDetails,
  getLegacyHumanEvaluationDetails,
  resolveHumanEvaluationForDiscount,
} from "../src/domain/humanEvaluation.ts";
import {
  buildReview19DataQuality,
  buildReview19ExportPayload,
  createInitialReview19Result,
  normalizeReview19Result,
} from "../src/domain/review19.ts";
import {
  buildRemoteReview19Row,
  normalizeRemoteReview19Row,
} from "../src/domain/review19RemoteStorage.ts";
import {
  createReview19DaySnapshot,
  createReview19Reference,
  getLatestReview19DayCheck,
} from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import { saveReview19Records, STORAGE_KEYS } from "../src/domain/storage.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  DailySessionSnapshot,
  DemandCycle,
  DiscountTime,
  HumanEvaluationDetails,
  Review19AreaSnapshot,
  Review19DayCheckSnapshot,
  Review19Result,
  WeatherInput,
} from "../src/domain/types.ts";

let passed = 0;
let failed = 0;

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS: ${String(passed + failed).padStart(2, "0")}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${String(passed + failed).padStart(2, "0")}. ${name}`);
    console.error(error);
  }
}

const DATE = "2026-08-11";
const AREA_ID: AreaId = "bento_men";
const ALL_AREAS = getNormalRoute(DATE);
const OTHER_AREAS = ALL_AREAS.filter((areaId) => areaId !== AREA_ID);

function readyBasis(
  discountTime: DiscountTime,
  comparisonMode: AreaCountDecisionBasis["comparisonMode"] = "holiday_before_normal_weekday",
): AreaCountDecisionBasis {
  return {
    ruleVersion: "area_count_median_v1",
    demandCycle: "summer",
    evaluationSource: "manual",
    recommendationStatus: "ready",
    actualWeekday: "火",
    actualWeekdayGroup:
      comparisonMode === "holiday_before_normal_weekday"
        ? "翌日平日祝日"
        : discountTime === "15"
          ? "金土日"
          : "火木日",
    comparisonMode,
    sampleSize: 3,
    requiredSampleSize: 3,
  };
}

function makeWeather(
  kind: "sunny" | "rain" | "snow" = "sunny",
): WeatherInput {
  const hourlyForecasts = createDefaultHourlyForecasts();
  for (const hour of Object.keys(hourlyForecasts) as Array<keyof typeof hourlyForecasts>) {
    hourlyForecasts[hour] = { ...hourlyForecasts[hour], weather: kind };
  }
  return { hourlyForecasts, afterRainSky: null };
}

function humanDetails(
  evaluation: AreaCountEvaluation,
  discountTime: "15" | "17",
): HumanEvaluationDetails {
  const selection = createHumanEvaluationSelection(evaluation);
  assert.ok(selection);
  const evaluatedAt = `${DATE}T0${discountTime === "15" ? "6" : "8"}:05:00.000Z`;
  return resolveHumanEvaluationForDiscount({
    selection,
    demandCycle: "summer",
    sessionDiscountTime: discountTime,
    evaluatedAt,
    nowMs: Date.parse(evaluatedAt),
  });
}

function makeSession(params: {
  discountTime: "15" | "17";
  demandCycle?: DemandCycle;
  humanEvaluationDetails?: HumanEvaluationDetails;
  legacyEvaluation?: AreaCountEvaluation;
  evaluationSource?: "manual" | "history";
  weather?: WeatherInput;
}): DailySessionSnapshot {
  const demandCycle = params.demandCycle ?? "summer";
  const startedAt = `${DATE}T${params.discountTime === "15" ? "06" : "08"}:00:00.000Z`;
  const weather = params.weather ?? makeWeather("rain");
  const evaluation =
    params.legacyEvaluation ?? params.humanEvaluationDetails?.resolvedEvaluation;
  const evaluationSource = params.evaluationSource ?? "manual";
  const basis = {
    ...readyBasis(params.discountTime),
    evaluationSource,
    finalEvaluation: evaluation,
  };
  const calendarContext = buildSessionAnalysisCalendarContext({
    date: DATE,
    weekday: 2,
    discountTime: params.discountTime,
    sessionStartedAt: startedAt,
    manualWeekdayOverride: false,
    areaDecisionBases: [{ areaId: AREA_ID, basis }],
  });
  const area: Review19AreaSnapshot = {
    areaId: AREA_ID,
    areaName: "匿名エリア",
    status: "completed",
    areaJudge: "normal",
    areaCount: 10,
    areaCountEvaluation: evaluation,
    areaCountEvaluationSource: evaluationSource,
    humanEvaluationDetails: params.humanEvaluationDetails,
    areaCountDecisionBasis: basis,
    judgeText: "匿名",
    rateText: "匿名",
    rateDecisionSnapshotStatus: "legacy_not_captured",
    measurementStatus: "measured",
  };
  return {
    version: 1,
    capturedAt: `${DATE}T${params.discountTime === "15" ? "06" : "08"}:30:00.000Z`,
    demandCycle,
    calendarContext,
    analysisWeatherContext: buildAnalysisWeatherContext(
      weather,
      params.discountTime,
    ),
    screen: "done",
    sessionEndReason: "completed",
    session: {
      date: DATE,
      weekday: 2,
      discountTime: params.discountTime,
      demandCycle,
      startedAt,
      manualWeekdayOverride: false,
      manualDiscountTimeOverride: false,
      weather,
      resolvedWeather: resolveWeatherInputForDiscount(weather, params.discountTime),
    },
    basis: {
      baseRateBonus: 0,
      lateTimeBonus: 0,
      totalRateBonus: 0,
      baseRateBonusReason: [],
    },
    areas: { [AREA_ID]: area } as Record<AreaId, Review19AreaSnapshot>,
    doneSummaryItems: [],
    currentAreaId: null,
    review19ExcludedAreaIds: [],
  };
}

function makeAreaRecord(
  session: DailySessionSnapshot,
  details: HumanEvaluationDetails,
): AreaCountRecord {
  const basis = session.areas[AREA_ID].areaCountDecisionBasis;
  return {
    date: DATE,
    demandCycle: "summer",
    sessionStartedAt: session.session.startedAt,
    recordedAt: session.capturedAt,
    areaId: AREA_ID,
    discountTime: session.session.discountTime,
    actualWeekday: "火",
    actualWeekdayGroup: "翌日平日祝日",
    count: 10,
    humanEvaluationDetails: details,
    suggestedEvaluation: session.areas[AREA_ID].areaCountEvaluation,
    evaluationSource: "manual",
    decisionBasis: basis,
    calendarContext: session.calendarContext,
    analysisWeatherContext: session.analysisWeatherContext,
  };
}

function checkpoint(
  discountTime: "15" | "17" | "19",
  rawScore9: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): ProductionShortageCheckpoint {
  return { discountTime, status: "recorded", rawScore9, sourceScale: 9 };
}

function makeStrongAnalysis(): ProductionAnalysis {
  const area = buildProductionShortageSuspicion({
    areaId: AREA_ID,
    checkpoints: {
      "15": checkpoint("15", 1),
      "17": checkpoint("17", 3),
      "19": checkpoint("19", 4),
    },
  });
  return {
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas: { [AREA_ID]: area },
  };
}

function makeIntegratedFixture(): {
  day: ReturnType<typeof createReview19DaySnapshot>;
  result: Review19Result;
  records: AreaCountRecord[];
} {
  const at15Details = humanDetails("few", "15");
  const at17Details = humanDetails("slightly_few", "17");
  const at15 = makeSession({ discountTime: "15", humanEvaluationDetails: at15Details });
  const at17 = makeSession({ discountTime: "17", humanEvaluationDetails: at17Details });
  const records = [
    makeAreaRecord(at15, at15Details),
    makeAreaRecord(at17, at17Details),
  ];
  const reviewSelection = createHumanEvaluationSelection("slightly_few");
  assert.ok(reviewSelection);
  const reviewDetails = createReview19HumanEvaluationDetails({
    selection: reviewSelection,
    demandCycle: "summer",
    evaluatedAt: `${DATE}T10:05:00.000Z`,
  });
  const areaEvaluations = {
    [AREA_ID]: {
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient" as const,
      humanEvaluation: "slightly_few" as const,
      humanEvaluationDetails: reviewDetails,
    },
  };
  const areaCounts = { [AREA_ID]: 8 };
  const dataQuality = buildReview19DataQuality({
    date: DATE,
    areaCounts,
    areaEvaluations,
    excludedAreaIds: OTHER_AREAS,
  });
  const reference = createReview19Reference({
    date: DATE,
    weekday: 2,
    discountTime: "19",
    demandCycle: "summer",
    manualWeekdayOverride: false,
    manualDiscountTimeOverride: false,
    weather: makeWeather("rain"),
  });
  const check: Review19DayCheckSnapshot = {
    version: 1,
    demandCycle: "summer",
    review19Status: "recorded",
    recordedAt: `${DATE}T10:10:00.000Z`,
    sessionStartedAt: `${DATE}T10:00:00.000Z`,
    sourceUpdatedAt: `${DATE}T10:10:00.000Z`,
    areaCountRecordedAt: { [AREA_ID]: `${DATE}T10:05:00.000Z` },
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts,
    areaEvaluations,
    excludedAreaIds: OTHER_AREAS,
    excludeReasons: Object.fromEntries(
      OTHER_AREAS.map((areaId) => [areaId, "manual"]),
    ),
    dataQuality,
    reference,
    calendarContext: reference.calendarContext,
    analysisWeatherContext: reference.analysisWeatherContext,
  };
  const day = createReview19DaySnapshot({
    capturedAt: `${DATE}T10:10:00.000Z`,
    date: DATE,
    demandCycle: "summer",
    areaCountRecords: records,
    sessions: [at15, at17],
    review19Check: check,
  });
  const result = normalizeReview19Result({
    review19Status: "recorded",
    date: DATE,
    demandCycle: "summer",
    sessionStartedAt: check.sessionStartedAt,
    sourceUpdatedAt: check.sourceUpdatedAt,
    recordedAt: check.recordedAt,
    areaCountRecordedAt: check.areaCountRecordedAt,
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts,
    areaEvaluations,
    excludedAreaIds: OTHER_AREAS,
    excludeReasons: check.excludeReasons,
    dataQuality,
    calendarContext: day.calendarContext,
    analysisWeatherContext: reference.analysisWeatherContext,
    productionAnalysis: day.productionAnalysis,
    reference,
    daySnapshot: day,
  });
  assert.ok(result);
  return { day, result, records };
}

test("実曜日と個別量・エリア別referenceを分離し、履歴不足でも実比較groupを保持", () => {
  const ready = readyBasis("17", "weekday");
  const insufficient: AreaCountDecisionBasis = {
    ...readyBasis("17", "fallback_group"),
    recommendationStatus: "insufficient",
    actualWeekdayGroup: "金土",
    sampleSize: 0,
  };
  const context = buildSessionAnalysisCalendarContext({
    date: DATE,
    weekday: 1,
    discountTime: "17",
    sessionStartedAt: `${DATE}T08:00:00.000Z`,
    manualWeekdayOverride: true,
    areaDecisionBases: [
      { areaId: "bento_men", basis: ready },
      { areaId: "tempura", basis: insufficient },
    ],
  });
  assert.equal(context?.actualWeekday, "火");
  assert.equal(context?.manualWeekdayOverride, true);
  assert.equal(context?.individualAmountReference.length, 1);
  assert.equal(context?.areaCountReference.length, 2);
  const insufficientReference = context?.areaCountReference.find(
    (reference) => reference.areaId === "tempura",
  );
  assert.equal(insufficientReference?.recommendationStatus, "insufficient");
  assert.equal(insufficientReference?.referenceWeekdayGroup, "金土");
  assert.equal(insufficientReference?.reason, "insufficient_history");
});

test("祝日・祝前日の独立booleanとcalendarConditionを日付事実から保持", () => {
  const consecutiveHoliday = buildSessionAnalysisCalendarContext({
    date: "2026-05-04",
    weekday: 1,
    discountTime: "17",
    sessionStartedAt: "2026-05-04T08:00:00.000Z",
    manualWeekdayOverride: false,
    areaDecisionBases: [],
  });
  assert.equal(consecutiveHoliday?.isHoliday, true);
  assert.equal(consecutiveHoliday?.isDayBeforeHoliday, true);
  const beforeHoliday = buildSessionAnalysisCalendarContext({
    date: "2026-11-02",
    weekday: 1,
    discountTime: "17",
    sessionStartedAt: "2026-11-02T08:00:00.000Z",
    manualWeekdayOverride: false,
    areaDecisionBases: [],
  });
  assert.equal(beforeHoliday?.isHoliday, false);
  assert.equal(beforeHoliday?.isDayBeforeHoliday, true);
  assert.equal(beforeHoliday?.calendarCondition, "day_before_holiday");
});

test("祝日翌日平日の比較groupと三連休中日の候補groupを正確に構造化", () => {
  const insufficientHoliday = {
    ...readyBasis("15"),
    recommendationStatus: "insufficient" as const,
    sampleSize: 0,
  };
  const at15 = buildSessionAnalysisCalendarContext({
    date: "2026-07-20",
    weekday: 1,
    discountTime: "15",
    sessionStartedAt: "2026-07-20T06:00:00.000Z",
    manualWeekdayOverride: false,
    areaDecisionBases: [{ areaId: AREA_ID, basis: insufficientHoliday }],
  });
  const at17 = buildSessionAnalysisCalendarContext({
    date: "2026-07-20",
    weekday: 1,
    discountTime: "17",
    sessionStartedAt: "2026-07-20T08:00:00.000Z",
    manualWeekdayOverride: false,
    areaDecisionBases: [{ areaId: AREA_ID, basis: { ...insufficientHoliday, comparisonMode: "holiday_before_normal_weekday" } }],
  });
  assert.equal(at15?.areaCountReference[0]?.referenceWeekdayGroup, "金土日");
  assert.equal(at17?.areaCountReference[0]?.referenceWeekdayGroup, "火木日");
  const middle = buildSessionAnalysisCalendarContext({
    date: "2026-07-19",
    weekday: 0,
    discountTime: "17",
    sessionStartedAt: "2026-07-19T08:00:00.000Z",
    manualWeekdayOverride: false,
    areaDecisionBases: [{
      areaId: AREA_ID,
      basis: {
        ...insufficientHoliday,
        comparisonMode: "three_day_holiday_middle",
        actualWeekdayGroup: "三連休中日",
      },
    }],
  });
  assert.deepEqual(
    middle?.areaCountReference[0]?.referenceWeekdayGroups,
    ["火木日", "金土"],
  );
});

test("入力対象時間だけでdry/rain/snow/mixedを分類しlate sessionの過去defaultを除外", () => {
  const weather = makeWeather("sunny");
  weather.hourlyForecasts["16"].weather = "rain";
  weather.hourlyForecasts["17"].weather = "snow";
  assert.equal(buildAnalysisWeatherContext(weather, "17").analysisWeatherClass, "dry");
  weather.hourlyForecasts["18"].weather = "rain";
  weather.hourlyForecasts["19"].weather = "snow";
  const mixed = buildAnalysisWeatherContext(weather, "17");
  assert.deepEqual(mixed.expectedHours, ["18", "19", "20", "21"]);
  assert.equal(mixed.analysisWeatherClass, "mixed");
  assert.deepEqual(mixed.precipitationTypes, ["rain", "snow"]);
  weather.hourlyForecasts["21"].weather = "rain";
  const at20 = buildAnalysisWeatherContext(weather, "20");
  assert.deepEqual(at20.expectedHours, ["21"]);
  assert.equal(at20.analysisWeatherClass, "rain");
  const snowOnly = buildAnalysisWeatherContext(makeWeather("snow"), "19");
  assert.equal(snowOnly.analysisWeatherClass, "snow");
  assert.deepEqual(snowOnly.precipitationTypes, ["snow"]);
});

test("対象時間が1つでも欠ければunknown、known候補をincomplete unknownより優先", () => {
  const partialRaw = makeWeather("sunny").hourlyForecasts as unknown as Record<string, unknown>;
  delete partialRaw["21"];
  const partial = buildAnalysisWeatherContext(partialRaw);
  assert.equal(partial.consideredHours.length, 5);
  assert.equal(partial.analysisWeatherClass, "unknown");
  const rain17 = buildAnalysisWeatherContext(makeWeather("rain"), "17");
  const chosen = chooseBestAnalysisWeatherContext([partial, rain17]);
  assert.equal(chosen?.analysisWeatherClass, "rain");
  assert.deepEqual(chosen?.expectedHours, ["18", "19", "20", "21"]);
});

test("3 checkpointのlow side個数をstrong/medium/weak/noneへそのまま写像", () => {
  const levels = [
    [[1, 1, 1], "strong"],
    [[1, 5, 1], "medium"],
    [[5, 5, 1], "weak"],
    [[5, 5, 5], "none"],
    [[4, 4, 4], "strong"],
    [[5, 4, 6], "weak"],
    [[6, 7, 8], "none"],
  ] as const;
  for (const [scores, expected] of levels) {
    const result = buildProductionShortageSuspicion({
      areaId: AREA_ID,
      checkpoints: {
        "15": checkpoint("15", scores[0]),
        "17": checkpoint("17", scores[1]),
        "19": checkpoint("19", scores[2]),
      },
    });
    assert.equal(result.productionShortageSuspicion, expected);
  }
});

test("missing/excluded/not measuredの1点でもinsufficientになり、weatherは判定入力にない", () => {
  for (const status of ["missing", "excluded", "not_measured", "session_missing"] as const) {
    const result = buildProductionShortageSuspicion({
      areaId: AREA_ID,
      checkpoints: {
        "15": checkpoint("15", 1),
        "17": { discountTime: "17", status },
        "19": checkpoint("19", 1),
      },
    });
    assert.equal(result.productionShortageSuspicion, "insufficient");
    assert.equal(result.validCheckpointCount, 2);
  }
  const source = readFileSync(
    new URL("../src/domain/analysisMetadata.ts", import.meta.url),
    "utf8",
  );
  const suspicionBlock = source.slice(
    source.indexOf("export function buildProductionShortageSuspicion"),
    source.indexOf("export function buildProductionAnalysis"),
  );
  assert.doesNotMatch(suspicionBlock, /weather|rain|snow/i);
});

test("同じ3/3 lowはdry/rain/snowでもstrongのまま、天候classだけを別metadataに保持", () => {
  for (const [weatherKind, expectedClass] of [
    ["sunny", "dry"],
    ["rain", "rain"],
    ["snow", "snow"],
  ] as const) {
    const weatherContext = buildAnalysisWeatherContext(
      makeWeather(weatherKind),
      "15",
    );
    const production = buildProductionShortageSuspicion({
      areaId: AREA_ID,
      checkpoints: {
        "15": checkpoint("15", 4),
        "17": checkpoint("17", 4),
        "19": checkpoint("19", 4),
      },
    });
    assert.equal(weatherContext.analysisWeatherClass, expectedClass);
    assert.equal(production.productionShortageSuspicion, "strong");
  }
});

test("legacy scale5をderiveし、history採用もfinal evaluationとして有効にする", () => {
  const at15 = makeSession({
    discountTime: "15",
    legacyEvaluation: "few",
    evaluationSource: "manual",
  });
  const at17 = makeSession({
    discountTime: "17",
    legacyEvaluation: "slightly_few",
    evaluationSource: "manual",
  });
  const reviewDetails = getLegacyHumanEvaluationDetails("normal");
  const check = makeIntegratedFixture().day.review19Check;
  assert.ok(check);
  check.areaEvaluations = {
    [AREA_ID]: {
      autoEvaluation: null,
      autoEvaluationStatus: "insufficient",
      humanEvaluation: "normal",
      humanEvaluationDetails: reviewDetails,
    },
  };
  const legacy = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [at15, at17],
    review19Check: check,
  }).areas[AREA_ID];
  assert.deepEqual(legacy?.checkpointScores, { "15": 1, "17": 3, "19": 5 });
  assert.deepEqual(legacy?.checkpointSourceScale, { "15": 5, "17": 5, "19": 5 });
  assert.deepEqual(legacy?.checkpointSources, {
    "15": "manual",
    "17": "manual",
    "19": "human_review19",
  });
  assert.equal(legacy?.productionShortageSuspicion, "medium");

  const autoOnly = makeSession({
    discountTime: "15",
    legacyEvaluation: "few",
    evaluationSource: "history",
  });
  const autoResult = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [autoOnly, at17],
    review19Check: check,
  }).areas[AREA_ID];
  assert.equal(autoResult?.checkpointStatus["15"], "recorded");
  assert.equal(autoResult?.checkpointEvaluations?.["15"], "few");
  assert.equal(autoResult?.checkpointSources?.["15"], "history");
  assert.equal(autoResult?.checkpointScores["15"], null);
  assert.equal(autoResult?.checkpointSourceScale["15"], null);
  assert.equal(autoResult?.productionShortageSuspicion, "medium");
});

test("匿名summer fixtureがcalendar/rain/strong/cycleをday・Review19・cloud・exportでround-trip", () => {
  const { day, result, records } = makeIntegratedFixture();
  assert.equal(day.demandCycle, "summer");
  assert.equal(day.calendarContext?.actualWeekday, "火");
  assert.equal(day.calendarContext?.isHoliday, true);
  assert.deepEqual(
    new Set(day.calendarContext?.areaCountReference.map((item) => item.referenceWeekdayGroup)),
    new Set(["金土日", "火木日"]),
  );
  assert.equal(day.analysisWeatherContext?.analysisWeatherClass, "rain");
  assert.equal(
    day.productionAnalysis?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );

  const remoteAreaRow = buildRemoteAreaCountRow(records[0]);
  const areaRoundTrip = normalizeRemoteAreaCountRows([remoteAreaRow])[0];
  assert.equal(areaRoundTrip?.calendarContext?.actualWeekday, "火");
  assert.equal(areaRoundTrip?.analysisWeatherContext?.analysisWeatherClass, "rain");

  const remoteRow = buildRemoteReview19Row(result);
  const remoteRoundTrip = normalizeRemoteReview19Row(remoteRow, "summer");
  assert.equal(remoteRoundTrip?.demandCycle, "summer");
  assert.equal(remoteRoundTrip?.calendarContext?.actualWeekday, "火");
  assert.equal(remoteRoundTrip?.analysisWeatherContext?.analysisWeatherClass, "rain");
  assert.equal(
    remoteRoundTrip?.productionAnalysis?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );
  assert.deepEqual(
    remoteRoundTrip?.productionAnalysis?.areas[AREA_ID]?.checkpointSources,
    { "15": "manual", "17": "manual", "19": "human_review19" },
  );
  assert.deepEqual(
    remoteRoundTrip?.productionAnalysis?.areas[AREA_ID]?.checkpointEvaluations,
    { "15": "few", "17": "slightly_few", "19": "slightly_few" },
  );
  const exported = buildReview19ExportPayload({
    records: [result],
    exportedAt: `${DATE}T11:00:00.000Z`,
  }).records[0];
  assert.equal(exported?.calendarContext?.actualWeekday, "火");
  assert.equal(exported?.analysisWeatherContext?.analysisWeatherClass, "rain");
  assert.equal(
    exported?.productionAnalysis?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );
  assert.equal(
    exported?.productionAnalysis?.areas[AREA_ID]?.checkpointScores["17"],
    3,
  );
  const allDataDay = buildAllDataExportPayload({
    dailyData: [day],
    review19Data: [],
    exportedAt: `${DATE}T11:00:00.000Z`,
  }).dailyData[0];
  assert.equal(allDataDay?.demandCycle, "summer");
  assert.equal(allDataDay?.calendarContext?.actualWeekday, "火");
  assert.equal(allDataDay?.analysisWeatherContext?.analysisWeatherClass, "rain");
  assert.equal(
    allDataDay?.productionAnalysis?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );
  assert.deepEqual(
    allDataDay?.productionAnalysis?.areas[AREA_ID]?.checkpointSources,
    { "15": "manual", "17": "manual", "19": "human_review19" },
  );
});

test("root-only calendar/production evidenceをpartial day normalizeで失わない", () => {
  const { result, day } = makeIntegratedFixture();
  const extraContext = buildSessionAnalysisCalendarContext({
    date: DATE,
    weekday: 2,
    discountTime: "20",
    sessionStartedAt: `${DATE}T11:00:00.000Z`,
    manualWeekdayOverride: false,
    areaDecisionBases: [{ areaId: AREA_ID, basis: readyBasis("20") }],
  });
  const insufficient = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [],
  });
  const normalized = normalizeReview19Result({
    ...result,
    calendarContext: extraContext,
    productionAnalysis: makeStrongAnalysis(),
    daySnapshot: {
      ...day,
      sessions: [],
      areaCountRecords: [],
      review19Check: undefined,
      productionAnalysis: insufficient,
    },
  });
  assert.ok(normalized);
  assert.ok(
    normalized.calendarContext?.individualAmountReference.some(
      (reference) => reference.referenceDiscountTime === "20",
    ),
  );
  assert.equal(
    normalized.productionAnalysis?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );
});

test("persisted 15+17とrebuilt 15+19の相補的checkpointをlossless merge", () => {
  const analysisWith = (
    checkpoints: {
      "15": ProductionShortageCheckpoint;
      "17": ProductionShortageCheckpoint;
      "19": ProductionShortageCheckpoint;
    },
  ): ProductionAnalysis => ({
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas: {
      [AREA_ID]: buildProductionShortageSuspicion({
        areaId: AREA_ID,
        checkpoints,
      }),
    },
  });
  const persisted = analysisWith({
    "15": checkpoint("15", 1),
    "17": checkpoint("17", 2),
    "19": { discountTime: "19", status: "missing" },
  });
  const rebuilt = analysisWith({
    "15": checkpoint("15", 1),
    "17": { discountTime: "17", status: "missing" },
    "19": checkpoint("19", 3),
  });
  const merged = mergeProductionAnalyses({
    persisted,
    rebuilt,
    areaIds: [AREA_ID],
  })?.areas[AREA_ID];
  assert.equal(merged?.validCheckpointCount, 3);
  assert.deepEqual(merged?.checkpointScores, { "15": 1, "17": 2, "19": 3 });
  assert.equal(merged?.productionShortageSuspicion, "strong");
});

test("normal/summerは同日でもsession・Review19 checkのmetadataを混ぜない", () => {
  const summer = makeSession({ discountTime: "15", demandCycle: "summer" });
  const normal = makeSession({ discountTime: "17", demandCycle: "normal" });
  const normalCheck = makeIntegratedFixture().day.review19Check;
  assert.ok(normalCheck);
  normalCheck.demandCycle = "normal";
  const day = createReview19DaySnapshot({
    capturedAt: `${DATE}T10:30:00.000Z`,
    date: DATE,
    demandCycle: "summer",
    areaCountRecords: [],
    sessions: [normal, summer],
    review19Check: normalCheck,
  });
  assert.deepEqual(day.sessions.map((session) => session.demandCycle), ["summer"]);
  assert.equal(day.review19Check, undefined);
});

test("getLatestReview19DayCheckは同日recordをdemandCycle別に選択", () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() { return memory.size; },
    },
  });
  const summer = makeIntegratedFixture().result;
  const normal = createInitialReview19Result({
    date: DATE,
    sessionStartedAt: `${DATE}T09:00:00.000Z`,
    demandCycle: "normal",
    excludedAreaIds: ALL_AREAS,
  });
  normal.recordedAt = `${DATE}T11:00:00.000Z`;
  normal.sourceUpdatedAt = normal.recordedAt;
  saveReview19Records([summer, normal]);
  assert.equal(getLatestReview19DayCheck(DATE, "summer")?.demandCycle, "summer");
  assert.equal(getLatestReview19DayCheck(DATE, "normal")?.demandCycle, "normal");
  assert.ok(memory.has(STORAGE_KEYS.review19Records));
});

test("normalizerはoptional metadataのlegacy欠損を破壊せずmalformedを採用しない", () => {
  const legacy = normalizeAnalysisCalendarContext(undefined);
  assert.equal(legacy, undefined);
  const malformed = normalizeAnalysisCalendarContext({
    version: 1,
    scope: "session",
    date: "not-a-date",
  });
  assert.equal(malformed, undefined);
  assert.equal(normalizeProductionAnalysis({ version: 1 }, ALL_AREAS), undefined);
});

test("15/17 final adopted evaluation source and 19 human observation", () => {
  const history15 = makeSession({
    discountTime: "15",
    legacyEvaluation: "few",
    evaluationSource: "history",
  });
  const history17 = makeSession({
    discountTime: "17",
    legacyEvaluation: "few",
    evaluationSource: "history",
  });
  const review19 = makeIntegratedFixture().day.review19Check;
  assert.ok(review19);
  review19.areaEvaluations = {
    [AREA_ID]: {
      autoEvaluation: "many",
      autoEvaluationStatus: "ready",
      humanEvaluation: "few",
      humanEvaluationDetails: getLegacyHumanEvaluationDetails("few"),
    },
  };

  const historyStrong = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [history15, history17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(historyStrong?.productionShortageSuspicion, "strong");
  assert.deepEqual(historyStrong?.checkpointEvaluations, {
    "15": "few",
    "17": "few",
    "19": "few",
  });
  assert.deepEqual(historyStrong?.checkpointSources, {
    "15": "history",
    "17": "history",
    "19": "human_review19",
  });
  assert.deepEqual(historyStrong?.checkpointScores, {
    "15": null,
    "17": null,
    "19": 1,
  });

  const manualDetails = {
    ...humanDetails("few", "17"),
    automaticEvaluation: "normal" as const,
  };
  const manual17 = makeSession({
    discountTime: "17",
    humanEvaluationDetails: manualDetails,
    evaluationSource: "manual",
  });
  const mixedStrong = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [history15, manual17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(mixedStrong?.productionShortageSuspicion, "strong");
  assert.equal(mixedStrong?.checkpointEvaluations?.["17"], "few");
  assert.equal(mixedStrong?.checkpointSources?.["17"], "manual");
  assert.equal(mixedStrong?.checkpointScores["17"], 1);
  assert.equal(mixedStrong?.checkpointSourceScale["17"], 9);

  const normal15 = makeSession({
    discountTime: "15",
    legacyEvaluation: "normal",
    evaluationSource: "history",
  });
  const many17 = makeSession({
    discountTime: "17",
    legacyEvaluation: "slightly_many",
    evaluationSource: "history",
  });
  const score8Selection = createHumanEvaluationSelection("slightly_many", "many");
  assert.ok(score8Selection);
  review19.areaEvaluations = {
    [AREA_ID]: {
      autoEvaluation: "few",
      autoEvaluationStatus: "ready",
      humanEvaluationDetails: createReview19HumanEvaluationDetails({
        selection: score8Selection,
        demandCycle: "summer",
        evaluatedAt: `${DATE}T10:05:00.000Z`,
      }),
    },
  };
  const none = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [normal15, many17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(none?.productionShortageSuspicion, "none");
  assert.equal(none?.checkpointScores["19"], 8);
  assert.equal(none?.checkpointEvaluations?.["19"], null);

  review19.areaEvaluations = {};
  const missing19 = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [],
    sessions: [history15, history17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(missing19?.checkpointStatus["19"], "missing");
  assert.equal(missing19?.productionShortageSuspicion, "insufficient");
});

test("recorded marker alone is insufficient and adopted five-level beats manual raw for low-side", () => {
  const invalid = buildProductionShortageSuspicion({
    areaId: AREA_ID,
    checkpoints: {
      "15": { discountTime: "15", status: "recorded" },
      "17": { discountTime: "17", status: "recorded" },
      "19": { discountTime: "19", status: "recorded" },
    },
  });
  assert.equal(invalid.productionShortageSuspicion, "insufficient");
  assert.equal(invalid.validCheckpointCount, 0);
  assert.deepEqual(invalid.checkpointStatus, {
    "15": "missing",
    "17": "missing",
    "19": "missing",
  });

  const finalEvaluationWins = buildProductionShortageSuspicion({
    areaId: AREA_ID,
    checkpoints: {
      "15": {
        discountTime: "15",
        status: "recorded",
        evaluation: "normal",
        source: "manual",
        rawScore9: 4,
        sourceScale: 9,
      },
      "17": {
        discountTime: "17",
        status: "recorded",
        evaluation: "normal",
        source: "history",
      },
      "19": {
        discountTime: "19",
        status: "recorded",
        source: "human_review19",
        rawScore9: 5,
        sourceScale: 9,
      },
    },
  });
  assert.equal(finalEvaluationWins.lowSideCount, 0);
  assert.equal(finalEvaluationWins.productionShortageSuspicion, "none");
  assert.equal(finalEvaluationWins.checkpointScores["17"], null);
});

test("exact-session record overrides snapshot and rescues legacy snapshot area absence", () => {
  const at15 = makeSession({
    discountTime: "15",
    legacyEvaluation: "normal",
    evaluationSource: "history",
  });
  const at17 = makeSession({
    discountTime: "17",
    legacyEvaluation: "few",
    evaluationSource: "history",
  });
  const manualDetails = getLegacyHumanEvaluationDetails("few");
  const record = {
    ...makeAreaRecord(at15, manualDetails),
    userJudge: "few" as const,
    suggestedEvaluation: "normal" as const,
    evaluationSource: "manual" as const,
    decisionBasis: {
      ...at15.areas[AREA_ID].areaCountDecisionBasis,
      evaluationSource: "manual" as const,
      finalEvaluation: undefined,
    } as AreaCountDecisionBasis,
  };
  const review19 = makeIntegratedFixture().day.review19Check;
  assert.ok(review19);
  const fromRecord = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [record],
    sessions: [at15, at17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(fromRecord?.checkpointEvaluations?.["15"], "few");
  assert.equal(fromRecord?.checkpointSources?.["15"], "manual");
  assert.equal(fromRecord?.checkpointScores["15"], 1);
  assert.equal(fromRecord?.checkpointSourceScale["15"], 5);

  const legacySnapshot = {
    ...at15,
    areas: {} as Record<AreaId, Review19AreaSnapshot>,
  };
  const rescued = buildProductionAnalysis({
    date: DATE,
    demandCycle: "summer",
    areaIds: [AREA_ID],
    areaCountRecords: [record],
    sessions: [legacySnapshot, at17],
    review19Check: review19,
  }).areas[AREA_ID];
  assert.equal(rescued?.checkpointStatus["15"], "recorded");
  assert.equal(rescued?.checkpointEvaluations?.["15"], "few");
});

test("legacy raw-only production metadata stays readable but enriched rebuild wins merge", () => {
  const legacyRaw = {
    version: 1,
    requiredCheckpoints: ["15", "17", "19"],
    areas: {
      [AREA_ID]: {
        version: 1,
        areaId: AREA_ID,
        productionShortageSuspicion: "strong",
        validCheckpointCount: 3,
        lowSideCount: 3,
        checkpointScores: { "15": 1, "17": 3, "19": 1 },
        checkpointStatus: { "15": "recorded", "17": "recorded", "19": "recorded" },
        checkpointSourceScale: { "15": 9, "17": 9, "19": 9 },
      },
    },
  };
  const normalizedLegacy = normalizeProductionAnalysis(legacyRaw, [AREA_ID]);
  assert.equal(
    normalizedLegacy?.areas[AREA_ID]?.productionShortageSuspicion,
    "strong",
  );
  assert.equal(normalizedLegacy?.areas[AREA_ID]?.checkpointSources?.["15"], "manual");

  const enriched = buildProductionShortageSuspicion({
    areaId: AREA_ID,
    checkpoints: {
      "15": {
        discountTime: "15",
        status: "recorded",
        evaluation: "few",
        source: "history",
      },
      "17": {
        discountTime: "17",
        status: "recorded",
        evaluation: "few",
        source: "history",
      },
      "19": {
        discountTime: "19",
        status: "recorded",
        source: "human_review19",
        rawScore9: 1,
        sourceScale: 9,
      },
    },
  });
  const merged = mergeProductionAnalyses({
    persisted: legacyRaw,
    rebuilt: {
      version: 1,
      requiredCheckpoints: ["15", "17", "19"],
      areas: { [AREA_ID]: enriched },
    },
    areaIds: [AREA_ID],
  });
  assert.equal(merged?.areas[AREA_ID]?.checkpointSources?.["15"], "history");
  assert.equal(merged?.areas[AREA_ID]?.checkpointScores["15"], null);
  assert.equal(merged?.areas[AREA_ID]?.checkpointEvaluations?.["15"], "few");
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${passed} analysis metadata checks passed.`);
}
