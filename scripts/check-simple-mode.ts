import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  APP_MODE_STORAGE_KEY,
  getAppModeLabel,
  loadAppMode,
  saveAppMode,
} from "../src/domain/appMode.ts";
import { getNormalRoute } from "../src/domain/area.ts";
import {
  SIMPLE_MODE_STORAGE_KEY,
  applySimpleAreaJudgment,
  buildSimpleFinalRoute,
  buildSimpleSecondRoute,
  clearSimpleModeState,
  completeSimpleFirstLapArea,
  createInitialSimpleModeState,
  getSimpleCalculation,
  loadSimpleModeState,
  normalizeSimpleModeState,
  resolveSimpleDiscountTime,
  saveSimpleModeState,
} from "../src/domain/simpleMode.ts";
import type { AreaCountEvaluation, AreaId } from "../src/domain/types.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  keys() { return [...this.values.keys()]; }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const simpleUiSource = source("src/app/SimpleModeApp.tsx");
const simpleHookSource = source("src/hooks/useSimpleMode.ts");
const appSource = source("src/app/App.tsx");
const appRouterSource = source("src/app/AppRouter.tsx");
const adminSource = source("src/components/common/AdminSettingsDialog.tsx");
const startSource = source("src/components/screens/StartScreen.tsx");
let passed = 0;

function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function dateAt(text: string) {
  return new Date(text);
}

const julyDate = "2026-07-20";
const route = getNormalRoute(julyDate);
const winterRoute = getNormalRoute("2026-01-20");
const judgments: Partial<Record<AreaId, AreaCountEvaluation>> = {};
route.forEach((areaId, index) => {
  judgments[areaId] = (["many", "slightly_many", "normal", "slightly_few", "few"] as AreaCountEvaluation[])[index % 5];
});

test("初期値は詳細モード", () => assert.equal(loadAppMode(new MemoryStorage()), "detailed"));
test("管理設定に使用モードがある", () => assert.match(adminSource, /使用モード/));
test("簡易モードを保存できる", () => { const s = new MemoryStorage(); saveAppMode("simple", s); assert.equal(loadAppMode(s), "simple"); });
test("詳細モードへ戻せる", () => { const s = new MemoryStorage(); saveAppMode("simple", s); saveAppMode("detailed", s); assert.equal(loadAppMode(s), "detailed"); });
test("モード選択は専用キーを使う", () => assert.equal(APP_MODE_STORAGE_KEY, "nebiki-helper/app-mode-v1"));
test("詳細と簡易を別コンポーネントでマウントする", () => { assert.match(appSource, /mode === "simple"/); assert.match(appSource, /DetailedModeRoot/); });

test("簡易画面に残数の数値入力がない", () => { assert.doesNotMatch(simpleUiSource, /AreaJudgeScreen|onChangeAreaCount|残数を入力/); assert.match(simpleUiSource, /このエリアの残り具合を選んでください/); });
test("簡易Hookは履歴自動判定を参照しない", () => assert.doesNotMatch(simpleHookSource, /areaCountHistory|Recommendation|median/i));
test("全エリアで5段階の選択肢を使う", () => ["many", "slightly_many", "normal", "slightly_few", "few"].forEach((value) => assert.match(simpleUiSource, new RegExp(`"${value}"`))));
test("誘導文を表示しない", () => { assert.doesNotMatch(simpleUiSource, /迷ったら多い側/); assert.doesNotMatch(simpleUiSource, /迷ったら普通/); });
test("曜日・時刻・天候の既存計算を共有する", () => { const state = createInitialSimpleModeState(dateAt("2026-07-20T17:00:00+09:00")); const result = getSimpleCalculation({ draft: state.sessionDraft, evaluation: "normal", now: dateAt("2026-07-20T17:00:00+09:00") }); assert.match(result.rateDisplay.many.main, /%/); assert.match(result.basisGuide.referenceText, /基準/); });

