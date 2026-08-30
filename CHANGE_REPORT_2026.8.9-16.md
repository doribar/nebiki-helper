# 値引ヘルパー 2026.8.9-16 CHANGE REPORT

作成日／検証更新: 2026-08-30（JST）  
基準: `2026.8.9-15`  
対象: localStorage QuotaExceededError恒久対策  
`dataSchemaVersion`: `3`（正式record／Supabase schemaは変更しない）

> 検証状態の表記: 自動testと実施済みbrowser確認は2026-08-30時点の実測だけを記載する。実browserで未実施のflowと、最終production rebuild／ZIP生成後に確定する識別情報はその旨を明記し、推定値をtest結果として記載しない。

## 1. 実端末事象とroot cause

確認済みの実端末事実:

- 9-14のAreaCount manual direct backfillは、source 878件に対してremote送信不要338件、direct送信540/540件、queue 0まで完了した。
- それでも2026-08-28の通常17時に新規AreaCount 1件、同日19時に12/12 Review19正本1件が `QuotaExceededError` となった。
- Android本体容量ではなく、browser origin／localStorage quotaであることは9-11の診断で確認済みである。

コード監査で残っていた長期増加経路:

1. `nebiki-helper/review19-records` がrich Review19正式履歴を配列で長期保持していた。
2. Supabaseからnormal／summerのfull Review19を取得するたび、local＋remoteをmergeして同じkeyへ全remote populationを再materializeしていた。
3. `nebiki-helper/finalized-day-data` がrichな日次正式記録を配列で無制限に蓄積していた。
4. AreaCount 1 MiB cacheとdaily snapshot 1 MiB cacheが個別budgetだけを持ち、localStorage全体のwrite headroomを保証していなかった。
5. current-session、checkpoint、runtime navigation等にrich operational stateの重複があり、runtime履歴の長期増加余地があった。

対策は古い正式recordを期限で削除するものではない。rich historical authoritative dataをIndexedDBへ保存し、localStorageを進行中業務・crash recovery・軽量outbox・bounded offline cacheへ限定した。

## 2. localStorage key棚卸し

容量はkey＋valueのUTF-16 code unitを2 bytesとして概算する。管理診断も同じ定義を使い、payload本文は表示しない。

