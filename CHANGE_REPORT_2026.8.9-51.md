# CHANGE REPORT 2026.8.9-51

- appVersion: `2026.8.9-51` / buildId: `build-20261012-040025-jst` / dataSchemaVersion: `3`。
- 完成ZIP: `nebiki-helper-2026.8.9-51.zip`。SHA-256はZIP外の`.zip.sha256` / RELEASE_REPORT / ZIP_VALIDATIONを参照。
- baseline: 完成50 ZIP `nebiki-helper-2026.8.9-50.zip`、SHA-256 `edfc2586e5b0e6e0ba81827b1cc9411762e7907623a0a90c002d33e27763c91d`、build `build-20261012-025803-jst`。

## 時計更新の変更

`clock.ts`の共通pure helper `getNextAlignedRuntimeClockDelayMs(nowMs)` はtimestampの秒・ミリ秒を含めて次の毎分00秒/30秒までの正のdelayを求める。15:59:12.345なら17,655msで15:59:30.000、境界ちょうどなら30,000ms後を予約する。初回だけ整列してintervalに切り替える方式は使わない。

`startAlignedRuntimeClock()` は起動時に現在時刻を即反映し、その更新後に時計をもう一度読み、次の境界へsetTimeoutを予約する。遅延発火・時計の前後補正でも、発火時の現在時刻を1度反映して次回を再計算する。15:59:30.400なら29,600ms後の16:00:00.000を予約し、過ぎた更新分を追いかけない。focusとvisibleのvisibilitychangeで旧予約を解除・即更新・再予約し、hidden通知だけでは更新しない。generation/disposed guard・clearTimeout・listener cleanupで取消済callbackやStrictModeの旧subscriptionを無効にする。

置換対象はuseNebikiAppの表示時計、開始画面のsyncDraftTime、Appの日付変更確認の3つ。通常時は既存getRuntimeNowMs/getRuntimeNowと同じ実時計を使う。固定時計は起動・指定値の変更時に即反映し、共通timerを起動せず、実時計で上書きしない。undo通知・通信・retry・長押し等の時計以外のtimerは変更しない。

## 境界をまたぐ画面切替の表示遅れ

50版ではarea_judgeのnowMsが古いままrate_displayへ移り、専用effectが境界後に走るとdelay=0でreturnし、fresh clockで判定するlowerだけ非表示になってlate+5/説明はinterval待ちとなった。

51版のclock stateは再描画の契機として保持し、表示計算用nowMsは各renderでfresh getRuntimeNowMsを一度取り直す。lateTimeBonus・説明・推奨率・Review19等の同renderの派生値をそのsampleへ揃える。screen/area切替の共通時計effectも即反映し、effectが境界後に初期化された場合も次の30秒を待たない。area_judge等の各画面にも同じ00/30時計更新が届く。50のrate専用境界timeoutと単独testNow同期effectは整理し、同じ境界に別timeoutを追加しない。

lowerの表示/操作は50の共通条件を維持する。元15時はJST16:00以降、元17時はJST18:00以降だけlowerを除外し、操作時はfresh clockで再確認する。古いlower操作を拒否しても評価・率・storage・undo・syncは変更しない。higher、元auto基準±1・非累積、既存ready/端点/Review19/fixed-time制限は不変。

## 業務・保存の保持

時計更新は採用評価を変更せず、確定済みcompleted rate / rateDecisionSnapshot / AreaCount / 履歴を再確定しない。現在推奨率の15時16:00+ / 17時18:00+ late+5は既存sourceの元値から毎回計算し、累積加算しない。開始画面の同期bodyはそのまま: 16:40自動切替、weather input lock、進行中の元業務日/時刻、日付/曜日更新、条件編集を保持する。Appの日付変更ブロックも保持する。

15/17 only、夜枠撤去と原本退避、独立Review19の18:55以降/遅い復帰/保存失敗retry/once guard、46快適補正、48三連休日曜優先、注意7項目、長押し、Start2列は非変更。保存形式/schema3、SQL9、Supabase、AGENTS、依存、buildId生成方式、旧履歴normalizerに変更なし。新field/storage key/migrationなし。

## 変更ファイル

