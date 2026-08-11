# Supabaseクラウド同期 変更報告

作成日: 2026-08-10（JST）

## リリース識別情報

- `appVersion`: `2026.8.9-2`
- `buildId`: `build-20260811-104055-jst`
- `dataSchemaVersion`: `3`
- 基準ZIP: `nebiki-helper-20260809-2144.zip`

`dataSchemaVersion` はアプリが保存・出力するJSON schemaのversionです。今回JSONへ加わる `sourceUpdatedAt` 等はoptionalで、旧記録のnormalizerも維持されています。DB migrationは別のSQL artifactとして管理するため、JSONの破壊的変更を示すversion bumpは行わず `3` を維持します。

## 実装概要

- normal／summerの両AreaCountをlocal-firstで端末へ即時保存し、共通outboxからSupabaseへupsertするようにしました。
- 送信失敗は永続pending queueへ残し、app起動、online復帰、次の保存、手動同期で再送します。
- `area_count_records` へcycleと1観測分の分析detailを追加するmigrationを用意しました。
- Review19専用tableを追加し、各エリア更新のpartialから正式完了finalまで同じ営業日rowを単調更新します。
- localとremoteの同一recordをdedupeし、normal／summerを別identityとして中央値の二重カウントとcycle混入を防ぎます。
- 実使用端末の既存local dataを検出・統合・upsertする手動backfillを管理設定へ追加しました。
- fixed-time modeはremote read/write、pending、retry、backfillから隔離しました。
- 20時30分の残数中央値5段階判定、最終値引tier、1個・2個・3個以上ルール、人間9段階UI対象外という仕様は変更していません。

## 変更ファイル

### アプリ／domain

- `src/domain/areaCountLocalStorage.ts`
  - normal／summer共通の端末cacheと旧key読込互換。
- `src/domain/supabaseSyncQueue.ts`
  - 永続outbox、同一identity置換、直列flush、in-flight guard、CAS。
- `src/domain/cloudSync.ts`
  - AreaCount／Review19共通送信dispatch、local-first、queue status。
- `src/domain/areaCountBackfill.ts`
  - 複数local sourceの検証・再構築・dedupe。
- `src/domain/areaCountRemoteStorage.ts`
  - cycle条件、5列upsert key、`record_details` roundtrip。
- `src/domain/review19RemoteStorage.ts`
  - Review19 REST row、partial/final、cycle read、upsert、median用merge。
- `src/domain/areaCountHistory.ts`
  - cycleを含むidentityとrich deterministic merge。
- `src/domain/review19.ts`
  - optional `sourceUpdatedAt` の旧データfallbackと単調更新。
- `src/domain/types.ts`
  - Review19 source timestamp、同期／backfill resultの型。
- `src/domain/storage.ts`
  - 旧normal cacheを消去しない互換処理。
- `src/hooks/nebikiApp/sessionSnapshots.ts`
  - Review19 source timestampのsnapshot保持。
- `src/hooks/useNebikiApp.ts`
  - remote load／merge、保存時同期、retry、Review19 partial/final同期、手動backfill、fixed隔離。
- `src/components/common/AdminSettingsDialog.tsx`
  - 端末内データ同期UI、件数／pending表示。
- `src/app/App.tsx`
  - 管理設定への同期state/action接続。

### SQL

- `supabase_area_count_records_cloud_sync_backup.sql`
- `supabase_area_count_records_cloud_sync_migration.sql`
- `supabase_area_count_records_cloud_sync_verify.sql`
- `supabase_area_count_records_cloud_sync_rollback.sql`

過去のSQL artifactは書き換えず、新しいone-shot migration一式を追加しました。

### テスト

- `scripts/check-supabase-sync-domain.ts`
- `scripts/check-review19-remote-storage.ts`
- `scripts/check-supabase-cloud-sync-sql.ts`
- 既存のSupabase、demand-cycle、9段階、workflow／characterization testを新schemaへ追従。

