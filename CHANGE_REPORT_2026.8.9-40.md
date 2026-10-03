# 2026.8.9-40 変更報告

検証日: 2026-10-04 JST

baseline: `nebiki-helper-2026.8.9-39.zip` / SHA-256 `5f9463ea6f65f1a717f514de3887a9255c79e077657fdfb04b6490c5ede2bba2`。

## 実装

- AreaJudge、RateDisplay（多い/どちらでもない/注意事項）、AutoSkipNotice、AutoSkipCount、FinalTimeの同一エリア画面で `AreaCountStatusPanel` を使う。値は現在の `areaProgressMap[currentAreaId].areaCount`。AreaJudgeの入力確定後は既存count draftとmemo済みrecommendationを使い、残数用の重複state/keyを追加しない。未知の数を捏造しない。
- 減少率は保存済みdecisionBasisまたは既存recommendationのraw decreaseから表示。`canUse=false` は判定なし、`more_few` は良い、`none` は普通、`more_many` は悪い。比較は中央値±20pt、履歴最低3件。17時だけ、厳密な20pt境界の浮動小数点誤差をNumber.EPSILONで吸収する。19:30の判定式/結果は旧仕様を維持する。
- 17時15→17対象は `bento_men,tempura,onigiri,inari,hosomaki,ryomi,autumn,yakitori`。ryomiの内部ID・表示名「夏商品」は維持。croquette/fry_chicken/chuka_fish/sushi/futomaki_chumakiとlegacy balance_bentoは対象外。18:30は減少率比較なし。19:30は全エリアで18:30→19:30を維持。
- 17時の対象エリアでready/canUse/raw more_many/previousTime15が成立し、fixed-timeではない場合だけ、RateDisplayで「追加製造あり・補正を取り消す」/「補正を戻す」を表示する。良い/普通/判定なし/対象外/19:30には取消UIを出さない。
- canonical optional metadataは `AreaCountDecisionBasis.decreaseAdjustment.suppressed?: boolean` と `suppressionReason?: "additional_production"`。取消はtrue+reason、復元は両fieldを省略。raw currentDecreaseRate/medianDecreaseRate/directionは不変。欠損は取消なしとして読み、legacyをmigration/backfillで書き換えない。
- 自動判定なら取消後final=raw baseEvaluation、復元後final=raw baseから多い側へ1段。既存5段階clampとrate adjustmentを使い、非累積。explicit manual/quickは人間final・rate・raw9・automaticEvaluation/evaluationAdjustmentを優先して保持する。既存quickのbaseEvaluation=original autoというsemanticも維持する。
- 取消/復元は既存local-first AreaCount保存境界を先に通し、成功時だけcurrent progressを更新する。失敗時はstate/判定/recordを変更せず再試行できる。cycleを含む既存identityでcurrent recordを選び、memoryは1recordをshallow置換する。通常renderで全history clone/全archive getter/normalizeを追加しない。
- 同session/同areaの既存navigation snapshotだけ更新し、Backで入力済み残数と取消を失わない。Undoのpre-action snapshotは改変せず、quick/残数修正のUndoを維持する。count修正時にraw bad比較が引き続き成立する場合だけ取消を引き継ぎ、good/none/比較不能なら無効な取消を新判定へ持ち込まない。
- current/checkpoint、daily session snapshot、Review19 daySnapshot、finalized/archive、AreaCount record_details、export/remote JSONは既存propagationでmetadataを保持する。rateDecisionSnapshotへ新しい取消fieldを重複追加しない。source state/履歴/productionAnalysis/businessMonthは維持する。
- Doneの多い/どちらでもないはfinite numeric > 0だけ赤#ff0000/緑#008000。0/unknown/skip/20:30は従来色。既存snapshot numericと、既存rate coreを共有するcurrent numeric helperを使い、文字列をparseして色を決めない。エリア順・judge/status/note・表示値引率は不変。


## 境界と計算互換性

中央値50%に対して70/69/30/31%減は、それぞれ良い/普通/悪い/普通。raw decrease計算を別実装せず、そのdirectionを表示する。20pt・履歴3件・raw保持・非累積を専用testで固定。

互換比較の例外を明記する: 9-39は40%→60%のような厳密20pt境界でbinary誤差により補正なしとなることがある。17時に限りNumber.EPSILONの境界許容を追加し、数学的に厳密20ptなら既存定義どおり1段補正する。20pt未満を広く丸めず、19.99999999pt等は補正なし。19:30の比較式は従来そのまま。既存5対象の境界以外は9-39と一致する。過去保存データは再計算しない。

3640 AreaCount比較のうち3530全出力一致、110意図した差分（新対象90、17時binary境界20）。対象外17/18:30/19:30/20:30は全出力一致。手動取消の差分は別の実hookテストで検証する。
Review19統計112、weekday336、rate5040、rateDecisionSnapshot5040、advance1008、basis business fields336、productionAnalysis1458、numeric/current rate9072件ずつ一致。表示率のsource of truthを数値でも使うため、discountの既存計算bodyをnumeric helperとして返し、旧text builderは同じ値を従来どおり表示する。値引率の式/上限/補正順は変更しない。

## 保存・人間判断・性能

判定レイヤーはraw中央値→raw減少率→取消→明示human/quick→採用final。history sourceだけ取消/復元で採用値とarea adjustmentを変更し、manual sourceはそのfinalを保持する。legacy basisのoptional source/finalが欠損していても、current progressの正式manual finalを優先する。既存quickのhumanEvaluationDetails.automaticEvaluation、evaluationAdjustment方向/steps/original/final、basis.baseEvaluation=original autoを維持する。

