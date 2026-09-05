# 値引ヘルパー 現行引継ぎ（2026.8.9-20）

最終更新: 2026-09-05 JST

この文書は、過去の会話を知らない新しいCodexセッションへ、現在の実装状態を渡すためのメモである。長期的な開発ルールとリリース規則は先に `AGENTS.md` を読むこと。ここでは最新release、現行architecture、実装済み機能、検証範囲、既知課題、未実装事項を扱う。

## 1. 正本と現在のローカル状態

### 最新の検証済みrelease

| 項目 | 値 |
| --- | --- |
| ZIP | `nebiki-helper-20260905-2242.zip` |
| 成果物workspace root相対path | `outputs/nebiki-helper-20260905-2242.zip` |
| appVersion | `2026.8.9-20` |
| buildId | `build-20260905-223329-jst` |
| dataSchemaVersion | `3` |
| SHA-256 | 完成ZIP生成後の `outputs/nebiki-helper-20260905-2242.zip.sha256` / `RELEASE_REPORT_2026.8.9-20.md` を参照（ZIP外。自己参照を避けるため本書へ値を埋め込まない） |

絶対path:

- 成果物workspace: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5`
- application root: `C:\Users\s0a6g\Documents\Codex\2026-07-18\step-1-2-3-4-5\work\reference-override-20260904\nebiki-helper`
- release ZIP: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5\outputs\nebiki-helper-20260905-2242.zip`

`package.json` / `package-lock.json` は9-20、`src/domain/dataVersion.ts` はschema 3。buildIdは `vite.config.ts` からbuild時に注入され、現行 `dist` bundleで上記値を確認した。

開発baselineは検証済み9-19 ZIP `nebiki-helper-20260904-2218.zip`（SHA-256: `83106cf1d960d1f83b882cdc775ec532f4a08c5e6c7602985e136b48d9d21d34`）。着手前はapplication code、package、dist、SQLが同ZIPと一致し、文書差分は既存のHANDOFF修正とAGENTS追加のみだった。9-20の変更は17時からのReview19優先遷移、専用test、version/build、関連文書に限定し、root SQL 9本は9-19とbyte-identical。詳細と検証範囲は `CHANGE_REPORT_2026.8.9-20.md` を読む。

### Git

この作業場所には有効なGit repositoryがない。

- `Get-Location`: `C:\Users\s0a6g\Documents\Codex\2026-07-18\step-1-2-3-4-5`
- application root直下に `.git` なし。
- workspace rootの `.git` は空で、`HEAD` なし。
- workspace/application rootの `git rev-parse --show-toplevel` はともに `fatal: not a git repository`。
- branch、git status、recent commitは取得不能。

したがって「値引ヘルパーGit root」は存在を確認できない。上記application rootを作業対象rootとして使い、差分は検証済みZIPとのhash比較で確認する。将来Git checkoutが用意された場合は、その時点で再度 `git rev-parse` する。

## 2. アプリの目的と現場フロー

値引ヘルパーはスーパー惣菜の値引支援Webアプリ。単純な早期売り切りではなく、19時の品ぞろえを確保しながら、20時の全品半額で翌日廃棄を十分少なくできる残量へ、主に15時・17時の判断で導く。

翌日廃棄の目安は理想5点以下、許容10点以下、10点超は改善対象。19時に売場が薄すぎる状態と、20時半額でも捌けないほど残る状態の双方を避ける。

- 値引session: 15:00、17:00、18:30、19:30、20:30
- Review19: 19:00時点の12エリア残数と人間評価。主に15時・17時判断と製造量の評価地点。
- 18:30: ユーザー本人が夜値引を担当する日の専用枠。Review19の主評価対象ではない。
- 天候入力: 16時〜21時。fresh起動時は最初の欄へ自動scrollせず、入力後は次欄へ進む。

## 3. 現在のarchitecture

