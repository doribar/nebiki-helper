# 変更報告 2026.8.9-62

完成61 ZIP（SHA-256 `dbae2498d81b3380ba015012e3cbf665a5ba083af03ec0699d0fb2943a1e2d88`）を比較基準に作成。appVersion `2026.8.9-62` / buildId `build-20261107-200442-jst` / dataSchemaVersion `3`。

## 比較ルールと保存分類

通常日は同じarea・時刻・実曜日の有効履歴3件以上を従来どおり優先し、不足時だけ次のgroupを使う。groupも3件未満なら既存の履歴不足/手動判定。

| 時刻 | 金・土・日等の多め側 | 中間 | 少なめ側 |
| --- | --- | --- | --- |
| 15時 | 金土日（金・土・日） | 月火（月・火） | 水木（水・木） |
| 17時 | 金土（金・土） | 日月火（日・月・火） | 水木（水・木） |

同曜日3件がある木曜の中央値をgroup変更だけで下げない。木曜だけの加点、中央値の大小の強制、率の平均は追加しない。

`getAreaCountComparisonFallbackWeekdayGroup`で現在の比較分類を分離した。旧保存labelの単純一致で抽出せず、recordの実曜日（欠損時は有効なISO日付から既存の曜日取得）・対象時刻・calendar/versionで判定する。実曜日も日付も確認できないrecordを新groupへ推測投入しない。旧月水/火木/火木日等の保存値、個数、確定評価/率/根拠は保持する。

`getActualWeekdayGroup` / `getAreaCountFallbackWeekdayGroup`は保存用の旧分類を維持。Supabaseの`actual_weekday_group`列には既存の旧label CHECKがあるため、新labelをこの列へ送らない。実際に採用した新groupは`decisionBasis.actualWeekdayGroup`とcalendar referenceへ保持し、既存の`record_details` JSONで同期できる。SQL/DB/schemaを変えず、専用列の互換分類と実際の比較元を区別する。

保存済みgroupをnormalizerで現行groupへ上書きしない。これに伴って同順位の重複観測の選別が変わらないよう、fingerprintの比較だけは61の旧分類を再現し、返すrecordの保存labelは維持する。245の競合fixtureで選別個数の一致を確認した。

## 祝日・連休・中央値・減少率

対象祝日は通常日曜3件優先を維持し、不足時だけ15金土日/17日月火。三連休中日17時も通常日曜優先、不足時だけ日月火と金土の基準中央値50:50、有効な片側のみ/両側不足を維持する。中日が土曜の場合も日曜履歴を使う。三連休15時、祝前日、4日以上連休内部17時の金土、お盆の優先順位は維持。

Review19の19時参考統計と旧18/19/20時の履歴比較は旧groupのまま。通年normal/summer、過去日・同area/time選別、canonical/同日1観測、short16/long52、単独曜日の中央値下げすぎguard、groupは短期中央値、判定閾値は維持する。減少率は採用した`matchedRecords`を共有する既存経路を使い、式・対象area・±20pt・追加製造取消は非変更。

新17三連休根拠にはoptional `sundayFallbackWeekdayGroup`、`sundayMondayTuesdaySampleSize`、`sundayMondayTuesdayMedianCount`を使用。旧`fireThursdaySunday*`へ日月火の値を入れず、旧field/欠損は旧意味のまま。法定祝日とは別のお盆最終日17時ではoptional `comparisonWeekdayGroup`で採用groupを捕捉し、旧根拠にfieldがなければ従来の火木日を保持する。

根拠はrecommendation→AreaProgress/AreaCount decisionBasis→daily snapshot→daySnapshot/finalized→export/remote JSONの既存経路へ伝播する。新storage key/migrationなし、schema3。新判定・明示再判定に適用し、保存済み確定値を現在の履歴から再計算/書換えしない。

## 61版との具体的な計算比較

天候0、global0、遅延なしの通常17時。率は「どちらでもない商品 / 多い商品」の順。