| key | 分類 | current operation | remote／archive復元 | duplicate／増加性 | 9-16の保持方針 |
|---|---|---:|---:|---|---|
| `current-session` | operational authoritative crash recovery | 必須 | 不可 | rich・1件 | 保護。自動削除しない |
| `work-session-checkpoint` | operational duplicate | 補助 | currentから一部再構築可能 | rich・1件 | headroom低下時はcurrentを残して整理可能 |
| `runtime-state` | derived navigation／undo | 補助 | 業務正本から再構築可能 | rich history | 永続historyを最新24件へ制限。headroom低下時に整理可能 |
| `next-session-skip-records` | operational | 必要 | 不可 | 小、identity dedupe | 維持 |
| `last-session-weather` | operational continuity | 必要 | 部分的 | 小・1件 | 維持 |
| `last-used-session-draft` | operational UX | 必要 | 不可 | 小・1件 | 維持 |
| `daily-message-state` | operational UI | 必要 | 不可 | 小・1件 | 維持 |
| `review19-source-state` | current Review19 recovery | Review19中は必須 | archive済みなら補助 | rich・1件 | currentを保護。完了後cleanup |
| `review19-records` | 旧Review19 authoritative history | migration中のみ | IndexedDB／Supabase | rich・無制限 | verify済みmigration後に削除。新規appendしない |
| `daily-session-snapshots` | intermediate evidence／offline cache | current／unfinalizedは必須 | finalized archiveでsealed日だけ復元可能 | rich・旧最大120件 | 最大120件を維持しつつ512 KiB soft budget。current／unfinalized保護、archive検証済みsealed date groupだけprune |
| `final-day-auto-export-dates` | operational marker | 必要 | 再構築困難 | 小 | 維持 |
| `finalized-day-data` | 旧finalized authoritative history | migration中のみ | IndexedDB | rich・無制限 | verify済みmigration後に削除。新規appendしない |
| `area-count-records-v2` | local authoritative＋bounded offline cache | 必須 | remote-confirmed部分のみSupabase | rich・1 MiB budget | 9-12のpending／current／local-only／remote未確認保護を維持 |
| `area-count-records` | legacy normal compatibility | 不要になり得る | unifiedで完全包含時のみ | duplicate | 完全包含を証明できた場合だけcleanup |
| `summer-area-count-records-v1` | legacy summer compatibility mirror | 不要になり得る | unifiedで完全包含時のみ | duplicate | 新規dual-writeなし。完全包含時だけcleanup |
| `pending-supabase-sync-v1` | operational outbox | 必須 | 不可 | 未送信件数に応じる | 保護。Review19新規itemはlightweight ref、AreaCount manual backfillはdirect |
| `demand-cycle-state-v1` | production day setting | 必須 | 不可 | 小・date scoped | 維持 |
| `fixed-time-demand-cycle-state-v1` | fixed-time setting | fixed時必須 | 不可 | 小 | productionと隔離して維持 |
| `global-discount-adjustment-v1` | production day setting | 必須 | 不可 | 小・date scoped | 維持 |
| `fixed-time-global-discount-adjustment-v1` | fixed-time setting | fixed時必須 | 不可 | 小 | productionと隔離して維持 |
| `fixed-time-temperature-by-date-v1` | fixed-time operational memory | fixed時必要 | 不可 | by-date map | 既存semantics維持 |
| `app-mode-v1` / `simple-mode-state-v1` | obsolete compatibility | 不要 | 不要 | 小 | 診断対象として可視化。既存safe cleanup以外で触らない |

全keyの修正前fixture実測top 5:

1. `nebiki-helper/finalized-day-data` / `4918.1 KiB`
2. `nebiki-helper/review19-records` / `4875.5 KiB`
3. `nebiki-helper/area-count-records-v2` / `277.7 KiB`
4. `nebiki-helper/current-session` / `68.5 KiB`
5. `nebiki-helper/daily-session-snapshots` / `36.2 KiB`

修正後fixtureのtop 5とtotalは「容量実測」節へ記載する。

## 3. IndexedDB historical archive

実装:

- database: `nebiki-helper-historical-archive`
- database version: `1`
- store: `review19`
- store: `finalized-days`
- Review19 operation key: JSON tuple `[date, demandCycle, sessionStartedAt]`
- finalized day key: `date`
- finalized day `recordId` indexを保持

Review19は同operation identityでfinal、complete、sourceUpdatedAt、richnessの順に既存canonical evidenceを優先する。median／cloud側のbusiness canonicalは既存どおりdate×demandCycleを使用し、archiveのoperation keyをremote row増殖へ使わない。

finalized dayは1日1正式record、recordId、finalizedAt、memo、discardCount、sessions、areaCountRecords、review19Check、productionAnalysis、weather／calendar／全体値引補正metadataを省略せず保存する。date／recordId metadata patchの外部semanticsも維持する。

IndexedDB archiveは長期履歴として増えることを許容する。localStorage quota回避のために過去正式履歴を捨てる設計ではない。

## 4. 9-15 localStorageからの安全なmigration

起動順:

1. production Appをhistorical archive gateで待機させる。
2. 旧Review19／finalized-day keyをread・normalizeする。
3. 既存archive内容とcanonical mergeした期待値を作る。
4. IndexedDBへupsertする。
5. archiveを再readする。
6. stable canonical contentと件数が期待値と一致するかverifyする。
7. verify成功後だけ該当旧localStorage keyをremoveする。
8. archive snapshotをhydrateし、履歴依存UI／cloud retryを開始する。

失敗時:

- invalid record、IndexedDB open／write／read／verify／transaction abort／SecurityErrorでは旧localStorage原本を削除しない。
- migration markerだけでremoveしない。
- structured failureをruntime／管理診断へ渡し、白画面にしない。
- 次回startupに同じidentityで再試行できる。
- archive commit後・legacy remove前に終了しても、次回canonical upsertでduplicateを作らず完了できる。
- IndexedDB unavailable／partial時は旧localStorage内容をfallbackとして読み、0件表示や履歴欠落を避ける。

自動test結果:

- 正常migration: `PASS`（Review19／finalized dayをarchiveへ移し、再read verify後だけlegacy sourceをremove）
- write失敗: `PASS`（両legacy sourceを保持し、同identityでretry可能）
- verify不一致: `PASS`（`ArchiveVerificationError`としてsourceを保持）
- transaction abort: `PASS`（sourceを保持し、retry成功後だけremove）
- SecurityError: `PASS`（sourceを保持し、sanitized `errorName`を返す）
- commit後remove前crash/idempotency: `PASS`（再実行でduplicateを作らない）

`check:historical-archive` は上記に加え、remote cacheと現場完成保存の同時mutationでも新しい完成evidenceが退行しないことを含む13/13件がPASSした。archiveのReview19 read／canonical merge／write区間は直列化し、同一operationへの競合を防ぐ。

## 5. Review19 save／median／cloud

- Review19完成はIndexedDB authoritative saveを先に行う。archive成功前はdoneへ進まず、12/12入力stateを保持する。
- authoritative archive成功後に既存 `review19_ref_v1` をenqueueする。outbox失敗はarchive失敗と区別し、authoritative recordを失わない。
- pending retry／manual syncはarchiveをbusiness identityで検索してrich payloadを解決する。legacy full-payload pendingとmigration fallbackも維持する。
- Supabase full Review19 historyはmemory＋IndexedDBへcanonical mergeし、`review19-records` localStorageへ全件書き戻さない。
- remote archive cacheと現場のReview19完成保存が同時発生しても、archive mutationを直列化し、古いremote snapshotで完成recordを上書きしない。
- online medianはarchive local authoritative＋remote historyを既存date×cycle canonical mergeへ渡す。offlineはIndexedDB archiveを使用する。
- human raw9、auto evaluation、finalEvaluation、productionAnalysis、normal／summer separationを変更しない。
- pending read／flush自体が例外になった場合は「0件成功」と扱わず失敗をsummaryへ残す。remote history hydrationにもmetadata-onlyのcatchを設け、未処理Promise rejectionをReactへ漏らさない。

remote Review19 100件以上のrematerialization test:

- remote返却件数: `120件`
- `review19-records` localStorage増加: `0.0 KiB`（legacy keyは再生成されず、localStorage totalもbyte-identical）
- median population／判定同値: migration前後の判定は`deepEqual`で同値。remote archive hydrate後のruntime populationは`302件`で、normal／summer operation identityも分離した。

## 6. finalized day／snapshot／export

- 20:30 finalized dayのauthoritative saveとmetadata patchをIndexedDBへ変更した。archive保存失敗時に偽の完了へ進まない。
- IndexedDBでverify済みのfinalized dateだけをdaily snapshotのsealed evidenceに登録する。
- daily snapshotは最大120件の互換上限に加え512 KiB soft budget。current date、unfinalized date、crash recoveryに必要なdate groupを保護し、sealed date groupを日単位で整理する。
- 19:00全件、day、all-data、normal／summer exportはarchive ready後にarchive＋必要なlegacy snapshotをcanonicalに取得する。async archive化で0件raceを起こさないよう、App gate／await経路を使う。
- previous finalized day metadata、memo、discardCount、recordId patchをarchiveから解決する。

移行前後canonical export比較:

- Review19全件: `PASS`（180件のcycle別payloadがmigration前後で`deepEqual`）
- day export: `PASS`（finalized-day 180件のcycle別payloadがmigration前後で`deepEqual`）
- all-data: `PASS`（Review19／finalized-dayのcanonical metadataを保持）
- normal／summer分離: `PASS`（cycle別export 7/7件、archive operation identity分離も確認）
- offline archive export／previous-day metadata: `PASS`（remoteなしのarchive初期化後もexport／medianを保持し、metadata patchはrich core／stable identityを維持）