test("1周目は通常ルート順", () => assert.deepEqual(route, getNormalRoute(julyDate)));
test("1周目に多い商品と通常値引率の指示がある", () => { assert.match(simpleUiSource, /aria-label="1周目の値引指示"/); assert.match(simpleUiSource, /calculation\.rateSnapshot\.mainRateText/); });
test("1周目に10個以上+5%の指示がある", () => assert.match(simpleUiSource, /10個以上ある商品/));
test("1周目に残り1個を値引しない指示がある", () => assert.match(simpleUiSource, /1個の商品は値引しない/));
test("1周目にそれ以外を値引しない指示がある", () => assert.match(simpleUiSource, /それ以外の商品は、まだ値引しない/));
test("季節外は涼味商品を除外", () => assert.equal(winterRoute.includes("ryomi"), false));
test("対象季節は涼味商品を含む", () => assert.equal(route.includes("ryomi"), true));

const sampleRate = { mainRateText: "30%", tenOrMoreRateText: "35%" };
const createAlternatingState = (text = "2026-07-20T17:00:00+09:00") => ({
  ...createInitialSimpleModeState(dateAt(text)),
  phase: "judgment" as const,
  currentIndex: 0,
  currentAreaId: route[0] ?? null,
});

test("天候入力後は全エリア一括判定ではなく最初のエリア判定から始まる", () => {
  const state = createAlternatingState();
  assert.equal(state.phase, "judgment");
  assert.equal(state.currentAreaId, route[0]);
  assert.equal(Object.keys(state.judgments).length, 0);
});
test("最初のエリアを判定すると同じエリアの1周目へ進む", () => {
  const state = createAlternatingState();
  const judged = applySimpleAreaJudgment(state, "many");
  assert.equal(judged.phase, "first_lap");
  assert.equal(judged.currentIndex, 0);
  assert.equal(judged.currentAreaId, route[0]);
  assert.equal(judged.judgments[route[0]], "many");
});
test("同じエリアの1周目完了後に次エリアの判定へ進む", () => {
  const judged = applySimpleAreaJudgment(createAlternatingState(), "many");
  const next = completeSimpleFirstLapArea(judged, sampleRate);
  assert.equal(next.phase, "judgment");
  assert.equal(next.currentIndex, 1);
  assert.equal(next.currentAreaId, route[1]);
  assert.deepEqual(next.firstLapRates[route[0]], sampleRate);
});
test("通常ルート最後まで判定と同一エリア1周目が交互に続く", () => {
  let state = createAlternatingState();
  for (let index = 0; index < route.length; index += 1) {
    assert.equal(state.phase, "judgment");
    assert.equal(state.currentAreaId, route[index]);
    state = applySimpleAreaJudgment(state, judgments[route[index]] ?? "normal");
    assert.equal(state.phase, "first_lap");
    assert.equal(state.currentAreaId, route[index]);
    state = completeSimpleFirstLapArea(state, sampleRate);
  }
  assert.equal(state.phase, "second_lap");
});
test("最後のエリアの1周目完了後だけ2周目へ進む", () => {
  let state = createAlternatingState();
  route.forEach((areaId, index) => {
    state = applySimpleAreaJudgment(state, judgments[areaId] ?? "normal");
    state = completeSimpleFirstLapArea(state, sampleRate);
    if (index < route.length - 1) assert.equal(state.phase, "judgment");
  });
  assert.equal(state.phase, "second_lap");
});
test("2周目開始時には全エリアの判定と1周目値引率が揃う", () => {
  let state = createAlternatingState();
  for (const areaId of route) {
    state = applySimpleAreaJudgment(state, judgments[areaId] ?? "normal");
    state = completeSimpleFirstLapArea(state, sampleRate);
  }
  assert.equal(Object.keys(state.judgments).length, route.length);
  assert.equal(Object.keys(state.firstLapRates).length, route.length);
});
test("19時30分の各エリア判定を都度保存して最終一覧に使用できる", () => {
  let state = createAlternatingState("2026-07-20T19:30:00+09:00");
  for (const areaId of route) {
    state = applySimpleAreaJudgment(state, judgments[areaId] ?? "normal");
    assert.equal(state.judgments1930[areaId], judgments[areaId] ?? "normal");
    state = completeSimpleFirstLapArea(state, sampleRate);
  }
  assert.deepEqual(buildSimpleFinalRoute(route, state.judgments1930), buildSimpleFinalRoute(route, judgments));
});
test("判定画面で再読み込みしても同じエリアと工程を復元", () => {
  const storage = new MemoryStorage();
  const raw = { ...createAlternatingState(), currentIndex: 3, currentAreaId: route[3] };
  saveSimpleModeState(raw, storage);
  const loaded = loadSimpleModeState(dateAt("2026-07-20T17:01:00+09:00"), storage);
  assert.equal(loaded.phase, "judgment");
  assert.equal(loaded.currentAreaId, route[3]);
});
test("1周目値引画面で再読み込みしても同じエリアと工程を復元", () => {
  const storage = new MemoryStorage();
  const raw = applySimpleAreaJudgment(
    { ...createAlternatingState(), currentIndex: 3, currentAreaId: route[3] },
    "normal",
  );
  saveSimpleModeState(raw, storage);
  const loaded = loadSimpleModeState(dateAt("2026-07-20T17:01:00+09:00"), storage);
  assert.equal(loaded.phase, "first_lap");
  assert.equal(loaded.currentAreaId, route[3]);
  assert.equal(loaded.judgments[route[3]], "normal");
});
test("Hookは判定と1周目の純粋状態遷移を使用する", () => {
  assert.match(simpleHookSource, /applySimpleAreaJudgment/);
  assert.match(simpleHookSource, /completeSimpleFirstLapArea/);
});

