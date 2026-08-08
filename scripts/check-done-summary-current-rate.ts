import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNormalRateDecisionSnapshot } from "../src/domain/rateDecisionSnapshot.ts";
import { createDefaultHourlyForecasts } from "../src/domain/hourlyWeather.ts";
import type {
  AreaProgress,
  ResolvedWeatherInput,
  SessionData,
} from "../src/domain/types.ts";
import { buildCurrentNormalRateDisplay } from "../src/hooks/nebikiApp/ratePresentation.ts";

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

function createSession(
  discountTime: SessionData["discountTime"],
  manualDiscountTimeOverride = false,
): SessionData {
  return {
    date: "2026-08-08",
    weekday: 6,
    discountTime,
    demandCycle: "summer",
    manualWeekdayOverride: false,
    manualDiscountTimeOverride,
    weather: {
      hourlyForecasts: createDefaultHourlyForecasts(),
      afterRainSky: null,
    },
    startedAt: "2026-08-08T06:00:00.000Z",
  };
}

const confirmedSnapshot = buildNormalRateDecisionSnapshot({
  confirmedAt: "2026-08-08T06:59:00.000Z",
  sessionDiscountTime: "15",
  weatherComfortAdjustmentPercent: 0,
  areaJudge: "normal",
  areaRateAdjustment: 0,
  resolvedWeather,
  weekday: 6,
  date: "2026-08-08",
  demandCycle: "summer",
});
const progress: AreaProgress = {
  areaId: "bento_men",
  status: "completed",
  areaJudge: "normal",
  areaRateAdjustment: 0,
  completedRateText: confirmedSnapshot.displayedRateText,
  completedNormalRateText: confirmedSnapshot.displayedRateText,
  completedManyRateText: `${confirmedSnapshot.displayedManyRatePercent}%`,
  rateDecisionSnapshot: confirmedSnapshot,
  rateDecisionSnapshotStatus: "captured",
};
const progressBefore = JSON.stringify(progress);

// 15:59は通常補正、16:00以降は呼び出し側の既存境界判定が渡す+5だけを反映する。
const at1559 = buildCurrentNormalRateDisplay({
  session: createSession("15"),
  progress,
  effectiveDiscountTime: "15",
  weatherBonus: 0,
  ignoreTimeRateCap: false,
});
const at1600 = buildCurrentNormalRateDisplay({
  session: createSession("15"),
  progress,
  effectiveDiscountTime: "15",
  weatherBonus: 5,
  ignoreTimeRateCap: false,
});
assert.equal(at1559?.normal.main, "0%");
assert.equal(at1559?.many.main, "10%");
assert.equal(at1600?.normal.main, "5%");
assert.equal(at1600?.many.main, "15%");

// 17時セッションの先取り表示は18時30分基準を計算後、既存どおり-5する。
const earlyNext = buildCurrentNormalRateDisplay({
  session: createSession("17"),
  progress,
  effectiveDiscountTime: "18",
  weatherBonus: 0,
  ignoreTimeRateCap: false,
  rateOffsetPercent: -5,
});
assert.equal(earlyNext?.normal.main, "15%");
assert.equal(earlyNext?.many.main, "25%");

// 手動時刻指定では呼び出し側が時刻補正を渡さないため、暗黙の補正は生じない。
const manual = buildCurrentNormalRateDisplay({
  session: createSession("15", true),
  progress,
  effectiveDiscountTime: "15",
  weatherBonus: 0,
  ignoreTimeRateCap: false,
  rateOffsetPercent: 0,
});
assert.equal(manual?.normal.main, "0%");
assert.equal(manual?.many.main, "10%");

assert.equal(
  buildCurrentNormalRateDisplay({
    session: createSession("20"),
    progress,
    effectiveDiscountTime: "20",
    weatherBonus: 0,
    ignoreTimeRateCap: false,
  }),
  null,
);
assert.equal(
  buildCurrentNormalRateDisplay({
    session: createSession("17"),
    progress: { ...progress, areaJudge: null },
    effectiveDiscountTime: "17",
    weatherBonus: 0,
    ignoreTimeRateCap: false,
  }),
  null,
);

// 表示計算は完了情報・確定Snapshotを更新しない。
assert.equal(JSON.stringify(progress), progressBefore);
assert.equal(progress.rateDecisionSnapshot, confirmedSnapshot);
assert.equal(Object.isFrozen(confirmedSnapshot), true);

const hookSource = readFileSync(
  new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
  "utf8",
);
assert.match(hookSource, /const capturedDoneSummaryItems = useMemo/);
assert.match(hookSource, /const doneSummaryItems = useMemo/);
assert.match(
  hookSource,
  /doneSummaryItems:\s*capturedDoneSummaryItems/g,
  "保存用snapshotは確定時一覧を使う",
);
assert.match(
  hookSource,
  /buildCurrentNormalRateDisplay\(\{[\s\S]*?effectiveRateDiscountTime[\s\S]*?rateOffsetPercent:\s*earlyNextMinus5Info \? -5 : 0/,
  "完了画面の表示だけが既存の現在時刻補正を共有する",
);
assert.doesNotMatch(
  hookSource,
  /createDailySessionSnapshot\(\{[\s\S]{0,500}?doneSummaryItems:\s*doneSummaryItems/,
  "動的表示値を日次snapshotへ保存しない",
);

console.log("PASS: Done画面用の現在値引率表示は既存計算を共有し、確定データを変更しない");