### 文書

- `README.md`
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_20260810_SUPABASE_CLOUD_SYNC.md`

## 現行Supabase schemaの確認結果

migration前の正本SQLでは、`area_count_records` は次の14列です。

`id`, `data_schema_version`, `app_version`, `build_id`, `date`, `session_started_at`, `recorded_at`, `area_id`, `discount_time`, `actual_weekday`, `actual_weekday_group`, `count`, `created_at`, `updated_at`

- unique: `date × session_started_at × area_id × discount_time`
- 履歴index: area／discount時刻／曜日または曜日group／record時刻
- RLS: enabled
- anon policy: SELECT／INSERT／UPDATE
- DELETE policy: なし
- summer識別列、9段階detail列、Review19 table: なし

この確認はproject内SQLと現行client実装に基づきます。開発環境に接続情報がないため、リモートDB catalogを直接照合した結果ではありません。migration前にbackup SQLと利用者側schema確認を必須とします。

## Supabase schema変更

### `area_count_records`

追加列:

```text
demand_cycle  text  NOT NULL DEFAULT 'normal'
record_details jsonb NOT NULL DEFAULT '{}'
```

- `demand_cycle` は `normal` / `summer` のCHECK付きです。
- 既存rowはDEFAULTで `normal` となり、削除・再作成しません。
- `record_details` はJSON objectのCHECK付きです。
- 新unique constraintは `date × session_started_at × area_id × discount_time × demand_cycle` です。
- 新しい5列constraintを先に追加してから、catalogで正確に特定した旧4列constraintを削除します。
- cycleを先頭にした同曜日／曜日group用indexを追加します。

`guard_area_count_records_cloud_sync_update` triggerの規則:

1. incoming `recorded_at` が古ければ無視。
2. 同時刻なら既存固定列を維持し、incoming detailから既存にないkeyだけ補完。
3. `humanEvaluationDetails` はscale 9をscale 5より優先。同scaleの衝突は既存値を維持。
4. incomingが新しい時刻なら新revisionを採用し、incomingで省略された旧detail keyだけ保持。

### `review19_records`

主な列:

```text
id
data_schema_version / app_version / build_id
date / session_started_at / demand_cycle
recorded_at / source_updated_at / is_complete
payload jsonb
created_at / updated_at
```

- unique: `date × demand_cycle`
- partial: `recorded_at IS NULL`
- final: `recorded_at IS NOT NULL`
- `source_updated_at` は同一営業日record内のrevision順序です。
- payloadのdate、session、cycle、source timestamp、complete、recordedAtが固定列と一致するCHECKを持ちます。
- triggerはfinal→partial、古いsource revision、証明できない同時刻updateを拒否します。同時刻partial→finalだけ許容します。

### RLS／security

- 既存 `area_count_records` のRLS／policyは変更しません。
- `review19_records` は既存area tableと同じ共有売場モデル、すなわちanon SELECT／INSERT／UPDATE、DELETEなしです。
- table／sequence権限を明示し、trigger functionの直接EXECUTEをpublic／anon／authenticatedからrevokeします。
- RLS無効化、service role keyのfrontend埋込み、anon DELETE、`grant all` は行いません。

## normal／summerの保存とremote query

- `AreaCountRecord.demandCycle` は既存domainの `normal | summer` をそのまま使います。
- remote payloadは必ず `demand_cycle` を持ちます。
- remote loadはnormalとsummerを別queryで読み、必ず `demand_cycle=eq.<cycle>` を付けます。
- migration未適用の404／400等を旧schemaへfallbackしません。local保存とpending保持だけを行います。
- 旧local／JSONでcycleが欠けるrecordは既存互換規則によりnormalです。旧summer専用keyだけはfallback `summer` でnormalizerへ渡します。
- summerのcurrent-year short、prior-years long、同曜日優先、曜日group fallback、3件条件、最大2個guardを変更していません。

## 9段階detailのcloud保存

`record_details` は1件の残数観測だけに属する次の情報を保持します。

- `userJudge`
- `humanEvaluationDetails`
  - `humanEvaluationScore9`
  - `humanEvaluationScale`
  - `humanEvaluationSelections`
  - `automaticEvaluation`
  - `resolvedEvaluation`
  - `resolutionDirection`
  - `resolutionReason`
  - `demandCycle`
  - `evaluatedAt`
  - `sessionDiscountTime`
- `suggestedEvaluation`
- `areaRateAdjustment`
- `evaluationSource`
- `decisionBasis`
- `comfortPoint`

旧5段階しかないAreaCountは、remote payload構築時だけ既存5段階をscore 1／3／5／7／9、scale 5として論理展開します。localの旧recordを物理移行せず、新9段階だけscale 9を保持します。raw 6とresolved `normal`、raw 6とresolved `slightly_many` は別detailとしてlosslessにroundtripできます。

## local-firstとpending queue

### 役割

```text
入力確定
→ local AreaCount／Review19 stateを先に保存
→ pending outboxへ追加
→ Supabase upsert
→ 成功ならpending削除
→ 失敗ならmetadata付きで保持
```

Supabase成功を待たずに値引フローを続行します。AreaCountは、pending保存自体が容量エラー等で失敗した場合でも、その前に端末の正式cacheが更新済みです。

### pending keyと構造

- key: `nebiki-helper/pending-supabase-sync-v1`
- `type`: `area_count` / `review19`
- `identity`
- JSON `payload`
- `firstFailedAt`
- `lastAttemptAt`
- `attemptCount`
- `enqueuedAt`
- `lastError`

queue keyは `type × identity` です。同じpayloadの再enqueueはmetadataを維持し、変更payloadは同じkeyの1 itemへ置換します。

### retry timing／多重実行防止

- app起動
- browserの `online` event
- 新しいAreaCount保存後
- Review19 partial／final更新後
- 管理設定の手動同期

flushはitemを直列送信し、module-global in-flight promiseで同時flushを1本にまとめます。送信前後にpayloadを比較するCASにより、送信中に積まれた新revisionを古い成功結果で削除しません。1回目が全成功し、その間にpendingが増えた場合だけ、hookがもう1回追送します。失敗itemへ試行時刻、回数、最初の失敗時刻、最後のerrorを保存します。

## local／remote dedupeとmerge precedence

### AreaCount

identity:

```text
date × sessionStartedAt × areaId × discountTime × demandCycle
```

- localとremoteに同じidentityがあっても1sampleです。
- normalとsummerはidentityが異なるため統合されません。
- recordedAtが異なる場合は新しいrevisionのcount／固定項目を優先し、そこにないoptional detailだけを古い方から補います。
- 同じrecordedAt・countならdetail leaf数が多い方を優先し、不足項目をもう一方から補います。
- detail量も同じ場合はserialized fingerprintで決定し、collection順に依存させません。
- count等が同時刻に衝突しても平均、推測、合算はしません。

### Review19

identity:

```text
date × demandCycle
```

- remote tableの1 rowとlocal recordを日・cycle単位でdedupeします。
- median履歴へはcompleteかつfinalだけを採用します。
- final、complete、sourceUpdatedAt、sessionStartedAtの順でcanonical recordを選び、完全tieではremoteを採用します。
- 人間raw評価とauto median評価は同一payload内の別観測値であり、一方から他方を補完しません。

## Review19クラウド保存

- 19:00チェックの入力中stateは各エリア確定／除外／修正後に端末へ保存され、そのrevisionをSupabaseへupsertします。
- `sourceUpdatedAt` を明示保存し、runtime clockが同じmsまたは逆行しても前revisionより1ms以上進めます。
- count入力後にskipへ修正して値を削除する操作も、新しいpartial revisionとしてremoteへ反映できます。
- 正式完了時は同じ営業日・cycle rowをfinalへ更新します。queueもfinalからpartialへ戻しません。
- payloadにはarea counts、9段階人間評価、scale 5旧互換、自動中央値5段階、auto status／basis、demandCycle、dataQuality、appVersion、buildId、day snapshotを保持します。
- remote中央値履歴はcomplete・finalだけです。partialを自動評価のsampleへ混ぜません。
- 2026-08-09等の旧5段階recordは保存物を改変せず、scale 5として保持できます。

## 既存端末データbackfill

管理設定へ「端末内データをSupabaseへ同期」を追加しました。

### AreaCountの収集元

- `nebiki-helper/area-count-records-v2`
- `nebiki-helper/area-count-records`
- `nebiki-helper/summer-area-count-records-v1`
- `nebiki-helper/finalized-day-data` の `areaCountRecords`
- `nebiki-helper/review19-records` 内day snapshotの `areaCountRecords`
- `nebiki-helper/daily-session-snapshots`
- 復元済みのcurrent session state

### Review19の収集元

- `nebiki-helper/review19-records` のcomplete・final record

### 除外

- fixed-time mode一式
- future business date／future session／future recordedAt
- 不正date、area、count、timestamp、discountTime、cycle
- cycleがcontainer／session間で矛盾するsnapshot
- `measurementStatus: "not_measured"` または不正な測定状態
- measurement timestampのない未確定area／一時UI draft
- incomplete／partial Review19の過去backfill（進行中のcurrent Review19はrealtime同期対象）

収集後にidentity dedupeしてからqueueへ積むため、finalized day、session snapshot、cacheに同じ観測があっても1件です。detailが多い保存元の情報を保持します。remote送信はupsertなので何度実行しても件数は増えず、端末データを削除しません。Supabase API上で新規／更新を余分なSELECTなしに厳密判別できないため、UIは検出、送信対象、成功、失敗、pendingを正本として表示します。

実使用中スマートフォンPWAのlocalStorageは開発PCから直接読み出していません。機能をdeploy後、利用者が実端末で手動backfillを実行する必要があります。

## remote read失敗時

- remote AreaCount／Review19 loadが失敗しても、端末local historyでアプリを継続します。
- remoteで取得できなかった件数をあるものとして扱わないため、localだけで3件に届かなければ従来どおり `insufficient` です。
- remote errorをnormal recordとして補完したり、summerをnormal queryへ混ぜたりしません。

## fixed-time mode隔離

fixed-time modeでは以下をすべて無効化します。

- Supabase AreaCount／Review19 read
- AreaCount／Review19 write
- pending retry
- 本番pending countの表示利用
- 手動backfill（`skippedReason: "fixed_time_mode"`）

従来どおり本番history、summer history、設定、Supabase、日次データを汚染しません。

## 20時30分回帰

今回変更したのは履歴の保存／取得経路とcycle分離です。次は変更していません。

- 20時30分の残数入力
- 中央値による既存5段階判定
- 30／40／50型
- 40／50型
- 全品50型
- 1個／2個／3個以上の最終値引ルール
- 人間9段階UIを20時30分へ出さない仕様

20時30分の残数recordにもcycleを保存し、normal／summerを分けてcloud同期します。

## SQLファイルと実行順

1. 旧clientの書込みを止める。
2. Supabase SQL Editorで `supabase_area_count_records_cloud_sync_backup.sql` を実行。
3. backup件数と内容一致を確認。
4. `supabase_area_count_records_cloud_sync_migration.sql` を実行。
5. `supabase_area_count_records_cloud_sync_verify.sql` を実行し、すべて成功を確認。
6. appVersion `2026.8.9-2` の新アプリをdeploy。
7. 実使用端末で新版を起動。
8. 管理設定の「端末内データをSupabaseへ同期」を実行。
9. 成功／失敗とpending 0を確認。

migrationはone-shotです。backupの完全一致を再確認し、5列uniqueを作ってから旧4列uniqueを外します。問題時は新アプリを停止／旧版へ戻してから `supabase_area_count_records_cloud_sync_rollback.sql` を使います。rollbackはsummer rowがあれば中止し、Review19 tableを削除せず `review19_records_quarantine_20260809_cloud_sync` へ退避します。追加列も自動削除しません。

## テスト結果

この変更報告作成時点の専用test結果:

- `npm run check:supabase-sync-domain`: **19 / 19 PASS**
- `npm run check:review19-remote-storage`: **12 / 12 PASS**
- `npm run check:supabase-cloud-sync-sql`: **PASS（5 SQL artifact）**

専用testはnormal／summer payload、5列identity、9段階roundtrip、scale 5互換、local-first、pending failure/retry/CAS/lock、rich merge、backfill validation、Review19 partial/final/sourceUpdatedAt、cycle query、旧schema fallback禁止、SQLのconstraint/index/RLS/rollbackを確認します。

最終リリース検証結果:

- 全 `check:*`: **26 / 26 scripts PASS**
- `check:supabase-sync-domain`: **19 / 19 PASS**
- `check:review19-remote-storage`: **12 / 12 PASS**
- `check:supabase-cloud-sync-sql`: **PASS（5 SQL artifact）**
- `npx tsc -b`: **PASS**
- 追加した同期domain・remote adapter・設定UI・専用testのESLint: **PASS**
- 変更ファイル全体のESLint: 基準版から存在する `areaCountHistory.ts` の未使用引数1件と既存Hook依存警告6件を検出。今回追加行に起因するerror／warningは0件で、無関係な挙動変更を避けるため基準版由来箇所は変更していません。
- `npm run build`: **PASS**
- Vite PWA `generateSW`: **PASS**（`dist/sw.js`、`dist/registerSW.js`、`dist/workbox-*.js`生成済み）
- `dist`識別情報: `appVersion 2026.8.9-2`、`build-20260811-104055-jst`を確認
- 既存23本を含む全回帰test、20:30、fixed-time、9段階評価、夏季モード、完了画面動的値引率: **PASS**
- 依存関係: `package.json` / `package-lock.json`とも基準版から依存関係差分なし。lockfileはプロジェクトversion以外同一。
- 既存Supabase SQL 5ファイル: 基準版とSHA-256同一。今回のDB変更は新規cloud-sync SQL 4ファイルとして追加。
- `dataSchemaVersion`: **3のまま**
- 390×844px: in-app browserのlocalhost security policyにより実画面接続が拒否され、ブラウザconsoleと目視確認は未実施。設定panelの`max-width`／`box-sizing`／全幅buttonと同期UI接続は静的回帰testで確認し、横幅を固定拡張する変更はありません。

## 実DB検証

- 開発環境の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` は利用できず、migrationをリモートSupabaseへ実行していません。
- normal test row、summer test row、9段階detail readback、Review19 partial/final、pending retryはmock／domain testで確認しました。
- 実DBで確認済みとは報告しません。利用者がmigration／verifyを実行し、新版deploy後に実端末backfillとpending 0を確認してください。

## 未解決事項・運用上の注意

- SQL migrationと実DB read/writeは利用者環境での確認が必要です。
- pending queueとlocal cacheはlocalStorage上にあるため、ブラウザデータ削除前にpending 0とJSON exportを確認してください。
- 既存と同じanon共有書込みmodelを維持しています。店舗・利用者単位の認証／tenant分離は今回の範囲外です。
- migration後は旧4列 `on_conflict` clientが使えないため、cutover中は旧clientの書込みを止めてください。
- 開発PCから実使用スマートフォンのlocalStorageを直接移行していません。新版の手動同期を実端末で実行してください。

## 利用者が次に行う作業

1. Supabaseでbackup SQLを実行。
2. migration SQLを実行。
3. verify SQLが成功することを確認。
4. 新版をdeploy。
5. 実使用端末で「端末内データをSupabaseへ同期」。
6. 成功件数、失敗件数、pending 0を確認。