const secondRoute = buildSimpleSecondRoute(route, judgments);
const reverse = [...route].reverse();
const expectedSecond = [
  ...reverse.filter((id) => judgments[id] === "many" || judgments[id] === "slightly_many"),
  ...route.filter((id) => judgments[id] === "normal"),
  ...reverse.filter((id) => judgments[id] === "slightly_few" || judgments[id] === "few"),
];
test("2周目に確認用2ボタンがない", () => assert.doesNotMatch(simpleUiSource, /続ける／終了|時間に余裕がありますか/));
test("2周目に切り上げボタンがない", () => assert.doesNotMatch(simpleUiSource, />ここで切り上げる</));
test("2周目に時間余裕の注意文がある", () => assert.match(simpleUiSource, /ここからは時間に余裕がある場合のみ行ってください。他にやることができたら、途中で切り上げて構いません。/));
test("多い・やや多いは逆ルート順", () => assert.deepEqual(secondRoute.slice(0, expectedSecond.filter((id) => judgments[id] === "many" || judgments[id] === "slightly_many").length), expectedSecond.slice(0, expectedSecond.filter((id) => judgments[id] === "many" || judgments[id] === "slightly_many").length)));
test("普通は通常ルート順", () => assert.deepEqual(secondRoute.filter((id) => judgments[id] === "normal"), route.filter((id) => judgments[id] === "normal")));
test("やや少ない・少ないは逆ルート順", () => assert.deepEqual(secondRoute.filter((id) => judgments[id] === "slightly_few" || judgments[id] === "few"), reverse.filter((id) => judgments[id] === "slightly_few" || judgments[id] === "few")));
test("2周目は全エリアを重複なく含む", () => { assert.equal(secondRoute.length, route.length); assert.equal(new Set(secondRoute).size, route.length); });
test("2周目は1周目保存率を使用する", () => assert.match(simpleUiSource, /firstLapRates\[areaId\].*mainRateText/));
test("2周目は10個以上でも+5%をしないと明示する", () => { const secondSection = simpleUiSource.slice(simpleUiSource.indexOf("function SecondLapScreen"), simpleUiSource.indexOf("function FinalScreen")); assert.match(secondSection, /10個以上でも\+5％はしない/); });
test("2周目は残り1個を対象外にする", () => { const secondSection = simpleUiSource.slice(simpleUiSource.indexOf("function SecondLapScreen"), simpleUiSource.indexOf("function FinalScreen")); assert.match(secondSection, /1個の商品は値引しない/); });
test("簡易UIに個別商品補正の入力がない", () => ["定番商品", "夜によく売れる", "見た目が悪い", "不人気", "広告商品"].forEach((text) => assert.doesNotMatch(simpleUiSource, new RegExp(text))));

