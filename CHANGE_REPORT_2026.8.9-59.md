# 変更報告 2026.8.9-59

完成58 ZIPを比較基準に、値引指示画面「注意事項」の案内文だけを更新した。appVersion `2026.8.9-59`、buildId `build-20261104-125115-jst`、dataSchemaVersion `3`。

## 表示変更

6. **同一商品**が、**小パックを含めずに20個以上**ある場合は、表示値引率に**＋10％**。**小パックにはこの補正を適用しない**。
7. 補正が重なる場合は、**−10％を最初に1回だけ**適用し、その後、**該当する項目ごとに＋10％**。最終的な値引率は**元の表示値引率＋10ポイントまで**とする。

画面は既存の太字表示を使う。文言中にアスタリスクは入らない。既存6項目の本文・強調・相対順は維持し、全8項目。「やや不人気」の10個以上・大小パックの条件も変更なし。

これは商品ごとの手作業の案内。表示25％で広告・やや不人気・20個以上の対象商品なら25％→15％→25％→35％、−10％なしで＋10％が2項目でも上限35％。案内の例であり、自動計算は追加していない。

## 変更ファイル

- `src/domain/fullMode.ts`：注意事項の配列のみ。画面コンポーネント、値引計算・表示値引率、保存仕様、SQL・Supabase・AGENTS.mdは変更なし。
- `scripts/check-full-mode.ts`、`check-feature-20260728.ts`、`check-logic.ts`、`check-slightly-unpopular-policy.ts`、`check-judge-hint-guidance.ts`、`check-automatic-time-operation.ts`、`check-automatic-weekday-operation.ts`：既存チェックの期待値を更新。
- `package.json`、`package-lock.json`：版のみ。依存、build設定、checkコマンドは不変。
- `dist/index.html`、`dist/assets/index-*.js`、`dist/sw.js`：本番成果物を再生成。
- `CHATGPT_HANDOFF.md`、本変更報告。過去の変更報告は保持。

## 検証

- 全check **98/98 PASS**。既存6項目の本文・太字・順序と、新2項目の完全一致、実描画の太字・アスタリスクなしを確認。
- TypeScript / production build / PWA generateSW **PASS**（111 modules、precache 10件）。
- Edge 360px・390px **8/8 PASS**。58/59の本番buildを人工データで比較。指定の太字・順序・8項目・表示率同一、文字欠け・横overflow・アプリconsole error/warning・外部通信なし。
- lint：58版と比較して新規0。全体の既存9 errors／5 warningsは維持。変更ファイルは0 errors／0 warnings。
- 本番ソース108本中、変更は1本のみ。残り107本、SQL9本、AGENTS.md、過去CHANGE67本は完成58 ZIPとbyte-identical。

ブラウザは人工fixtureによる確認。物理店舗端末、インストール済みPWAの長時間運用、実Supabase通信は未確認。

## 成果物

`nebiki-helper-2026.8.9-59.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-59.md`、`ZIP_VALIDATION_2026.8.9-59.json`。ZIPを再openしてCRC、ファイル集合・全bytes、パス・除外物、版情報、dist/PWA、SHA-256を照合する。
