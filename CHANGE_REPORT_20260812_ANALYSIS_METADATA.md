# UI基準表示・祝日reference・分析メタデータ・cycle別全件出力

## リリース情報

- 基準ZIP: `nebiki-helper-20260811-1306.zip`
- appVersion: `2026.8.9-4`
- buildId: `build-20260812-004623-jst`
- dataSchemaVersion: `3`

## 1. 実装概要

今回の変更は、現場UIで採用中の基準を分かりやすくすることと、Work / Data Analyticsが表示文言を解析せず当日の条件を判断できるanalysis metadataを追加することです。

- 天候確認表の天気記号行だけを「天候」から「天気」へ変更
- summer時の個別量判断と手動エリア判定に、夏の基準であることを明示
- エリア残数判定側だけ「迷ったら…」を削除し、個別量判断側は維持
- 個別量判断の祝日前日を金土基準、祝日当日を日曜基準として明示
- 実曜日と採用referenceを分離する `calendarContext` を追加
- 15時・17時・19時のhuman raw評価から `productionAnalysis` を追加
- 入力済み時間別予報の分析用summary `analysisWeatherContext` を追加
- 19:00／日次の「全件出力」をnormal／summer別ファイルへ分離

これらは表示と後方互換なoptional metadata／export filterの追加です。値引率、中央値、天候・気温補正、夏季履歴、20時30分、クラウド同期基盤を変更しません。

## 2. 変更ファイル

### UI／曜日基準

- `src/components/screens/WeatherConfirmationPanel.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/common/DayBeforeHolidayNotice.ts`
- `src/app/AppRouter.tsx`
- `src/domain/dayBeforeHolidayNotice.ts`
- `src/domain/weekdayBase.ts`

### 分析メタデータ／保存・export

