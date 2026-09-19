# 2026.8.9-28 変更報告

検証日: 2026-09-19〜20 JST

## 変更内容と依存関係

ユーザーが「1日データ」を独立機能として操作する導線を削除した。実装前にUI、download、内部保存、Review19参照、archive/backfill、前日廃棄入力の依存を分類し、内部履歴を残す範囲で変更した。

| 分類 | 対応 |
| --- | --- |
| 完了画面 | 日次出力・任意メモ・メモ保存・専用stateを削除。上部基準ラベル、全12エリアの率一覧、戻る/home/18:30開始は維持 |
| 設定画面 | 日次全件/最新出力section、専用件数とprops、容量診断内の日次件数表示行を削除。Review19全件/最新出力、容量診断、Supabase同期は維持 |
| 廃棄入力 | 前日のfinalized recordだけを編集する専用UIのため、Startの入力とhook actionを削除。過去のdiscardCountは保持 |
| 専用download/公開API | 日次全件/最新/完了download、memo保存、前日廃棄保存、旧未使用統合download、専用derived/props/helper/refを削除 |
| 内部保存 | finalizedDayData、DailySessionSnapshot、daySnapshot、20:30確定保存、保存失敗時のDone抑止、record IDを維持 |
| archive/backfill | hydration、確定状態、営業日/cycle判断、snapshot retention、AreaCount復元/同期を維持 |
| 過去JSON | 日次/統合pure builderとnormalization、memo/discardCount等のlegacy metadataを維持。ユーザー向けdownload経路は削除 |

`finalizedDayData` はユーザー向け出力以外に、履歴確定、保存容量管理、backfill、履歴復元の正本として使用される。このため構造・archive・既存記録は削除しない。Review19生成・保存・JSON出力、productionAnalysis、15/17/19履歴、weather/calendar/rate計算を変更していない。

保存失敗alertは「1日データ」から「入力内容」へ表示名のみ変更。失敗時に入力を保持して再試行する制御は維持する。

## 変更ファイル

アプリ（7本）:

- `src/components/screens/DoneScreen.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/components/common/AdminSettingsDialog.tsx`
- `src/app/App.tsx`
- `src/app/AppRouter.tsx`
- `src/hooks/useNebikiApp.ts`
- `src/domain/types.ts`

テスト（既存7本＋新規1本）:

- `scripts/check-full-mode.ts`
- `scripts/check-feature-20260728.ts`
- `scripts/check-workflow-20260728.ts`
- `scripts/check-cycle-separated-export.ts`
- `scripts/check-memo-export-20260729.ts`
- `scripts/check-refactor-characterization.ts`
- `scripts/check-supabase-sync-domain.ts`
- `scripts/check-daily-ui-removal.ts`（新規）

リリース:

- `package.json`, `package-lock.json`
- `CHATGPT_HANDOFF.md`, `CHANGE_REPORT_2026.8.9-28.md`（新規）
- `dist/*`（production/PWA再生成）


AGENTS.md、root SQL9本、Supabase、schema、依存関係、version/buildId生成方法は非変更。packageにはversion更新と専用checkコマンド1本だけを追加。Git repositoryなし、baseline ZIPとのbytes比較で検証する。

## 検証

- 全 `check:*` **60/60 PASS**（既存59本＋専用1本）。専用UI撤去checkは **21/21 PASS**。packageのcheck名との集合一致を確認。旧UIを要求する7既存testの期待/境界を更新し、domainの互換性assertは維持。
- TypeScript / production build / PWA generateSW PASS（100 modules、precache10）。chunk sizeとBrowserslist dataの既存build警告あり。
- changed-file focused ESLint **0 errors / 4 existing warnings**。full lint **9 errors / 7 warnings**は9-27とfile/rule/severity/message比較で一致し、新規diagnostic 0。
- Edge production preview 390×844で通常Done6条件＋20:30 Doneの基準ラベル/12エリア一覧を維持し、日次メモ・出力UIなしを確認。前日finalized記録があるStartでも廃棄入力なし、旧メモ/廃棄値はarchiveに保持。
- 20:30の12残数を実入力し、内部finalized archive1件を保存、reload後の保持を確認。Review19も12エリアの人間評価を実入力・保存し、完了/設定全件/最新からJSONを取得してparse（1/4/1件）。最新recordは3出力で一致し、daySnapshot/productionAnalysisを保持。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、popupなし。既存Review19案内alert1件と要求した3downloadのみ。隔離用Service WorkerブロックによるPlaywright警告11件は別記録し、アプリ警告と混同しない。スクリーンショット10枚の目視確認済み。
- src96本中7本だけ変更。他89本、root SQL9本、AGENTS.md、version/build/schema生成処理は9-27 ZIPとbyte-identical。AST比較でもReview19生成/保存/出力、同期/backfill、session遷移、保存形式85型が不変。内部finalize関数は失敗メッセージと不要UI ref代入の削除だけ。
- GPT-6 Astra / Ultraのみを使用。使用制限時に中断し、再開時に実行記録で同設定を再確認した。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザ検証は隔離したfixtureで行い、外部通信は遮断した。その他の15/17/18:30/20時台・夏17時天候・quick・fixed-time・storage等の回帰は全checkと非変更コード比較で確認。

証跡: `work/dailyUi28/checks.json`、`lint-comparison28.json`、`source-proof28.json`、`browser-work/browser-results28.json`、`browser-work/browser-proof28.json`。ZIP再open検査とSHAはZIP外の `outputs/ZIP_VALIDATION_2026.8.9-28.json` / `RELEASE_REPORT_2026.8.9-28.md`。


## Release

- appVersion: `2026.8.9-28`
- buildId: `build-20260919-231318-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260920-0848.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260919-1807.zip`
- baseline SHA-256: `d8e925978776e8ac7fa31535f65e9e5507d6bd43609093c951a94b10af3a20d5`
- 完成ZIPのSHA-256と再open検査はZIP外の `outputs/RELEASE_REPORT_2026.8.9-28.md`、`ZIP_VALIDATION_2026.8.9-28.json`、ZIP隣接`.sha256`へ記録する。
