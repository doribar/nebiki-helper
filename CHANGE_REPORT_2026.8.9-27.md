# 2026.8.9-27 変更報告

検証日: 2026-09-18〜19 JST

## 変更内容

DoneScreenの「全エリアの値引率」にあった `referenceText && timeText` 条件の `BasisTimeMiniPanel` を削除した。上部 `referenceConditionLabel`（例: 夏・木曜日・17時）と全エリアの値引率一覧は維持。

このpanelにしか使われていなかったDoneScreen内の2helper、local component、referenceText/timeText propsを整理し、AppRouterのDoneScreen呼出しから同じ2属性だけを削除した。他画面のBasisTimeMiniPanel、AreaJudgeScreen、reference formatterと解決処理は変更していない。

値引率計算、Review19、履歴、保存データ、JSON出力、メモ・export・戻る・home・18:30手動開始の処理は非変更。

## 変更ファイル

- `src/components/screens/DoneScreen.tsx`: 重複panelとその専用helper/propsを削除。
- `src/app/AppRouter.tsx`: DoneScreenに渡していた不要2propsだけを削除。
- `scripts/check-advance-discount-ui.ts`: 既存1testの期待を「上部ラベル1つ・下部曜日時刻なし・率一覧維持」に更新。
- `package.json`, `package-lock.json`: versionのみ9-27へ更新。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

srcの差分は上記2本だけ。他の全src、root SQL9本、AGENTS.mdは9-26 ZIPとbyte-identical。schema、Supabase、SQL、依存関係、check一覧、version/buildId生成方法は変更なし。Git repositoryなし、baseline ZIPを比較基準とする。

## 検証

- 全 `check:*` **59/59 PASS**。packageのcheck名との集合一致を確認。更新した既存UI checkは35/35 PASS、通常Done summary、rate snapshot、Review19、storage、export、weather、夏17時、fixed-time等もPASS。
- TypeScript / production build / PWA generateSW PASS（101 modules、precache10）。chunk sizeとBrowserslist dataの既存build警告あり。
- changed-file focused ESLint **0 errors / 0 warnings**。full lint **9 errors / 7 warnings**は9-26既存分と一致し、file/rule/severity/message比較で新規diagnostic 0。
- Edge production preview 390×844で夏15/17・normal15/17・手動曜日override・ObonのDone表示を確認。上部referenceConditionLabelは1つ、下側の今日の曜日／値引時刻panelはなし、全12エリアの一覧を維持。数値率を持つ完了fixtureでも一覧表示を確認した。
- AreaJudgeScreenの既存の基準曜日・時刻panelを実ブラウザで確認。横overflow、console error/warning、page error、外部通信、予期しないdialog/download/popupは0。
- src96本中の変更はDoneScreenとAppRouterの2本だけ。他94本は9-26 ZIPとbyte-identical。表示panelと専用の未使用依存の削除以外の本体差分がないことを検査した。AGENTS.md、root SQL9本、build/schema生成処理もbyte-identical。
- GPT-6 Astra / Ultraのみを使用。制限時は停止し、再開時に実行記録で同設定を確認した。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信。今回のブラウザ確認は隔離fixtureで行い、値引計算・Review19・保存・export全運用の実ブラウザ再実行はしていない（コード非変更＋全checkで回帰確認）。

証跡: `work/doneLabel27/checks.json`、`lint-comparison27.json`、`source-proof27.json`、`browser-work/browser-results27.json`。ZIP再open検査・SHAは `outputs/ZIP_VALIDATION_2026.8.9-27.json` / `RELEASE_REPORT_2026.8.9-27.md`。


## Release

- appVersion: `2026.8.9-27`
- buildId: `build-20260918-120201-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260919-1807.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260915-0201.zip`
- baseline SHA-256: `2f8ca857a5f604f110ed245749c97a4b5a3cccc0cb9a3b2f3660c51d3cd1d519`
- 完成ZIPのSHA-256と再open結果はZIP外の `outputs/RELEASE_REPORT_2026.8.9-27.md`、`ZIP_VALIDATION_2026.8.9-27.json`、ZIP隣接`.sha256`へ記録する。