## 7. localStorage全体soft budget／headroom

定数:

- aggregate soft budget: `2.25 MiB`（key＋value UTF-16概算）
- reserved operational headroom: `256 KiB`
- daily snapshot budget: `512 KiB`
- AreaCount budget: 既存 `1 MiB`
- persisted runtime navigation history: 最新`24`件

critical writeはbudget−headroomを超えるとき、write前にsafe housekeepingを実施する。対象は完全包含legacy mirror、archiveでsealed済みsnapshot、rebuild可能runtime、duplicate checkpoint、9-12 semanticsでremote-confirmedと証明されたAreaCount cache余剰に限定する。cleanup後のwriteも失敗した場合のquota retryは従来どおり最大1回である。

自動削除禁止:

- current session／current Review19
- local-only authoritative record
- pending未送信recordの唯一の正本
- remote未確認AreaCount
- unfinalized day
- migration未検証archive copy
- memo／discardCountの唯一の正式記録

soft budgetはブラウザのlocalStorage quota値を意味しない。`navigator.storage.estimate()` もorigin全体の参考値としてだけ表示する。

## 8. storage diagnostic

管理設定の「端末保存容量を確認」は次を匿名表示する。

- nebiki-helper localStorage total KiB
- 2.25 MiB soft budgetとheadroom
- key別top sizes／record count／read failureのerrorName
- IndexedDB Review19 count／finalized-day count
- migration status
- pending queue count
- current session／Review19 source／unfinalized snapshot保護の有無
- origin usage／quota estimate（localStorage quotaではない旨を明記）

匿名diagnostic JSONへvalue、record本文、商品payload、credential、URL parameterを含めない。

## 9. 容量実測

比較条件: anonymous rich fixture。180営業日分のReview19 180件（normal 144／summer 36）とfinalized day 180件、AreaCount 240件、daily snapshot 12件、current-session／work-session-checkpoint各1件、lightweight pending 1件を使用した。容量はlocalStorage key＋valueのUTF-16概算で、archiveはin-memory IndexedDB adapter相当を用いた。

| 指標 | 9-15相当 | 9-16 migration／housekeeping後 | 差 |
|---|---:|---:|---:|
| nebiki-helper localStorage total | `10211.5 KiB` | `417.9 KiB` | `-9793.6 KiB / 95.9%解放` |
| Review19 legacy key | `4875.5 KiB / 180件` | `0.0 KiB / 0件` | `100.0%解放` |
| finalized-day legacy key | `4918.1 KiB / 180件` | `0.0 KiB / 0件` | `100.0%解放` |
| daily snapshots | `36.2 KiB / 12件` | `36.2 KiB / 12件` | `0.0%` |
| AreaCount cache | `277.7 KiB / 240件` | `277.7 KiB / 240件` | `0.0%` |
| IndexedDB Review19 | 該当なし | `180件`（adapter内byte sizeは非計測） | 履歴保持 |
| IndexedDB finalized day | 該当なし | `180件`（adapter内byte sizeは非計測） | 履歴保持 |

migration直後のtop 5は、AreaCount `277.7 KiB`、current-session `68.5 KiB`、daily snapshots `36.2 KiB`、work-session-checkpoint `35.3 KiB`、pending `0.2 KiB`だった。旧Review19／finalized-day keyはtop listから消えた。

180営業日fixture:

- Review19 archive count: 初回migration `180件`、normal／summer同session 2件とremote 120件、追加180営業日後の最終値 `482件`
- finalized-day archive count: 初回migration `180件`、追加180営業日後の最終値 `360件`
- historical export count: 初回Review19 `180件`／finalized day `180件`を保持し、cycle別payloadはmigration前後で`deepEqual`
- localStorage収束値: critical operation後 `421.4 KiB / 0.412 MiB`。さらに180営業日をarchiveへ追加した後も`421.4 KiB`でbyte-identical
- peak localStorage: migration前 `10211.5 KiB / 9.972 MiB`。migration後のcritical operationを含むpeakは`421.4 KiB`
- IndexedDB history増加: 初回 `180 Review19 / 180 finalized day`から最終 `482 / 360`（`+302 / +180`）。localStorageは増加しない
- 17時AreaCount→Review19→20:30 finalized save: `PASS`（migration直後、2.25 MiB capacity設定下でAreaCount正本＋outbox、Review19 archive＋lightweight outbox、finalized archiveが成功）

上記値は実端末quotaではなく匿名fixture実測である。実端末では管理診断のtotal／headroom／top key／migration status／archive countを確認する。

## 10. 旧9-15 one-time maintenanceの完了・撤去確認

- `cleanupReview19Debug20260825.ts`を削除。
- startup one-time cleanup callを削除。
- 2026-08-25専用remote exclusion／target guardを削除。
- 汎用delete UI／APIは追加しない。
- 15時／17時AreaCount等の通常業務データを変更する処理はない。

9-15でlocal export 6→5、Supabase `matching_rows=0` が確認済みであるため、9-16は同日を特殊扱いしない。この節は完了済み作業の監査記録であり、deploy後にmaintenanceやDELETE SQLを再実行する手順ではない。

## 11. 回帰影響

- AreaCount: 9-12のremote-confirmed 1 MiB bounded cache、local／remote dedupe、offline minimum sample、local-only／pending／current／remote未確認保護を維持。
- manual sync: 9-14のremote比較、最大100件memory batch、direct upload、rich pending大量生成なし、legacy pending CASを維持。
- Review19: lightweight outbox、legacy pending、pendingなし正本direct sync、storage diagnosticsを維持。
- 値引: 中央値、human raw9、even resolution、finalEvaluation、productionAnalysisを変更しない。
- 全体値引補正: −5／0／＋5 percentage points、forced 50除外、date reset、session capture、fixed-time隔離を維持。
- calendar/weather: normal／summer、holiday、day-before-holiday、three-day-middle、Obon、weather／temperatureを変更しない。
- fixed-time: production Supabase AreaCount READ ONLY、production WRITE／pending／Review19／finalized／learning population WRITE禁止を維持。
- 20:30: 既存fixed half-price／30・40・50／40・50／all50を維持。

回帰test結果: `全check:* 49/49 PASS`。TypeScript／production buildもPASS、変更23 TS/TSXファイルのESLintは0 error（既存`react-hooks/exhaustive-deps` warning 4件）だった。

## 12. DB／Supabase／schema

- Supabase migration: なし
- table／column／index／trigger／RLS／grant変更: なし
- service role client導入: なし
- SQL artifact byte comparison: `PASS`。rootの9 SQL artifactはnominal 9-15 source directoryおよびauthoritative baseline ZIPと9/9 byte-identicalで、追加／削除／不一致は0件（明示byte比較＋SHA-256比較）。
- `dataSchemaVersion`: `3`

IndexedDBは端末内storage backendであり、Supabase schema migrationではない。

## 13. tests／build／browser

### 自動test

| 項目 | 結果 |
|---|---|
| historical archive／migration | `PASS 13/13`（同時mutation退行防止を含む） |
| Review19 archive cloud source | `PASS 6/6` |
| finalized-day archive／patch | `PASS`（archive patch＋finalized-day 11/11） |
| remote Review19 non-rematerialization | `PASS`（120件、localStorage増加0.0 KiB） |
| migration failure／crash idempotency | `PASS`（write／SecurityError／abort／verify mismatch／remove failure／crash） |
| near-quota 17→19→20:30 | `PASS`（archive long-run critical write sequence） |
| 180営業日long-run | `PASS 6/6` |
| offline archive median／export | `PASS`（archive初期化後もmigration前とdeepEqual） |
| storage diagnostic | `PASS 15/15` |
| AreaCount direct backfill | `PASS 10/10` |
| Review19 lightweight outbox | `PASS 9/9` |
| quota-root-fix／long-run-storage-safety | `PASS 10/10＋4 scenarios` |
| global adjustment／forced50 | `PASS 10/10` |
| fixed-time READ ONLY／WRITE isolation | `PASS 7/7` |
| storage write boundary | `PASS`（review済み35 call sites、application-layer raw call 0） |
| 全 `check:*` | `49/49 PASS` |
| TypeScript | `PASS`（`npm run build`内の`tsc -b`） |
| changed-file ESLint | `PASS`（23 TS/TSX、0 error、既存hook warning 4） |
| production build | `PASS`（98 modules。596.43 kBのVite advisoryのみ） |
| PWA generateSW | `PASS`（`manifest.webmanifest`／`sw.js`／`registerSW.js`生成） |

