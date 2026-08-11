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
npm run check:review19-human-auto
npm run check:human-evaluation-9scale
npm run check:supabase-sync-domain
npm run check:review19-remote-storage
npm run check:supabase-cloud-sync-sql
npm run build
```

## 現在の運用

- 操作フローは従来の詳細モード相当の1種類です。簡易モードとモード切替はありません。
- 15時・17時・18時30分・19時30分・20時30分の値引フロー、19時チェック、自動時刻遷移、早め次時刻−5％を維持しています。
- 天候入力は16時〜21時です。15時値引そのものは維持し、15時専用の天候欄だけを廃止しています。
- エリアの残数評価は5つの基準ボタンを維持し、長押し時だけ隣接項目との中間を選べる9段階入力です。曜日グループ、祝前日、三連休中日、翌日平日祝日のロジックは維持しています。
- 20時30分は従来の最終残数入力と1個・2個・3個以上ルールを維持し、5択の人間評価UIがないため9段階入力の対象外です。
- 個別商品の「10個以上＋5％」は廃止しています。
- 広告商品は当日の売れ方にかかわらず、表示値引率から常に−10％です。
- 定番商品−10％、夜によく売れる商品−10％、見た目が悪い商品＋10％、不人気商品＋10％は従来どおりです。

## 人間残数評価（5ボタン・9段階）

- 表示する基準ボタンは従来どおり「多い／やや多い／普通／やや少ない／少ない」の5つです。通常タップはその項目を直ちに確定し、内部scoreは順に `9 / 7 / 5 / 3 / 1` です。
- 500ms長押しが成立すると、その第1選択を直ちに強調表示し、対応端末では15ms振動します。第2選択として同じ項目か隣接項目だけを選べます。
- 同じ項目を再タップすると単独選択の奇数score、隣接項目を選ぶと中間の偶数score `2 / 4 / 6 / 8` になります。第1・第2選択の入力順は保存し、非隣接の組合せは受け付けません。「中間選択をやめる」でキャンセルできます。
- 長押し成立後の `pointerup` と後続ghost clickは抑止します。移動、`pointercancel`、pointer capture喪失、画面blur・非表示でもgestureを安全に終了し、長押しと画面左スワイプが競合しないようにしています。
- 新規入力は `humanEvaluationDetails` に `humanEvaluationScale: 9`、`humanEvaluationScore9`、`humanEvaluationSelections` と解決条件を保存します。raw score・選択順を変更せず、値引運用に必要な既存5段階値だけを別途解決します。
- 通常サイクルの偶数scoreは15時なら少ない側、17時以降なら多い側へ解決します。夏季モードの偶数scoreはJST 18:00未満なら少ない側、18:00以降なら多い側へ解決します。奇数scoreは選んだ基準項目のままです。
- 夏季境界は固定時間を含むruntime clockと `evaluatedAt` で検証します。時間固定モードの時計・履歴・保存先は引き続き本番運用から隔離します。
- 旧5段階値は保存済みデータを書き換えず、読み込み・分析・出力時に奇数scoreと `humanEvaluationScale: 5` へ論理的に読み替えます。

## 夏季モード

- ユーザー向け名称は「夏季モード」です。内部互換のため、保存値とJSONは従来どおり `demandCycle: "normal" | "summer"` を維持します。
- 夏季モードはJSTの営業日が7月1日〜9月30日の場合だけ開始画面に表示し、ユーザーがON/OFFします。期間外は自動的にOFFとなり、翌年7月に勝手にONへ戻りません。
- 夏季モードは営業日全体へ適用し、当日の運用開始後は固定します。期間内の選択状態は翌日以降へ引き継ぎます。
- 時間固定モードでは固定したJST営業日を基準に期間判定し、本番設定とは別の `nebiki-helper/fixed-time-demand-cycle-state-v1` に選択と当日ロックを保存します。本番の残数履歴は読み書きしません。
- ON時の17:59までは、9段階の中間値を少ない側へ解決する案内を表示します。18:00以降は中間値を多い側へ解決します。単独の5基準項目は時刻で変更しません。
- 残数履歴、自動判定、減少率履歴、20時30分の中央値判定は従来どおり `normal` / `summer` 別に分離します。
- `summer` の短期履歴は対象年と同じ年、長期履歴は対象年より前の年の夏データだけを使用します。
- `summer` では今年の同曜日3件を優先し、同曜日が不足する場合は今年の曜日グループ3件で自動判定します。どちらも3件未満なら手動判定です。
- 旧データに `demandCycle` がない場合は `normal` として扱います。既存の `summer` 履歴はそのまま再利用します。

## 19:00チェックの2つの残数評価

- 各対象エリアでは、実残数と、売場を見た担当者による共通5ボタン・9段階のraw評価を記録します。除外エリアを除き、両方が揃うと完了です。
- 人間評価は現場感覚を保存する観測値であり、正解ラベルではありません。
- Review19の `humanEvaluationDetails` は `humanEvaluationScale: 9` とraw score・選択順を正本にし、偶数scoreを値引用5段階へ解決しません。奇数scoreだけは完全一致する旧 `humanEvaluation` も互換用に保存し、偶数scoreへ架空の丸め値は保存しません。
- 入力した当日値を含めず、過去の19:00チェック残数だけから既存中央値ロジックによる5段階評価も計算し、別の観測値として保存します。
- 中央値評価は `normal` / `summer`、同曜日／既存曜日グループ、夏季モードの今年短期・前年以前長期の条件を維持します。履歴不足時は「普通」へ補完せず `insufficient` とします。
- 中央値による自動5段階評価、中央値、サンプル数、判定基準は入力中・完了後とも現場UIへ表示しません。JSON内の `areaEvaluations` から、人間raw評価・自動5段階評価・後日の結果や廃棄を分析時に比較できます。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」の旧評価であり、今回の人間9段階残数評価とは別データとして維持します。

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
- `humanEvaluationDetails` はセッション／日次スナップショット、19:00個別出力、日次個別出力、統合JSONで保持します。旧5段階は保存済みデータを更新せず、出力用cloneだけへ奇数score・scale 5を展開します。

## Supabaseクラウド同期

通常・夏季の残数記録は、どちらも同じlocal-first経路で保存します。残数確定時は先に端末へ保存し、その後Supabase送信用outboxへ追加してupsertを試みます。通信、設定、SQL schemaのいずれかに問題があっても現場フローは止めず、未送信itemを `nebiki-helper/pending-supabase-sync-v1` に残します。Supabase送信成功を端末保存の条件にはしません。

pending itemは `type`、record identity、payload、`firstFailedAt`、`lastAttemptAt`、`attemptCount`、`enqueuedAt`、`lastError` を持ちます。同じtype・identityは1 itemへまとめ、app起動、online復帰、新しい残数／19:00チェック保存後、管理設定の手動同期時に直列再送します。同期処理はin-flight lockで多重実行を防ぎます。新schemaが未適用なら旧schemaへnormalとして送るfallbackは行わず、normal／summerを保持したままpendingに残します。

### 同期エラーの確認

pendingが1件以上ある場合だけ、管理設定のSupabase同期欄へ「エラー詳細」を表示します。既存の `nebiki-helper/pending-supabase-sync-v1` を正本とし、`record type × demandCycle × lastError` で同一原因を集約するため、大量の未同期recordを1件ずつ描画しません。cycleが欠けるlegacy／不正itemはnormalへ推測せず「不明」、`lastError`がないitemは「エラー未記録」として件数へ含めます。

「エラー内容をコピー」はappVersion、buildId、pending総数、group別のtype／cycle／件数／試行回数範囲／最初の失敗／最後の試行／全文errorを診断用テキストにします。payload全体は表示・コピーしません。Authorization、Cookie、API key、access／refresh token、JWT、Supabase key、URL認証情報等は除去し、HTTP status、PostgREST code／message／details／hint、constraint、column等は保持します。Clipboard APIが利用できない場合はアプリを停止せず画面へ失敗を通知します。

新規HTTP失敗では、安全に取得できるPostgREST診断本文を `lastError` に保持します。既存pendingのschemaは変更せず、すでに保存されている `lastError` もそのまま集約・表示できます。これは原因確認のためのUIであり、retry回数、retry timing、CAS、in-flight lock、queue identity、local-first動作は変更しません。

### `area_count_records`

既存14列を維持し、次を追加します。

- `demand_cycle text not null default 'normal'`（`normal` / `summer` のCHECK）
- `record_details jsonb not null default '{}'`（JSON objectのCHECK）

upsert identityとunique keyは `date × session_started_at × area_id × discount_time × demand_cycle` です。remote読込もcycle条件を必ず付け、normalとsummerを同じ中央値母集団へ混ぜません。旧remote rowはmigrationのDEFAULTによりnormalです。

`record_details` は1件の残数観測に属する `userJudge`、`humanEvaluationDetails`、`suggestedEvaluation`、`areaRateAdjustment`、`evaluationSource`、`decisionBasis`、`comfortPoint` を保持します。旧5段階記録はcloud payload上だけscale 5の奇数scoreとして表現し、新9段階記録のraw score・選択順・resolved 5段階・解決理由をlosslessに保存します。アプリstate全体は保存しません。

localとremoteは上記identityでdedupeします。異なるrevisionでは新しい `recordedAt` のcount・固定項目を採用し、欠けたoptional detailだけを古いrecordから補います。同一revisionでは詳細量が多いrecordを優先して不足項目を補い、同じ情報量なら安定したfingerprintで決定します。DB側でも古いupsertは無視し、同時刻では既存の固定値を維持しながら欠損JSONを補完します。`humanEvaluationScale: 9` はscale 5 envelopeより優先します。

### `review19_records`

19:00チェックは専用tableへ、営業日・cycleごとに1 rowとして保存します。主な列はversion情報、`date`、`session_started_at`、`demand_cycle`、`recorded_at`、`source_updated_at`、`is_complete`、`payload jsonb` です。unique keyは `date × demand_cycle` です。

入力途中も各エリアの更新後にlocal保存とSupabase upsertを行います。partialは `recorded_at = null`、正式完了は `recorded_at` ありです。`sourceUpdatedAt` は入力、除外、戻り修正、完了など同一営業日の更新を単調増加で順序付けます。DB triggerは古いrevisionとfinalからpartialへの逆戻りを拒否します。中央値履歴へ使うのはcompleteかつfinalのrecordだけで、localとremoteの同一日・cycleは1件へ統合します。人間9段階raw、自動中央値5段階、basis、data quality、app/build情報はpayloadで保持します。

### 端末内データの一括同期

管理設定の「端末内データをSupabaseへ同期」は、次の正式保存元を集約してからidentityごとに1件へまとめ、idempotent upsertします。

- 統合残数cache `nebiki-helper/area-count-records-v2`
- 旧normal cache `nebiki-helper/area-count-records`
- 旧summer cache `nebiki-helper/summer-area-count-records-v1`
- `nebiki-helper/finalized-day-data`
- 19:00記録内のday snapshot
- 日次session snapshot
- 確定済みの現在session state
- `nebiki-helper/review19-records` のcomplete・final 19:00記録

未来日／未来時刻、不正なarea・count・cycle、未測定、確定前UI入力、固定時間モードのデータは除外します。同じ操作を繰り返してもunique upsertで件数は増えず、端末データは削除しません。画面には検出件数、送信対象、成功、失敗、pendingを表示し、pending 0だけを「すべて同期済み」とみなします。時間固定モードではremote読込、write、retry、backfillのすべてを行いません。

### SQL適用手順

リモートSQLはアプリから自動実行しません。既存clientの書込みを止めてから、次の順でSupabase SQL Editorから実行してください。

1. `supabase_area_count_records_cloud_sync_backup.sql`
2. `supabase_area_count_records_cloud_sync_migration.sql`
3. `supabase_area_count_records_cloud_sync_verify.sql`
4. schema検証成功後に新アプリをdeploy
5. 実使用端末で新版を起動
6. 管理設定の「端末内データをSupabaseへ同期」を実行し、pending 0を確認

問題時は新アプリを停止／旧版へ戻してから `supabase_area_count_records_cloud_sync_rollback.sql` を使用します。rollbackはsummer行がある場合に中止し、Review19 tableは削除せずprivate quarantineへ退避する保守的な手順です。

既存 `area_count_records` のRLSは、共有売場を前提としたanonのSELECT／INSERT／UPDATE許可、DELETE不許可の現行モデルを変更しません。新しい `review19_records` も同じモデルでRLSと権限を設定します。service role keyはフロントエンドへ追加しません。

2026-08-11に利用者が実DBへcloud-sync migrationを適用済みです。旧verify artifactはPL/pgSQL関数定義の改行位置に依存し、正常なguardを誤って失敗扱いにしていました。現行verifyは関数定義の空白・改行・インデントを正規化してから、final→partial禁止、古いrevision禁止、同一revision guard、同時刻partial→final例外の4条件を検証します。DB上のguard実動作、schema、migration、RLSはこの修正では変更しません。

このソースを検証した開発環境には実DB接続情報がないため、現在の端末に残る同期失敗の原因は未特定です。新版を実使用端末へdeploy後、管理設定の「エラー詳細」から診断内容をコピーして確認してください。

`dataSchemaVersion` はJSON schemaのversionです。今回のJSON側変更は既存読込を壊さないoptional情報（Review19の `sourceUpdatedAt` 等）であり、DB migrationは別管理のため `3` を維持します。20時30分の中央値5段階判定と最終値引tier、固定時間モードの隔離、JSON exportは変更しません。

## バージョン

- `appVersion`: `2026.8.9-3`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260811-130021-jst`
