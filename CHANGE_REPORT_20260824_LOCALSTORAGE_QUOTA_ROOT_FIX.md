# CHANGE REPORT — localStorage QuotaExceededError root fix / Review19 rescue

## 1. 実端末で確定した事象

2026-08-24のReview19端末正本保存で、初回writeと既存safe cleanup後の1回retryがともに `QuotaExceededError` になったことを9-11診断UIで確認済み。Android本体には約169 GBの空きがあるため、確認された上限は端末本体容量ではなく `nebiki-helper.vercel.app` originのブラウザ保存領域である。9-8以降のstructured failure、React rootへthrowしない安全境界、retry最大1回、入力state保持は正常に機能した。

## 2. 9-11 localStorage全write／key監査

静的監査では32個のレビュー済みstorage primitive call、application hook／component層のraw write 0件を確認した。書込み／削除対象20 keyとread-only legacy keyを用途別に分類した。

| key | 分類 | 常時全件が必要か／整理条件 |
|---|---|---|
| `area-count-records-v2` | local-first正式値＋remote cache | local-only／pending／currentは必要。remote完全確認済みcacheだけbounded化可能 |
| `area-count-records` | legacy normal | v2へ完全包含された場合だけ削除可能 |
| `summer-area-count-records-v1` | legacy summer mirror | v2へ完全包含された場合だけ削除可能。新規dual-write不要 |
| `pending-supabase-sync-v1` | authoritative unsynced outbox | 常時保護。pendingなしをremote確認とみなさない |
| `review19-records` | authoritative Review19 | 原則保護。今回の第一prune対象にしない |
| `finalized-day-data` | authoritative daily | 常時保護 |
| `current-session` | 進行中の業務正本 | 常時保護。8/24救済source |
| `work-session-checkpoint` | current-sessionの復旧duplicate | quota時に後順位で解放可能 |
| `runtime-state` | navigation／debug duplicate | quota時に解放可能 |
| `daily-session-snapshots` | 未確定日は中間証跡、確定後はduplicate | finalizedへ封印済みの古いdate groupだけ整理 |
| `review19-source-state` | 17時source中間state | Review19完了まで保護。12/12入力sourceではない |
| `next-session-skip-records` | operational | 保護 |
| `last-session-weather` | small operational | 保護、容量要因ではない |
| `last-used-session-draft` | small preference | 容量要因ではない |
| `daily-message-state` | small derived | 容量要因ではない |
| `final-day-auto-export-dates` | capped derived marker | 小容量 |
| `demand-cycle-state-v1` | production設定 | 保護 |
| `fixed-time-demand-cycle-state-v1` | fixed隔離設定 | 保護 |
| `fixed-time-temperature-by-date-v1` | fixed隔離cache | 保護、small |
| `app-mode-v1` / `simple-mode-state-v1` | obsolete flag | 従来どおりstartup remove |

## 3. 匿名rich fixtureによる修正前容量実測

fixtureはAreaCount 2,000件（normal／summer混在）、summer mirror 400件、Review19 6件、pending 100件、daily snapshot 80件、finalized day 40件、進行中12/12 Review19、checkpoint、runtime、Review19 source、各small keyを含む。UTF-16はlocalStorageのkey＋value概算。値／payload本文は出力していない。

| key | records | JSON chars | UTF-8 bytes | UTF-16 bytes | 構成比 |
|---|---:|---:|---:|---:|---:|
| `area-count-records-v2` | 2,000 | 1,500,889 | 1,514,317 | 3,001,848 | 58.49% |
| `daily-session-snapshots` | 80 | 327,681 | 327,681 | 655,436 | 12.77% |
| `summer-area-count-records-v1` | 400 | 300,172 | 302,856 | 600,428 | 11.70% |
| `review19-records` | 6 | 231,785 | 233,397 | 463,630 | 9.03% |
| `pending-supabase-sync-v1` | 100 | 104,668 | 105,340 | 209,412 | 4.08% |
| `runtime-state` | 1 | 70,339 | 70,339 | 140,732 | 2.74% |
| `work-session-checkpoint` | 1 | 8,779 | 8,779 | 17,632 | 0.34% |
| `review19-source-state` | 1 | 8,779 | 8,779 | 17,628 | 0.34% |
| `current-session` | 1 | 8,779 | 8,779 | 17,616 | 0.34% |
| `finalized-day-data` | 40 | 2,801 | 2,801 | 5,666 | 0.11% |
| remaining seeded small keys | 7 | 663 | 663 | 1,856 | 0.04% |