### Browser 390×844

- archive migration fixture／reload: 実browserでは未実施（自動testでmigration／idempotent reloadを確認）
- version／summer-normal／全体値引補正／fresh scroll: `PASS`（`2026.8.9-16`、summer OFF、全体値引補正表示、`scrollY=0`、`activeElement=BODY`）
- storage diagnostic表示／JSON copy: 最終distで表示`PASS`（fresh originのtotal `5.3 KiB`、budget `2304.0 KiB`、headroom `2298.7 KiB`、archive `0/0`、migration complete、pending 0、current yes、unfinalized 0、origin参考値の注記あり）。JSON copy操作は未実施
- Review19件数／export: 実browserでは未実施（自動testのみ）
- 17時→19時→20:30 flow: 実browserでは未実施（自動testのみ）
- horizontal overflow: `PASS`（document／dialogともoverflowなし。`innerWidth=390`、`clientWidth=375`、`scrollWidth=375`）
- console error／warning: `0 / 0`
- 実browserへの人工Quota注入: 未実施

## 14. version／build／成果物

- `appVersion`: `2026.8.9-16`
- `buildId`: `build-20260830-093910-jst`
- `dataSchemaVersion`: `3`
- CHANGE REPORT: `CHANGE_REPORT_2026.8.9-16.md`
- ZIP: `C:\Users\s0a6g\Documents\Codex\2026-07-18\step-1-2-3-4-5\outputs\nebiki-helper-20260830-0944.zip`
- SHA-256: `6b4a305b0757858a4e078155a0d035f8a8d726a9c0db4cf9bd2d5565c946314c`（生成済みZIP本体を再open・検査後に算出。同梱版reportでは自己参照を避け、ZIP外report／最終回答で確定値を伝達する）。

ZIPの最終ファイルをPython `ZipFile`等で再openし、次を実測する。

- `ZipFile.testzip() = None`: `PASS`
- duplicate entry 0: `PASS`
- backslash path 0: `PASS`
- 全entry path `/`: `PASS`
- traversal／invalid path 0: `PASS`
- single root `nebiki-helper`: `PASS`
- nested ZIP／node_modules／cache／.env／credential 0: `PASS`
- dist／PWA artifactsあり: `PASS`（`index.html`、`sw.js`、`registerSW.js`、`manifest.webmanifest`）

## 15. deploy後の実端末確認

1. 9-16をdeployし、アプリ起動時にmigration待機後StartScreenが表示されることを確認する。
2. 管理設定の「端末保存容量を確認」でmigration status、IndexedDB件数、localStorage total／headroom／top keyを記録する。
3. Review19全件／day／all-data exportの過去件数が9-15から欠落していないことを確認する。
4. 通常17時AreaCountを保存して次エリアへ進めることを確認する。
5. 19時Review19 12/12を完了し、端末正本archiveと軽量outboxが成立することを確認する。
6. 20:30 finalized dayを保存し、archive件数とprevious-day metadataを確認する。
7. offline時にもarchiveからReview19 median／exportが使えることを確認する。

実端末diagnosticでは、`localStorage total`がsoft budgetを下回ることだけでなく、headroom、migration status、旧Review19／finalized keyの残存、pending count、current／unfinalized保護を併せて確認する。