正本を保存できない場合、取消状態やformal recordを先に更新しない。既存local-first保存・outbox・sync境界とidentityを利用する。source保存、current/checkpoint復旧、daily/Review19/finalized/export/remote JSON/IndexedDB archiveへのpropagationを確認。DB/SQL/schema変更なし。snapshot retentionやReview19 authoritative archiveを削除しない。

通常renderのcount/decrease表示はcurrent progressからだけ取り出す。取消は保存済みbasisを使い、recommendationを再計算しない。current AreaCount recordだけshallow置換し、memoryの全履歴cloneを追加しない。既存local-first journalの正本保存処理は変更しない。performance7/7、startup6/6、interactive12/12とEdge2000件/navigation24/CPU4xの診断を再実行。ブラウザの実数/範囲は下記証跡を参照。

## 変更ファイル

production（14本、うち新規2）:

- `src/app/AppRouter.tsx`
- `src/components/common/AreaCountStatusPanel.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/screens/AutoSkipCountScreen.tsx`
- `src/components/screens/AutoSkipNoticeScreen.tsx`
- `src/components/screens/DoneScreen.tsx`
- `src/components/screens/FinalTimeScreen.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/domain/areaCountHistory.ts`
- `src/domain/discount.ts`
- `src/domain/types.ts`
- `src/hooks/nebikiApp/decreaseSuppression.ts`
- `src/hooks/nebikiApp/ratePresentation.ts`
- `src/hooks/useNebikiApp.ts`

tests（新規4、既存期待値/実hook fixture更新4）:

- `scripts/check-area-count-performance.ts`
- `scripts/check-area-count-status-ui.ts`
- `scripts/check-area-decrease-adjustment.ts`
- `scripts/check-decrease-suppression-flow.ts`
- `scripts/check-done-rate-colors.ts`
- `scripts/check-done-summary-current-rate.ts`
- `scripts/check-logic.ts`
- `scripts/check-refactor-characterization.ts`

その他: package.json(version/check4)、package-lock.json(versionのみ)、CHATGPT_HANDOFF.md、本CHANGE_REPORT、dist/*。
SQL9本、AGENTS.md、過去CHANGE_REPORT、storage/archive/Supabase実装、version/build生成方式は9-39とbyte-identical。Review19統計・productionAnalysis・businessMonth処理もbyte-identical。

## 検証結果

- 全check:* **77/77 PASS**（9-39の73 + 専用4）。domain35/35、実hook取消フロー15/15、実component/event/AppRouter UI16/16、Done色9/9。性能は既存AreaCount7/7、startup6/6、interactive/recovery12/12もPASS。
- 9-39比較: AreaCount3640の3530件は全出力一致。意図した差分110件は、新17対象ryomi/autumn/yakitoriの90件と17時厳密20pt境界20件のみ。40%→60%および60%→40%のbinary誤差を修正し、旧5対象でもこの境界だけ旧9-39の補正なしと差がある。19:30ではこの変更を適用しない。
- Review19統計112、weekday336、rate5040、rate snapshot5040、advance1008、basis business fields336、productionAnalysis1458、numeric/current rate9072件ずつは一致。入力非破壊。天候/商品policy/冷惣菜/暦/営業月/Review19自動移行は非変更。
- TypeScript / production build / PWA generateSW PASS（104 modules、precache10）。focused ESLint4 existing errors/3 existing warnings、full9 existing errors/6 existing warnings。file/rule/severity/message比較で新規error/warning0。移動した行番号とReact診断のcode-frame行番号のみ正規化し、診断文とcode tokenは保持。既存largechunk/Browserslist warningは残る。
- Edge production preview390×844で最終buildの残数継続/修正/Back/reload/recovery、悪い取消/復元、良い/普通/対象外/19:30の取消なし、human/quick優先、日次/Review19/archive、Done色、横overflowを確認。意図的な保存失敗は隔離fixtureで別集計。通常application consoleerror/warningと外部request0。詳細は外部browser summaryを参照。
- SQL9本・AGENTS.md・過去CHANGE_REPORT・保存architecture・version/buildId生成方式/schema3は9-39とbyte-identical。100 production source中86本が9-39とbyte-identical。
- GPT-6.1 Sol / Ultraのみ使用（並列agentを含む）。

未確認: 店舗物理端末/native touch、インストール済みPWA、実Supabase通信、店舗の全過去archive、物理crash/長時間background。CPU4x/software touch/隔離fixtureは実端末の速度保証ではない。起動archive gateの既存long taskを今回解消したとはしていない。

証跡: `work/areaDecrease40/checks.json`, `lint-comparison40.json`, `baseline-comparison40.json`, `calculation-comparison40.json`, `browser-work/final-browser-summary40.json`。完成ZIP検査/SHAは外部release報告/検査JSON。


## Release

- appVersion: `2026.8.9-40`
- buildId: `build-20261003-235945-jst`（既存JST生成方式、buildは2026-10-03 23:59:45 JST）
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-40.zip`
- SQL / Supabase schema / RLS / GRANT / trigger / identity変更なし。
- AGENTS.md変更なし。過去release報告非変更。

## ブラウザ証跡

`work/areaDecrease40/browser-work/final-browser-summary40.json` が最終source/build確認、操作結果、performance測定、保存失敗fixtureの別集計、screenshotsを記録する。完成ZIPの検査とSHA-256はZIP外のrelease報告/検査JSONへ記載し、自己参照を避ける。

