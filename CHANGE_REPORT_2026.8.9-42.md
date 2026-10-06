# 2026.8.9-42 変更報告

検証日: 2026-10-06 JST

baseline: `nebiki-helper-2026.8.9-41.zip` / SHA-256 `394b59e79376cd30254ec1477212161ba4d0577e21b978639f921fd8d6c1a45e`。

## 実装

`src/domain/fullMode.ts` の `FULL_MODE_NOTICE_ITEMS` へ次の独立項目を追加した。

> 同一商品が、小パックを含めずに20個以上ある場合は、表示値引率に＋10％。

既存の「やや不人気」項目の後、「多い・少ないの判断」項目の前に置く。既存6項目の文言・segment・強調・相対順序は保持し、合計7項目とする。既存のsegment/emphasis方式を使い、「同一商品」「小パックを含めずに」「20個以上」「＋10％」を強調する。`RateDisplayScreen.NoticeItems` の既存strong/span・bullet divで描画し、componentやstyleは変更していない。

これは現場で実数を確認する注意書きだけである。20個ちょうどを含み、小パックを判定個数へ含めない。大小パック商品では大パック20個以上なら対象、大15+小10は対象外。＋10％はpercentage pointsなので表示20％→30％の意味。AreaCountの同一商品10個capとは別の条件。

商品個数入力UI・自動加算・商品別state/key・新metadataを追加していない。ProductAdjustmentPolicySnapshot、値引率計算、保存形式、Review19/productionAnalysis/JSON/export/Supabase/SQLは非変更。既存不人気/やや不人気等との重複時の加算方法・上限との適用方法を今回新しく決めていない。過去recordも書き換えない。

## 変更ファイル

- `src/domain/fullMode.ts`（notice1項目だけ）
- `scripts/check-full-mode.ts`
- `scripts/check-logic.ts`
- `scripts/check-feature-20260728.ts`
- `scripts/check-slightly-unpopular-policy.ts`
- `package.json` / `package-lock.json`（versionだけ。check一覧・依存は不変）
- `CHATGPT_HANDOFF.md`
- 本 `CHANGE_REPORT_2026.8.9-42.md`
- `dist/*`

production source100本中99本は9-41 ZIPとbyte-identical。fullModeの差分もnotice arrayへの9行追加だけで、既存6項目とlegacy URL canonicalizationは変更なし。AGENTS.md・root SQL9本・全過去CHANGE_REPORT・buildId生成方式・schema3を維持。

## 検証

- 全check:* **78/78 PASS**。関連check: full-mode36/36、logic91/91、feature6/6、slightly-unpopular-policy10/10。
- 注意件数・全文・segment・強調・順序を固定。実RateDisplayScreen TSXのSSRでnormal/summer×15/17/18/19の7項目と20:30の従来非表示を確認。新しいinput/controlを追加していないこと、props非破壊も確認。
- 既存の商品policy/snapshot/legacy/JSON roundtrip、AreaCount同商品10個cap、先行率の非依存性はそのままPASS。自動加算のtestや新計算関数は作っていない。
- TypeScript / production build / PWA generateSW PASS（104 modules、precache10）。`build-20261006-095107-jst` / `/assets/index-BpRbZDJ7.js`。
- focused ESLint 0 errors / 0 warnings。full lintは既存 9 errors / 6 warnings。9-41とfile/rule/severity/message比較で新規diagnostic0。既存largechunk/Browserslist outdated build warningは残る。
- Edge最終production preview390×844でnormal17/summer15の実操作（天候→先行案内→エリア残数→値引率）と、7項目・正確な追加文・4箇所の強調・旧6項目保持を確認。20:30の従来非表示も確認。console error/warning・外部通信・横overflow0。詳細は `work/productCountNotice42/browser-work/final-browser-summary42.json`。
- 保存・計算・率上限・天候/global・曜日reference・Review19・履歴・JSON互換コードはbaselineと同一。新しい商品条件を計算入力やsnapshotへ混入させていない。

## Release

- appVersion: `2026.8.9-42`
- buildId: `build-20261006-095107-jst`（既存JST timestamp生成方式）
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-42.zip`
- AGENTS.md / SQL9本 / Supabase schema / RLS / GRANT / trigger変更なし。

ZIP再open検査・SHA-256はZIP外の `RELEASE_REPORT_2026.8.9-42.md` / `ZIP_VALIDATION_2026.8.9-42.json` / `nebiki-helper-2026.8.9-42.zip.sha256` に記録する。testzip、duplicate/case-insensitive duplicate、path/traversal/backslash/symlink、single root、除外物/credential、dist/PWA/version/build/schema、working tree対象file集合/bytes、SQL9本/AGENTS/過去report同一性を検査する。

未確認: 実店舗物理端末・installed PWA・実Supabase通信。今回の表示変更についてはEdgeで確認済み。他項目との重複加算や商品数自動計算を本変更で実装・検証したとはしていない。