| 条件 | 61 | 62 |
| --- | --- | --- |
| 木曜・現在10個、木曜12/14/16個の3件あり | 同木曜、中央値14、少ない、area−10pt、0% / 10% | 同じ履歴・中央値・判定・補正・率 |
| 月曜・現在10個、月曜不足、火曜6個×3・水曜30個×3 | 月水の水曜3件、中央値30、少ない、area−10pt、0% / 10% | 日月火の火曜3件、中央値6、多い、area＋10pt、20% / 30% |

これらは完成61の実コードで実行した出力をfixtureに固定し、62の実recommendationとrate coreへ照合した。木曜を含む15/17×7曜日の同曜日優先14条件は、採用履歴/件数/中央値/guard/閾値/評価/減少補正/表示率が61と一致する。例の率変化は選んだ母集団と最終評価の違いであり、基本率や計算式の変更ではない。

## 変更ファイルと非変更範囲

- production: `src/domain/areaCountHistory.ts`、`src/domain/types.ts`、`src/domain/analysisMetadata.ts`のみ。src108中、他105本は完成61ZIPとbyte-identical。61の2行基準案内/採用5段階表示を維持。
- 新規test: `scripts/check-weekday-fallback62.ts`、`scripts/weekday-fallback61-fixtures.json`（匿名の人工データと完成61の実出力）。
- 既存check更新11本: weekday-groups、three-day-holiday-middle、three-day-holiday-sunday-reference、holiday-before-normal-weekday、full-mode、demand-cycle、obon-calendar、fixed-time-supabase-read、long-holiday-reference、area-count-year-round、holiday-sunday-reference52。新groupに属するfixtureへ変更し、旧保存labelの保全と比較時の除外を検証する。旧夜枠48条件のgoldenは完成61の実出力、15時16条件は新groupの明示期待値に分け、従来の率720条件も保持。
- package/lock: versionと専用check1本だけ。依存/build方法は非変更。dist/index/JS/sw再生成、CHATGPT_HANDOFFと本報告更新。過去CHANGE70本を変更しない。
- 基本率、快適/降水/気温差緩和、global計算順、手動/長押し/quick、遅延+5/時刻境界/進行/優先復帰、注意8項目、productionAnalysisの式、Review19生評価、保存責務は非変更。SQL9本・Supabase構造・AGENTS.mdは変更なし。

## 検証結果

- 全check **101/101 PASS**、専用 **69/69 PASS**。関連: weekday29、three-day33、Sunday reference28、holiday37、demand35、Obon16、fixed-time7、long-holiday18、year-round44、holiday-Sunday52の63件を含む。
- TypeScript / production build / PWA generateSW **PASS**、111modules、precache10。既存chunk500kB超・Browserslist更新案内は維持。
- focused ESLint **0 errors / 0 warnings**。全体 **7 existing errors / 5 existing warnings**、61とfile/rule/severity/message比較で新規0、増減なし。
- 独立互換比較 **320/320 PASS**（重複同順位245・旧夜枠/captured calendar63・Review19 direct/prepared統計12）。新3groupのremote column/JSON往復 **3/3 PASS**。
- 実Edge157.0.4341.42、production、360/390×844、人工データ/localhostの **32/32 PASS**。通常各group、同曜日優先、不足時手動、祝日日曜/代替、三連休合成、旧火木日保存根拠、61案内の両段階、率/snapshot/再読込保持を確認。各contextで完成bundle hashを検証した。文言/太字/折返しは可読、文字欠け/横overflow/アプリconsole error・warning/外部通信なし。ハーネスのSW遮断通知64件は別計上。

## 未確認事項・成果物

実店舗物理端末、インストール済みPWAのSW更新・長時間バックグラウンド運用、実Supabase通信は未確認。SSR/自動チェックと、隔離した実Edgeエンジンでの人工データ検証を区別する。保留中の曜日文言と夏17時中間評価案内の既存不一致は変更せず引継ぎに残す。

`nebiki-helper-2026.8.9-62.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-62.md`、`ZIP_VALIDATION_2026.8.9-62.json`を作成する。完成ZIPそのものを再openし、CRC・重複/casefold・path/除外物/秘密情報・single root・file集合/bytes・version/JST build/schema・dist/PWA・SQL/AGENTS同一性・SHA-256を検査する。
