# 2026.8.9-39 変更報告

検証日: 2026-10-03 JST

## 基準表示と営業月metadata

全1〜12月で、基準の夏prefix/無prefixを営業月表示へ変更した。対象はAreaJudge、RateDisplay、AdvanceDiscount、通常Done、Review19。既存共通formatterとBasisGuide表示だけを変更し、component・曜日resolver・rate coreへロジックを重複追加しない。

実表示例: `10月の金曜日の17時を基準に考えて`、`10月・金曜日・17時`、group `10月・金曜日・土曜日・17時`。Review19は既存時刻表示を維持し、`10月・金曜日・19時`。新規月表示以外の文型とgroup内容はそのまま。normal/summerの需要modeを廃止したわけではなく、modeを示す既存「夏季モード基準」badgeも維持する。

月はsession/recordの営業日ISOから軽量に導出する。timestamp/UTC/現在月は使わない。Review19の保存reference.dateとrecord.dateが異なるlegacy caseはrecord.dateの月を使い、保存済みweekdayと既存reference再解決/19時表示を尊重する。

## 保存・互換性

canonical optional `businessMonth?: number` を追加し、valid値は整数1..12。新規Review19 root、review19Check、daySnapshot root / daySnapshot.review19Checkへ同じ営業月を保存する。current/checkpoint/recovery、authoritative IndexedDB archive、direct/latest/all/cycle別Review19 export、既存日次exportコピーへ保持する。

lightweight outboxは従来のidentity参照のまま。送信時にarchive正本を解決し、既存remote JSON payload内へmonthを保持する。新しいDB columnやschema/key/migrationはない。SQL9本・Supabase処理/RLS/grant/trigger・identity・direct rescueは非変更。

旧recordの欠損をnormalize/read/archive/remoteで勝手に埋めない。`resolveBusinessMonth()` はvalidな保存monthを優先し、必要時だけdate由来のfallbackを返す。exportは独立copyのみへ補い、元record/LS/IDBへ書き戻さない。不正値は採用せず、無効dateを現在月で補完しない。過去recordや過去CHANGE_REPORTは非変更。

## 計算・performance非変更確認

AreaCount母集団は通年共通のまま、short16/long52、同曜日3件、group fallback、long median guard、decrease、20:30、calendar/長期連休を維持。月別filterは追加しない。Review19統計、raw9/tap-toggle、productionAnalysis、summer gate/夏17 dry快適-10、weather/global/商品policy/冷惣菜/先行値引、manual18、18:55Review19のbusiness条件は非変更。

9-38 ZIPとの全出力比較は、AreaCount1260、Review19統計32、weekday core336、rate5040、rateDecisionSnapshot5040、advance1008、basis business fields336、productionAnalysis1458すべて一致。既存入力は非破壊。basis表示2fieldとoptional月metadataだけが意図した差分。

performance構造は全既存checkで再確認。月表示のためにrender全archive read/全Review19 normalize/productionAnalysis再構築/全AreaCount prepare/大量JSONcloneを追加しない。9-38のstartup6/6、interactive12/12、AreaCount performance7/7もPASS。ブラウザ再測定の範囲と実数は下記証跡を参照し、起動gateのlong taskが解消したとはしない。

## 変更ファイル

production（7本、新規helper1本を含む）:
- `src/domain/businessMonth.ts`
- `src/domain/finalizedDayData.ts`
- `src/domain/review19.ts`
- `src/domain/types.ts`
- `src/domain/weekdayBase.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/hooks/useNebikiApp.ts`

tests（2新規、既存表示期待値とexport golden互換更新）:
- `scripts/check-advance-discount-ui.ts`
- `scripts/check-analysis-metadata-ui.ts`
- `scripts/check-business-month-label.ts`
- `scripts/check-holiday-before-normal-weekday.ts`
- `scripts/check-long-holiday-reference.ts`
- `scripts/check-obon-calendar.ts`
- `scripts/check-refactor-characterization.ts`
- `scripts/check-reference-label-quick-adjustment.ts`
- `scripts/check-review19-business-month.ts`
- `scripts/check-three-day-holiday-middle.ts`
- `scripts/check-weekday-groups.ts`

