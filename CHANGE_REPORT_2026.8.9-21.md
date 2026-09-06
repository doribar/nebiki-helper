# 値引ヘルパー 2026.8.9-21 CHANGE REPORT

作成日: 2026-09-07 JST。baseline: 検証済み2026.8.9-20。
appVersion: `2026.8.9-21` / buildId: `build-20260907-020124-jst` / dataSchemaVersion: `3`。

## 実装内容

Review19完了画面の主操作を、従来のJSONファイル出力から「ChatGPT用にコピー」へ変更した。完了済み `state.review19` を既存の `buildDirectReview19DataExportPayload()` で包み、従来のdownloadと同じpretty JSON文字列を `navigator.clipboard.writeText()` へ渡す。export形式の別実装やmetadataの削除・要約は行っていない。

copy操作ではBlob、`<a download>`、browser download、file saveを呼ばない。clipboard API未対応、権限拒否、serialization失敗は画面内エラーとして扱い、Review19のcompletion、archive、outbox、cloud、localStorage、IndexedDBを変更しない。成功は画面内に「コピーしました」と表示し、約5秒で消す。連打中は一回に制限し、失敗後は再試行できる。

設定画面の「19:00チェックデータを全件出力」「最新の19:00チェックデータを出力」は既存のJSON downloadを維持した。Review19入力、保存完了条件、9-20の18:55以降優先遷移、17時source/snapshot保全、storage architecture、fixed-time、Supabase/SQL、値引率・評価ロジックは変更していない。

## 変更ファイル

- `src/components/screens/Review19DoneScreen.tsx`: 完了画面のcopy button、busy/status表示、5秒成功表示。
- `src/hooks/useNebikiApp.ts`: 完了recordの既存export builderをclipboardへ渡す `copyCompletedReview19Data()`。
- `src/app/AppRouter.tsx` / `src/domain/types.ts`: 完了画面action名と型。
- `scripts/check-review19-copy.ts`: export payload一致、全metadata、失敗・再試行、無副作用、UI、設定downloadの専用check。
- `scripts/check-feature-20260728.ts` / `scripts/check-full-mode.ts` / `scripts/check-refactor-characterization.ts` / `scripts/check-workflow-20260728.ts`: 完了画面のaction・文言契約を更新。
- `package.json` / `package-lock.json`: appVersion 2026.8.9-21、専用check登録。
- `CHATGPT_HANDOFF.md`: 9-21の現行状態と検証結果。
- `CHANGE_REPORT_2026.8.9-21.md`: 本報告。
- `dist/`: production build / PWA generateSW成果物。

`AGENTS.md`、application domain/export builder、設定画面download、Review19保存処理、18:55優先遷移、root SQL 9本は変更していない。

## 検証結果

- package.jsonの全 `check:*`: 53/53 PASS。
- `check:review19-copy`: 21/21 PASS。normal/summer、主要metadata、records、nested snapshot、clipboard拒否/API欠如、completion維持、storage/download無変更、再試行、設定全件・最新download、UI成功/失敗/連打を検証。
- TypeScript / production build PASS、99 modules。PWA generateSW PASS、precache 10 entries。chunk sizeと古いBrowserslist dataの既存build警告は残る。
- changed-file focused ESLint: 0 errors / 4 warnings。既存useNebikiAppのhook依存警告のみ。
- 全体lint: 既存baselineの9 errors / 7 warnings、exit 1。9-20 baselineとのfile/rule/severity/message比較で新規diagnostic 0。
- root SQL 9/9と `AGENTS.md`: 9-20 baselineとbyte-identical。SQL / Supabase schema / RLS / grant / trigger変更なし。

## 実ブラウザ確認

Edge（Chromium）のproduction preview、390×844、Asia/Tokyo、隔離local originで確認した。

- 18:55優先遷移から実際に12エリアを入力し、正規のReview19 completionとIndexedDB authoritative recordを生成。
- 完了画面でclipboard write/read、JSON.parse、既存 `buildDirectReview19DataExportPayload()` とのpayload全体一致を確認。
- copy時のdownload、Blob URL、download anchor、localStorage、IndexedDB、outbox書込みは0件。成功表示は5秒後に消え、拒否/API欠如/再試行も完了状態を保った。
- 設定画面の全件・最新Review19 JSON downloadを実際に取得し、copy payloadと主要metadata・records・dataQualityを比較。
- 横overflowなし（390/390）、console error/warningなし、pageerrorなし、外部通信なし。

Windows clipboardでは改行がCRLFへ正規化されたが、parse後のJSON内容は一致した。実Supabase mutation、インストール済みPWA実機、実店舗端末の長時間バックグラウンド復帰は未確認。

## release

release ZIPは `outputs/nebiki-helper-20260907-0202.zip`。完成ZIP再open検査、SHA-256、root SQL同一性はZIP外の `RELEASE_REPORT_2026.8.9-21.md` と `ZIP_VALIDATION_2026.8.9-21.json` に記録する。
