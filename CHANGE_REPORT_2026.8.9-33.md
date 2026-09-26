# 2026.8.9-33 変更報告

検証日: 2026-09-26 JST

## 変更内容

冷惣菜ガイドの最終表示率に限り、独自ルール・天候プラス分・globalプラス分を反映した後に50%上限を追加した。

`最終表示率 = min(50, B + max(W,0) + max(G,0))`

production変更は `coldDeliGuide.ts` の5行だけ。15時の上段20/少ない15/下段10/少ない5の各加算結果と、17時の25または30への加算結果を、それぞれ `Math.min(50, ...)` で制限する。通常エリアを上限処理してから少ないエリアを作らず、少ないエリアも自身の基準率から独立に計算する。両方50%になってよい。丸め、別の補正、設定や警告UIは追加しない。

Wは既存の `sessionSourceResolvedWeather → getWeekdayBaseInfo().baseRateBonus` による解決済み天候合計。Gは既存正規化済みglobal。元W/Gによる17時25%条件を維持し、プラス分は別々に取り出す。globalは一度だけ加算し、マイナス分を率から直接引かない。

## 主要条件の結果

| 時刻・条件 | 結果 |
| --- | --- |
| 17時 W+20 / G+5 | 30+20+5=55 → **50%** |
| 17時 W+20 / G0 | **50%** |
| 17時 W+20 / G-5 | **50%** |
| 17時 W+10 / G+5 | **45%**（不変） |
| 17時 W+10 / G-5 | **40%**（不変） |
| 17時・翌日土日祝 W-10 / G+5 | 25+5=**30%**（不変） |
| 17時・翌日土日祝 W-5 / G-5 | **25%**（不変） |
| 15時 W+10 / G+5 | **35 / 30 / 25 / 20%**（不変） |
| 15時 W+10 / G-5 | **30 / 25 / 20 / 15%**、個数境界+1も維持 |

15時の表の順は上段/上段少ないエリア/下段/下段少ないエリア。個数、翌日の実日付土日祝判定、global-5の個数境界+1、17時25%条件 `翌日土日祝 AND (W=-10 OR (W=-5 AND G=-5))` は9-32と同一。

## 非変更領域

AdvanceDiscountScreen・hookを含め、helper以外の全96 sourceは9-32とbyte-identical。UIはhelperが返す最終値をそのまま表示し、画面の文字列置換やUI側の上限計算は行わない。レイアウト・文言・既存ボタン・画面遷移・17時の後回し補足を維持する。

既存先行値引案内/計算、温惣菜等の通常rate上限、20:30最終値引、weather/global、calendar/reference、AreaCount/商品policy、Review19/productionAnalysis、履歴/export/Supabase/SQLは非変更。冷惣菜専用state/保存/snapshot、当日切れや冷惣菜10個以上+10%の追加はない。保存schema3と過去データ互換を維持する。

## 変更ファイル

- `src/domain/coldDeliGuide.ts`: 5つの加算済み率へ50%上限。
- `scripts/check-cold-deli-guide.ts`: 55→50、独立上限の境界と既存保証。
- `scripts/check-cold-deli-guide-ui.ts`: helper出力50%の表示と既存UI保証。
- `scripts/check-advance-discount-flow.ts`: 最終上限の期待値と復元/再確定の回帰検証。
- `package.json`, `package-lock.json`: versionだけ9-33へ。依存関係とcheck一覧は同一。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。
- AGENTS.md、SQL9本、過去の変更報告は非変更。

## 検証

- 全 `check:*` **64/64 PASS**。package.jsonの全check名と実行結果の集合一致。
- 冷惣菜domain **70/70**、UI **35/35 PASS**。17時55→50、50/45/40/30/25維持、15時4率の独立上限、50未満/ちょうど50/50超、丸めなし、個数条件、対象外画面・非保存を確認。15時の全率上限境界は、通常の天候計算を変更せず、合成resolved-weatherの大きな補正値を使う境界testとして区別する。
- 9-32の実helperとの独立比較 **185,284条件 PASS**。有効な既存天候入力で、新値は各率ごとに `min(50, 9-32値)` と一致し、個数/表示対象/その他出力は同一。既存先行値引率も新旧一致。
- 先行値引の計算 **15/15**、UI **35/35**、flow **48/48 PASS**。初回天候確定・戻り/再確定・current/checkpoint/reload復元、元の案内、session保持・保存非追加を確認。Review19/productionAnalysis/storage/export/fixed-time等の既存checkもPASS。
- 9-32 ZIPとのbyte比較: 全97 source中96本同一。変更はcoldDeliGuide.tsの5箇所に `Math.min(50, ...)` を加えただけ。逆変換すると旧helperと完全一致。UI/hook・通常rate・weather/global・calendar・型/保存・Review19はbyte-identical。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLint **0 errors / 0 warnings**。全体lintは9-32と同じ **9 errors / 7 warnings**。file/rule/severity/message比較で新規diagnostic **0**（message内の作業root絶対pathだけ統一）。
- Microsoft Edge production preview自動操作（headless、390×844）**12/12 PASS**。実coreで解決したW=+20/G=+5の「すべて → 50%」、戻る/再確定/reload後の50%、50%未満のケース、既存先行値引率の不変を確認。代表スクリーンショットも目視確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。検証用Service WorkerブロックのPlaywright警告24件は別計上。
- SQL9本、AGENTS.md、過去のCHANGE_REPORT全件、version/build生成方法・dataSchemaVersionは9-32 baselineとbyte-identical。依存関係・check一覧は非変更。
- GPT-6 Astra / Ultraのみ使用。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計によるソフトウェア自動検証。対象外時刻・Review19・fixed-timeは自動testで確認し、本ブラウザ検証の対象外。

証跡: `work/coldDeli33/checks.json`, `baseline-comparison33.json`, `comparison-work/baseline-rate-comparison33.json`, `lint-comparison33.json`, `browser-work/browser-results33.json`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONに記録。

## Release

- appVersion: `2026.8.9-33`
- buildId: `build-20260926-223018-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260926-2236.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260926-2209.zip`
- baseline SHA-256: `88e1ebd57e8acfcc3bbf862c8ad27622c389b025b935362a04c09370b81f3f46`
