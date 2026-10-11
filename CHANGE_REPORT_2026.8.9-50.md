# CHANGE REPORT 2026.8.9-50

- appVersion: `2026.8.9-50` / buildId: `build-20261012-025803-jst` / dataSchemaVersion: `3`。
- 完成ZIP: `nebiki-helper-2026.8.9-50.zip`。SHA-256はZIP外`.zip.sha256` / RELEASE_REPORT / ZIP_VALIDATIONを参照（自己参照回避）。
- baseline: 完成9-49 ZIP `nebiki-helper-2026.8.9-49.zip`、SHA-256 `8bddc3557d1612b2b4f4d11cd113a2ce90458dbec9ccc118bf45f727c84b8881`、build `build-20261011-220012-jst`。

## 表示と操作の共通条件

元の値引sessionが15時ならJST16:00:00から、17時ならJST18:00:00から、自動判定カードのdirection=lowerだけを非表示にする。normal/summer共通。画面の表示ラベルやglobal/快適/遅延補正の数値では判定しない。higherの表示条件、few/many端点、ready/不足/不明、fixed-time/Review19の非表示条件は維持する。

`areaEvaluationAdjustment.ts`のpure helper `getAreaEvaluationLowerQuickAdjustmentDelayMs(discountTime, now)` がJSTの当日境界までのmsを解決する。境界以降0、旧18/19/20等は対象外null。`getAreaEvaluationQuickAdjustments()` に必須nowを渡し、lowerとdelay0の組合せだけを除外する。評価の5段階順・directionの意味・元automatic基準±1・非累積・metadata形式は変更しない。

AppRouterは表示時の `getRuntimeNow()`、hook actionは操作時点のfresh `getRuntimeNow()` を同じgetQuickへ渡す。境界前に取得した古いlowerイベントでも、境界後はselection生成/judge/評価保存/率更新/undo/syncを呼ばずreturnする。

開いたrate画面には同helperのdelayを使う境界timeoutを追加し、境界でclock stateを更新する。既存30秒timer/focus/visibility更新、reload/area移動時のrenderも現在時刻を使う。fixed-timeは既存runtime test clockとREAD ONLY・quick非表示を維持し、新しい境界timeoutを起動しない。

## 確定済み内容と既存運用の保持

RateDisplayScreenはbyte-identicalで、human lowerの説明・採用判定・full manual selector・長押し操作は残る。非表示化で保存済み評価をautoへ戻さず、確定済みrateDecisionSnapshotや履歴を再生成しない。確定率と現在推奨率は区別し、15時16:00+ / 17時18:00+の既存late+5表示・新規確定計算を維持する。+5の再表示による累積はない。

保存関係は49と同じ: humanEvaluationDetails.automaticEvaluation / evaluationAdjustment.originalEvaluationは元auto、areaCountEvaluation/suggestedEvaluation/finalEvaluationは採用値。evaluationAdjustmentはhumanEvaluationDetails内部に保存し、humanEvaluationDetails自体がarea progress / daily area snapshot上でrateDecisionSnapshotと隣接する。rateDecisionSnapshot内部へこのmetadataを追加しない。source/base/final/areaRateAdjustment/session/daySnapshot/finalized/export/AreaCount propagationは不変。

49の15/17 only、16:40切替とweather lock、独立Review19の18:55以降・遅い復帰・保存/失敗retry、旧夜枠退避、46快適補正、48三連休日曜優先、天候/注意7/Start2列を維持。SQL9・AGENTS・schema3・Supabase・依存・build生成方式・旧履歴normalizerは変更なし。新field/storage key/DB migrationなし。

## 変更ファイル

- `src/domain/areaEvaluationAdjustment.ts`: JST lower制限と共用境界delay、now必須。
- `src/app/AppRouter.tsx`: 表示にruntime clockを渡す。
- `src/hooks/useNebikiApp.ts`: rate境界timeoutとactionのfresh clock再確認。
- `scripts/check-late-area-quick50.ts`: 専用test追加。
- `scripts/check-area-quick-adjustment.ts` / `check-reference-label-quick-adjustment.ts` / `check-decrease-suppression-flow.ts`: 旧期待を境界前のdeterministic clockで固定しnow追加。
- `scripts/check-refactor-characterization.ts`: 追加した境界timeout effectの件数を反映し、49の保存guard・interval数の保証を維持。
- `package.json` / `package-lock.json`: version50と専用check1登録、依存不変。
- `dist/*`、`CHATGPT_HANDOFF.md`、本CHANGE_REPORT。

上記3 production files以外のsrc102本、RateDisplayScreen・全計算/保存/履歴/同期core、SQL9、AGENTS、過去CHANGE58本は49ZIPとbyte-identical。

## 検証結果

