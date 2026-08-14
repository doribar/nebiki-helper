# お盆calendar condition対応 変更報告

作成日: 2026-08-13（JST）

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260812-0827.zip`
- 基準appVersion: `2026.8.9-5`
- appVersion: `2026.8.9-6`
- buildId: `build-20260813-231309-jst`
- dataSchemaVersion: `3`

## 変更概要

毎年8月13日〜16日をお盆として識別します。お盆は法定祝日と混同せず、分析用calendar metadataへ `isObon: true`、`calendarCondition: "obon"` を保存します。一方、現時点の需要判断ではholiday-equivalentとして、個別量判断とエリア残数自動判定に現行の祝日当日と同じreference選択ロジックを使用します。

## お盆期間とcalendar metadata

- お盆期間: 毎年8月13日、14日、15日、16日
- 8月12日と17日はお盆ではありません。
- `isObon` は `isHoliday` と独立したcalendar factです。実際の祝日と重なる場合は両方を保持します。
- 新規sessionは `calendarCondition: "obon"` を記録します。表示が必要な既存UIでは「お盆」と示します。
- `demandCycle` とは独立しており、通常の8月運用では `demandCycle: "summer"` と `calendarCondition: "obon"` が共存します。

## holiday-equivalent需要判断

- 個別量判断: 現行の祝日当日と同じ日曜referenceを使い、reasonはお盆由来と判別可能に保持します。
- UI: 既存の判断基準欄に「今日はお盆のため、祝日と同じ基準になっています。」を表示し、個別量のreferenceは既存の夏季接頭辞と組み合わせても「夏の日曜日の…」となります。
- エリア残数判定: お盆当日を現行の祝日当日と同じくfallback強制し、同じ曜日reference／履歴選択を使用します。お盆最終日の翌日が通常平日の場合も、祝日当日と同じ `翌日平日祝日` 専用母集団を使います。旧recordの再正規化では保存時appVersionをgateにし、導入前データは従来groupのままです。
- お盆期間の中日であることだけを理由に三連休中日へ分類しません。既存カレンダー条件上で本当に三連休中日の場合だけ、従来の特例と優先順位を維持します。
- 8月12日へ「お盆前日」や `day_before_holiday` の新ルールを追加しません。8月17日にも翌日特例を追加しません。

## 既存仕様への影響

- summer / normal分離: 変更なし。お盆は別軸のcalendar conditionです。
- weather／気温／快適度: 変更なし。お盆と降水等は独立して作用します。
- `productionAnalysis`: ロジック変更なし。お盆を理由に `productionShortageSuspicion` を強めたり弱めたりしません。
- 値引率、商品属性補正、20時30分、完了画面の現在時刻連動表示: 変更なし。
- Supabase cloud sync、pending／retry／CAS／backfill／fixed-time隔離: 変更なし。

## 過去recordと後方互換

- 新ルールは新版導入後に作成するsessionから適用します。
- 導入前に2026-08-13等を `ordinary`、実曜日referenceとして保存したrecordはimmutableです。日付だけを見て `obon`、日曜reference、祝日相当comparisonへ遡及変換しません。
- 旧sessionを新版で再開してrecord自体に新版appVersionが付く場合も、保存済みの有効な `calendarContext` をappVersionより優先します。この原則を通常履歴のnormalize、Review19履歴投影、端末backfill再構成のすべてに適用します。
- 旧recordで `isObon` が欠けても正常に読み込みます。normalize、日次統合、normal／summer別export、cloud mergeは保存済みcalendar condition／referenceを維持します。
- optional additive metadataとして既存JSONBへ保存できるため、物理migrationは行いません。

## Supabase / DB

- SQL変更: なし
- migration追加: なし
- table／column／unique key／index／trigger／RLS／policy変更: なし
- `dataSchemaVersion`: optionalな後方互換追加のため `3` を維持

## 変更ファイル

- `src/domain/obon.ts`、`src/domain/japaneseHoliday.ts`（固定日付判定と旧／新session gate）
- `src/domain/weekdayBase.ts`、`src/domain/areaCountHistory.ts`（holiday-equivalent referenceと既存基準欄の最小表示）
- `src/domain/areaCountBackfill.ts`、`src/domain/review19Evaluation.ts`（保存元appVersionに基づくObon groupの再構築）
- `src/domain/analysisMetadata.ts`、`src/domain/review19.ts`（optional calendar metadataと過去record保全）
- `src/hooks/useNebikiApp.ts`、`src/hooks/nebikiApp/sessionSnapshots.ts`（新規／復元済みsessionへ適用gateを引き渡す）
- `scripts/check-obon-calendar.ts`
- `scripts/check-refactor-characterization.ts`（意図したuseNebikiApp facade差分の固定値更新）
- `package.json`（専用check scriptのみ。version更新は通常リリース識別更新）
- `package-lock.json`（appVersionのみ）
- `README.md`
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_20260813_OBON_CALENDAR.md`
- `dist/**`（確定appVersion／buildIdによる本番build成果物）

## テスト

専用回帰で以下を検証します。

- 毎年8月13日〜16日だけがお盆で、2026年と2027年の両方に適用
- 新規sessionの `isObon: true`／`calendarCondition: "obon"`
- 個別量判断とエリア残数判定が祝日当日と同じreferenceロジック
- metadataのcondition／reasonではお盆を識別可能
- 8月14日・15日という日付だけで三連休中日にならない
- 8月12日をお盆前日／祝日前日にしない
- 導入前の2026-08-13 ordinary fixtureを遡及変換しない
- manual weekday override後もお盆のcalendar factを維持
- normal／summer別exportにお盆metadataを保持し、cycleを混在させない
- ordinary、holiday、day-before、三連休中日、weather、productionAnalysis、Review19、Supabase、20時30分等の既存回帰

最終確認結果:

- 全 `check:*`: `31 / 31` 成功
- `check:obon-calendar`: `16 / 16` 成功
- `check:analysis-metadata`: `19 / 19` 成功
- `check:analysis-metadata-ui`: 成功
- `check:weekday-groups`: `29 / 29` 成功
- `check:three-day-holiday-middle`: `33 / 33` 成功
- `check:holiday-before-normal-weekday`: `37 / 37` 成功
- `check:cycle-separated-export`: `7 / 7` 成功
- TypeScript (`tsc -b`): 成功
- 変更対象ESLint: 0 errors。`useNebikiApp.ts` に基準版から存在する `react-hooks/exhaustive-deps` warning 4件のみ
- production build: 成功
- PWA `generateSW`: 成功（precache 10 entries、`dist/sw.js` とWorkbox生成を確認）
- 390×844確認: 固定時刻2026-08-13の開始画面を表示し、document-level横スクロールなし、console warning/errorなしを確認。お盆基準文言の到達状態は専用UI/domainテストで確認し、実ブラウザでは全入力フローの完走までは行っていません。

## 未解決事項

- なし

## リリース成果物

- ZIP: `nebiki-helper-20260813-2321.zip`
- SHA-256はZIP生成後の外部検証結果を最終回答で提示します。

