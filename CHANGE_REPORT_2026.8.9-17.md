# 値引ヘルパー 2026.8.9-17 CHANGE REPORT

作成日: 2026-08-30（JST）  
基準: `2026.8.9-16`  
対象: 実端末に残ったlocalStorage quota圧迫の恒久対策  
`appVersion`: `2026.8.9-17`  
`buildId`: `build-20260830-112242-jst`  
`dataSchemaVersion`: `3`

> 容量値はkey＋valueのUTF-16概算である。実端末で得た値と匿名fixtureの値を明確に分ける。`navigator.storage.estimate()` はorigin全体の参考値であり、localStorage単独quotaとは扱わない。

## 1. 実端末事象と9-16で残ったroot cause

9-16 deploy後の実端末診断は、localStorage `6731.8 KiB`、soft budget `2304.0 KiB`、headroom `0.0 KiB`だった。上位は次の2 keyである。

- `daily-session-snapshots`: `4820.5 KiB / 86件 / 33 historical unfinalized dates`
- `area-count-records-v2`: `1839.6 KiB / 866件`

9-16でReview19／finalized-dayのIndexedDB移行は完了していたが、daily snapshot retentionは「IndexedDB finalized-dayでsealedと証明されたdate group」だけを整理対象にしていた。実端末の33日は、過去versionでformal finalized-dayを作らなかった、または20:30 finalizeを通らなかったため、すべて保護対象になった。snapshot自体は主にdone／auto transition時の履歴であり、33日すべてが現在進行中という意味ではない。`120件 / 512 KiB`はsoft budgetなので、保護groupを破棄して強制適用せず、結果として4.8 MiBが残った。

AreaCountの1 MiBも同様にauthoritative-aware soft budgetである。pending／current／local-only／remote未確認を上限だけで削除しないため、manual direct sync成功を永続的なremote-confirmation indexとして持たない866件は次回startupで再び保護され得た。`queue=0`をremote-confirmedとみなすことも禁止していたため、1.84 MiBが残った。

従ってroot fixは保護条件を弱めて古い正式データを消すことではなく、rich historical session／AreaCountをIndexedDBへ完全保持し、localStorageからhistorical copyだけを外すことである。

## 2. 採用したstorage設計

既存IndexedDB `nebiki-helper-historical-archive` をversion 2へ上げ、次のstoreを追加した。

- `daily-session-snapshots`
  - identity: `date × discountTime × sessionStartedAt`
  - snapshotのrateDecision、weather、calendar、area evidence、appVersion／buildId、end reason等を簡略化せず保存
- `area-count-records`
  - identity: 既存の `date × sessionStartedAt × areaId × discountTime × demandCycle`
  - revision／richness／normal-summer semanticsは既存mergeを再利用

IndexedDB version 1の既存 `review19`／`finalized-days` storeは変更しない。formal finalized-dayが0件でもsnapshotから架空の日次正式recordを生成しない。過去session evidenceはsnapshotのままarchiveする。

localStorageに残すもの:

- current date／current-session／checkpoint／Review19 sourceに対応する日付のoperational snapshotとAreaCount
- current-session、Review19入力復元、lightweight outbox、pending、skip、weather、日次設定
- quota recoveryに必要な小さなoperational state

IndexedDBへ移すもの:

- rich Review19正式履歴（9-16から継続）
- rich finalized-day正式履歴（9-16から継続）
- historical daily-session snapshots（9-17）
- historical AreaCount（9-17）

新規AreaCountはlocal-firstの現行日journalと既存pendingを先に確定する。現在日の履歴は小さく保ち、次回startupでarchiveへ移す。15時／17時のcritical pathへ新しい必須async archive writeを差し込まず、remote失敗でも現場入力を保持する。

## 3. 安全な9-16→9-17 migration

startup gate内で各legacy sourceを次の順に処理する。

1. localStorage sourceをread／normalizeする。
2. IndexedDBの既存canonical collectionとmergeする。
3. stable business identityでupsertする。
4. IndexedDBを再readする。
5. countだけでなくcanonical stable contentが期待値と一致することをverifyする。
6. verify成功後だけ、localStorage keyをcurrent／active protected date subsetへ置換する。protected subsetが0ならkeyをremoveする。
7. legacy normal／summer AreaCount keyも、全sourceをarchive検証した後だけremoveする。

protected dateはcalendar上の現在日だけでなく、`current-session`、`work-session-checkpoint`、`review19-source-state`内の日付も含む。

失敗時は旧sourceを削除しない。IndexedDB write／SecurityError／AbortError／read-back mismatch／local remove failureはstructured failureとなり、白画面にせず次回startupで同じidentityをidempotent retryする。archive commit後・local remove前に終了しても、次回upsertでduplicateを作らない。migration markerだけを根拠にremoveしない。