- package.jsonの全check:* **88/88 PASS**。全88件を実行し、初回失敗した2件だけ修正後に再実行した。既存characterizationのeffect数24→25を今回の境界timeout追加に合わせ、新規testのclampで率差が見えないfixtureを天候中立条件へ修正。既存保証の削除やproduction計算の変更はない。
- 専用check:late-area-quick50 **29/29 PASS**。5段階×通常/夏季・JST境界±1ms・表示と操作・境界timer/cleanup・focus/visibility・古いlower操作のstate/save/undo/sync不変・保存済みlowerとsnapshot/伝播・late+5非累積・fixed-timeを検証。
- area quick **40/40**、reference label quick **29/29**、decrease suppression flow **15/15 PASS**。49 daytime/retired-night/Review19、46 weather、48 reference、storage/archive/export等も全checkに含む。
- 独立runtime audit **38/38 PASS**。3 production fileの差分を独立確認し、それ以外のsrc102本、SQL9、AGENTS、過去CHANGE58本は49とbyte-identical。build input120 / check input210のhashは最終候補と一致。
- TypeScript `tsc -b --force`、production `npm run build`（tsc -b + Vite）、PWA generateSW **PASS**。108 modules / precache 10 entries。bundle `/assets/index-VfzdDVUq.js`、SHA-256 `e9fd99ec360f85e7081eefb4b80c58a59b295ed6064d7b6e51460f555084520a`。
- focused ESLint **0 errors / 2 existing warnings**。全体lint **9 errors / 5 warnings**で49 baselineと同数。file/rule/severity/message比較で新規・消失diagnostic **0**（埋込path/行座標のみ正規化）。全体lintのexit 1は既存診断によるもので、PASS扱いしない。
- buildには既存のchunk size / Browserslist stale data警告が残る。build設定・依存を今回変更しない。

## 実ブラウザ確認

- インストール済みMicrosoft Edge **155.0.4283.45**のheadless実ブラウザでproduction distを確認。通常/夏季×15/17×幅360/390×6flow **48/48 PASS**。隔離した人工履歴fixture（2026-09-29、canonical3件）と時計制御を使用し、店舗データへアクセスしない。
- 境界前15:59:59 / 17:59:59から999ms時点はlowerを保持、1000ms（16:00:00 / 18:00:00）でlowerだけ非表示。30秒tickを待たないことを確認。higherのtap、few/many端点、focus/visibility、reload、別エリア移動、30秒更新も確認。
- 境界前に捕捉した古いReact callbackを境界後に実行する8ケースで、評価/率/current/checkpoint/runtime/undoを含む全localStorage bytesと実AreaCount rowsは不変。
- 保存済みlowerの採用判定・説明を境界後/reload後も保持。境界前に完了した8ケースのprogress / rateDecisionSnapshotは全fieldを比較して保持。reloadでは既存local→IDB archive配置移行があるため、同一canonical recordの完全内容で比較し、移行をデータ改変と扱わない。操作拒否の検証では配置・bytesも厳密に比較する。
- 現在推奨率の既存late+5と保存済み確定率は別に確認。normal17のlower採用中の現在many率10→15%、summer17は5→10%だが、境界前に完了したsnapshotは書き換えない。新規確定snapshotは元15/17時・late_plus5/+5・early0、再表示による累積なし。
- software touch **352 taps**、geometry **136 checks**、96 screenshots。横overflowなし、console error **0**、想定外warning **0**、外部通信 **0**。Service Worker遮断による検証環境通知104件は別分類し、warning皆無とは報告しない。
- 初回の環境制限によるEdge/loopback起動失敗と、reload時archive配置を同一視したharness失敗は証拠へ保存。harnessをcanonical完全内容比較へ修正後、48件を最初から再実行。アプリcodeの修正なし。検証前後でsrc105本とbundle hash一致、所有previewを停止しlistener 0。
- 詳細証拠はworkspaceの`work/delayedQuick50/browser-work/`（final-browser-summary50.json / BROWSER_SUMMARY50.json / browser-results50.json / preview-cleanup50.json）。ブラウザinstrumentation・人工データ・画像等はrelease ZIPへ含めない。

## 未確認事項・既存不一致

実店舗の物理タッチ端末、インストール済みPWAの更新/Service Worker挙動、実Supabase通信、端末の長時間background復帰は未確認。実Edgeはsoftware touch・時計制御・隔離人工fixtureであり、捕捉した古いcallbackはinstrumentationによる再現。SSR/自動testと実ブラウザの確認範囲を区別する。固定時計READ ONLY、履歴不足、保存伝播等の網羅条件は自動checkで確認した。

夏17時sessionを18時以降まで継続して新規中間評価を確定する場合、既存実時計18:00規則はhigher、静的hintの指定本文は「15時・17時:少ない側」のため不一致が残る。確定済み評価を時計だけで解決し直さない。今回曜日基準の文言・この案内は対象外の指定で変更せず、解消済みとしない。
