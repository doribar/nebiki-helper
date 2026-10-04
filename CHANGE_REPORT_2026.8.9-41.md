# 2026.8.9-41 変更報告

検証日: 2026-10-04 JST

baseline: `nebiki-helper-2026.8.9-40.zip` / SHA-256 `bc8f98a38bb995b7a50135dd0bab5b5478e72b7eef77041757f77d4c803ee200`。

## 実装と変更範囲

設定の「19:00チェックデータを全件出力」は、normal/summerの正式なReview19履歴を、時系列に並べた1つのpretty JSONへ出力する。

9-40はactive cycleで履歴を選んでいたわけではない。`useNebikiApp.ts` の `exportAllReview19Data()` が全archiveから取得し、`buildAllReview19DataExportPayloadsByDemandCycle()` でnormal/summerに分け、それぞれに `buildAllReview19DataExportPayload(..., demandCycle)` のfilterを適用して2ファイルをdownloadしていた。

9-41は同じ `archivedReview19RecordsRef.current` を `buildAllReview19DataExportPayload({ records, exportedAt })` へ渡し、demandCycleを指定しない。既存builderはこの場合両cycleを返す。既存 `downloadJsonFiles()` に1ファイルだけ渡す。componentとUI文言は変更不要だった。最新出力・完了画面の直接出力は変更なし。明示cycle指定のpure builder、cycle別bundle builder、cycle別filename helperも保持する。

`getAllReview19ExportFilename(exportedAt)` は既存の `formatJstExportTimestamp()` を再利用し、`nebiki-review19-all-YYYYMMDD-HHmm.json` を返す。日時不正の場合も既存同等のsuffix省略を使う。新しいselector/button/exportScopeは追加しない。

## 正本・重複排除・local/remote・legacy

全件出力sourceは起動archive gate後のcanonical memory view `archivedReview19RecordsRef.current`。既存 `HistoricalArchiveRepository` がIndexedDBとlocal journalの重複を解決し、readyなnormal/summerのremote履歴も `cacheRemoteReview19InHistoricalArchive()` のupsert成功後に同じviewへ反映する。cycle別queryの呼出し、remote identity、local-first/failure continuityは変更していない。exportボタンでremote query・archive write・migration/backfillを行わない。remote-only記録がexportへ入るには既存archive cacheの成功が必要で、cache失敗時に前のviewを保持する挙動も9-40と同じ。未同期remoteを即時取得する機能は追加していない。

archiveのoperation identityは `date × normalizeDemandCycle(demandCycle) × sessionStartedAt`。同identityは既存のfinal/complete/sourceUpdatedAt/richness優先ルールで1記録へまとめる。同日でも異なる正式operation identityは保持する。remote tableのbusiness unique identity `date × demandCycle` との役割の違いも維持する。export内で新しいdedupeや雑なconcatを追加せず、正本のcanonical集合を使う。中央値用complete/final-onlyのmergeをexportへ転用しないため、recordedなincompleteも出力できる。

旧recordの欠損cycleは既存 `normalizeReview19Result()` のdaySnapshot/snapshot/reference由来の解決と、既存normal fallbackをそのまま使用する。今回新しい分類・物理書換え・migration/backfillは行わない。各recordのsummer/normalは保持し、`all`へ変換しない。

## JSON・品質・並び順

既存 `buildReview19ExportPayload()` が最終record集合からcountとdataQualityを再集計する。format/version/schema/appVersion/buildId/exportedAt/count/dataQuality/recordsと、recordのdate/cycle/businessMonth/areaCounts/areaEvaluations/productionAnalysis/calendarContext/analysisWeatherContext/snapshot/daySnapshotと、その中のrateDecisionSnapshot等の既存metadataを維持する。pretty printは既存 `JSON.stringify(payload, null, 2)`。blob/anchor cleanupも既存download helperのまま。

sortは既存 `selectAllReview19Data()` / `compareReview19Data()` のまま、date昇順、同日ならreviewCompletedAt→reviewStartedAt→sessionStartedAtの既存実施時刻fallbackで比較し、最後にsessionStartedAtを比較する。cycleによるgroup分けを行わない。

必須fixtureはsummer9/28complete・9/29complete・9/30incomplete、normal10/1complete・10/2complete・10/4complete。結果はcount6、recordedCount6、completeRecordCount5、incompleteRecordCount1、summer3/normal3、9/28→9/29→9/30→10/1→10/2→10/4。active normal/summerで同じ集合。dedupe、同日別operation/cycle、legacy、local-only、remote-only、remote failure継続、空集合/download失敗、入力/保存非破壊も専用testで確認。

## 非変更とperformance