その他: package.json(version+check2本)、package-lock.json(version)、CHATGPT_HANDOFF.md、本CHANGE_REPORT、dist/*。
AGENTS.md・root SQL9本・全過去CHANGE_REPORTは9-38 ZIPとbyte-identical。全98 production sourceの91本もbyte-identical。

## 検証結果

- 全check:* **73/73 PASS**。月表示28/28、月保存11/11。旧export goldenは月field4箇所を明示assertし、それだけを除いた既存JSON長さ34742・SHA-256の厳密期待値を維持。
- UI test: 全12月・両cycle、指定7月カテゴリ×15/17/19の実component SSR、single/group/manual weekday/calendar、record/reference営業日不一致、UTC境界、無効date/no-clockfallback。
- 保存test: actual完成handler、month1..12、12area raw9、check/day copy、archive/remote JSON・lightweight outbox解決、current/checkpoint、fixed-timeproductionwrite0、新旧各export、legacy storagewrite0、productionAnalysis/統計非変更。
- TypeScript / production build / PWA generateSW **PASS**。102 modules / precache10。既存largechunk、Browserslist outdated-data warningは残る。
- focused ESLint **0 errors / 3 existing warnings**。full **9 errors / 6 warnings**。9-38 file/rule/severity/message比較で新規error/warning **0**。
- Edge390×844: actual最終production buildで10月15/17/Review19、7/8/9月summer、weekday group。18:55Review19へ実遷移し12エリア入力→完了→JSON download/parse→archive month10。横overflowなし、application consoleerror/warning0、外部request0。software touch、固定Date、native timers/performance、隔離fixture。詳細: `work/businessMonth39/browser-work/final-browser-summary39.json`。

## Release

- appVersion: `2026.8.9-39`
- buildId: `build-20261003-085458-jst`（既存JST生成方式、vite.config byte-identical）
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-39.zip`
- SQL / Supabase schema / RLS / grant / trigger変更なし。AGENTS.md変更なし。
- GPT-6.1 Sol / Ultraのみ使用（並列agentを含む）。

## 未確認事項

実店舗物理端末、native touch、インストール済みPWA、実Supabase通信/remote roundtrip、店舗全過去archive、物理crash/長時間backgroundは未確認。API JSONとoutbox解決は自動testで確認し、実cloud通信とは区別する。9-38の起動archive gateに残るcanonical化のlong taskは今回対象外。

## 証跡

`work/businessMonth39/checks.json`、`lint-comparison39.json`、`baseline-comparison39.json`、`calculation-comparison39.json`、`browser-work/final-browser-summary39.json`。ZIP検査・SHA-256はZIP外のrelease報告と検査JSONへ記載し、自己参照を避ける。

## Edge performance再確認

2000 AreaCount / navigation24 / CPU4xの隔離fixtureで各13操作を実行した。新たな複数サイズmatrixや9-38との直接latency比較は実施していない。診断copyはwrapperとReact commit後frame、完成版は実clickから2回目rAFまでの値であり、physical paintや実店舗速度の保証ではない。

|操作|診断copy click→settled commit frame ms|完成版 click→2回目rAF ms|
|---|---:|---:|
|fresh.weather.change|10.4|8.6|
|fresh.temperature.change|9.6|9.3|
|fresh.wind.change|8.1|7.4|

上記各変更でhistory clone/runtime write/archive full getter/Review19 normalize/productionAnalysis/AreaCountPrepare/Review19Prepareはすべて0。current/checkpoint各1回で即時保存を維持。計測copyの元source hash92件一致、release source/distへinstrumentation混入なし。application console0と別に、PlaywrightがService Workerを遮断したharness warning9件を記録した。