test("18時25分に18時30分へ切替", () => assert.equal(resolveSimpleDiscountTime(dateAt("2026-07-20T18:25:00+09:00")), "18"));
test("19時25分に19時30分へ切替", () => assert.equal(resolveSimpleDiscountTime(dateAt("2026-07-20T19:25:00+09:00")), "19"));
test("20時25分に最終値引へ切替", () => assert.equal(resolveSimpleDiscountTime(dateAt("2026-07-20T20:25:00+09:00")), "20"));
test("16時55分は17時セッション", () => assert.equal(resolveSimpleDiscountTime(dateAt("2026-07-20T16:55:00+09:00")), "17"));
test("2周目途中でも時刻正規化で確認なく切替", () => { const raw = { ...createInitialSimpleModeState(dateAt("2026-07-20T19:00:00+09:00")), phase: "second_lap" as const }; const next = normalizeSimpleModeState(raw, dateAt("2026-07-20T19:25:00+09:00")); assert.equal(next.phase, "weather"); assert.equal(next.discountTime, "19"); });
test("再読み込み後も同じ時刻と画面を復元", () => { const s = new MemoryStorage(); const raw = { ...createInitialSimpleModeState(dateAt("2026-07-20T18:30:00+09:00")), phase: "first_lap" as const, currentIndex: 2, currentAreaId: route[2] }; saveSimpleModeState(raw, s); const loaded = loadSimpleModeState(dateAt("2026-07-20T18:31:00+09:00"), s); assert.equal(loaded.phase, "first_lap"); assert.equal(loaded.currentIndex, 2); });

const finalRoute = buildSimpleFinalRoute(route, judgments);
test("最終値引は19時30分判定を受け取る", () => { assert.match(simpleHookSource, /judgments1930/); assert.match(simpleUiSource, /finalRoute/); });
test("19時30分状態から20時25分へ進むと判定を最終一覧へ引き継ぐ", () => { const raw = createInitialSimpleModeState(dateAt("2026-07-20T19:30:00+09:00")); raw.judgments[route[0]] = "many"; const next = normalizeSimpleModeState(raw, dateAt("2026-07-20T20:25:00+09:00")); assert.equal(next.phase, "final"); assert.equal(next.judgments1930[route[0]], "many"); assert.equal(next.finalRoute.length, route.length); });
test("最終の多い・やや多いは通常順", () => assert.deepEqual(finalRoute.filter((id) => judgments[id] === "many" || judgments[id] === "slightly_many"), route.filter((id) => judgments[id] === "many" || judgments[id] === "slightly_many")));
test("最終の普通は逆順", () => assert.deepEqual(finalRoute.filter((id) => judgments[id] === "normal"), reverse.filter((id) => judgments[id] === "normal")));
test("最終のやや少ない・少ないは通常順", () => assert.deepEqual(finalRoute.filter((id) => judgments[id] === "slightly_few" || judgments[id] === "few"), route.filter((id) => judgments[id] === "slightly_few" || judgments[id] === "few")));
test("最終値引は1画面の番号付き一覧", () => { assert.match(simpleUiSource, /<ol/); assert.doesNotMatch(simpleUiSource, /completeFinalArea/); });
test("最終値引は全品50％を指示", () => assert.match(simpleUiSource, /すべての商品を50％にしてください/));
test("最終値引は順次画面でない", () => assert.doesNotMatch(simpleUiSource, /finalCurrentArea|finalIndex/));
test("最終画面に判定名・方向・グループ名を出さない", () => { const finalPart = simpleUiSource.slice(simpleUiSource.indexOf("function FinalScreen")); assert.doesNotMatch(finalPart, /evaluationText|逆順|順方向|第1グループ/); });
test("一部未判定でも全エリアを1回含む", () => { const partial = { [route[0]]: "many", [route[2]]: "normal" } as Partial<Record<AreaId, AreaCountEvaluation>>; const result = buildSimpleFinalRoute(route, partial); assert.equal(result.length, route.length); assert.equal(new Set(result).size, route.length); });
test("判定なしは通常ルート順", () => assert.deepEqual(buildSimpleFinalRoute(route, {}), route));