100 production sourceのうち98本が9-40 ZIPとbyte-identical。変更2本のうちhook差分はexportのimport/functionだけ、domain差分はfilename helper追加だけ。Review19入力/9段階評価/統計/productionAnalysis/AreaCount/減少率/率計算/businessMonth/calendar/weather/coldDeli・advance/保存/復元/retention/remote処理は非変更。通常render/startupへ全history normalize/clone/getter/serializeを追加していない。処理は全件出力の明示操作時だけ実行する。既存AreaCount性能7/7、startup6/6、interactive/recovery12/12もPASS。

9-40との実計算比較は差分0、入力非破壊。結果: `{"recommendations": 3640, "expectedDifferenceCount": 0, "reviewStatistics": 112, "weekdayRates": 336, "rateCalculations": 5040, "rateSnapshots": 5040, "advanceCalculations": 1008, "coldDeliCalculations": 2016, "productionAnalyses": 1458, "numericRateComparisons": 9072, "currentRateComparisons": 9072, "humanEvaluations": 90, "businessMonthComparisons": 117, "analysisMetadataComparisons": 310, "compatibilityPassed": true, "inputUnchanged": true}`。root version/build metadataは9-41として更新するが、過去recordを新計算結果へ置換しない。

## 変更ファイル

- `scripts/check-cycle-separated-export.ts`
- `scripts/check-feature-20260728.ts`
- `scripts/check-review19-all-export.ts`
- `scripts/check-review19-download.ts`
- `src/domain/separateDataExport.ts`
- `src/hooks/useNebikiApp.ts`

その他: `package.json`（version/専用check1本）、`package-lock.json`（versionのみ）、`CHATGPT_HANDOFF.md`、本CHANGE_REPORT、`dist/*`。AGENTS.md・root SQL9本・過去CHANGE_REPORT・version/build生成方式・schema3は9-40とbyte-identical。

## 検証

- 専用test: `{"review19AllExport": "14/14 PASS", "review19Download": "15/15 PASS", "cycleSeparatedBuilders": "7/7 PASS", "legacyFeatureRegression": "6/6 PASS", "independentCanonicalSourceAudit": "9/9 PASS"}`。旧testのempty guard文字列期待値をpayload.countへ合わせて再test6/6、他77本もPASS。実hook/download・archive/runtimeを実行し、静的文字列確認だけにはしていない。
- 全check:* **78/78 PASS**。Review19/archive/storage/export/AreaCount/quick/fixed-time/天候/減少率/起動・interactive性能の既存checkを含む。
- TypeScript / production build / PWA generateSW PASS（104 modules、precache10）。既存JST build生成を維持。
- focused ESLint: 0 existing errors / 3 existing warnings。full: 9 existing errors / 6 existing warnings。9-40とfile/rule/severity/message比較で新規error/warning0。root path・埋込座標・code-frame行番号だけ正規化し、diagnostic本文とcode tokenを保持。
- buildの既存large chunk・Browserslist outdated warningは残る。今回の新規警告ではない。
- Edge production preview390×844、最終build `build-20261004-211829-jst` / `/assets/index-DhEGOP6I.js`。normal/summerで1click=1file、6件/両cycle/品質/時系列/filename/JSON metadata、最新出力と通常weather→advance→areaを確認。完了直接出力は自動testで確認し、browserでは未確認（保存済みdone stateのreloadは既存のstart/null正規化仕様）。application error/warning・不要外部通信・横overflow0。正確なケース・操作・未確認範囲は `work/review19AllExport41/browser-work/final-browser-summary41.json` を参照。
- SQL/Supabase schema/RLS/GRANT/trigger/remote identity変更なし。archive/localStorage/outbox/cloudの保存責務は変更なし。

## Release

- appVersion: `2026.8.9-41`
- buildId: `build-20261004-211829-jst`（既存JST timestamp生成）
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-41.zip`

完成ZIPそのものを再openし、testzip・duplicate/case-insensitive duplicate・backslash/invalid/traversal・single root・symlink・nestedZIP/node_modules/cache/.env/credential・dist/PWA/version/build/schema・working tree対象file集合/bytes・SQL9本/AGENTS/past reports同一性を確認する。SHA-256と最終検査結果はZIP外の `RELEASE_REPORT_2026.8.9-41.md` / `ZIP_VALIDATION_2026.8.9-41.json` / `.zip.sha256` に記録し自己参照を避ける。

未確認: 実店舗物理端末/native touch、インストール済みPWA、実Supabase通信、実店舗の全過去archive、物理crash/長時間background。隔離fixtureでのEdge確認であり、店舗archive全件取得の実通信検証ではない。既存起動archive gateのlong taskを本変更で解消したとはしていない。