## 4. localStorage全key監査と9-17方針

| key／group | 分類 | 長期増加 | 9-17方針 |
|---|---|---:|---|
| `current-session` | operational authoritative | 1件 | 保護 |
| `work-session-checkpoint` | crash-recovery duplicate | 1件 | 通常維持。headroom低下時はcurrentを残して整理可 |
| `runtime-state` | derived navigation／undo | bounded | 24件上限、低headroom時整理可 |
| `review19-source-state` | current Review19 recovery | 1件 | 完了まで保護 |
| `daily-session-snapshots` | current-day operational journal | 旧版では無制限化 | historicalをIDBへ移しcurrent／active日だけ残す |
| `area-count-records-v2` | current-day local-first journal | 旧版では1 MiB超過可 | historicalをIDBへ移しcurrent／active日だけ残す |
| legacy normal／summer AreaCount | compatibility duplicate／source | 可 | archive verify後にremove。新規dual-writeなし |
| `review19-records` | legacy rich history | 無制限 | 9-16どおりIDB verify後remove。再materialize禁止 |
| `finalized-day-data` | legacy rich history | 無制限 | 9-16どおりIDB verify後remove |
| `pending-supabase-sync-v1` | operational outbox | 未送信分 | 保護。Review19 ref、AreaCount通常pending／legacy互換維持 |
| skip／weather／draft／message | operational small state | bounded | 維持 |
| demand-cycle／global-adjustment | date-scoped setting | 小 | production／fixed-time分離を維持 |
| fixed-time temperature | fixed-time operational | 日付単位 | 既存semantics維持 |
| obsolete mode keys | compatibility | 小 | 既存safe cleanupのみ |
| 未知の `nebiki-helper/*` | diagnostic対象 | 不明 | 値を表示・自動削除せずkey容量だけ可視化 |

application／hook／component層のraw `localStorage.setItem/removeItem` は0件。migrationの低レベルreplace/removeはreview済みdomain boundary内だけで、storage primitive allowlistは37箇所で固定した。

## 5. 履歴利用・export・cloud互換

- runtimeはIndexedDB archiveとcurrent local journalを既存identityでmergeし、同じrecordを中央値sampleへ二重投入しない。
- AreaCount online historyはSupabase full paged history＋archive／current localを既存engineへ渡す。remote full historyをlocalStorageへseedしない。
- offlineはIndexedDB AreaCount archiveを中央値、manual backfill、daySnapshot生成へ利用できる。
- daily snapshot consumers（temperature continuity、Review19 daySnapshot、productionAnalysis材料、legacy day export、manual backfill）はarchive＋current journalを参照する。
- 19:00全件、day、all-data、normal／summer exportは9-16のReview19／finalized archiveと9-17 snapshot／AreaCount archiveを使い、過去evidenceを失わない。
- Review19 remote full historyは引き続きlocalStorageへ再materializeしない。Review19 lightweight outbox／pendingなし正本direct sync／legacy full pending互換を維持する。
- AreaCount manual direct backfillはremote比較、最大100件memory batch、rich pending大量生成なし、legacy pending CASを維持する。

median auto、human raw9、even resolution、finalEvaluation、productionAnalysis、weather／temperature、normal／summer、holiday／day-before／three-day-middle／Obon、20:30 forced half-priceは変更していない。

## 6. 実端末相当容量fixture

実端末値へ合わせた匿名rich fixture:

- daily snapshots: `86件 / 33 historical dates + current protected / 4896.6 KiB`
- AreaCount: `866件 / 1808.4 KiB`
- finalized-day: `0件`
- pending: `0件`
- current-session: `あり`

| 指標 | migration前 | migration／housekeeping後 | 15時・17時各12エリア＋transition保存後 |
|---|---:|---:|---:|
| localStorage total | `6705.3 KiB` | `59.3 KiB` | `120.6 KiB` |
| soft budget | `2304.0 KiB` | `2304.0 KiB` | `2304.0 KiB` |
| headroom | `0 KiB` | `2244.7 KiB` | 最低 `2183.4 KiB` |
| IDB daily snapshots | 既存なし | `86件` | `86件`（current journalはidentity dedupe） |
| IDB AreaCount | 既存なし | `866件` | `866件`（新規currentはlocal-first journal） |
| IDB finalized-day | `0件` | `0件` | `0件` |

99.1%のlocalStorageを解放した。current日1 snapshot／1 AreaCountは意図的にlocalStorageにも残し、current operation保護をtestした。

360営業日fixtureは、formal finalized-dayが存在しない旧運用を含む `720 snapshots / 8640 AreaCount` をarchiveした。legacy localStorage sourceは `21354.1 KiB`、migration後は `0.0 KiB`、IndexedDB countは `720 / 8640 / finalized 0`。localStorageは日数比例で増えない。