test("簡易HookからSupabase保存が発生しない", () => assert.doesNotMatch(simpleHookSource, /supabase|RemoteStorage|saveAreaCount/i));
test("簡易Hookから残数履歴を作成しない", () => assert.doesNotMatch(simpleHookSource, /AreaCountRecord|saveAreaCountRecord|areaCountHistory/));
test("簡易Hookから19時チェックを開始しない", () => assert.doesNotMatch(simpleHookSource, /review19/i));
test("簡易一時状態は詳細保存キーと別", () => assert.equal(SIMPLE_MODE_STORAGE_KEY, "nebiki-helper/simple-mode-state-v1"));
test("簡易一時状態を再読み込み復元できる", () => { const s = new MemoryStorage(); const raw = createInitialSimpleModeState(dateAt("2026-07-20T17:00:00+09:00")); raw.judgments[route[0]] = "many"; saveSimpleModeState(raw, s); assert.equal(loadSimpleModeState(dateAt("2026-07-20T17:01:00+09:00"), s).judgments[route[0]], "many"); clearSimpleModeState(s); assert.equal(s.getItem(SIMPLE_MODE_STORAGE_KEY), null); });
test("日付変更時に古い簡易状態を破棄", () => { const old = createInitialSimpleModeState(dateAt("2026-07-20T17:00:00+09:00")); old.judgments[route[0]] = "many"; const next = normalizeSimpleModeState(old, dateAt("2026-07-21T17:00:00+09:00")); assert.equal(Object.keys(next.judgments).length, 0); assert.equal(next.date, "2026-07-21"); });

test("モード名表示が日本語で固定", () => { assert.equal(getAppModeLabel("detailed"), "詳細モード"); assert.equal(getAppModeLabel("simple"), "簡易モード"); });
test("天候画面は簡易対象時刻だけに制限", () => assert.match(simpleUiSource, /allowedDiscountTimes=\{\["17", "18", "19"\]\}/));
test("詳細StartScreenの既定時刻一覧は維持", () => ["15", "17", "18", "19", "20"].forEach((time) => assert.match(startSource, new RegExp(`value: "${time}"`))));

test("簡易共通ヘッダーにモード・時刻・エリア進捗をまとめる", () => {
  assert.match(simpleUiSource, /data-simple-ui="header"/);
  assert.match(simpleUiSource, /role="progressbar"/);
  assert.match(simpleUiSource, /aria-label="エリア進捗"/);
});
test("簡易共通ヘッダーは全対象時刻を値引時刻として表示する", () => {
  ["17:00値引", "18:30値引", "19:30値引", "20:30値引"].forEach((text) => assert.match(simpleUiSource, new RegExp(text)));
});
test("5段階ボタンは60px以上で判定別のトーンを持つ", () => {
  assert.match(simpleUiSource, /const EVALUATION_TONES/);
  assert.match(simpleUiSource, /data-evaluation=\{evaluation\}/);
  assert.match(simpleUiSource, /minHeight: 60/);
});
test("1周目・2周目・最終値引は大きな値引率カードを共有する", () => {
  assert.match(simpleUiSource, /data-simple-ui="instruction-card"/);
  assert.match(simpleUiSource, /data-simple-ui="discount-rate"/);
  assert.match(simpleUiSource, /fontSize: "clamp\(52px/);
});
test("1周目と2周目の補足は短い箇条書きで整理する", () => {
  assert.match(simpleUiSource, /data-simple-ui="rules"/);
  assert.match(simpleUiSource, /function RuleItem/);
  assert.match(simpleUiSource, /まだ値引していない商品が対象/);
});
test("主要な次へボタンは下部寄せで60px以上", () => {
  assert.match(simpleUiSource, /data-simple-ui="action-area"/);
  assert.match(simpleUiSource, /position: "sticky"/);
  assert.match(simpleUiSource, /minHeight: 60/);
});
test("最終値引一覧は番号とエリア名をカード状に表示する", () => {
  const finalPart = simpleUiSource.slice(simpleUiSource.indexOf("function FinalScreen"));
  assert.match(finalPart, /\{index \+ 1\}/);
  assert.match(finalPart, /getAreaName\(areaId\)/);
  assert.match(finalPart, /値引する順番/);
});
test("開始画面の強調は簡易モードだけで詳細モードは既定表示", () => {
  assert.match(simpleUiSource, /emphasizeModeLabel/);
  assert.match(startSource, /emphasizeModeLabel = false/);
  assert.doesNotMatch(appRouterSource, /emphasizeModeLabel/);
});

assert.equal(passed, 73);
console.log(`簡易モード確認: ${passed}件すべて成功`);
