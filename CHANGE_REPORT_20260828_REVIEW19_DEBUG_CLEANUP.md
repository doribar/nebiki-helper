# CHANGE REPORT — 2026-08-25 debug Review19 one-time cleanup

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260828-0927.zip`
- appVersion: `2026.8.9-15`
- buildId: `build-20260828-211234-jst`
- dataSchemaVersion: `3`
- 作業日: 2026-08-28（JST）

## 1. one-time cleanup概要

2026-08-25にデバッグ目的で保存された、全12エリアの残数が整数0のReview19 1件だけを端末から除去するstartup maintenanceを追加した。汎用DELETE機能ではない。ユーザーが日付やrecordを選ぶUI、恒久的な削除ボタン、DELETE APIは追加していない。

maintenanceはReview19の自動cloud retry／手動backfillより前に実行する。全対象sourceを読み取って安全条件と更新可否をpreflightし、safe storage boundaryで必要なkeyだけを書き換える。対象がなければwriteなしのno-opであり、次の通常releaseでmoduleとstartup呼び出しをまとめて外せるよう `src/domain/maintenance/cleanupReview19Debug20260825.ts` へ隔離した。

## 2. exact guard

端末側で削除対象と認める条件は、次のすべての完全一致である。

- Review19 recordである。
- `date = 2026-08-25`
- `demandCycle = summer`
- `sessionStartedAt = 2026-08-25T07:54:21.145Z`
- `appVersion = 2026.8.9-12`
- `review19Status = recorded`
- `areaCounts` のkeyが次の12個と完全一致し、各値が整数0である。

```text
bento_men
tempura
ryomi
croquette
fry_chicken
yakitori
chuka_fish
onigiri
sushi
futomaki_chumaki
inari
hosomaki
```

日付／cycle／cloud business identityだけでは削除しない。1エリアでも欠損、追加、0以外、非整数なら対象外である。

## 3. local Review19 authoritative cleanup

`nebiki-helper/review19-records` はraw arrayを保ったまま対象だけをfilterする。専用fixtureでは6件中1件だけを削除し5件となり、残り5件のJSONはcleanup前後で一致した。対象外recordをnormalizerで再生成しないため、revision、timestamp、optional metadataを副作用で変更しない。

## 4. pending / outbox cleanup

`nebiki-helper/pending-supabase-sync-v1` は次の2形式を別々に判定する。

- `review19_ref_v1`: complete値を問わず、date、cycle、sessionStartedAtまで完全一致するreferenceだけを除去。入力途中に作られた同一sessionのstale referenceも残さない。
- legacy full-payload pending: payloadを既存normalizerで読み、exact identity、appVersion、recorded、12エリアall-zeroを再確認できるものだけを除去。

同じdate／cycleでもsessionStartedAtが異なるReview19 referenceは維持する。AreaCount pendingはtypeで分離し、配列内容を一切変更しない。

## 5. current / checkpoint / source-state cleanup

次のsourceに対象Review19が実在する場合だけ、そのAppStateの `review19` を `null` にする。

- `nebiki-helper/current-session`
- `nebiki-helper/work-session-checkpoint`
- `nebiki-helper/review19-source-state`
- `nebiki-helper/runtime-state` のundo snapshot／screen history内state

Review19画面を指しているcopyだけは安全な `screen=start` へ戻す。session、weather、AreaCount、その他stateはspread保持し、key全体や2026-08-25の日全体を削除しない。対象が存在しないsourceにはwriteしない。

## 6. finalized day内review19Check cleanup

`nebiki-helper/finalized-day-data` では、親dayのdate／cycleと埋め込み `review19Check` のsessionStartedAt／appVersion／status／12エリアall-zeroが全て一致する場合だけ、`review19Check` propertyを除去する。day recordそのものは維持し、`review19Status` を `not_performed` に直す。

以下はそのまま保持する。

- 15時／17時を含む `sessions`
- `areaCountRecords`
- memo、discardCount
- recordId、finalizedAt
- calendar／weather／globalDiscountAdjustment等の日次metadata

## 7. productionAnalysis再構築

finalized dayから対象Review19を外す際は、既存の `buildProductionAnalysis` を正本として、元の15時／17時sessionsとAreaCount recordsを渡し、19時Review19だけを未指定として再構築する。fixtureでは15時・17時checkpointが `recorded` のまま、19時だけ `session_missing` となり、`productionShortageSuspicion` は既存semanticsどおり `insufficient` になった。15時／17時evidenceやevaluation sourceを丸ごと削除しない。

## 8. 再出現防止

Review19のlocal sourceを列挙し、authoritative records、pending、current-session、checkpoint、Review19 source state、runtime navigation copy、finalized dayのうち、対象Review19本体を持ち得るsourceだけをcleanup対象にした。Review19本体を持たないdaily session snapshot等は変更していない。

さらに、管理者がSupabase側を削除する前に同じremote rowがSELECTで返っても、remote merge直前に同一exact guardで除外する。cleanup後のReview19 export／day export／all-data exportおよびmanual Review19 direct sync sourceに対象は残らない。

## 9. idempotencyと通知

1回目に対象があれば必要なsourceだけを更新する。2回目以降は対象が存在しないためwriteなしのno-opになる。cleanup済みmarkerは不要で、marker自体によるstorage増加もない。

全preflightと全storage writeが成功し、1件以上の対象copyを実際に除去した場合だけ、次の通知を一度表示する。

```text
2026/8/25のデバッグ用19:00チェックを端末から削除しました。
```

storage writeが1つでも失敗した場合は成功通知を出さず、次回startupでexact guardにより安全に再試行できる。storage例外はReactへthrowせず、既存structured resultで扱う。`localStorage` getterそのものが `SecurityError` を投げる制限環境も取得段階で捕捉し、初回renderを白画面化しない。

## 10. 対象外データの保護

2026-08-25の15時／17時AreaCount、通常値引session、率snapshot、天候、calendarContext、globalDiscountAdjustmentPercent、memo、discardCount、他日Review19、全AreaCount、AreaCount pendingはcleanup対象外である。fixtureではfinalized dayのsessions／areaCountRecordsと主要metadataがcleanup前後で一致し、AreaCount pendingもdeep equalだった。

## 11. 既存機能への影響

- 9-14 AreaCount manual direct backfill: 最大100件memory batch、rich pending新規作成0、legacy pending互換を変更しない。
- 9-13 Review19 lightweight outbox: `review19_ref_v1`、pendingなし正本direct sync、legacy full-payload互換を維持する。exact debug targetだけを除く。
- 全体値引補正: -5／0／+5 percentage points、forced 50除外、date reset、session capture、fixed-time別settingを変更しない。
- fixed-time: production Supabase AreaCount READ ONLYとproduction WRITE隔離を変更しない。
- 9-12 storage safety: AreaCount bounded cache、authoritative／pending／remote未確認／current保護、startup housekeeping、quota recovery最大1回、application raw storage write 0を維持する。
- median、human raw9、finalEvaluation、productionAnalysisの通常semantics、normal／summer、holiday／Obon、weather、20時30分を変更しない。

## 12. DB / schema / SQL artifact

DB migration、table、column、index、trigger、unique key、RLS、grantを変更していない。特にanon clientへ `review19_records` のDELETE権限を追加していない。アプリへservice role credentialも追加していない。

今回のdiagnostic cleanupは一時的な端末maintenanceで正式record schemaを変更しないため、`dataSchemaVersion = 3` を維持する。既存Supabase SQL artifactは編集対象外であり、基準9-14とbyte-identicalであることを最終package検証で確認する。

## 13. Supabase管理者用 確認SELECT

以下はmigrationではない。Supabase SQL Editorで管理者が今回だけ実行するmaintenance SQLである。payload本文は返さず、guard対象metadataと一致件数だけを確認する。

```sql
with candidate as materialized (
  select id, date, demand_cycle, session_started_at, app_version, is_complete, recorded_at
  from public.review19_records
  where date = '2026-08-25'
    and demand_cycle = 'summer'
    and session_started_at = '2026-08-25T07:54:21.145Z'
    and app_version = '2026.8.9-12'
    and is_complete is true
    and recorded_at is not null
    and payload ->> 'date' = '2026-08-25'
    and payload ->> 'demandCycle' = 'summer'
    and payload ->> 'sessionStartedAt' = '2026-08-25T07:54:21.145Z'
    and payload ->> 'appVersion' = '2026.8.9-12'
    and payload ->> 'review19Status' = 'recorded'
    and payload #>> '{dataQuality,complete}' = 'true'
    and payload -> 'areaCounts' = jsonb_build_object(
      'bento_men', 0,
      'tempura', 0,
      'ryomi', 0,
      'croquette', 0,
      'fry_chicken', 0,
      'yakitori', 0,
      'chuka_fish', 0,
      'onigiri', 0,
      'sushi', 0,
      'futomaki_chumaki', 0,
      'inari', 0,
      'hosomaki', 0
    )
)
select
  count(*) as matching_rows,
  coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'demand_cycle', demand_cycle,
      'session_started_at', session_started_at,
      'app_version', app_version,
      'is_complete', is_complete,
      'recorded_at', recorded_at
    )),
    '[]'::jsonb
  ) as matching_records