未seedのfixed temperature keyは0件、legacy normal keyはこのsummer重点fixtureでは0件。いずれもコード監査上の保護／完全包含条件を別testで固定した。旧app-mode keyはstartup cleanup対象である。

9-11 before housekeepingは `5011.6 KiB`。top 5はv2 AreaCount `2931.5 KiB`、daily snapshots `640.1 KiB`、summer mirror `586.4 KiB`、Review19 `452.8 KiB`、pending `204.5 KiB`。最大要因はSupabase全AreaCountの起動時local再materializeと、そのsummer subsetのlegacy mirror重複だった。

参考として950件fixtureではv2 AreaCount `868.3 KiB`、daily snapshots `641.6 KiB`、runtime＋checkpoint `449.5 KiB`、pending `174.0 KiB`、current `136.9 KiB`、Review19 `74.5 KiB`、合計 `2350.3 KiB`。summer mirrorは別途追加容量となる。

## 4. 採用したroot fix

1. production startupでSupabase全AreaCount履歴をlocalStorageへ全件再保存しない。
2. remote全履歴は中央値sourceとしてメモリへ保持し、local recent／unsynced cacheと既存mergeでdedupeする。
3. remote GETをcycle別・1,000行pageで完走させ、2,000件超でもserver row limitで切れないようにする。
4. unified v2を縮小できるexact replacement writerを追加する。旧merge writerで削除対象が復活しないようにした。
5. summer mirrorの新規dual-writeを停止。legacy readerは維持する。
6. startup housekeepingを追加し、current-sessionを先に読み保護日を確定してから、証明済みduplicateだけを整理する。
7. Review19 quota recovery coordinatorでも同じ安全な整理順を使い、retryは既存どおり最大1回とする。

## 5. AreaCount bounded cacheとbudget根拠

soft budgetはUTF-16 key＋value概算 `1 MiB`。既存950件fixtureが868.3 KiBで、実運用規模のoffline fallbackを保ちつつ約18%の余白を持つ一方、2,000件では1.83 MiB超まで増えるためbounded化が必要という実測に基づく。budget超過だけでauthoritativeを捨てず、protected dataが多ければ超過を許容する。

保持優先順位は、pending／current／local-only／remote未確認、cycle×area×discountTime×actualWeekday／fallback groupの最低3件、残りの新しいremote cache。3件は現行中央値recommendation成立の最低母集団に合わせた。normal／summer、時刻、area、calendar groupは混ぜない。

## 6. remote-confirmed／pruning条件

local AreaCountをevict可能とするのは、対象cycleのremote全page取得成功後に次を全て満たす場合だけ。

- `date + sessionStartedAt + areaId + discountTime + demandCycle` のidentity一致
- remote `recordedAt` がlocal以上
- 同revisionならlocalの全定義fieldがremoteと同値
- newer revisionならlocalのrich detailをremoteが包含
- 対応するAreaCount pending identityではない
- current／protected dateではない

`pendingにない`、HTTP upsert成功、古い日付だけではremote-confirmedとしない。remote unavailable時は正式recordのpruneを0件とする。

## 7. authoritative／unsynced保護

Review19入力state、未保存Review19、pending、local-only AreaCount、current-session、finalized day、Review19正本、Supabase未確認record、current／unfinalized evidenceはcleanup対象外。Review19を先にpruneする変更はない。既存daily snapshotの最大120件＋1 MiB soft budget、current／unfinalized保護、finalized date group単位整理も維持した。

## 8. 2026-08-24 Review19救済

9-11にはcurrent-sessionに入力が残っていてもnormalizerがreview19画面を一律startへ戻し、翌日にはstale-session cleanupが先に削除する問題があった。9-12は、正規化可能で `screen` が `review19`／`review19_weather`、`recordedAt`未設定、12/12入力完備、sessionとReview19のdate／sessionStartedAtが一致するstateだけを翌日deployでも復元する。12/12 counts、12/12 human raw9、productionAnalysis材料、daySnapshot材料をそのまま保持する。

存在しないstateを日付やfixed-timeから推測しない。`review19_done`、identity不一致、保存済みrecordは従来どおり復元しない。同一identityのReview19とpendingは既存dedupeを使うため、「完了」の再押下でduplicateを作らない。

