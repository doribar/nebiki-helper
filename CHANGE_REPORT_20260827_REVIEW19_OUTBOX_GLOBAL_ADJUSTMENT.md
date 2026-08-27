# CHANGE REPORT — Review19 lightweight outbox / 全体値引補正

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260824-2159.zip`
- appVersion: `2026.8.9-13`
- buildId: `build-20260827-203600-jst`
- dataSchemaVersion: `3`
- 作業日: 2026-08-27（JST）

## 1. 実端末で発生したReview19正本保存成功 / pending Quota失敗

2026.8.9-12の実端末では、Review19 authoritative local recordの保存は成功した一方、クラウド同期用pendingの保存が `QuotaExceededError` で失敗した。管理設定のqueue件数は0でも、remote未送信のlocal正本が存在し得る状態だった。今回の変更はlocal-firstを維持し、正本を失わずにこのrecordを後から送信できるようにする。

## 2. 旧Review19 pendingのpayload構造

旧形式はReview19のbusiness identity、revision metadataに加え、12エリア、human raw9、productionAnalysis、calendarContext、analysisWeatherContext、daySnapshot等を含むrich送信payloadをpending item内へ保持していた。端末正本と実質的に同じ大きなJSONを別keyへ再保存する構造だった。

## 3. 二重保持の容量

匿名rich fixtureのUTF-16 key＋value概算は次のとおり。

- Review19 authoritative record 1件: `96.6 KiB`
- legacy full-payload pending 1件: `97.0 KiB`
- 正本＋旧pending: 約`193.6 KiB`

旧pendingは正本とほぼ同量で、1件のReview19完了によって約1 record分の重複容量が追加されていた。

## 4. 採用した新outbox設計

新規Review19 pendingは `review19_ref_v1` の軽量referenceとした。同期時にreferenceから端末正本を解決し、その時点のauthoritative rich payloadを既存Supabase uploaderへ渡す。Review19正本保存 → 軽量outbox準備 → 送信というlocal-first順序は維持した。AreaCount pendingは変更していない。

## 5. reference identity

referenceには、`kind`、`date`、`demandCycle`、`sessionStartedAt`、`sourceUpdatedAt`、`recordedAt`、complete／final情報等、既存Review19 identityとrevision／final性を安全に照合するための最小metadataだけを保存する。送信時はまず `nebiki-helper/review19-records` の正本を探し、既存の救済元であるcurrent-session、work-session checkpoint、Review19 source stateもidentityが一致する場合だけ利用する。record本文はreferenceへ複製しない。

## 6. legacy full-payload pending後方互換

旧full-payload pendingと新reference pendingの両形式を読み、送信できる。legacy itemをstartupで一括変換しない。旧pendingがpartialでも、より新しいlocal finalが存在すればfinalを送る。送信成功後は、その成功revisionで安全に覆われるitemだけを削除し、新しい未送信revisionをCAS上誤削除しない。

## 7. pendingなしlocal Review19のmanual sync救済

管理設定の「端末内データをSupabaseへ同期」は、complete・finalなlocal Review19正本をpendingの有無にかかわらず検出し、full pendingを事前作成せず直接idempotent upsertする。これにより、端末正本は存在するがpending作成だけquota失敗した実端末相当fixtureを送信できた。local正本は送信後も保持し、duplicate remote rowを作らない。

## 8. offline時

通信失敗時もlocal authoritative Review19を保持する。軽量referenceを保存できる場合は再送状態として残すが、referenceすら保存できない極端なquota状態でも正本を削除しない。後日のmanual syncがpendingなし正本を再検出する。通信失敗をcomplete取消やfull payloadの再複製へ変換しない。

## 9. remote existing時

同じ `date × demandCycle` identityのremote recordが既にある場合も、既存CAS／revision／rich merge semanticsを使う。idempotent successとして扱い、remote rowや中央値sampleを増殖させず、成功revisionで不要になったpendingだけを整理する。local正本は維持する。

## 10. pending/UI件数表示の意味

従来の `クラウド未同期` はpending queue件数だけからremote全件同期済みと誤認され得たため、管理設定では `未送信キュー` と表示する。0件は「local outboxが空」の意味であり、remote全履歴の同期済み保証ではない。manual sync結果にはReview19正本の直接確認／送信件数をqueue件数と分けて表示する。

## 11. 修正前後のpending容量

- 旧full-payload pending: `97.0 KiB`
- 新reference pending: `0.9 KiB`
- pending部分の削減率: `99.1%`

100件reference fixtureでもrich Review19本文を含まないこと、1 recordのpayload肥大に比例してoutboxが増えないことを確認した。9-12 long-run fixtureのbounded storage checksも全てPASSした。fixture全体について測定条件の異なる新しい総量値は作らず、比較可能な1件あたりの実測値を正式値として記録する。

## 12. 9-12 bounded storage回帰

AreaCount remote-confirmed bounded cache、UTF-16概算1 MiB soft budget、pending／current／local-only／remote未確認record保護、Supabase全page履歴、remote/local identity dedupe、legacy summer mirror新規dual-write停止、startup housekeeping、current／unfinalized snapshot保護、未保存Review19 rescue、offline fallbackを維持した。raw storage write boundaryもapplication層0件のまま。

## 13. 全体値引補正UI

StartScreenの天候入力より前へ `全体値引補正` と `-5% / なし / +5%` のsegmented controlを追加した。初期値は `なし`。人間の明示選択だけを使用し、欠勤、近隣店、客数、天候、曜日、祝日、Obon等から自動推論しない。補正0では率画面を過剰表示せず、±5時は補正前rateと `全体補正 ±5%` を表示する。

## 14. -5 / 0 / +5のrate計算

曜日、中央値auto、人間判定、商品、weather、temperature、既存時刻補正等を終えた通常表示rateへ、最後に5 percentage pointsを1回だけ加減する。割合乗算ではない。

- 20 + 0 → 20
- 20 + 5 → 25
- 20 − 5 → 15
- 0 − 5 → 0
- 0 + 5 → 5
- 45 + 5 → 50

結果は0〜50へclampする。補正前rate、補正値、補正後rateを別fieldとして扱うため、resume／rerender／navigationで二重適用しない。

## 15. forced 50%との関係

20時30分の既存forced half priceおよび30／40／50、40／50、all50等の業務ルールは全体補正の対象外。forced 50に＋5または−5を選んでも50のまま。通常ロジックの結果をclampして50にする経路と、業務ルールによるforced rateをコード上で分離した。

## 16. date reset

production設定はbusiness date付きのsmall operational settingとして保存する。同じbusiness date内では再起動後も復元し、日付が変われば0へ戻す。前日の＋5／−5を翌日へ自動継承しない。旧保存値／不正値も0へ安全に正規化する。

## 17. mid-day変更

各sessionは開始時の選択値をcaptureする。15時sessionを補正0で保存後、17時前に＋5へ変更した場合、15時recordは0／元rateのまま、17時sessionだけ＋5／補正後rateになる。完了済み別sessionを遡及更新しない。

## 18. sessionへの保存

optional field `globalDiscountAdjustmentPercent: -5 | 0 | 5` をsessionへ保存する。rate snapshotには補正前表示、採用補正、最終表示を分離して保持する。daySnapshot、Review19 daySnapshot、finalized day、normal／summer export等、既存sessionを運ぶ経路で欠落しない。旧recordにfieldがなければ読込時だけ0相当とし、物理migrationしない。

## 19. median / human / finalとの関係

全体補正はrateの最終表示段だけに作用する。`autoEvaluation`、中央値表示、human raw9、even score、resolutionDirection、`finalEvaluation`、areaRateAdjustment等を書き換えず、計算へ戻して二重適用しない。同じ入力・同じfinalEvaluation・補正0なら9-12と同じ値引率になる。

## 20. productionAnalysisへの影響

`history / manual / human_review19` source semantics、strong／medium／weak／none／insufficient、15／17 final adopted area evaluation、19時human raw observationを変更しない。補正が適用された事実はsession／rate snapshotから分析できるが、製造不足疑いを強めたり弱めたりしない。

## 21. fixed-time

fixed-timeはproductionとは別のdate-scoped setting keyを使用し、同じbase rateと補正値なら同じ最終表示rateになる。本番Supabase AreaCount READ ONLYは維持する。fixed-timeからproductionのAreaCount、pending、Review19、finalized day、day setting、learning population、Supabase mutationへWRITEしない。

## 22. export / backward compatibility

全体補正は既存JSONB／session metadataへoptional additive fieldとして保持し、normal／summer export schemaを分岐させない。legacy Review19 pending、旧session、旧exportを読める。旧recordの補正欠損は0相当で、過去値や判断referenceを遡及変更しない。`dataSchemaVersion` は3を維持する。

## 23. storage safety

Review19正本最優先、quota recovery最大1回、structured storage result、current／unfinalized保護、AreaCount bounded cache、Review19 diagnosticsを維持する。新しい日次settingも既存storage boundaryを使用し、App／hook／componentへraw `localStorage.setItem()`／`removeItem()` を追加していない。

## 24. Supabase / DB変更有無

DB migration、SQL、table、column、index、trigger、unique key、RLS、credentialを変更していない。Review19の最終送信payloadとSupabase CAS／merge semanticsは従来どおりで、端末側outboxの保存形式とmanual source経路だけを変更した。

## 25. HANDOFF更新

`CHATGPT_HANDOFF.md` の既存内容と「値引ヘルパーの運用目的」を保持したまま、Review19 lightweight cloud outbox、legacy互換、pendingなし正本のmanual救済、queue表示の意味、全体値引補正、forced 50、date/session/fixed-time semanticsを追記した。

## 26. tests

- 全 `check:*`: `44 / 44 PASS`
- `check:review19-lightweight-outbox`: `9 / 9 PASS`
- `check:global-discount-adjustment`: `10 / 10 PASS`
- TypeScript (`tsc -b`): PASS
- changed-file ESLint: `0 errors`、既存hook dependency warning `4件`（新規errorなし）
- production build: PASS
- PWA generateSW: PASS（`dist/manifest.webmanifest`、`dist/sw.js`、`dist/registerSW.js`、workbox生成を確認）
- storage write boundary: application raw write `0件`

上記にはReview19正本あり／pendingなしmanual rescue、legacy pending、100 reference、remote existing、direct upload failure→軽量reference、成功revision cleanup、offline相当、rate clamp、forced 50、date reset、mid-day不変、resume二重適用なし、production／fixed storage分離、session／snapshot保存を含む。Supabaseはmock uploaderを使い、実DBへのmutationは行っていない。

## 27. browser確認

Codex in-app Browserを390×844に固定し、production buildを未使用originで開いて確認した。トップで `値引ヘルパー` と `2026.8.9-13` が同一行、`夏季モード：OFF`、`全体値引補正` の `-5% / なし / +5%`、20時30分の固定値引には適用されない説明を確認した。fresh起動は `scrollY=0`、active elementは `BODY`、document `scrollWidth=375` に対してviewport `innerWidth=390` で、初期focus移動とdocument-level横overflowはなかった。`+5%` 選択後は `aria-pressed=true` へ更新され、天候入力から確認表まで操作できた。

天候確定後にin-app Browser controllerがtimeoutし、値引率画面の `20→25`／`20→15`、forced 50、console最終ログ、manual sync mockの目視確認までは完走できなかった。このため、それらを実ブラウザ確認済みとはしない。率計算・forced 50・二重適用防止は `check:global-discount-adjustment` 10/10、pendingなしlocal Review19のdirect syncとfull pending非生成は `check:review19-lightweight-outbox` 9/9で自動検証した。Supabase credentialを使う実DB mutationは行っていない。

## 28. appVersion / buildId / schema

- appVersion: `2026.8.9-13`
- buildId: `build-20260827-203600-jst`
- dataSchemaVersion: `3`

dataSchemaVersion 3維持の理由は、Review19 reference outboxがlocal同期用metadataであり、全体補正が旧readerで欠損可能なoptional additive session fieldだからである。DB schema変更はない。
