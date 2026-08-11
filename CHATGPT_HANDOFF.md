# 値引ヘルパー 引継ぎメモ

最終更新: 2026-08-11（日本時間）

## 正本と作業ルール

- ユーザーから渡された最新ZIPを展開し、その中身を正本として確認する。
- 変更前に `package.json`、型、localStorage、JSON出力、Supabase保存、テストを確認する。
- 値引率・閾値・上下限は、ユーザーが明示した範囲以外で変更しない。
- リリースZIPには検証済みの `dist` を含め、`node_modules`、`.env`、秘密情報、別のZIPは含めない。

## 現行リリース情報

- 作業基準ZIP: `nebiki-helper-20260811-1042.zip`
- `appVersion`: `2026.8.9-3`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260811-130021-jst`
- リリースZIP: 今回JST日時で生成する `nebiki-helper-YYYYMMDD-HHMM.zip`。確定した識別情報で再生成した `dist` を収録する。

## 現行フロー

- 操作モードは従来の詳細モード相当の1種類。簡易モードと習熟Step制は廃止済み。
- 15時、17時、18時30分、19時30分、20時30分を維持。
- 天候入力は16時〜21時。15時天候欄はない。
- 19時チェック開始は天候入力画面から行う。18時30分完了画面には開始ボタンを出さない。
- 19時チェックの新規「対象外」登録はない。旧 `not_applicable` は読み込み互換のみ。
- 20時30分は従来の最終残数入力と1個・2個・3個以上ルールを維持する。既存5択の人間評価UIがないため、今回の9段階入力は適用しない。

## 人間残数評価（5ボタン・9段階）

- 共通UIは既存5ボタンを維持する。通常タップは即確定し、`few / slightly_few / normal / slightly_many / many` をscore `1 / 3 / 5 / 7 / 9` として保存する。
- 500ms長押し成立時に第1選択を即時強調し、対応端末では15ms振動する。長押し後は同じ項目または隣接項目だけを第2選択にできる。
- 同じ項目の再タップは単独選択へ戻り奇数score、隣接項目は偶数score `2 / 4 / 6 / 8`。第1・第2選択の順序を保存し、非隣接はvalidatorで拒否する。キャンセル操作で中間モードを終了できる。
- 成立済み長押しの `pointerup` とghost clickをone-shotで抑止する。移動、`pointercancel`、pointer capture喪失、blur・visibility changeもcleanupし、画面左スワイプは長押し成立時にキャンセルする。
- action入力の `HumanEvaluationSelection` はraw scoreと選択列だけを持つ。hook/domain境界で `HumanEvaluationDetails` を構築し、入力オブジェクトと順序を変更しない。
- 新規記録は `humanEvaluationScale: 9`。通常値引では偶数だけを既存 `AreaCountEvaluation` へ解決し、その解決値を既存運用ロジックへ渡す。通常サイクルは15時=`lower`、17時以降=`higher`。夏季モードはJST 18:00未満=`lower`、18:00以降=`higher`。奇数は選択値のまま。
- 夏季境界には固定時間対応のruntime clockを使い、`evaluatedAt` とresolution reasonの整合もnormalizerで検証する。
- 旧5段階は保存物を移行せず、読み込み・分析・出力時に奇数score、`humanEvaluationScale: 5`、単独selectionへ論理deriveする。

## 夏季モード（内部 `demandCycle`）

- ユーザー向け名称は「夏季モード」。内部保存値は互換性のため `normal` / `summer` のまま維持する。
- JSTの営業日が7月1日〜9月30日の場合だけ開始画面へON/OFFを表示し、ユーザーが手動で切り替える。気温による自動切替は行わない。
- 期間外は保存済み `summer` も `normal` へ正規化し、翌年7月に勝手にONへ戻さない。
- モードは15時、17時、18時30分、19時30分、20時30分、19時チェックを含む営業日全体へ適用する。
- 当日の運用開始後は変更できない。期間内の選択状態は翌日以降へ引き継ぐ。
- 時間固定モードは固定したJST日時で期間判定し、本番とは独立した選択・日次ロックを使用する。固定モードでは本番の残数履歴を読み書きしない。
- ONかつ17:59までは、9段階の中間値を少ない側へ解決する案内を表示する。18:00以降は中間値を多い側へ解決し、単独の5基準項目は変更しない。
- 通常履歴と夏履歴は混ぜない。旧データで `demandCycle` が欠ける場合は `normal` として扱う。
- `summer` の短期中央値は対象年と同じ年の夏データだけ、長期中央値は対象年より前の年の夏データだけを使用する。
- 前年以前の夏データは、今年の自動判定開始3件へ含めない。
- 今年の同曜日が3件以上なら曜日単体判定を使用する。同曜日が3件未満で曜日グループが3件以上ならグループ判定、どちらも3件未満なら手動判定とする。
- 曜日単体判定では、既存の「長期中央値より最大2個低い位置まで」のガードを使用する。曜日グループ判定では長期ガードを使用しない。
- 減少率履歴と20時30分の中央値判定もサイクル別に分離する。
- 19時チェック、日次スナップショット、`rateDecisionSnapshot`、JSON出力へ需要サイクルを保存する。

## 夏季モードとクラウド保存

- 通常・夏季の残数履歴を同じlocal-first同期経路で扱う。端末保存が先、Supabase upsertは後であり、remote失敗で値引フローを止めない。
- 統合端末cacheは `nebiki-helper/area-count-records-v2`。旧normalの `nebiki-helper/area-count-records` と旧summerの `nebiki-helper/summer-area-count-records-v1` は読込互換を維持し、summer keyは旧版互換のためdual-writeする。同期成功後も端末データを削除しない。
- Supabaseの `area_count_records.demand_cycle` へ `normal` / `summer` を正式保存する。remote queryも必ずcycleで分離し、normalとsummerを同じ中央値・減少率・20時30分判定の母集団へ混ぜない。
- サイクル選択と当日ロックのキーは `nebiki-helper/demand-cycle-state-v1`。時間固定モード側は `nebiki-helper/fixed-time-demand-cycle-state-v1` で、本番設定と相互に変更しない。
- 固定時間モードは本番local history、Supabase、pending queue、Review19、日次データを読み書きせず、手動backfillも `fixed_time_mode` として実行しない。
- 完了済み日の通常・夏季履歴は日次JSONにも含まれ、JSON exportは引き続き分析・監査・可搬backupとして維持する。
- `dataSchemaVersion` はJSON schemaのversionであり、今回のJSON側追加はoptionalかつ後方互換なため `3` のまま。Supabase schema migrationは別管理とする。

## 分析データ

- 新規完了エリアでは `rateDecisionSnapshot` が実表示率の正本。
- `completed*` は画面表示・旧データ互換用。
- エリア完了後に時計が進んでも `rateDecisionSnapshot`・`completed*`・保存用完了サマリーを再計算しない。
- 完了画面の値引率一覧だけは最終確認用途のため、確定済み判定を維持し、現在時刻の既存時間補正で動的に再計算する。表示値はセッション・日次データ・エクスポートへ書き戻さない。
- 旧完了データにスナップショットがない場合は `legacy_not_captured`。架空の値を作らない。
- セッション `basis` は完了保存時に `basisCapturedAt` とともに固定し、エリア率の正本には使わない。
- 日次品質は `processComplete` と `measurementComplete` を分離する。
- `humanEvaluationDetails` はraw score・選択順・scale・解決値と理由を保持する。`decisionBasis` へ重複保存しない。

## 19:00チェックの人間評価と中央値評価

- 各対象エリアは、19:00実残数と共通5ボタンによる人間9段階raw評価が揃って完了する。除外エリアには要求しない。
- 人間評価は売場を見た担当者の観測値であり、ground truthではない。数値と感覚が矛盾しても、どちらも入力どおり保持する。
- Review19では偶数scoreを値引用5段階へ解決しない。`humanEvaluationDetails` のscore・selection・scale 9が正本であり、`resolutionDirection: "not_applicable"`、`resolutionReason: "review19_observation"`、`sessionDiscountTime: "19"` を保存する。
- 新規の奇数scoreだけは完全一致する既存 `humanEvaluation` を互換用に併記する。偶数scoreでは丸めた `humanEvaluation` を作らない。旧 `humanEvaluation` だけの記録はscale 5・奇数scoreとして論理deriveし、保存済みデータ自体は更新しない。
- 過去の19:00チェック残数だけを一時的な19時履歴として既存中央値エンジンへ渡し、中央値ベースの5段階評価を別センサーとして保存する。当日自身は母集団へ含めない。
- `normal` / `summer` を混ぜず、既存の同曜日3件優先・曜日グループfallback・祝日例外を維持する。`summer` は今年を短期、前年以前を長期として分離する。
- 履歴不足は `autoEvaluation: null` と `autoEvaluationStatus: "insufficient"` であり、「普通」を代入しない。
- エリア別の正本は `areaEvaluations[areaId]`。`humanEvaluationDetails`、互換 `humanEvaluation`、`autoEvaluation`、`autoEvaluationStatus`、`autoEvaluationBasis` を19:00個別出力、日次スナップショット、統合JSONから追跡できる。
- 自動5段階評価、中央値、件数、基準は入力画面にも完了画面にも表示しない。Work/Data Analyticsで human raw evaluation / median-based five-level evaluation / later outcome・discard を比較するためのデータである。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」の旧評価で意味が異なるため再利用しない。これら旧rating系から人間評価を推測・補完しない。
- 時間固定モードは本番19:00履歴を読み込まず、本番履歴・Supabase・本番日次データへ保存しないため、自動評価は履歴不足になる。

## 先取り値引済みエリア

正式時刻では3択:

1. 残数だけ記録する
2. 今回は値引する
3. 測定せずスキップする

未測定時は残数を補完せず、`measurementStatus`、`missingReason`、先取り元情報、確認時刻、`rateOrigin` を保存する。

## 現行の商品ルール

- 「10個以上＋5％」は廃止済み。
- 広告商品は常時−10％。
- 定番−10％、夜によく売れる−10％、見た目が悪い＋10％、不人気＋10％は維持。
- 20時30分の1個・2個・3個以上ルールは維持。

## 出力

- 管理設定の「全データを出力」で日次データと19時チェックを1 JSONへ統合。
- 同日は日次データを正本とし、19時チェック側を除外。
- 重複除外・判定不能・旧対象外の件数を `dataQuality` に保存。
- 新しいscale 9詳細はセッション、日次スナップショット、19:00個別、日次個別、統合JSONでroundtripする。旧scale 5は保存済みデータを変更せず、出力用cloneだけへ奇数scoreとしてmaterializeする。

## Supabaseクラウド同期

### 現行schema確認とmigration

- migration前の `area_count_records` は `id`、version 3列、日付・session・record時刻、area・discount時刻、曜日・曜日group、count、作成・更新時刻の14列。unique keyは `date × session_started_at × area_id × discount_time`。RLSは共有売場を前提にanonのSELECT／INSERT／UPDATEを許可し、DELETEは許可しない。
- 新migrationは既存rowを削除せず、`demand_cycle text not null default 'normal'` と `record_details jsonb not null default '{}'` を追加する。既存rowはDEFAULTでnormalとなる。CHECKでcycleを `normal` / `summer`、detailsをJSON objectへ制限する。
- unique keyを `date × session_started_at × area_id × discount_time × demand_cycle` へ置換し、cycle・area・discount時刻・曜日／曜日group・record時刻用indexを追加する。
- `record_details` は `userJudge`、`humanEvaluationDetails`、`suggestedEvaluation`、`areaRateAdjustment`、`evaluationSource`、`decisionBasis`、`comfortPoint` を保持する。旧5段階はcloud payload上だけscale 5と奇数scoreへ展開し、新9段階はraw score、selection順、resolved 5段階、direction/reasonを保持する。アプリstate全体は格納しない。
- `review19_records` を新設し、1営業日・1cycleを1 rowとしてupsertする。version、date、session、cycle、`recorded_at`、`source_updated_at`、`is_complete`、`payload jsonb`、作成・更新時刻を持ち、unique keyは `date × demand_cycle`。
- Review19のpartialは `recorded_at = null`、finalはrecorded_atあり。各入力・除外・修正・完了で `sourceUpdatedAt` を単調増加させる。triggerは古いrevisionとfinalからpartialへの逆戻りを拒否する。旧recordに `sourceUpdatedAt` がなければrecorded/completed/area count/start時刻のうち最新の有効時刻を論理的に利用する。
- 新tableのRLS／権限は既存area tableと同じanon SELECT／INSERT／UPDATE、DELETEなし。area tableの現行RLS modelは変更しない。service role keyはfrontendへ追加しない。

### local-first、pending、retry

- AreaCountは端末cacheへupsertしてからoutboxへ積み、Review19は端末state／recordを保存してからoutboxへ積む。Supabase成功を現場保存の条件にしない。
- pending keyは `nebiki-helper/pending-supabase-sync-v1`。itemは `type`（`area_count` / `review19`）、identity、payload、`firstFailedAt`、`lastAttemptAt`、`attemptCount`、`enqueuedAt`、`lastError` を持つ。
- 同じtype・identityはqueue内で1 itemにまとめる。retryはapp起動、online event、新しいAreaCount／Review19保存後、管理設定の手動同期で行う。送信は直列で、process内のsingle in-flight lockにより並列flushを抑止する。送信中に同identityの新revisionが積まれた場合はCASで消さず、必要なら成功後にもう一度だけ追送する。
- remote失敗、Supabase設定なし、schema未適用はすべてpendingに残す。特にsummerを旧schemaへnormalとして送るfallbackはない。
- Review19は各エリア確定後のpartialも送る。final payloadがpartialへ退行しないようqueueとDB triggerの両方で保護する。remoteから中央値履歴へ取り込むのはcomplete・finalだけ。

### pending同期エラー診断

- pendingが1件以上ある場合だけ、管理設定に「エラー詳細」を表示する。既存の `nebiki-helper/pending-supabase-sync-v1` を直接読み、別のerror logは作らない。
- group keyは `type × payload直下のdemandCycle × sanitized lastError`。cycle欠損はnormalへ推測せず「不明」、error欠損も「エラー未記録」としてgroup件数へ含める。
- 表示・コピー対象はtype、cycle、件数、試行回数の最小／最大、最初の失敗、最後の試行、error本文。payload全体や全record一覧は表示しない。
- コピー前にAuthorization、Cookie、API key、access／refresh token、JWT、Supabase key、URL認証情報を除去する。HTTP status、PostgREST code／message／details／hint、constraint、columnは保持する。
- 新規HTTP失敗は安全なPostgREST本文を `lastError` へ追加保持する。既存pending schema、retry回数／時機、CAS、in-flight guard、identity、local-first同期は変更しない。
- retry成功後は既存のcloud sync version更新でgroupを再生成し、pending 0なら診断UIを消す。固定時間モードではqueueを読まず、診断groupも空にする。
- 実使用端末で報告された165件の同期失敗原因は未特定。2026.8.9-3は原因を推測修正せず、既存pendingのerrorを表示・コピー可能にする診断リリースである。

### identity、dedupe、merge precedence

- AreaCount identityは `date × sessionStartedAt × areaId × discountTime × demandCycle`。同じlocal／remote recordを1sampleにし、normalとsummerは別recordとして扱う。
- app側はrecordedAtが新しいrecordのcount・固定値を優先し、欠けたoptional detailを古いrecordから補完する。同一revisionでは詳細量の多い方を優先して不足項目を補い、同率なら安定fingerprintで決定する。
- DB側は遅れて届いた古いrecordedAtを無視する。同じrecordedAtでは既存固定値を保持し、欠けたJSON keyだけ補完する。ただしscale 9の `humanEvaluationDetails` はscale 5 envelopeより優先する。新しいrecordedAtでは新revisionの値を採用し、未送信の旧JSON keyを残す。
- Review19 identityは `date × demandCycle`。local／remote中央値履歴はcomplete・finalだけを1日1cycleへ統合し、完全なtieではremoteを採用する。人間rawと中央値auto評価はpayload内に共存し、相互に上書きしない。

### 端末内データbackfill

- 管理設定の「端末内データをSupabaseへ同期」で手動実行する。対象は統合cache、旧normal cache、旧summer cache、finalized day、Review19のday snapshot、daily session snapshot、確定済みcurrent session、およびlocalのcomplete・final Review19。
- future record、invalid date／area／count／timestamp／cycle、未測定、確定前UI state、fixed-time dataを除外する。複数保存元の同一recordは送信前にidentityで統合し、rich detailsを保持する。
- 送信はidempotent upsert。何度実行してもrow／中央値sampleを増殖させず、remote既存rowをnull detailで劣化させず、localデータは削除しない。
- 結果UIは残数／19:00の検出数、送信対象、成功、失敗、pendingを表示する。pending 0だけを「すべて同期済み」の条件とする。Supabase APIのため新規／更新を推測表示しない。

### SQL実行と実環境確認

- SQLは `supabase_area_count_records_cloud_sync_backup.sql` → `supabase_area_count_records_cloud_sync_migration.sql` → `supabase_area_count_records_cloud_sync_verify.sql` の順。旧clientの書込みを止めてから実行し、verify成功後に新アプリをdeployする。
- deploy後、実使用端末で新版を起動し、「端末内データをSupabaseへ同期」を実行して成功／失敗／pendingを確認する。
- 問題時は新アプリを停止／旧版へ戻してから `supabase_area_count_records_cloud_sync_rollback.sql` を使う。summer rowがある場合はrollbackを中止し、Review19 tableは削除せずprivate quarantineへrenameする。
- 利用者報告では、2026-08-11にcloud-sync migrationを実DBへ適用済みで、guard関数自体も正常。旧verify SQLだけが `pg_get_functiondef()` 内の改行位置に依存して誤失敗し、該当判定を手動修正するとverify全体が完走した。
- 2026.8.9-3のverifyは関数定義の空白・改行・インデントを正規化してから、final→partial禁止、古いrevision禁止、同一revision guard、partial→final例外の4条件を検査する。migration、guard runtime、schema、unique、RLS、rollbackは変更しない。
- この開発環境にはSupabase接続情報がないため、新verifyを実DBで再実行したとは報告しない。実端末の同期error本文を確認後に原因と次の修正を判断する。
- 20時30分の残数中央値、30/40/50型・40/50型・全品50型、1個・2個・3個以上ルールは変更しない。20時30分recordもcycleを保持して同期するが、人間9段階UIは追加しない。

## 確認コマンド

README記載の全 `check:*`（特に `check:supabase-sync-diagnostics`、`check:human-evaluation-9scale`、`check:review19-human-auto`、`check:supabase-sync-domain`、`check:review19-remote-storage`、`check:supabase-cloud-sync-sql`）、TypeScript型チェック、変更対象ESLint、`npm run build` を実行する。PWA生成物は `dist/manifest.webmanifest`、`dist/sw.js`、`dist/registerSW.js` を確認する。今回の実行結果は `CHANGE_REPORT_20260811_SUPABASE_SYNC_ERROR_DIAGNOSTICS.md` を参照する。