- React 19、TypeScript 5.9、Vite 8、`vite-plugin-pwa` generateSW。
- UI入口: `src/app/App.tsx` / `AppRouter.tsx`
- 業務state/flow: `src/hooks/useNebikiApp.ts`、`src/hooks/nebikiApp/*`
- domain logic: `src/domain/*`
- archiveのmigration/hydration完了前は履歴依存UIをreadyにせず、起動直後の0件表示や欠落export raceを防ぐ。

永続化の現行分担:

| 層 | 内容 |
| --- | --- |
| localStorage | current operation、crash recovery、設定、lightweight outbox、current/active日のlocal-first journal |
| IndexedDB | rich historical Review19、finalized day、daily session snapshots、AreaCount |
| memory | IndexedDB/local/Supabase履歴のcanonical merge |
| Supabase | normal/summerの共有AreaCountとReview19 cloud copy |

IndexedDB:

- DB: `nebiki-helper-historical-archive`
- version: `2`
- stores: `review19`、`finalized-days`、`daily-session-snapshots`、`area-count-records`

## 4. 9-17 storage architectureの現在状態

9-16実端末では、historical daily snapshots 86件/33日が約4.8 MiB、AreaCount 866件が約1.84 MiB残り、localStorage合計約6.7 MiB、headroom 0だった。過去versionでformal finalized-dayを持たない日をlocalStorageへ永久保護していたことと、remote-confirmedを証明できないAreaCountを1 MiB budgetだけでは安全に削れなかったことが原因。

9-17は両方をIndexedDB v2へarchiveし、localStorageをcurrent/active journalへ縮小した。過去snapshotから架空のfinalized-dayは作らない。

legacy migrationは次の順で行う。

1. localStorage原本を読む。
2. stable identityでIndexedDBへcanonical upsertする。
3. archiveを再readする。
4. identity、count、stable contentをverifyする。
5. verify成功後だけlegacy historical copyを削除し、active subsetだけ残す。

失敗時は原本を保持し、次回起動でidempotent retryする。markerだけを削除根拠にしない。

現在の容量制御:

- nebiki-helper localStorage soft budget: 2.25 MiB
- critical write headroom: 256 KiB
- runtime history: 最大24件
- legacy local daily snapshot budget: 512 KiB
- legacy local AreaCount cache budget: 1 MiB
- structured storage result: `ok / key / operation / errorName / quotaExceeded`
- safe cleanup後のretry: 最大1回

管理設定の「端末保存容量を確認」は、localStorage total/budget/headroom、key別上位サイズ・件数、IndexedDB store件数、migration、pending/protected状態をpayloadなしで表示・JSON化する。`navigator.storage.estimate()` はorigin全体の参考値で、localStorage quotaではない。

9-17自動fixture:

- migration前 6705.3 KiB → migration後 59.3 KiB
- 15時/17時各12エリア保存と遷移後 120.6 KiB
- 最低headroom 2183.4 KiB
- daily snapshots 86件、AreaCount 866件をarchiveへ保持
- formal finalized-dayは0件のまま。捏造なし。
- 360営業日、720 snapshots、8640 AreaCountでもlocalStorageは日数比例で増えず、履歴はIndexedDBに残る。

この大量migration/人工Quota/360日検証は自動fixture。実ブラウザへ同規模データを注入した確認ではない。

## 5. AreaCountの現在状態

### 保存・同期

- 通常運用の新規AreaCountはcurrent local authoritative journalへ保存後、既存の少量rich pendingでSupabase送信を試す。通常AreaCount pending全体はlightweight化されていない。
- historical AreaCount正本はIndexedDB `area-count-records`。production履歴はarchive + current journal + Supabase remoteをmemoryでcanonical mergeする。
- remote full historyをlocalStorageへ再展開しない。offlineはarchive + current journalを使用。
- identity: `date × sessionStartedAt × areaId × discountTime × demandCycle`
- revision/recordedAt/richnessを用いる既存canonical mergeで、同一観測をmedianへ重複投入しない。
- manual backfillは既存pending再送後、remote比較し、最大100件のmemory batchでdirect idempotent upsertする。大量rich pendingを作らない。
- legacy AreaCount pendingと旧normal/summer keyは後方互換で読める。legacy summer mirrorへの新規dual-writeはしない。

