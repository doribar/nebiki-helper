# 2026.8.9-31 変更報告

検証日: 2026-09-26 JST

## 変更内容

天候入力後に表示される既存 `AdvanceDiscountScreen` の同じカード内へ、独立した「冷惣菜」ガイドを追加した。対象は通常15時・17時のみ。元の「多い商品のうち10個以上ある商品を」「○％で引いてください」等の案内、率・強調表現、既存の「エリア別値引へ進む」操作を維持する。

### 15時

| 翌日 | global | 上段 | 下段 |
| --- | --- | --- | --- |
| 平日 | 0 / +5 | 2個以上 → 20% | 1個 → 10% |
| 土日祝 | 0 / +5 | 3個以上 → 20% | 2個 → 10% |
| 平日 | -5 | 3個以上 → 20% | 2個 → 10% |
| 土日祝 | -5 | 4個以上 → 20% | 3個 → 10% |

各段の下に「少ないエリア → 15%」「少ないエリア → 5%」を併記する。少ないエリアでは個数条件を変えず、表示ガイドの率だけ5ポイント低い。天候補正を15時の個数や率へ加えない。

### 17時

通常は「すべて → 30%」。翌日が土日祝、かつ天候補正-10、または天候補正-5かつglobal-5の場合だけ「すべて → 25%」。天候-10はglobal+5でも該当する。global-5単独、天候-5単独、翌日平日は30%のまま。

少ないエリア向けに率を下げない。別の小さな補足として「少ないエリア・判断に迷う場合は後回しにしてください。」を表示する。

## 実装と非変更領域

`coldDeliGuide.ts` は表示用pure helper。翌日の土日祝はsessionの実日付から既存holiday utilityで判定する。手動weekday、reference、お盆の需要区分は休日の判定に使わない。17時の天候補正は先行値引と同じ `sessionSourceResolvedWeather`（既存の気温補正snapshot反映済み）を受け、既存 `getWeekdayBaseInfo().baseRateBonus` を使用する。

`useNebikiApp` では既存の `derived.advanceDiscountInstruction` へ表示用値を付加する。既存screen/fixed-time gateとhelperの15/17 gateを使い、18:30以降、Review19、fixed-timeには表示しない。AppRouter・遷移・state/actionは非変更。

商品数をアプリに入力・保存する機能は追加していない。商品補正の自動適用、冷惣菜専用state/storage key/snapshot、架空のAreaCountは追加していない。冷惣菜ガイドには「当日切れ」も「10個以上+10%」も表示・実装していない。元の先行値引にある10個以上の案内はそのまま。

通常値引計算、weather/temperature/summer17、calendar/reference、global補正、AreaCount/quick、商品policy、Review19、人間評価、productionAnalysis、履歴/archive/export、Supabase/SQLは非変更。保存schemaは3、過去データの再計算やmigrationはない。AGENTS.mdも非変更。

## 変更ファイル

- `src/domain/coldDeliGuide.ts`: 表示条件だけを解決する新規helper。
- `src/hooks/useNebikiApp.ts`: importと既存derivedへの表示配線。
- `src/components/screens/AdvanceDiscountScreen.tsx`: optional表示propと冷惣菜section。
- `scripts/check-cold-deli-guide.ts`, `scripts/check-cold-deli-guide-ui.ts`: 専用テスト。
- `scripts/check-advance-discount-flow.ts`: current/checkpointの表示復元・永続化非追加を検証。
- `package.json`, `package-lock.json`: 9-31と専用check2本。依存関係は非変更。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

## 検証

- 全 `check:*` **64/64 PASS**。package.jsonの全check名と実行結果の集合一致を確認。
- 冷惣菜専用: domain **31/31 PASS**、UI **11/11 PASS**。15時4パターン、global+5/欠損、土日/祝日/振替/国民の休日/年跨ぎ、17時30/25条件と負例、既存天候補正・気温snapshotの利用、対象外時刻/fixed-time、非保存・非破壊を確認。
- 既存先行値引: 計算 **15/15**、UI **35/35**、flow **30/30 PASS**。flowへ冷惣菜derived表示とcurrent/checkpoint復元・永続化非追加の検証を追加。通常rate、Review19、productionAnalysis、商品policy、履歴、schema/export等の全既存checkもPASS。
- 9-30 ZIPとのbyte比較: 既存96 source中94本が同一。変更2本は画面とhookの表示配線だけ。新規helper1本。hookはimportと既存derivedへの表示データ追加のみ。通常値引計算・weather/calendar・storage・snapshot型/保存・Review19・productionAnalysisは非変更。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLint **0 errors / 4 existing warnings**。全体lintは9-30と同じ **9 errors / 7 warnings**。file/rule/severity/message比較で新規diagnostic **0**。message内の作業root絶対pathだけを統一し、本文・行番号・source抜粋は変更せず比較。
- Microsoft Edge production preview自動操作（headless、390×844）**16/16 PASS**。15時4条件をnormal/summerで確認し、17時30/25条件と負例、既存案内の維持、reload復元、既存ボタンからarea_judgeへの進行、session保持・冷惣菜専用保存なしを確認。代表スクリーンショットも目視確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。検証用Service Workerブロックに伴うPlaywright警告32件は別記録。
- SQL9本、AGENTS.md、vite.config.ts、dataVersion.tsは9-30 baselineとbyte-identical。Supabase/SQL/schemaの変更なし。
- GPT-6 Astra / Ultraのみ使用。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計によるソフトウェア自動検証で、実店舗データの操作ではない。18:30以降・Review19・fixed-timeの非表示は自動testで確認。

証跡: `work/coldDeli31/checks.json`, `baseline-comparison31.json`, `lint-comparison31.json`, `browser-work/browser-results31.json`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONに記録する。

## Release

- appVersion: `2026.8.9-31`
- buildId: `build-20260926-212826-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260926-2134.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260925-0128.zip`
- baseline SHA-256: `d003aff375d682ef1dd3388327e2072d96598f426e814b6979f524058f57f0d7`
