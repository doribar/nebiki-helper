# 2026.8.9-26 変更報告

検証日: 2026-09-14〜15 JST

## 変更内容

Review19用の19時残数中央値からの5段階自動判定fieldを生成・保存・採用する処理を停止した。正式評価は既存の9段階人間入力。Review19画面・完了画面はbaselineから自動判定結果を表示しておらず、人間selector・実残数入力・reference label・JSON downloadをそのまま維持した。

- `buildReview19AutomaticEvaluation()` を `buildReview19HistoryStatistics()` に置き換え、hookのエリア入力時と最終観測保存時の2か所を切り替えた。
- 新規の `autoEvaluation` / `autoEvaluationStatus` は生成しない。既存 `autoEvaluationBasis` fieldは統計保存・読み込み互換用に残し、新規データでは中央値・標本数等だけをallowlistで保存する。
- 自動のbase/final評価、閾値、area rate、decrease metadataは新規Review19評価basisに保存しない。新形式の正規化でも同じallowlistを使用する。
- 共通の履歴選択・中央値エンジンは統計取得に再利用するが、その5段階判定はReview19で採用・表示しない。通常15/17の中央値判定は変更しない。

## 維持したデータ・互換性

12エリアの実残数、過去の同曜日count、median/sample、短期・長期統計、15/17/19履歴、Review19記録を削除しない。human raw9は全9段階を保存し、奇数だけ既存5段階fieldへ互換値を保存する。偶数段階を丸めない。

旧auto入りJSONは従来の正規化枝で読み込み、過去の観測値を保持する。旧途中stateの再開時、再入力しないエリアには旧autoが残り得るが、UI・主要判断には使わない。migrationや過去recordの遡及書換えは行わない。

`productionAnalysis` / `productionShortageSuspicion` は従来から19時human raw9を参照しており、ロジックを変更していない。15/17履歴との分析、保存・archive・outbox・direct rescue・cloud payload経路も維持。通常値引、夏17時の快適補正上限-10%、先行値引、曜日・quick・fixed-time・20:30の計算は非変更。

## 変更ファイル

- `src/domain/review19Evaluation.ts`: 自動評価生成を統計保存へ変更、統計allowlist。
- `src/domain/review19.ts`: 新形式の人間評価＋統計を正規化、旧auto枝維持。
- `src/domain/types.ts`: auto/statusを旧データ互換用optionalにし、保存semanticのコメントを更新。
- `src/hooks/useNebikiApp.ts`: importと2呼出しを新builder名へ変更しただけ。
- `scripts/check-review19-human-auto.ts`: 新形式・統計・人間raw9・旧auto互換を検証。
- `scripts/check-review19-download.ts`, `scripts/check-obon-calendar.ts`, `scripts/check-historical-archive-long-run.ts`: 旧auto生成の期待を統計に変更し、既存export/calendar/archive検証を維持。
- `package.json`, `package-lock.json`: versionのみ更新。check一覧・依存関係は変更なし。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

AGENTS.md・root SQL9本は9-25 ZIPとbyte-identical。Supabase/schema/SQL/RLS/grant/trigger変更なし。dataSchemaVersionは3、appVersion管理・buildId生成方法は非変更。Git repositoryなし、baseline ZIPとのhash/bytes比較で差分を検査する。

## 検証結果

- 全 `check:*`: **59/59 PASS**（packageの全check名との集合一致を確認）。Review19 human/statistics・旧auto互換31/31、download15/15、Obon16/16、archive長期6項目PASS。
- normal/summer各12エリアのhuman raw9全段階を正規化、archive保存・再読込、cloud row変換、Review19/daySnapshot/統合JSONへ往復。相反する旧autoを付けてもproductionAnalysisの全12エリアhuman raw9・不足疑い判定が一致。
- 既存human9 15/15、Review19完了保存16/16、priority70/70、quick40/40、先行率15/15・UI35/35・flow30/30、夏17時comfort46/46・integration11/11 PASS。通常値引、weather、fixed-time、20:30、storage、archive、export等も全checkに含む。
- TypeScript / production build / PWA generateSW PASS（101 modules、precache10）。chunk size / Browserslist dataの既存build警告あり。
- changed-file focused ESLint: **0 errors / 4 existing warnings**。full lint: **9 errors / 7 warnings**、9-25とfile/rule/severity/message比較で新規diagnostic 0。既存診断は今回の変更対象外。
- Edge production preview 390×844: 17時完了状態から18:55の正規Review19遷移、12エリア実入力（raw1〜9、偶数は長押し隣接選択）、保存→完了JSON download→JSON.parseを確認。残数11〜22、中央値20〜31、sample3を保持し、新規auto/statusやbasisの判定・補正fieldなし。
- IndexedDBには当日正本1件と既存履歴3件を保持。reload後は既存仕様どおりstartへ戻り、設定画面の全件4件・最新1件downloadでもhuman raw9、履歴統計、productionAnalysisを確認した。
- 横overflow、アプリconsole error/warning、page error、外部通信0。想定されたReview19 alert1回とdownload3回のみ。Service Workerを遮断するPlaywright設定由来のwarning2件は別記し、PWA runtime確認には数えない。
- AGENTS.md / root SQL9本は9-25 ZIPとbyte-identical。productionAnalysis、AreaCount engine、通常rate、天候・夏17時補正、先行値引、reference/transition、storage主要実装もbytes不変。hook差分はbuilder名のimportと2呼出しだけ。
- 親・担当agentの実行ログでGPT-6 Astra / Ultraを確認。制限時には停止し、再開時も同設定を再確認した。

未確認: 実Supabase通信・mutation、インストール済みPWA実機、実ユーザー端末・長時間background復帰。通常値引・夏17時等の今回の回帰は自動testで確認し、全通常フローの実ブラウザ再実行はしていない。

証跡: `work/review19human26/checks.json`、各check log、`lint-comparison26.json`、`protected-source-proof26.json`、`browser-work/browser-results26.json`。完成ZIP検査・SHAは `outputs/RELEASE_REPORT_2026.8.9-26.md` / `ZIP_VALIDATION_2026.8.9-26.json`。

## Release

- appVersion: `2026.8.9-26`
- buildId: `build-20260914-205743-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260915-0201.zip`
- baseline: `nebiki-helper-20260914-0129.zip`
- baseline SHA-256: `467fd3d2f9a7c6e9dcd72c9f7c8f7379367612fe0c9ff76a8be2046a0d36dd8e`
- 完成ZIPのSHA-256と再open検査結果はZIP外の `outputs/RELEASE_REPORT_2026.8.9-26.md`, `ZIP_VALIDATION_2026.8.9-26.json`, ZIP隣接`.sha256`へ記録する。