9-14の実端末報告ではsource 878件、remote送信不要338件、direct対象540件、540/540成功、失敗0、queue 0まで確認済み。

### median / weekday group

- rule: `area_count_median_v1`
- 必要sample: 最低3件
- 5段階: `many / slightly_many / normal / slightly_few / few`
- rate adjustment: `+10 / +5 / 0 / -5 / -10` percentage points
- 同weekday履歴を優先し、不足時だけ既存weekday groupへfallbackする。
- groupは月水、火木/火木日、金土日/金土等で時刻により変わる。祝日、祝日前日、三連休中日には専用比較がある。
- `normal` / `summer` は履歴、remote query、settingを完全分離。cycle欠損legacy recordは互換上normalとして読むが、物理書換えしない。
- 値引率画面の `中央値判定：○○` はhuman override前のauto。履歴不足を普通へ偽装せず、表示値を再度rate計算へ適用しない。

## 6. calendar、reference、summer / normal

個別量referenceの優先順:

1. 三連休中日（17時以降。15時は実曜日）
2. Obon
3. 非祝日の祝日前日
4. 法定祝日/振替休日
5. 実曜日

Obonは毎年8月13日〜16日。`isObon=true`、`calendarCondition="obon"` として法定祝日とは別に保存し、現行需要判断はholiday-equivalent。Obonだけで三連休中日扱いせず、8月12日をObon前日にしない。導入前recordを遡及変更しない。

祝日/Obonは日曜reference、祝日前日は金土group。実曜日と採用referenceは別metadataとして保持する。

9-19の対象UIは共通の `formatReferenceConditionLabel()` で短いreference labelを作る。エリア手動判定・値引率表示は、既存の `getIndividualAmountReferenceContext()` で解決したcontextをformatterへ渡す。

- normal: `火曜日・17時`
- summer: `夏・火曜日・17時`
- Review19: internal referenceが19:30相当でもdisplayは `火曜日・19時` / `夏・火曜日・19時`

Review19は、保存済み `IndividualAmountReferenceContext` そのものを直接渡す方式ではない。`useNebikiApp.ts` の `review19ReferenceLabel` が `state.review19.reference.date` / `weekday`、`discountTime: "19"`、現在の `applyObonRule` を `getReferenceConditionLabel()` へ渡し、その内部で既存reference logicを再解決してからformatterを呼ぶ。cycleは `state.review19.demandCycle ?? reference.demandCycle` を `normalizeDemandCycle()` で正規化する（両方欠損時はnormal）。`displayTimeText: "19時"` を明示するため、内部の19:30相当表現はラベルへ出さない。

入力は保存済みdate / weekdayであり、UI側で今日の曜日を再計算したり、保存済みreferenceを書き換えたりしない。legacy `referenceText` やsummer補助noteは互換/別用途で残るため、全UIの文章形式を廃止したわけではない。

human 9-scaleのeven解決は、normalでは15時が少ない側、17時以降が多い側。summerではJST 18:00未満が少ない側、18:00以降が多い側。

## 7. 人間評価と9-19 quick adjustment

既存full manual判定は5つの基準ボタンを維持する。表示ボタンは1/3/5/7/9、長押し後に隣接項目を選ぶと2/4/6/8を保存する。raw score、選択順、scale、resolution direction/reasonを保持する。旧5段階recordは互換読込し、物理migrationしない。

Review19のraw9は19時時点の人間観測。even scoreを15/17のような最終5段階へ丸めない。Review19のauto medianとhuman observationは別情報。

9-19の `やや多いにする` は次の場合だけ表示する。

- history由来autoが `many`
- normal: 15時のみ
- summer: 15時・17時のみ
- Review19、normal 17時以降、summer 18時以降、many以外: 非表示

quick適用後の保存関係:

- final adoptedは `slightly_many`。`AreaProgress.areaCountEvaluation`、`AreaCountRecord.suggestedEvaluation` / `userJudge` に入る。`areaCountEvaluation` / `suggestedEvaluation` を元のautoの保存先として読まない。
- original autoの `many` は `humanEvaluationDetails.automaticEvaluation` と `humanEvaluationDetails.evaluationAdjustment.originalEvaluation` に保持する。
- `humanEvaluationDetails.resolvedEvaluation` は `slightly_many`。`AreaProgress.areaCountDecisionBasis.finalEvaluation` / `AreaCountRecord.decisionBasis.finalEvaluation` も最終採用値を持つ。判定sourceはそれぞれ `areaCountEvaluationSource: "manual"` / `evaluationSource: "manual"` となる。
- `humanEvaluationDetails.evaluationAdjustment`:
  - `applied: true`
  - `source: human`
  - `direction: lower`
  - `steps: 1`
  - `originalEvaluation: many`
  - `finalEvaluation: slightly_many`

field欠損は「操作なし」でありhuman agreementではない。型は将来拡張可能だが、現行quick UIはmany→slightly_manyの1種類だけ。既存full manual selectorを置き換えない。

quickは既存 `judgeCurrentArea()` / `applyAreaJudgeSelection()` と保存経路へ入り、AreaCount rate adjustmentを+10から+5へする。通常運用では `AreaCountRecord` をlocal-first保存し、更新した `AppState.areaProgressMap` は既存のcurrent session / checkpoint保存経路で保持する。fixed-timeでは本番保存を行わない。

`evaluationAdjustment` の保存先は `humanEvaluationDetails` の内部であり、`RateDecisionSnapshot` の内部ではない。実コードで保持・伝播される位置は次のとおり。

| record / 経路 | 保存位置 |
| --- | --- |
| 進行中session / checkpointの `AppState` | `areaProgressMap[areaId].humanEvaluationDetails.evaluationAdjustment`。親の `humanEvaluationDetails` が、同じ `AreaProgress` の `areaCountEvaluation` / `areaCountDecisionBasis` / `rateDecisionSnapshot` と隣接する。`SessionData` 自体のfieldではない。 |
| `DailySessionSnapshot` / `Review19Snapshot` | `areas[areaId].humanEvaluationDetails.evaluationAdjustment`。`buildAreaSnapshotsFromState()` がdeep copyし、`areaCountEvaluation` / `areaCountDecisionBasis` / `rateDecisionSnapshot` と同じarea snapshot内に保持する。 |
| `AreaCountRecord` | `humanEvaluationDetails.evaluationAdjustment`。`suggestedEvaluation` / `userJudge` / `decisionBasis` 等と同じrecord内に保持する。 |
| `Review19Result.daySnapshot` | `sessions[].areas[areaId].humanEvaluationDetails.evaluationAdjustment` と `areaCountRecords[].humanEvaluationDetails.evaluationAdjustment`。`createReview19DaySnapshot()` は同日・同cycleのrecordを収集し、sessionは `screen === "done"` または `sessionEndReason === "auto_time_transition"` のものだけを含める。 |
| finalized day / 日次export | `StoredFinalizedDayData` はdaySnapshotを展開した形で `sessions` / `areaCountRecords` を保持する。全件日次exportは `records[]`、単日exportは `daySnapshot` 配下にこれらを保持する。 |
| Review19 export / cloud | 対象 `Review19Result` に含まれる `snapshot.areas` / `daySnapshot.sessions` / `daySnapshot.areaCountRecords` 内のmetadataを保持する。exportでは `records[]`、cloudでは `review19_records.payload` 配下となる。 |
| AreaCount cloud | `area_count_records.record_details.humanEvaluationDetails.evaluationAdjustment`。`buildRemoteAreaCountDetails()` が元recordの `humanEvaluationDetails` をdeep copyする。 |

上記は有効なmetadataを持つsnapshot / recordが対象に含まれる場合の保存・出力経路であり、cloud送信成功や欠損した過去metadataの復元を保証するものではない。exportのlegacy互換処理は既存 `humanEvaluationDetails` を保持し、欠損からquick操作を推測して生成しない。根拠は `types.ts`、`useNebikiApp.ts`、`sessionSnapshots.ts`、`areaCountHistory.ts`、`finalizedDayData.ts`、`dayExport.ts`、`separateDataExport.ts`、`review19.ts`、`areaCountRemoteStorage.ts`、`review19RemoteStorage.ts`。

