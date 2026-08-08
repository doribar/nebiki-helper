# 値引ヘルパー

惣菜の値引判断と残数記録を支援する、React + TypeScript + Vite製の業務用PWAです。

## 起動と確認

```powershell
npm install
npm run dev
npm run check:logic
npm run check:integration
npm run check:weekday-groups
npm run check:three-day-holiday-middle
npm run check:holiday-before-normal-weekday
npm run check:full-mode
npm run check:rate-decision-snapshot
npm run check:auto-skip-ui
npm run check:data-export-and-supabase
npm run check:schema-v3
npm run check:demand-cycle
npm run check:summer-mode
npm run check:done-summary-current-rate
npm run build
```

## 現在の運用

- 操作フローは従来の詳細モード相当の1種類です。簡易モードとモード切替はありません。
- 15時・17時・18時30分・19時30分・20時30分の値引フロー、19時チェック、自動時刻遷移、早め次時刻−5％を維持しています。
- 天候入力は16時〜21時です。15時値引そのものは維持し、15時専用の天候欄だけを廃止しています。
- エリアの5段階残数判定、曜日グループ、祝前日、三連休中日、翌日平日祝日のロジックを維持しています。
- 個別商品の「10個以上＋5％」は廃止しています。
- 広告商品は当日の売れ方にかかわらず、表示値引率から常に−10％です。
- 定番商品−10％、夜によく売れる商品−10％、見た目が悪い商品＋10％、不人気商品＋10％は従来どおりです。

## 夏季モード

- ユーザー向け名称は「夏季モード」です。内部互換のため、保存値とJSONは従来どおり `demandCycle: "normal" | "summer"` を維持します。
- 夏季モードはJSTの営業日が7月1日〜9月30日の場合だけ開始画面に表示し、ユーザーがON/OFFします。期間外は自動的にOFFとなり、翌年7月に勝手にONへ戻りません。
- 夏季モードは営業日全体へ適用し、当日の運用開始後は固定します。期間内の選択状態は翌日以降へ引き継ぎます。
- 時間固定モードでは固定したJST営業日を基準に期間判定し、本番設定とは別の `nebiki-helper/fixed-time-demand-cycle-state-v1` に選択と当日ロックを保存します。本番の残数履歴は読み書きしません。
- ON時の17:59までは、「残数の5段階判定で境界に迷った場合だけ1段階少ない側へ寄せる」案内を表示します。明らかに多い場合は下げず、18:00以降はこの案内を表示しません。
- 残数履歴、自動判定、減少率履歴、20時30分の中央値判定は従来どおり `normal` / `summer` 別に分離します。
- `summer` の短期履歴は対象年と同じ年、長期履歴は対象年より前の年の夏データだけを使用します。
- `summer` では今年の同曜日3件を優先し、同曜日が不足する場合は今年の曜日グループ3件で自動判定します。どちらも3件未満なら手動判定です。
- 旧データに `demandCycle` がない場合は `normal` として扱います。既存の `summer` 履歴はそのまま再利用します。

## 値引率の保存

新規に完了した各エリアには `rateDecisionSnapshot` を保存します。これはエリア完了時点の次の情報を固定した分析上の正本です。

- 確定時刻、セッション時刻、実効計算時刻、計算モード
- 基本値引率、天候・快適度補正、遅い時間帯＋5％、早め次時刻−5％
- エリア残数判定補正、適用中の商品補正方針
- 上下限前後の通常商品率・多い商品率と上下限適用有無
- 実際の表示値引率、解決済み天候、`rateLogicVersion`
- `appVersion`、`buildId`、`dataSchemaVersion`

確定時の `rateDecisionSnapshot` と既存の `completed*` は、完了後の時計進行で再計算・上書きしません。完了画面の値引率一覧だけは最終確認用途のため、確定済みの残数判定・補正条件を維持したまま、現在時刻に応じた既存の時間補正で動的に再計算します。この表示値はセッション・日次スナップショット・エクスポートへ書き戻しません。旧データにスナップショットがなければ `legacy_not_captured` とし、架空のスナップショットは生成しません。

セッションの `basis` は `basisCapturedAt` とともに最初の完了保存時点で固定します。各エリアの実表示率の分析には `basis` ではなく `rateDecisionSnapshot` を使用してください。

## 先取り値引済みエリア

正式時刻では次の3つから選びます。

1. 残数だけ記録する
2. 今回は値引する
3. 測定せずスキップする

測定せずスキップした場合、残数へ0や別時刻の値を補完しません。`measurementStatus`、`missingReason`、先取り元の時刻・セッション・完了時刻、確認時刻、`rateOrigin` を保存します。日次品質では `processComplete` と `measurementComplete` を分けます。

## データ出力

管理設定の「全データを出力」から、1日通しデータと19時チェックを1つのJSONへ出力します。

- 同日に両方がある場合は1日通しデータだけを出力します。
- 日本時間の日付で重複を判定します。
- 除外した日付、旧形式や日付欠損で判定不能だった件数を `dataQuality` に記録します。
- 旧 `not_applicable` は読み込み可能なまま保持しますが、新規作成せず、統合出力の業務データから除外します。
- 旧15時天候フィールドは新しい統合出力へ持ち込みません。

## Supabase `area_count_records`

アプリが新規に送信する列は次のとおりです。

- `data_schema_version`
- `app_version`
- `build_id`
- `date`
- `session_started_at`
- `recorded_at`
- `area_id`
- `discount_time`
- `actual_weekday`
- `actual_weekday_group`
- `count`

`id`、`created_at`、`updated_at` はDB側で維持します。旧列はローカル日次JSONの互換情報とは別に、Supabaseの残数履歴テーブルからだけ削除します。

既存環境では次の順で実行してください。リモートSQLは自動実行しません。

1. 新アプリをデプロイ（旧DBでは `build_id` なしで再試行できるため互換あり）
2. `supabase_area_count_records_backup.sql`
3. `supabase_area_count_records_migration.sql`
4. `supabase_area_count_records_verify.sql`
5. 問題時のみ `supabase_area_count_records_rollback.sql`

新規環境だけは `supabase_area_count_records.sql` を使用します。

## バージョン

- `appVersion`: `2026.8.8-1`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260808-163017-jst`（Viteビルドごとに日本時間形式で生成。CIでは同形式の`NEBIKI_BUILD_ID`を指定できます）