from candidate;
```

`matching_rows` が正確に `1` でない場合は、次のDELETEを実行しない。

## 14. Supabase管理者用 guarded DELETE

DELETE自身もcandidateが正確に1件の場合だけ動作し、0件または複数件なら削除しない。実行後は `returning` 相当の結果が1行であることを確認する。

```sql
with candidate as materialized (
  select id
  from public.review19_records
  where date = '2026-08-25'
    and demand_cycle = 'summer'
    and session_started_at = '2026-08-25T07:54:21.145Z'
    and app_version = '2026.8.9-12'
    and is_complete is true
    and recorded_at is not null
    and payload ->> 'date' = '2026-08-25'
    and payload ->> 'demandCycle' = 'summer'
    and payload ->> 'sessionStartedAt' = '2026-08-25T07:54:21.145Z'
    and payload ->> 'appVersion' = '2026.8.9-12'
    and payload ->> 'review19Status' = 'recorded'
    and payload #>> '{dataQuality,complete}' = 'true'
    and payload -> 'areaCounts' = jsonb_build_object(
      'bento_men', 0,
      'tempura', 0,
      'ryomi', 0,
      'croquette', 0,
      'fry_chicken', 0,
      'yakitori', 0,
      'chuka_fish', 0,
      'onigiri', 0,
      'sushi', 0,
      'futomaki_chumaki', 0,
      'inari', 0,
      'hosomaki', 0
    )
), singleton as (
  select min(id) as id
  from candidate
  having count(*) = 1
), deleted as (
  delete from public.review19_records as r
  using singleton as s
  where r.id = s.id
  returning
    r.id,
    r.date,
    r.demand_cycle,
    r.session_started_at,
    r.app_version,
    r.is_complete,
    r.recorded_at
)
select * from deleted;
```

Codexは実DBへSELECT／DELETEを実行していない。

## 15. 推奨実施順

1. `2026.8.9-15` をdeployする。
2. 実使用端末でアプリを一度起動し、local cleanupの成功通知を確認する。
3. 管理設定の「19:00チェックデータを全件出力」で対象が消え、対象を含む6件だった場合は5件になったことを確認する。
4. Supabase SQL Editorで上記確認SELECTを実行する。
5. `matching_rows = 1` とmetadataが対象に一致することを確認する。1件でなければ停止する。
6. 上記guarded DELETEを実行する。
7. DELETE結果が正確に1行であることを確認する。
8. アプリを再起動する。
9. 必要なら管理設定の手動Supabase同期を1回実行する。
10. Review19全件exportとSupabase確認SELECTで対象が再出現しないことを確認する。

localを先にcleanupすることで、アプリが対象remote rowを再送する経路を断ってから管理者DELETEできる。

## 16. tests

専用 `check:review19-debug-cleanup` はA〜TをPASSした。

- 6件→5件、残り5件不変。
- 1エリア非0／欠損、date／cycle／sessionStartedAt／appVersion違いの非削除。
- target reference／legacy payloadだけ削除、AreaCount pending不変。
- current／checkpoint／source-state／runtimeはReview19部分だけ除去。
- finalized day本体、15時／17時、AreaCount、memo、discardCount、recordId、finalizedAtを維持。
- productionAnalysisは15時／17時を維持し19時だけ不足。
- 2回目no-op。
- Review19 all export 5件、day／all-data exportに対象なし。
- manual Review19 direct syncは残り5件だけをsourceとし、対象を再送しない。
- storage `SecurityError` はstructured failureとなりthrowしない。

回帰確認済み：

- `check:review19-lightweight-outbox`: 9/9 PASS
- `check:area-count-direct-backfill`: 10/10 PASS
- `check:global-discount-adjustment`: 10/10 PASS
- `check:quota-root-fix`: 10/10 PASS
- `check:long-run-storage-safety`: PASS
- `check:fixed-time-supabase-read`: 7/7 PASS
- `check:review19-completion-safety`: 16/16 PASS
- `check:review19-storage-diagnostics`: 10/10 PASS
- `check:storage-write-boundary`: application-layer raw write 0、review済み34 call site
- TypeScript `tsc -b`: PASS

- 全 `check:*`: 46/46 PASS。
- changed-file ESLint: exit 0、error 0。`useNebikiApp.ts` の今回と無関係な既存 `react-hooks/exhaustive-deps` warning 4件は基準挙動のまま。
- TypeScript: PASS。
- production build: PASS。固定識別情報 `2026.8.9-15` / `build-20260828-211234-jst` をbundle内でも確認。
- PWA `generateSW`: PASS。`dist/manifest.webmanifest`、`dist/registerSW.js`、`dist/sw.js`、`dist/workbox-9c191d2f.js` を生成。
- production buildには500 KiB超chunkの既存size warning 1件があるが、build失敗／runtime console warningではない。

## 17. browser確認

390×844のin-app browserで次を実確認した。

- 最終production build: `appVersion 2026.8.9-15`、`build-20260828-211234-jst`、schema 3。
- fresh起動は `scrollY=0`、active elementはBODY、document-level横overflowなし（innerWidth 390 / scrollWidth 375）。
- topにversion、summer OFF、全体値引補正 -5／なし／+5を表示。管理設定を正常に開ける。
- 匿名Review19 6件（通常fixture 5件＋exact target 1件）をlocal dev originへ投入して起動すると成功alertが発生し、管理設定の件数が6→5になった。
- その後reloadするとalertは再表示されず、件数5を維持したためstartup maintenanceのidempotent no-opを確認した。
- production previewとfixture確認のpage consoleはerror 0 / warning 0。実Supabase DELETEは行っていない。

## 18. HANDOFF更新

既存の「値引ヘルパーの運用目的」と9-14までのstorage／sync仕様を残し、debug recordのexact identity、9-15 one-time local cleanup、15時／17時非削除、管理者SQLによるSupabase 1行削除、次releaseでmaintenanceを削除可能であることを追記した。

## 19. appVersion / buildId / schema

- appVersion: `2026.8.9-15`
- buildId: `build-20260828-211234-jst`
- dataSchemaVersion: `3`