## 8. rate、global adjustment、productionAnalysis

rate計算の正本は `discount.ts`、`weekdayBase.ts`、`rateDecisionSnapshot.ts`、`globalDiscountAdjustment.ts`。

概略は、基本率 → weather/comfort/late-time → final AreaCount evaluation → 既存商品line/limit → early-next等 → 最後にglobal adjustment → 0〜50 clamp。商品policyには表示line/metadataもあるため、全商品属性を単純加算と決めつけない。

`globalDiscountAdjustmentPercent` は人間が選ぶ `-5 / 0 / +5` percentage points。新business dateでは0、同日内で復元、session開始時にcapture、完了済み過去sessionへ遡及適用しない。production/fixed-timeのsettingは分離。20:30 forced tierは対象外で、forced 50を45/55へしない。

`rateDecisionSnapshot` は各補正量、補正前後の率、表示率、version等を確定時に固定し、時計進行や再renderで二重適用・遡及書換えしない。採用判定や人間の操作metadata自体を内包せず、同じ `AreaProgress` / area snapshotの `areaCountEvaluation`、`areaCountDecisionBasis`、`humanEvaluationDetails` と対応づけて読む（保存位置は第7節）。

productionAnalysis:

- 15/17: final adopted 5-level。auto採用は `history`、full manual/quick変更は `manual`。
- 19: Review19 human rawのみ、sourceは `human_review19`。auto medianで補完しない。
- 3 checkpointが揃えば `strong / medium / weak / none`。欠測があれば `insufficient`。
- weather/calendarは説明変数であり、値引率やshortage flagを相互上書きしない。

## 9. Review19の現在状態

### 9-20: 18:30自動遷移を逃した場合のReview19優先

- 当日17時sessionを保持した通常画面/done画面では、18:25〜18:54は既存どおり18:30の天候入力へ自動遷移する。18:55以降はReview19未開始・未完了ならReview19を優先する。19:25以降も上限なしで適用し、19:30値引へ直接飛ばさない。
- `review19Flow.ts` の `getAutomaticReview19TransitionKey()` で判定する。start画面、Review19各画面、当日の既存Review19 state、当日完了済みarchive、fixed-time、当日17時以外のsessionを除外する。既に18:30入力へ移った場合は `timeSwitchTarget` と既存17→18自動遷移keyでも除外するため、保全用17時sessionが残る場合にも再通知しない。
- `startNextDoneSession({ autoTransition: true })` が既存 `finalizeUnmeasuredAreasForAutoTransition()` で未計測を `not_measured` / `auto_time_transition` とし、17時の `sessionEndReason: "auto_time_transition"` snapshotとReview19 source stateを既存safe storage境界で保存する。新経路は両保存成功後のみ進み、失敗時は現在の17時stateを保持してretry可能にする。18:25の既存失敗時挙動は変更しない。
- 手動・自動とも `createReview19StartState()` を共用し、17時sourceのdate / demandCycle / startedAt / weather等から従来どおりReview19を生成する。`window.alert("19時チェックの時間になったため、19時チェックに進みます。")` のOK後に `screen: "review19"` を設定する。18:30session、AreaCount、実施済み扱い、早め値引予約を作らない。
- date / session.startedAt / 17 / review19のkeyを保存・通知より前にrefへ確保し、成功後も保持する。30秒timer、focus、visibility、StrictModeの再評価で同一sourceの通知/開始を重複させない。保存失敗時はkeyを解放する。
- `resolveDiscountTime()`、`getNextDoneDiscountInfo()`、start画面のmanual開始条件、manualDiscountTimeOverrideの既存意味、fixed-timeの既存経路は変更していない。

### 保存・完了

Review19は12エリアの19時残数とhuman raw9、別軸のauto median、daySnapshot、calendar/weather、productionAnalysisを持つ。19時input画面には9-19の短いreference labelを表示するが、auto中央値/sample/basis詳細は現場UIへ出さず分析metadataとして保持する。

