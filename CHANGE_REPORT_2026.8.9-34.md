# 2026.8.9-34 変更報告

検証日: 2026-09-27 JST

## 変更内容

先行値引画面の表示を2点だけ修正した。

1. 「多い商品のうち10個以上ある商品を」の「10個以上」を既存manyColor（#ff0000）と太字spanで強調。「多い」と率の既存赤字は維持し、「ある商品を」は通常色のまま。
2. 冷惣菜15時の下段個数を、上段highCountを元に1からhighCount-1まで列挙する。境界2では「1個」、3では「1個・2個」、4では「1個・2個・3個」。上段の「○個以上」と少ないエリアの表示は維持。プラス補正がある場合も同じ個数表記と既存の最終率を表示する。

既存helperは表示文字列を持たず数値を返す構造のため、表示文字列だけをAdvanceDiscountScreen内で生成する。coldDeliGuide.tsと型を変更せず、lowCountの値も維持する。入力UI・state・保存fieldは追加していない。

## 変更ファイル

- `src/components/screens/AdvanceDiscountScreen.tsx`: 赤字spanと下段個数表記。
- `scripts/check-advance-discount-ui.ts`, `scripts/check-cold-deli-guide-ui.ts`: 表示の期待値と強調範囲を更新。
- `package.json`, `package-lock.json`: versionのみ9-34へ。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

## 非変更領域

production97ソース中96本は9-33とbyte-identical。冷惣菜15時の個数境界、翌日土日祝判定、global-5の境界+1、17時25/30%判定、天候とglobalのプラス分と50%上限、通常/先行値引計算は変更していない。17時の補足・レイアウト・ボタン・画面遷移も維持する。

Review19、productionAnalysis、履歴・JSON・IDB/localStorage・Supabase・SQL・schema3・AGENTS.mdは非変更。過去CHANGE_REPORTは当時の記録として維持。

## 検証

- 全 `check:*` **64/64 PASS**。package.jsonの全check名と実行結果の集合一致。
- 先行値引UI **35/35**、冷惣菜UI **35/35 PASS**。赤字spanが「10個以上」で終わり「ある商品を」は通常色であること、上段境界2/3/4に対する列挙、上段・少ないエリア・17時・既存ボタンの維持を確認。
- 冷惣菜domain **70/70**、先行値引計算 **15/15**、flow **48/48 PASS**。天候/globalプラス分、50%上限、個数境界、reload/再確定、Review19/productionAnalysis/storage/export/fixed-time等も既存checkでPASS。
- 9-33 ZIPとのbyte比較: 全97 source中96本同一。production差分はAdvanceDiscountScreenの赤字spanと下段個数表記のみ。coldDeliGuideを含むdomain全件、hook・router・型・保存・Review19はbyte-identical。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLint **0 errors / 0 warnings**。全体lintは9-33と同じ **9 errors / 7 warnings**。file/rule/severity/message比較で新規diagnostic **0**（message内の作業root絶対pathだけ統一）。
- Microsoft Edge production preview自動操作（headless、390×844）**8/8 PASS**。上段境界2/3/4、赤字の範囲と後続文字の通常色、元の案内と率、17時の50%上限、reloadとエリアフローへの遷移を確認。代表スクリーンショットも目視確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。検証用Service WorkerブロックのPlaywright警告16件は別計上。
- SQL9本、AGENTS.md、過去CHANGE_REPORT全件、version/build生成方法・dataSchemaVersionは9-33とbyte-identical。依存関係・check一覧は非変更。
- GPT-6 Astra / Ultraのみ使用。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計によるソフトウェア自動検証。対象外時刻・Review19・fixed-timeは自動testで確認し、本ブラウザ検証の対象外。

証跡: `work/advanceText34/checks.json`, `baseline-comparison34.json`, `lint-comparison34.json`, `browser-work/browser-results34.json`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONに記録。

## Release

- appVersion: `2026.8.9-34`
- buildId: `build-20260927-111101-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260927-1115.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260926-2236.zip`
- baseline SHA-256: `4dcc9baf35c51c63ad6e80d6532cd0c8d6ec85bc0adaed3b2bc31c75e2b25865`