既存historical long-run fixtureでは、Review19／finalized-dayを含むmigration前 `10237.1 KiB`、migration直後 `104.0 KiB`、追加180営業日後 `107.6 KiB`。archiveは最終 `482 Review19 / 360 finalized-day`で、17時AreaCount→Review19→20:30 finalizedのcritical sequenceもPASSした。

## 7. diagnostics拡張

管理設定の匿名diagnosticへ以下を追加した。

- IDB daily/session snapshot count
- IDB AreaCount count
- snapshot total／date／当日／active／historical formal-unfinalized／archive／local整理可能件数
- snapshot oldest／newest date
- AreaCount total／archive／current／pending／remote-confirmed／remote-unconfirmed／local整理可能件数
- offline minimum sampleのためlocalStorageへ残す件数（IDB archive採用後は0）

従来のlocalStorage total、2.25 MiB soft budget、headroom、top key sizes、Review19／finalized count、migration status、pending、origin参考estimateも維持する。payload、商品本文、credential、URL parameterは含めない。

## 8. migration failure／operational safety

自動testで次を確認した。

- IndexedDB write `SecurityError`: local snapshot／AreaCount原本を保持し次回retry成功
- transaction abort: 既存archive testで原本保持・retry成功
- daily／Area read-back mismatch: 対象localStorage原本を削除しない
- archive commit後／local remove前crash相当: 次回duplicateなしで完了
- local remove `SecurityError`: verified archiveとlocal原本を併存させ、次回安全に完了
- invalid source: normalize／verify失敗としてremoveしない
- current／checkpoint／Review19 sourceの日付: protected subsetとしてlocalに残す

移行できない環境ではデータを勝手に削除せず、legacy fallbackを使う。そのためsoft budgetまで必ず下げられるとは偽装せず、diagnosticにpartial／failureを残す。

## 9. DB／Supabase／schema

- Supabase migration／table／column／index／trigger／RLS／grant変更: `なし`
- service role client導入: `なし`
- root SQL artifact: 基準9-16 ZIPと `9/9 byte-identical`
- IndexedDB DB version: `1 → 2`（端末内archive store追加。Supabase migrationではない）
- 正式JSON schema: 変更なし
- `dataSchemaVersion`: `3`

## 10. test結果

- 全 `check:*`: `50/50 PASS`
- `check:operational-storage-headroom`: `7/7 PASS`
- historical archive: `13/13 PASS`
- historical long-run: `6/6 PASS`
- storage diagnostic: `15/15 PASS`
- Supabase sync domain: `23/23 PASS`
- Review19 archive／lightweight outbox／completion safety: `PASS`
- AreaCount direct backfill: `PASS`
- global discount adjustment／forced 50: `PASS`
- fixed-time READ ONLY／production WRITE isolation: `PASS`
- storage write boundary: `PASS`（application raw write 0）
- TypeScript／production build／PWA generateSW: `PASS`
- changed-file ESLint: `0 error`。既存 `react-hooks/exhaustive-deps` warning 4件のみ。

## 11. browser確認（390×844）

実ブラウザで確認済み:

- appVersion `2026.8.9-17`
- fresh `scrollY=0`、active element `BODY`
- summer OFF表示、全体値引補正 `-5 / なし / +5`
- document `scrollWidth=clientWidth=375`（横overflowなし）
- 管理設定を開き、localStorage total／budget／headroom、IDB 4 store count、snapshot／AreaCount詳細diagnosticを表示
- console error／warning `0`

実ブラウザでは大量fixture注入、人工Quota、15→17→Review19→20:30の全入力は実施していない。これらは上記の自動Storage fixture／domain testで確認した。実Supabase mutationも行っていない。

## 12. 実端末deploy後の確認点

1. 9-17をdeployし、アプリを1回起動してstartup migrationを完了させる。
2. 管理設定「端末保存容量を確認」でmigration=`complete`、IDB session／AreaCount count、localStorage total／headroomを確認する。
3. 期待値はhistorical snapshots／AreaCountがIDBへ移り、local keyがcurrent／active日だけになること。実端末固有の正確な件数は削除せずcanonical mergeするため、fixture値との一致を要件にしない。
4. 15時／17時の残数を保存し、次エリアへ進めることを確認する。
5. 19時Review19、可能なら20:30 finalizedを完了する。
6. Review19／day／all-data exportとmanual Supabase syncを必要に応じて確認する。

正式履歴を件数・期限だけで削除する処理は追加していない。最優先は、過去evidenceをIndexedDBへ保持しながらlocalStorageに十分なoperational headroomを戻すことである。
