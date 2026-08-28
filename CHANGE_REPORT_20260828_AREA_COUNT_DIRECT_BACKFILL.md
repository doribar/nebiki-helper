# CHANGE REPORT — AreaCount manual direct backfill

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260827-2050.zip`
- appVersion: `2026.8.9-14`
- buildId: `build-20260828-091829-jst`
- dataSchemaVersion: `3`
- 作業日: 2026-08-28（JST）

## 1. 修正概要

管理設定の手動Supabase同期から、AreaCount backfill候補全件をrich pendingへ事前複製する処理を除去した。既存pendingを再送し、remote履歴を照合した後、送信が必要な端末AreaCount sourceだけを最大100件のmemory batchで直接upsertする。通常運用のlocal-first pending、legacy pending互換、Review19 lightweight outbox、9-12 bounded storageを維持する。

## 2. 実端末9-13で起きていたAreaCount問題

利用者が報告した9-13の実端末結果は、端末source検出がAreaCount 878件・Review19 6件、Review19正本direct syncが6/6件成功、AreaCount同期途中のqueueが約70件、最終結果が成功95件・失敗30件・queue 30件で、30件の `lastError` は `Failed to fetch` だった。Review19の救済は成功しており、残るボトルネックはAreaCount手動backfillだった。

## 3. root causeと旧pending内容

旧 `syncLocalDataToSupabase()` は `collectAreaCountBackfillRecords()` で複数の正式保存元をidentity mergeした後、`enqueueAreaCountRecordsForCloud(collectedAreaRecords)` を呼び、各AreaCount rich recordを `nebiki-helper/pending-supabase-sync-v1` へ保存していた。payloadには日付、session identity、area、time、cycle、countだけでなく、human detail、decision basis、calendar／weather metadata等が入る。送信前に端末sourceと同じrich JSONを別keyへ二重保持するため、候補数に比例してorigin quotaへ近づいた。

## 4. 採用したroot fix

AreaCountの手動backfillはdirect sync方式とした。AreaCount lightweight referenceは導入していない。理由は、backfill sourceが既存の統合cache、legacy cache、finalized day、Review19 daySnapshot、daily snapshot、current-sessionから毎回安全に再検出でき、remote未確認／local-only／current evidenceは9-12 policyで保護されるためである。新しいoutbox metadataさえ不要にし、追加localStorage量を0にした。

処理順は次のとおり。

1. 既存pendingを既存CAS／single in-flight経路で再送する。
2. Review19端末正本を9-13のdirect syncで確認・送信する。
3. AreaCountのnormal／summer remote履歴を全page取得する。
4. 端末AreaCount sourceを既存5-field business identityでcanonical化する。
5. remote revision／richnessに覆われるrecordと、既存pending identityをdirect対象から除外する。
6. 残りを最大100件ずつ直接upsertする。localStorage outboxは作らない。
7. 最初の失敗batchで停止し、残りは未試行として端末sourceに残す。

## 5. batch size

上限は100件。既存remote GET page size 1,000件より十分小さく、878件fixtureは100件×8 batch＋78件の9 requestで完走した。batchはmemory/network上だけに存在し、pending keyへmaterializeしない。

## 6. remote dedupe / idempotency

remote照合はAreaCountの `date × sessionStartedAt × areaId × discountTime × demandCycle` identityを使う。remote `recordedAt` がlocal以上で、localに定義されたdetailもremoteが包含する場合だけ送信不要とする。照合不能なrecordは既存Supabase conflict columnsとidempotent upsertを使う。同じ878件を複数回送るmockでもremote mapは878 rowのままで、中央値sampleは増殖しなかった。

## 7. legacy AreaCount pending互換と30件救済

通常運用と9-13以前のAreaCount pending shape、payload、sender、attempt metadata、lastError、CAS、retryを変更していない。30件fixtureは9-14でも読込可能で、成功時は30/30件を安全に削除し、`Failed to fetch` 時はattemptCountとlastErrorを更新して30件を保持した。実端末では9-14 deploy後に管理設定の手動同期を再実行すれば、現在の30件を最初に既存queue経路で再送できる。

## 8. 通信失敗時

direct batchが `Failed to fetch` 等で失敗してもlocal AreaCount sourceを削除せず、remote-confirmed扱いにせず、新しいrich pending／referenceも作らない。残りbatchを連続送信してendpointをhammerせず、次回の手動同期で再検出する。自動testでは1 batch成功後に2 batch目を失敗させ、100件成功・100件失敗・678件未試行となり、入力878件のJSONはbyte-identicalのままだった。通信回復後の再実行で残り778件を送信できた。

## 9. local source prune保護

9-12のcache policyを維持する。remote内容がidentity／revision／detailまで確認できないAreaCount、pending identity、current date、local-only recordは1 MiB soft budgetを超えてもpruneしない。finalized dayやReview19正本へ封印されたevidenceも各authoritative keyに残る。direct成功だけを理由にlocal sourceを即削除しない。成功recordはそのsessionのin-memory remote historyへmergeし、次回remote全page確認後に既存retention policyが判断する。

## 10. storage容量比較

同じ匿名rich AreaCount 878件を使用したUTF-16 key＋value概算：

- 旧manual backfill rich pending追加: `2257.4 KiB`
- 9-14 direct sync追加localStorage: `0.0 KiB`
- 削減率: `100.0%`

near-quota storage mockは全 `setItem()` を `QuotaExceededError` にしたが、direct helperはlocalStorage write 0回のまま878件を送信できた。対象rich payload総量に比例した一時増加はない。

## 11. manual sync UI件数の意味

結果UIを次の区分へ分けた。

- `端末source検出`: localの候補総数。未同期件数ではない。
- 同期開始時の既存queue／再送成功・失敗。
- Review19正本direct結果。
- AreaCount remote照合済みcycle数／送信不要数。
- 既存AreaCount queue対象数。
- AreaCount直接送信対象／成功／失敗／未試行。
- 新規queue追加数。AreaCount rich payloadは追加しない旨。
- 同期後のqueue件数。
- direct errorのcredential sanitization済み本文。

`未送信キュー: 0` はlocal outboxが空という意味であり、source検出0やremote全件同期済みを意味しない。

## 12. Quota警告と通信エラー

AreaCount backfill queue準備自体を廃止したため、878件一括pending作成のQuota警告経路はなくなった。Review19 lightweight reference保存が失敗した場合は9-11のstorage diagnostic（保存先、operation、errorName、quota、retry）をそのまま使用する。AreaCount direct通信エラーはstorage quotaと混同せず、sanitization後に `残数直接送信エラー` として一時表示する。

## 13. Review19 9-13回帰

`review19_ref_v1`、端末正本authoritative、pendingなし正本direct sync、legacy full-payload pending、revision-aware cleanupを変更していない。`check:review19-lightweight-outbox` は9/9 PASS。利用者報告の実端末6/6 direct sync経路を維持する。

## 14. 全体値引補正／forced 50回帰

`-5 / 0 / +5` percentage points、0〜50 clamp、business-date reset、session capture、mid-day非遡及、resume二重適用防止、production／fixed-time setting分離を変更していない。`check:global-discount-adjustment` は10/10 PASS。20:30 forced 50および30／40／50、40／50、all50は±5の対象外のまま。

## 15. fixed-time、median、productionAnalysis

fixed-timeは本番Supabase AreaCount READ ONLYだけを許可し、manual backfillは `fixed_time_mode` で停止する。本番pending、AreaCount、Review19、finalized day、learning population、global settingへWRITEしない。中央値engine、remote/local identity dedupe、normal／summer、holiday／Obon referenceは変更していない。productionAnalysisのhistory／manual／human_review19とstrong／medium／weak／none／insufficientも変更していない。

## 16. 9-12 storage safety

AreaCount 1 MiB soft budget、remote-confirmed bounded cache、local-only／pending／remote未確認／current保護、full paged remote history、legacy summer mirror新規dual-write停止、startup housekeeping、current／unfinalized daily snapshot保護、Review19 authoritative優先、quota recovery最大1回、structured storage resultを維持した。`check:quota-root-fix` 10/10、`check:long-run-storage-safety` PASS、storage write boundaryはreview済み33 call site／application raw write 0件。

## 17. Supabase / DB / SQL

DB migration、SQL、table、column、index、trigger、unique key、RLS、credentialを変更していない。全9 SQL artifactは基準ZIPとSHA-256比較してmismatch 0（byte-identical）。既存AreaCount bulk upsert、conflict columns、DB guard／CAS／rich mergeを再利用する。実DB mutation testは行わず、mock uploaderとlocal production buildで検証した。

## 18. backward compatibility / data schema

旧AreaCount／Review19 pending、AreaCount／Review19 record、normal／summer、finalized day、snapshot、exportを物理migrationなしで読める。正式record schemaは変えず、`SupabaseBackfillResult` の画面用optional fieldだけを追加したため `dataSchemaVersion = 3` を維持する。

## 19. HANDOFF更新

既存の「値引ヘルパーの運用目的」を削除せず、9-13 Review19 6/6実端末成功、AreaCount rich pending大量複製の次ボトルネック、9-14 direct backfill、legacy 30件互換、通信失敗時source保持、UI件数semantics、全体値引補正維持を追記した。

## 20. tests

- 全 `check:*`: `45 / 45 PASS`
- `check:area-count-direct-backfill`: `10 / 10 PASS`
- `check:review19-lightweight-outbox`: `9 / 9 PASS`
- `check:global-discount-adjustment`: `10 / 10 PASS`
- `check:quota-root-fix`: `10 / 10 PASS`
- `check:fixed-time-supabase-read`: `7 / 7 PASS`
- TypeScript `tsc -b`: PASS
- changed-file ESLint: 0 errors、既存hook dependency warning 4件
- production build: PASS
- PWA generateSW: PASS（10 precache entries、`dist/sw.js`、`dist/registerSW.js`、`dist/manifest.webmanifest`、workbox生成）
- storage boundary: application raw write 0件

専用testには878件batch、near-quota write 0、remote-covered、既存pending除外、idempotency、network fail／recovery、legacy30件成功cleanup／失敗保持、UTF-16容量、hook静的境界、UI wordingを含む。

## 21. browser確認

Codex in-app Browserでproduction buildを未使用port `127.0.0.1:4187`、viewport 390×844で確認した。fresh起動は `scrollY=0`、active element=`BODY`、innerWidth=390、document scrollWidth=375で横overflowなし。`値引ヘルパー`、`2026.8.9-14`、夏季モードOFF、全体値引補正の3選択を確認した。

管理設定でappVersion、buildId、schema、`未送信キュー`を確認し、credentialなしのlocal環境で手動同期を実行した。画面は端末source 85件を、remote照合、直接送信対象、直接成功／失敗／未試行、新規queue 0、同期後queue 0へ分けて表示し、`Supabase configuration is unavailable` をstorage quotaとは別のdirect errorとして表示した。console error／warningは0件、document横overflowもなかった。

実端末相当の878件・legacy pending 30件・Review19 6件を同時投入したbrowser mock UI、および実Supabase mutationは実施していない。これらの同期semanticsは自動mock testで確認したものとして区別する。

## 22. appVersion / buildId / schema

- appVersion: `2026.8.9-14`
- buildId: `build-20260828-091829-jst`
- dataSchemaVersion: `3`