near-quota救済fixtureでは、current Review19／pending／Review19 sourceをbyte-identicalに保ち、完全duplicate mirrorをstartupで解放し、Review19正本とpendingを保存してdone可能になった。remote unavailableで安全整理だけでは足りないfixtureは、入力stateと診断を保持したまま正直にQuota失敗を返した。

## 9. median・offline・fixed-time

中央値engine、5段階判定、値引率は変更していない。同一remote／local identityは1件へmergeし、fixtureで修正前後のrecommendation同値を確認。online productionはfull paged remote＋local、offlineはbounded local／local-only＋人間判定で続行する。remote失敗を普通へ偽装しない。

fixed-timeはproduction Supabase AreaCount READ ONLYを維持する。production cache housekeeping／local history／pending／Review19／finalized day／learning populationへのwriteは0。normal／summer、ordinary／holiday／Obon referenceは既存共通ロジックを使用する。

## 10. storage diagnosticsとquota recovery

9-11の保存先、set/remove、`errorName`、`quotaExceeded`、retry結果のUI診断を維持。Review19本文、payload、credentialは表示／console出力しない。cleanup順は完全包含legacy duplicate → sealed snapshot duplicate → runtime → checkpoint。対象writeの再試行は1回だけでrecursive retryはない。SecurityErrorではquota cleanupを行わない。

## 11. 修正後容量

同一rich fixtureでafter housekeepingは `2516.7 KiB`、削減は `2494.9 KiB / 49.8%`。AreaCount localは2,000件から897件、v2は `1022.9 KiB`。after top 5はv2 AreaCount `1022.9 KiB`、daily snapshots `640.1 KiB`、Review19 `452.8 KiB`、pending `204.5 KiB`、runtime `137.4 KiB`。正式／unsyncedをbudgetへ押し込むための強制削除はないため、v2がkey込みで1 MiBをわずかに超えるsoft-budget結果は意図どおり。

## 12. Supabase／DB／schema

AreaCount／Review19の既存table、identity、CAS、rich merge、pending、retry、backfill、RLSを変更していない。migration、SQL、table、column、index、trigger、RLS変更は0。変更は既存SELECTのpaginationとclient-side cache保持のみ。正式JSON schemaは破壊せず、`dataSchemaVersion = 3`を維持する。

## 13. backward compatibility

旧AreaCount、legacy normal／summer、Review19、pending、finalized day、current-session、daily snapshot、normal／summer、Obon、exportを物理migrationなしで読み込む。legacy keyは完全包含を証明できない限り残す。過去recordのcalendar、evaluation、rate、fixed-time意味を書き換えない。

## 14. HANDOFF更新

bounded AreaCount cache、remote pagination、authoritative／unsynced保護、offline fallback、8/24 Review19救済、diagnostics維持に加え、値引ヘルパー全体の上位目的（19時の品ぞろえと翌日廃棄5点理想／10点許容の両立、Review19は主に15／17時判断の評価地点）を既存内容を消さず追記した。

## 15. tests

- 専用 `check:quota-root-fix`: 10/10 PASS（mirror証明、richer legacy保護、remote confirm、2,000件bounded cache、dedupe／median同値、2,005件pagination、12/12 resume、near-quota救済、remote unavailable、容量実測）。
- 全 `check:*`: 42/42 scripts PASS。
- TypeScript: PASS。
- changed-file ESLint: error 0（基準版由来の既存hook warning 4件のみ）。full-repo ESLintは未変更ファイルに基準版由来のerror 9件／warning 9件がありFAILしたため、今回と無関係なUI／domainを改修していない。
- production build: PASS。PWA `generateSW`: PASS、precache 10 entries / 548.55 KiB。
- 390×844 browser: fresh originでappVersion `2026.8.9-12`、buildId `build-20260824-215940-jst`、summer状態、scrollY 0、focus BODY、document-level horizontal overflowなし、console error／warning 0を確認。天候入力→確認→通常AreaCount画面まで進行した。
- Browser内でorigin quotaを安全に人工注入するfixtureは用意していないため、12/12 Review19復元／Quota救済のbrowser実注入は未確認。専用Storage mockでnear-quota startup→state復元→Review19正本→pending→dedupeを検証したことと明確に分ける。

## 16. version

- `appVersion`: `2026.8.9-12`
- `buildId`: `build-20260824-215940-jst`
- `dataSchemaVersion`: `3`