completion:

1. 12/12 stateとmetadataを完成。
2. IndexedDB `review19`へauthoritative save。
3. 成功後だけ `review19_ref_v1` lightweight outboxを準備。
4. cloud送信を試し、local正本成功を前提にdoneへ進む。

authoritative save失敗時はdoneにせず入力stateを保持。outboxだけの失敗は正本失敗と区別する。診断表示はstage/operation/errorName/quota/retry metadataのみで、payloadやcredentialは出さない。

`review19_ref_v1` はdate、demandCycle、sessionStartedAt、sourceUpdatedAt、final/complete等のlightweight identity/revision。legacy full-payload pendingも送信可能。manual syncはpendingのないcomplete/final archive正本もdirect idempotent uploadできる。

Supabase full Review19 historyはcanonical merge後にIndexedDB/memoryへ置き、旧localStorageへ全件再materializeしない。onlineはremote+archive、offline median/exportはarchiveを使う。

archive件数が過去のlegacy local件数より多いことはremote canonical recoveryで起こり得る。duplicate corruptionを証明せず、件数を合わせる目的で削除しない。

## 10. Supabaseとfixed-time

- 既存table: `area_count_records`、`review19_records`
- local-first。remote失敗だけで現場入力を失わない。
- pending 0はlocal outboxが空という意味で、remote全履歴同期済みの保証ではない。
- AreaCount manual direct backfill、Review19 pendingなし正本rescue、legacy pending、CAS/finality/in-flight guardを維持。
- 実Supabase mutationは9-19・9-20開発検証では実施していない。

fixed-timeはproduction AreaCount履歴をSupabaseからREAD ONLYで使い、同じmedian engineへ渡す。productionのAreaCount/pending/Review19/finalized/learning/global settingへWRITEしない。fixed-time cycle、clock、temperature、global adjustmentは専用state。

DB migration、SQL、RLS、grant、trigger、service role、client DELETE機能は9-20でも変更していない。

## 11. そのほかの現行UX

- 最後の未完了エリアでskipしてもdoneにせず、他候補がない旨を通知して未完了のまま残す。
- skip直後の自己loopを防ぎ、後からの再訪は可能。
- title右側に正規 `APP_VERSION` を表示。buildId/schemaは常時表示しない。
- 全体値引補正UIは `-5% / なし / +5%`。説明文は9-18で削除したが機能は維持。
- 「アウトパック → 多い側に寄せる」案内だけ削除済み。関連data/logicは維持。
- Review19の新規 `not_applicable` 登録はなく、legacy read compatibilityのみ。
- 2026-08-25 debug Review19 one-time cleanupは完了。9-16で専用code/remote exclusionを撤去済みで、現行機能ではない。

## 12. 最新releaseの検証結果

`CHANGE_REPORT_2026.8.9-20.md` に記録された結果:

- package.jsonの全 `check:*`: 52/52 PASS。
- 新規 `check:review19-priority-transition`: 47/47 PASS。境界時刻、19:25以降、除外条件、手動共用、欠測/snapshot/source、保存失敗、実action本体の再入・反復実行を検証。
- TypeScript + production build PASS、99 modules、PWA generateSW PASS（precache 10 entries）。buildにはchunk sizeと古いBrowserslist dataの警告がある。
- changed-file focused ESLint: 0 errors / 4 warnings。4件は既存useNebikiAppのhook依存警告。新規指摘0。
- 全体lint: 既存9 errors / 7 warnings、exit 1。9-19 baselineとfile/rule/severity/messageを比較し、増減0。
- root SQL artifacts: 9-19 baselineと9/9 byte-identical。Supabase schema/sync変更なし、実DB mutation未実施。

実ブラウザはproduction bundleをEdge（Chromium）で390×844、Asia/Tokyo、隔離したローカルoriginへ合成17時stateとテスト時計を設定して確認した。

