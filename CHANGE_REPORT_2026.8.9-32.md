# 2026.8.9-32 変更報告

検証日: 2026-09-26 JST

## 変更内容

冷惣菜独自ルールで決める個数と加算前率を維持し、天候・global補正のプラス分だけを表示率へ加える。

`W = 既存の解決済み天候合計、G = 正規化済みsession global補正`

`追加分 = max(W, 0) + max(G, 0)`

`最終表示率 = 冷惣菜基準率 + 追加分`

W/Gを合算してから正値判定しない。マイナス分は率から直接引かない。global+5は最後に一度だけ加算。global-5は15時の個数境界と17時の25%条件にだけ使う。%の加算はpercentage points。

### 15時

個数は9-31のまま。上段は2個以上を起点に、翌日が土日祝なら+1、G=-5ならさらに+1。下段は上段より1個少ない「N個」。天候やG=+5は個数範囲を変えない。

| W | G | 上段 / 少ないエリア / 下段 / 少ないエリア |
| --- | --- | --- |
| 0 | 0 | 20 / 15 / 10 / 5% |
| +5 | 0 | 25 / 20 / 15 / 10% |
| 0 | +5 | 25 / 20 / 15 / 10% |
| +5 | +5 | 30 / 25 / 20 / 15% |
| +10 | +5 | 35 / 30 / 25 / 20% |
| +10 | -5 | 30 / 25 / 20 / 15% |
| -10 | +5 | 25 / 20 / 15 / 10% |
| -10 | -5 | 20 / 15 / 10 / 5% |

### 17時

加算前は30%。元のW/Gで `翌日土日祝 AND (W=-10 OR (W=-5 AND G=-5))` の場合だけ25%へ変更してから加算する。

| 翌日 | W | G | 最終表示率 |
| --- | --- | --- | --- |
| どちらでも | 0 | 0 | 30% |
| どちらでも | +5 | 0 | 35% |
| どちらでも | 0 | +5 | 35% |
| どちらでも | +10 | +5 | 45% |
| どちらでも | +10 | -5 | 40% |
| 土日祝 | -10 | 0 / -5 | 25% |
| 土日祝 | -10 | +5 | 25+5=30% |
| 土日祝 | -5 | -5 | 25% |
| 土日祝 | -5 | 0 | 30% |
| 土日祝 | -5 | +5 | 35% |
| 平日 | -10 | -5 | 30% |
| 平日 | -10 | +5 | 35% |

17時は少ないエリアで率を下げず、既存の後回し補足を維持する。

境界: **継続雪などで既存W=+20、G=+5なら17時は55%**。指定されていない上限・丸めは導入しない。通常値引率の0〜50%上限や20:30の50%ルールには変更しない。

## 計算経路・表示・保存

15/17とも `useNebikiApp` の既存 `sessionSourceResolvedWeather` を使い、`getWeekdayBaseInfo(session.weekday, session.discountTime, resolvedWeather, session.date, session.demandCycle).baseRateBonus` からWを取得。通常/夏季、既存気温snapshot、雨雪・風・快適度の解決済み合計であり、個々のプラス要素を再加算しない。例: 15時の雨+5/快適-5が合計0なら、Wの追加分は0。

Gは `normalizeGlobalDiscountAdjustmentPercent()` で欠損/不正値を既存どおり0とする。天候Wへ基本率・エリア残数・商品補正・Gを混ぜない。

冷惣菜表示用型は15時の4率をnumber fieldで持ち、17時のratePercentもnumberへ広げる。画面の4固定値をこのpropへ置換しただけで、レイアウト・数値以外の文言・既存ボタンは同一。hookのderived配線は非変更。

冷惣菜専用入力・state・保存・snapshotは追加しない。既存sessionから再計算する表示derivedのみ。通常値引計算、先行値引「多い商品のうち10個以上」の案内/率、天候計算、global機能、曜日/祝日/reference、AreaCount、商品policy、Review19/productionAnalysis、履歴/export/Supabase/SQLを変更しない。「当日切れ」「10個以上なら+10%」を冷惣菜ガイドへ追加しない。schemaは3、過去データのmigrationなし。

## 変更ファイル

- `src/domain/coldDeliGuide.ts`: 既存天候取得を15/17へ共用、正値の分離加算、表示用rate型。
- `src/components/screens/AdvanceDiscountScreen.tsx`: 15時4率の固定値をprop表示へ。
- `scripts/check-cold-deli-guide.ts`, `scripts/check-cold-deli-guide-ui.ts`: 新期待値と非相殺・型/UI・境界のテスト更新。
- `scripts/check-advance-discount-flow.ts`: 初回/条件編集/復元での加算済み率のテスト更新・追加。
- `package.json`, `package-lock.json`: versionだけ更新。check一覧・依存関係は同一。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。
- `AGENTS.md` とroot SQL9本は9-31とbyte-identical。

## 検証

- 全 `check:*` **64/64 PASS**。package.jsonの全check名と実行結果の集合一致。
- 冷惣菜domain **57/57**、UI **31/31 PASS**。15時4率/個数、17時25%先判定、W/G非相殺、二重加算なし、欠損global=0、通常/夏、既存気温snapshot、解決済み天候合計、非保存、55%境界と丸めなしを確認。
- 既存先行値引は計算 **15/15**、UI **35/35**、flow **42/42 PASS**。flowには15/17×通常/夏×global3条件の12ケースを追加し、初回確認・条件編集からの復帰・実hook/current/checkpoint復元での率一致と保存非追加を確認。Review19/productionAnalysis/storage/SQL/export/fixed-time等を含む全既存checkもPASS。
- 9-31 ZIPとのbyte比較: 全97 source中95本同一。変更はcoldDeliGuide.tsとAdvanceDiscountScreen.tsxのみ。画面差分は4つの固定率を表示propへ置換した箇所だけ。hook配線、既存weather/discount/advance、calendar、型/保存/Review19はbyte-identical。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLint **0 errors / 0 warnings**。全体lintは9-31と同じ **9 errors / 7 warnings**。file/rule/severity/message比較で新規diagnostic **0**。message内の作業root絶対pathだけを統一して比較。
- Microsoft Edge production preview自動操作（headless、390×844）**41/41 PASS**。実coreで解決したnormal/summerの天候を用い、15/17プラス補正、非相殺、25%+global5=30%、個数維持、元先行率の9-31一致、reload・エリアへの進行を確認。7ケースは初回天候確定・戻る/再確定も実画面操作。代表スクリーンショット目視確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。隔離用Service WorkerブロックによるPlaywright警告82件は別記録。
- SQL9本・AGENTS.md・version/build生成方法・dataVersion.tsは9-31 baselineとbyte-identical。依存関係、schema 3、Supabase/SQLは非変更。
- GPT-6 Astra / Ultraのみ使用。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計によるソフトウェア自動検証で、実店舗データの操作ではない。18:30以降・Review19・fixed-timeの非表示は自動testで確認。

証跡: `work/coldDeli32/checks.json`, `baseline-comparison32.json`, `lint-comparison32.json`, `browser-work/browser-results32.json`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONに記録する。

## Release

- appVersion: `2026.8.9-32`
- buildId: `build-20260926-220342-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260926-2209.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260926-2134.zip`
- baseline SHA-256: `01bb9b5bf1fca402f29b0e92e368278fd8cc50bb4f97c1aece5ed6fdaabdffed`