- `src/domain/analysisMetadata.ts`（新規）
- `src/domain/types.ts`
- `src/domain/areaCountHistory.ts`
- `src/domain/areaCountRemoteStorage.ts`
- `src/domain/review19.ts`
- `src/domain/finalizedDayData.ts`
- `src/domain/storage.ts`
- `src/domain/separateDataExport.ts`
- `src/domain/jsonDownload.ts`（新規）
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/hooks/useNebikiApp.ts`

### テスト／設定／文書／生成物

- `scripts/check-analysis-metadata.ts`（新規）
- `scripts/check-analysis-metadata-ui.ts`（新規）
- `scripts/check-cycle-separated-export.ts`（新規）
- `scripts/check-weather-confirmation.ts`
- `scripts/check-weekday-groups.ts`
- `scripts/check-refactor-characterization.ts`
- `package.json`
- `package-lock.json`（project versionのみ）
- `README.md`
- `CHATGPT_HANDOFF.md`
- 本変更報告
- `dist/**`（確定appVersion／buildIdの本番build・PWA生成物）

## 3. UI文言とsummer基準表示

- 天気確認表は、天気記号の行名だけを「天気」としました。入力見出し、内部のweather field、天候計算、保存形式は変更していません。
- 個別量判断ではnormalなら従来どおり「日曜日の17時を基準に考えて」、summerなら「夏の日曜日の17時を基準に考えて」のように表示します。
- 手動エリア残数判定はsummer時に「夏季モード基準：夏の残数基準で手動判定します。」を表示します。normal時に夏表示は出しません。
- エリア残数判定側の「迷ったら…」link／dialogと、その画面内の専用state／handlerを削除しました。既存保存データとの互換用hook stateは維持しています。個別量判断の「迷ったら…」と9段階の長押し案内も維持します。

## 4. 祝日referenceと優先順位

個別量判断は共通resolverで次の順に採用基準を決めます。

1. 三連休中日の既存特殊基準（17時以降）
2. 非祝日の祝日前日: 金土基準
3. 祝日当日: 日曜基準
4. 通常日: 実曜日基準

三連休中日の15時は従来どおり実曜日基準です。祝日であり翌日も祝日のケースを単純な「祝日前日」にしないため、祝日／連休側を優先します。表示は「明日は祝日なのでさらに考慮」ではなく、「金曜日・土曜日の○時を基準に考えて」「日曜日の○時を基準に考えて」と、アプリが採用済みの基準を受動的に示します。

エリア残数判定は今回ロジックを変更していません。既存の同曜日優先、曜日group fallback、祝日前日、祝日、三連休中日、翌日平日祝日の実判定をそのまま使用し、採用結果だけをanalysis metadataへ保存します。したがって個別量基準とエリア基準が異なる日・時刻も両方追跡できます。

## 5. `calendarContext`

`calendarContext` は `version: 1` のoptional metadataです。主な情報は次です。

- scope、営業日、実曜日
- `isHoliday`、`isDayBeforeHoliday`、`calendarCondition`
- 手動曜日overrideの有無
- sessionごとの個別量reference
- session／値引時刻／areaごとの残数comparison reference
- 同曜日、曜日group、複合group、履歴不足等のtype
- comparison mode、採用reason、採用weekday／group

日次contextは各sessionとAreaCount recordのcontextを統合し、15時と17時でreferenceが違う場合や、エリアごとに同曜日／fallbackが違う場合も1つへ潰しません。`actualWeekday` と採用referenceを別フィールドにするため、Workが表示文や実曜日から基準を推測する必要はありません。

旧データに `calendarContext` がない場合は未取得として正常に読み込み、従来の `actualWeekday`、`actualWeekdayGroup`、`comparisonMode` 等を壊しません。過去データの物理migrationは行いません。

## 6. `productionAnalysis`（製造不足疑い）

areaごとに15時・17時・19時のhuman raw評価だけから次を保存します。

- checkpoint別raw score 1〜9
- checkpoint status
- source scale 5／9
- 有効checkpoint数
- 少ない側件数
- `productionShortageSuspicion`

少ない側はraw score `1 / 2 / 3 / 4`、普通は`5`、多い側は`6 / 7 / 8 / 9`です。3 checkpointが全て有効な場合だけ次へ分類します。

```text
3/3 low -> strong
2/3 low -> medium
1/3 low -> weak
0/3 low -> none
```

15時、17時、19時のどれかがmissing、excluded、not measured、session missingなら `insufficient` です。2/2や1/1から強さを推測しません。15時・17時は実際のhuman manual評価、19時はReview19のhuman評価を使い、自動中央値評価を人間評価として流用しません。

旧5段階human評価は既存互換に従い `few / slightly_few / normal / slightly_many / many` を `1 / 3 / 5 / 7 / 9` へ論理deriveします。ただしsource scaleは5のままで、過去recordを書き換えません。

これは製造不足の確定判定や正解ラベルではありません。値引率・残数判定へ入力せず、後からその後の残数・廃棄等と比較するための生flagです。

## 7. `analysisWeatherContext`

各値引セッションで既存入力対象となる時間別予報（15時は16〜21時、17時は18〜21時、18時30分は19〜21時、19時30分は20〜21時、20時30分は21時）を、次のanalysis summaryへまとめます。

- `weatherDataSource: "entered_hourly_forecast"`
- `analysisWeatherClass: "dry" | "rain" | "snow" | "mixed" | "unknown"`
- `hasPrecipitation`
- `precipitationTypes`
- 判定対象、dry、rain、snowの時刻

全対象時刻が揃い降水なしならdry、雨だけならrain、雪だけならsnow、雨と雪が混在すればmixed、対象時間不足・判別不能はunknownです。予報由来であり実測天候ではありません。

元の `hourlyForecasts`、`resolvedWeather`、`precipitationRateBonus`、`weatherPointScore` は置き換えず保持します。製造不足疑いは天気に依存させていないため、3/3 low + rainも `strong` + rain metadata、3/3 low + snowも `strong` + snow metadataです。

## 8. Work / Data Analyticsの解釈

- normal／summerは別母集団として扱う。
- dry／rain／snow／mixedでデータセット自体を分断しない。weather classは各cycle内の説明変数・層別条件として使う。
- 製造量・残数水準を比べるときはweather classを考慮した同条件比較を優先する。
- `productionShortageSuspicion` は15/17/19 human評価由来のraw flagであり、雨・雪でも消去・弱体化しない。`analysisWeatherContext` と併読する。
- 祝日分析では実曜日だけでなく、`calendarContext` の採用reference／reason／comparison modeを使う。
- human raw評価、median-based auto評価、製造不足疑い、その後の残数、最終廃棄は別々の観測として保持し、相互に上書きしない。

## 9. normal／summer別の全件export

既存の2つの全件出力ボタンを増やさず、内部でcycle別に分けます。

- 19:00全件: `nebiki-review19-normal-YYYYMMDD-HHMM.json`／`nebiki-review19-summer-YYYYMMDD-HHMM.json`
- 日次全件: `nebiki-daily-normal-YYYYMMDD-HHMM.json`／`nebiki-daily-summer-YYYYMMDD-HHMM.json`
- 両cycleに有効recordがあれば2ファイル
- 片側0件なら空ファイルを作らず、有効側の1ファイルだけ
- 各rootにoptionalな `exportFilter: { demandCycle }`
- normal fileへsummer、summer fileへnormalを含めない
- schema／detailは両側とも従来と同じ完全版

「最新の19:00チェックデータ」「最新の1日データ」は従来どおり1操作1ファイルです。downloadはpopupを使わず同一操作内で順番に行い、生成・download失敗をアプリ全体へ波及させません。

`calendarContext`、`analysisWeatherContext`、`productionAnalysis` は日次snapshot、Review19、日次・19:00・統合JSONの既存経路で追跡できます。fixed-timeのデータは従来どおり本番exportへ混入しません。

## 10. Supabase／DB／cloud syncへの影響

- 新規migration: なし
- Supabase SQL変更: なし
- table／column／unique key／index変更: なし
- RLS／policy変更: なし
- credential変更: なし

追加metadataは `area_count_records.record_details` と `review19_records.payload` の既存JSONB、既存snapshotにoptional fieldとして保存します。rich merge／roundtripで欠落させず、schema列を追加しません。

実運用基準版で正常完走済みのnormal／summer local-first sync、pending、retry、CAS、in-flight guard、backfill、local／remote dedupe、Review19 partial／finalを変更しません。

`dataSchemaVersion` は業務JSONの互換versionです。今回のfieldはすべてoptional additiveで、欠損を許容し旧reader／旧データを破壊しないため `3` を維持します。

## 11. 後方互換性と変更していないロジック

- `demandCycle`欠損の旧データは引き続きnormal
- 旧human scale 5はscale 5のまま論理derive
- `calendarContext`／weather context／production analysis欠損を許容
- 既存JSON、日次snapshot、Review19、AreaCountの読込を維持
- 値引率基本値、商品属性補正を変更しない
- 気温快適度、気温低下中、雨・雪・風・未来天候補正を変更しない
- 夏季モード期間、履歴抽出、短期／長期、3件条件を変更しない
- 9段階interaction、500ms長押しを変更しない
- 完了画面の現在時刻連動値引率を変更しない
- 20時30分のmedian 5段階、30/40/50・40/50・all50、個数別tierを変更しない
- fixed-timeの本番履歴／cloud／pending／export隔離を維持

## 12. 検証結果

- 全 `check:*`: 30/30成功
- `check:analysis-metadata`: 15/15成功
- `check:analysis-metadata-ui`: 11/11成功
- `check:cycle-separated-export`: 7/7成功
- `check:weather-confirmation`: 19/19成功
- TypeScript: `npx tsc -b --pretty false` 成功
- 本番build: 成功。`dist/assets/index-Br_60vF_.js` を生成
- PWA: `generateSW` 成功。precache 10件、`dist/sw.js`／`dist/workbox-9c191d2f.js` を生成
- 変更対象ESLint: 新規・今回実装箇所は0 error。全変更対象をまとめた実行では、基準版から存在する `react-hooks/set-state-in-effect` 2件、未使用引数3件、hook dependency warning 4件が残る
- 実画面: current sourceを固定時間17時・夏季モードで操作し、確認表「天気」、夏の祝日基準、手動エリアの夏表示、エリア側「迷ったら…」非表示、個別量側「迷ったら…」表示、console error／warning 0を確認
- 390×844: in-app browserのviewport overrideを要求したが、実際のruntime viewportは1280×720のままで、実機幅の動的確認は未実施。専用UI testと固定幅／折返しのsource監査では横スクロール要因なし
- SQL: 基準版9ファイルとSHA-256一致、追加migrationなし
- dataSchemaVersion: `3`
- 依存関係: `dependencies`／`devDependencies`と505 packageのlock graphは基準版と同一。package-lockはproject version欄のみ同期
- `dist`: appVersion `2026.8.9-4`、buildId `build-20260812-004623-jst` を確認
- build warning: minified JSが500 kBを超える既存Vite chunk-size warningのみ。build／PWA生成は成功

## 13. 未解決事項

機能上の未解決事項はありません。DB migrationや利用者側SQL実行も不要です。検証環境上の制約として、390×844のbrowser viewport overrideが反映されず、実機幅の動的確認だけは未実施です。変更対象ESLintには上記の基準版由来5 error／4 warningが残りますが、今回追加行に新規errorはありません。

## 14. 成果物

- ZIP: `nebiki-helper-20260812-0051.zip`（JST）
- ZIP直下: `nebiki-helper/` の1フォルダ
- `dist`収録
- `node_modules`、`.env`、credential、元ZIP／中間ZIP、cacheを除外
- SHA-256: 最終回答で報告