- `src/hooks/nebikiApp/clock.ts`: 共通delay / recursive timeout予約・復帰・解除。
- `src/hooks/useNebikiApp.ts`: 表示時計/Start同期の共通化、fresh render clock、50専用境界effect整理。
- `src/app/App.tsx`: 日付確認の共通化、fixed clockの安定したnumber依存。
- `scripts/check-aligned-clock51.ts`（新規）と既存`check-refactor-characterization.ts` / `check-late-area-quick50.ts` / `check-interactive-persistence.ts` / `check-daytime-operation49.ts` / `check-evening-comfort-flow.ts`。interval固定のfixtureを共有timeout・実際のdue callbackへ合わせ、保存/undo/queue/Review19/fixed-time等の既存保証を維持。
- `package.json` / `package-lock.json`: appVersionと専用check登録。依存不変。
- `dist/*`、`CHATGPT_HANDOFF.md`、本変更報告。

完成50ZIPとのbyte比較で、src105本の変更は上記3本だけ、残る102本は同一。SQL9本・AGENTS.md・過去CHANGE59本・dataVersion・Vite設定・依存はbyte-identical。全check入力211件/build入力120件のhashを凍結し、検査対象が実行・build後に変更されていないことを確認する。

## 検証結果

- 全`check:*`: **89/89 PASS**。旧88 commandは不変、時計専用checkだけ追加。
- `check:aligned-clock51`: **20/20 PASS**。ms/境目ちょうど・初期即同期・callback後fresh予約・遅延/前後clock補正・focus/visible/hidden・取消済callback・cleanup/StrictMode・実hook/TSXのStart16:40/weather lock/date・15/17 late率・screen切替時snapshot・Review18:55/19:40復帰・fixed READ ONLY・App midnight blockerを確認。
- 別実行の独立scheduler検証: **12/12 PASS**。601 timestampでdelay/境目を比較し、連続100復帰の1予約、解除後callback無効化等を確認。
- TypeScript (`tsc -b --force`とbuild内`tsc -b`) / production build / PWA `generateSW`: **PASS**。108 modules、precache10。build時のchunk-size・Browserslist更新案内はbaseline由来。
- focused ESLint（source3＋test6）: **0 errors / 2 existing warnings、新規0**。full ESLint: **9 errors / 5 warnings**で50baselineとfile/rule/severity/message比較の新規0・削除0。既存診断が残るためfull lint自体はexit1。

## 実ブラウザ確認

- インストール済Edge 155のproduction previewを、独立した人工fixture/時計・local profileで実行。360×844 / 390×844、normal/summer、15/17。全51フロー **108/108 PASS**（50仕様48＋aligned更新40＋Start/固定/日付/Review補足20）。別途50/51比較 **2/2 PASS**。集計summaryの全体は 108/108。
- タッチtap・クリックでlower/higher・次エリア・記録済み修正を操作。境界前後、00/30予約、area_judgeを開いたまま、旧timer未発火のscreen切替、focus/visibility、reload、保存済lower/確定snapshot保持を確認。Start16:40/weather lock、midnight block、fixed clock実時計上書きなし/production bytes不変、Review18:55の17source保存・once guardも確認。
- 同じnormal17/360条件で50raceを再現: 17:59:59.999のarea_judgeから、旧clock callback未発火のまま18:00:00.001で残数10を確定しrate表示。50はlowerなしだがlate説明なし・many15%、51はlowerなし＋late説明あり・many20%。両者ともtimer callbacks0を観測し、画面切替renderの修正を比較した。
- 横overflow0、unexpected console error/warning0、外部通信0。テスト環境がSW登録をblockした通知は別計上し、アプリ警告0と混同しない。source105本とbundleの検証前後hashは一致し、製品bundleへinstrumentationを追加していない。
- 生証拠はworkspace `work/alignedClock51/browser-work/` の `browser-results51.json` / `supplemental-results51.json` / `baseline-race-results51.json` / `final-browser-summary51.json`、各PNG。これらはZIP外。

## 未確認事項・既存不一致

時計・timer/focus/visibilityは自動化環境で制御した実Edge確認であり、物理タッチ端末、OS実時計の変更、実端末の長時間background/throttlingからの復帰、インストール済PWAのSW更新・offline動作、実Supabase mutationは未確認。固定時計のREAD ONLY、save失敗retry、cleanup/StrictMode、遅延callback・時計前後補正等の詳細は対応する自動fixtureでも確認し、実端末検証と区別する。

曜日基準の文言と、夏17時sessionを18時以降まで続けて新規中間評価を確定する際の既存hint/lowerと実処理/higherの不一致は今回の指定どおり変更しない。確定済み評価は時計だけで解決し直さず、引継ぎにもこの不一致を残す。