- 18:25: 既存alert → 18:30天候入力。
- 18:55 / 19:25: Review19 alert → OK → Review19。17時source identity、既存残数17、他エリア欠測、17時interrupted snapshotを保持し、18:30 snapshotを生成しない。
- 各ケースで実React timerを60秒進め、window focus / document visibilitychangeをdispatchしてもalertは1回。
- innerWidth/innerHeight=390/844、clientWidth/scrollWidth=390/390、横overflowなし。console error/warning、pageerror、外部通信は各0。

18:24/18:54/19:00等の全境界、storage失敗、固定時刻モード、手動復元、全除外条件は専用/既存自動testで確認した。実店舗端末の長時間バックグラウンド復帰、実Supabase mutation、Review19全12エリア完走、quick button実押下、大量storage fixtureの実端末注入は今回未確認。

完成ZIPは再openして `ZipFile.testzip()`、duplicate/backslash/traversal/single root、除外物/credential、dist/PWA、version/buildを検査する。検査結果とSHA-256はZIP外の `RELEASE_REPORT_2026.8.9-20.md` に保存する。

## 13. 既知課題、検討中だが未実装の案

既知課題:

- full project ESLintに既存9 errors / 7 warnings。
- `README.md` はrelease年表を含み、一部に9-16以前のlocal retention説明、legacy文章表現、全51本より少ないcheck一覧が残る。現行判断は `AGENTS.md`、この文書、`package.json`、実コード、最新CHANGE REPORTを優先。
- 9-19のquick実browser押下、Review19 12/12 browser完走、実DB mutationは未確認。
- 9-17大量storage/360日検証は自動fixtureで、同規模の実端末再検証ではない。

検討可能だが未実装:

- quick adjustmentの任意方向/複数step UI。型が汎用なだけで、現行buttonはmany→slightly_manyのみ。
- quick適用有無とReview19/廃棄結果を比較するdashboardや自動学習。
- 通常運用AreaCount outboxのlightweight reference化。現在はmanual bulk backfillだけがdirect方式。
- full project ESLint debtの別作業での解消。

実装済みと誤認してはいけないもの:

- IndexedDBへの全面移行。current/active localStorage journalは意図的に残る。
- global adjustment/quick adjustmentの自動推論。
- generic history DELETE UI/API、client DELETE権限、service role。
- Review19 quick adjustment。
- archiveのTTL削除。正式履歴はIndexedDBで増える設計。
- Review19件数をlegacy local件数へ合わせる自動削除。
- 実Supabase mutationによる9-19確認。

## 14. 次セッションが最初に確認するファイル

1. `AGENTS.md`
2. `CHATGPT_HANDOFF.md`
3. `package.json`
4. `CHANGE_REPORT_2026.8.9-20.md`（baseline記録は `CHANGE_REPORT_2026.8.9-19.md`）
5. `src/domain/dataVersion.ts`
6. `src/domain/types.ts`
7. `src/app/App.tsx`、`src/app/AppRouter.tsx`
8. `src/hooks/useNebikiApp.ts` と対象の `src/hooks/nebikiApp/*`
9. `src/domain/historicalArchive.ts`、`historicalArchiveRuntime.ts`
10. `src/domain/storage.ts`、`storageDiagnostics.ts`
11. `src/domain/areaCountHistory.ts`、`areaCountHistorySource.ts`
12. `src/domain/weekdayBase.ts`、`humanEvaluation.ts`、`areaEvaluationAdjustment.ts`
13. `src/domain/discount.ts`、`rateDecisionSnapshot.ts`、`globalDiscountAdjustment.ts`
14. `src/domain/review19.ts`、`review19Evaluation.ts`、`review19CompletionStorage.ts`
15. `src/domain/cloudSync.ts`、`review19CloudOutbox.ts`、`review19RemoteStorage.ts`
16. `src/domain/areaCountDirectSync.ts`、`areaCountBackfill.ts`、`supabaseSyncQueue.ts`
17. 対象screen componentと対応する `scripts/check-*.ts`
18. 必要な場合だけ過去CHANGE REPORT / README / SQL artifact

再開時は、version metadataとGit rootの有無を再確認し、最新ZIPとの差分を取ってから編集する。恒久的な検証・packagingルールは `AGENTS.md` に従う。
