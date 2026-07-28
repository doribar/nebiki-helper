import assert from "node:assert/strict";
import { getNormalRoute } from "../src/domain/area.ts";
import {
  createDefaultHourlyForecasts,
  resolveWeatherInputForDiscount,
} from "../src/domain/hourlyWeather.ts";
import type { AreaId, AreaProgress, SessionDraft } from "../src/domain/types.ts";
import {
  getBasisGuideDisplay,
  getWeekdayBaseInfo,
} from "../src/domain/weekdayBase.ts";
import { createDailySessionSnapshot } from "../src/hooks/nebikiApp/sessionSnapshots.ts";
import {
  createInitialState,
  normalizeAreaProgressMap,
} from "../src/hooks/nebikiApp/stateNormalization.ts";

const date = "2026-07-28";
const route = getNormalRoute(date);
const targetAreaId = route[0];

function normalizeOne(
  patch: Partial<AreaProgress>,
  areaId: AreaId = targetAreaId,
): AreaProgress {
  return normalizeAreaProgressMap({
    [areaId]: {
      areaId,
      status: "unstarted",
      areaJudge: null,
      ...patch,
    },
  })[areaId];
}

assert.equal(
  normalizeOne({ areaCount: 10 }).stapleItemCount,
  undefined,
  "旧データでは定番個数を追加しない",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: null }).stapleItemCount,
  null,
  "空欄を表すnullを維持する",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: 0 }).stapleItemCount,
  0,
  "0個を維持する",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: 10 }).stapleItemCount,
  10,
  "総残数と同じ整数を維持する",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: 11 }).stapleItemCount,
  undefined,
  "総残数を超える値を破棄する",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: 1.5 }).stapleItemCount,
  undefined,
  "小数を破棄する",
);
assert.equal(
  normalizeOne({ areaCount: 10, stapleItemCount: -1 }).stapleItemCount,
  undefined,
  "負数を破棄する",
);
assert.equal(
  normalizeOne({ stapleItemCount: 4 }).stapleItemCount,
  4,
  "旧データで総残数が欠損していても有効な非負整数は維持する",
);

const draft: SessionDraft = {
  date,
  weekday: 2,
  discountTime: "20",
  manualWeekdayOverride: false,
  manualDiscountTimeOverride: false,
  weather: {
    hourlyForecasts: createDefaultHourlyForecasts(),
    afterRainSky: null,
  },
};
const state = createInitialState(draft);
state.screen = "done";
state.session = {
  ...draft,
  startedAt: "2026-07-28T11:30:00.000Z",
};
state.areaProgressMap[route[0]] = {
  ...state.areaProgressMap[route[0]],
  status: "completed",
  areaJudge: "normal",
  areaCount: 5,
  stapleItemCount: null,
};
state.areaProgressMap[route[1]] = {
  ...state.areaProgressMap[route[1]],
  status: "completed",
  areaJudge: "normal",
  areaCount: 7,
  stapleItemCount: 0,
};

const resolvedWeather = resolveWeatherInputForDiscount(draft.weather, "20");
const weekdayBaseInfo = getWeekdayBaseInfo(
  draft.weekday,
  "20",
  resolvedWeather,
  draft.date,
);
const basisGuide = getBasisGuideDisplay({
  date: draft.date,
  weekday: draft.weekday,
  discountTime: "20",
  weather: resolvedWeather,
});
const snapshot = createDailySessionSnapshot({
  capturedAt: "2026-07-28T12:00:00.000Z",
  state,
  resolvedWeather,
  weekdayBaseInfo,
  basisGuide,
  lateTimeBonus: 0,
  doneSummaryItems: [],
});

assert.ok(snapshot, "日次セッションスナップショットを作成できる");
assert.equal(snapshot.areas[route[0]].stapleItemCount, null);
assert.equal(snapshot.areas[route[1]].stapleItemCount, 0);

const serialized = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
assert.equal(serialized.areas[route[0]].stapleItemCount, null);
assert.equal(serialized.areas[route[1]].stapleItemCount, 0);
assert.equal(
  Object.prototype.hasOwnProperty.call(serialized.areas[route[2]], "stapleItemCount"),
  false,
  "旧データ相当のundefinedはJSONへ新規キーとして出力しない",
);

console.log("PASS: 20時30分の定番個数データ境界・旧データ互換・スナップショット転記");
