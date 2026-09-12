# 値引ヘルパー 現行引継ぎ（2026.8.9-24）

最終更新: 2026-09-12 JST

この文書は、過去の会話を知らない新しいCodexセッションへ、現在の実装状態を渡すためのメモである。長期的な開発ルールとリリース規則は先に `AGENTS.md` を読むこと。ここでは最新release、現行architecture、実装済み機能、検証範囲、既知課題、未実装事項を扱う。

## 1. 正本と現在のローカル状態

### 最新の検証済みrelease

| 項目 | 値 |
| --- | --- |
| ZIP | `nebiki-helper-20260912-2229.zip` |
| 成果物workspace root相対path | `outputs/nebiki-helper-20260912-2229.zip` |
| appVersion | `2026.8.9-24` |
| buildId | `build-20260912-171652-jst` |
| dataSchemaVersion | `3` |
| SHA-256 | ZIP外の `outputs/nebiki-helper-20260912-2229.zip.sha256` / `RELEASE_REPORT_2026.8.9-24.md` を参照（自己参照回避） |

絶対path:

- 成果物workspace: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5`
- application root: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5\work\advance24\nebiki-helper`
- release ZIP: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5\outputs\nebiki-helper-20260912-2229.zip`

`package.json` / `package-lock.json` は9-24、`src/domain/dataVersion.ts` はschema 3。buildIdは `vite.config.ts` からbuild時に注入され、現行 `dist` bundleで上記値を確認した。

検証済み9-23 ZIP（`nebiki-helper-20260910-1420.zip`、SHA-256 `643334f3c117f3eb5d60bba961254c11972e6017440339b356d45506521dfc14`）をbaselineとした。9-24は通常Done画面の共通基準ラベルと、通常15/17の天候確定直後の先行値引指示画面を追加した。率は既存の基本率・解決済み天候補正・global補正と商品が多い固定+10だけを使用する。9-23のhigher→lower quick順・保存semantic、17→Review19通常ルート、18:30 manual only、Review19 download、storageを維持する。root SQL 9本とAGENTS.mdは変更していない。詳細は `CHANGE_REPORT_2026.8.9-24.md`。

### Git

この作業場所には有効なGit repositoryがない。

- `Get-Location`: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5\work\advance24\nebiki-helper`
- application root直下に `.git` なし。
- 作業workspace root、作業copy親、application rootの `git rev-parse --show-toplevel` はいずれも `fatal: not a git repository`。
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

## 7. 人間評価と±1 quick adjustment（9-23表示順）

既存full manual判定は5つの基準ボタンを維持する。表示ボタンは1/3/5/7/9、長押し後に隣接項目を選ぶと2/4/6/8を保存する。raw score、選択順、scale、resolution direction/reasonを保持する。旧5段階recordは互換読込し、物理migrationしない。

Review19のraw9は19時時点の人間観測。even scoreを15/17のような最終5段階へ丸めない。Review19のauto medianとhuman observationは別情報。

`RateDisplayScreen` のquick buttonは、history由来の自動判定がreadyでcountがあり、通常の15/17/18/19 session（summer/normal）を表示中だけ有効にする。自動判定の順序 `few < slightly_few < normal < slightly_many < many` に対し、9-23では上にhigher（1段多い側）、下にlower（1段少ない側）を表示する。端では存在する方向の1個だけを表示し、空白やplaceholderは作らない。Review19、fixed-time、20:30、履歴不足・自動判定不明では表示しない。

quick適用後の保存関係:

- final adoptedはquickの移動先。`AreaProgress.areaCountEvaluation`、`AreaCountRecord.suggestedEvaluation` / `userJudge` に入る。`areaCountEvaluation` / `suggestedEvaluation` を元のautoの保存先として読まない。
- original autoは `humanEvaluationDetails.automaticEvaluation` と `humanEvaluationDetails.evaluationAdjustment.originalEvaluation` に保持する。`humanEvaluationDetails.resolvedEvaluation`、`AreaProgress.areaCountDecisionBasis.finalEvaluation`、`AreaCountRecord.decisionBasis.finalEvaluation` はfinalを持つ。判定sourceはそれぞれ `areaCountEvaluationSource: "manual"` / `evaluationSource: "manual"` となる。
- `humanEvaluationDetails.evaluationAdjustment`:
  - `applied: true`
  - `source: human`
  - `direction: lower` または `higher`
  - `steps: 1`
  - `originalEvaluation: 元のautomaticEvaluation`
  - `finalEvaluation: originalEvaluationから±1段`

field欠損は「操作なし」でありhuman agreementではない。quickは元auto基準で非累積、2段以上はfull manual selectorを使う。既存full manual selectorを置き換えない。

quickは既存 `judgeCurrentArea()` / `applyAreaJudgeSelection()` と保存経路へ入り、final評価に対応した既存AreaCount rate adjustment（fewからmanyへ -10 / -5 / 0 / +5 / +10）を使う。many→slightly_manyの場合は従来どおり+10から+5となる。通常運用では `AreaCountRecord` をlocal-first保存し、更新した `AppState.areaProgressMap` は既存のcurrent session / checkpoint保存経路で保持する。fixed-timeでは本番保存を行わない。

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

### 9-22: 17時→Review19を通常ルート、18:30は手動のみ

- 17時sessionは18:25〜18:54を含めてそのまま保持する。timer、focus、visibility復帰、start画面の時計更新で18:30session・天候入力・AreaCountを自動生成しない。
- 当日17時sessionをsourceにでき、Review19が未開始・未完了、同日authoritative recordがなく、同日18:30sessionが実際には開始されていない通常日は、18:55以降（19:25、20:30、23:59を含む）に `getAutomaticReview19TransitionKey()` がReview19開始keyを返す。`startNextDoneSession({ autoTransition: true })` はkeyがない17→18経路を保存・予約・画面遷移なしで終了する。
- 自動開始は `finalizeUnmeasuredAreasForAutoTransition()`、17時の `auto_time_transition` snapshot、`persistReview19SourceStateSafely()`、`createReview19StartState()` の順で既存safe storage境界を共用する。未計測は `measurementStatus: "not_measured"` / `missingReason: "auto_time_transition"` として保全し、捏造した残数を作らない。snapshotまたはsource保存失敗時は17時stateとkeyを保持して再評価・retryできる。
- 手動・自動とも `createReview19StartState()` を共用し、17時sourceのdate / demandCycle / sessionStartedAt / reference / weather等からReview19を生成する。18:30session、架空AreaCount、実施済み扱い、早め値引予約を作らない。alertは既存の `window.alert("19時チェックの時間になったため、19時チェックに進みます。")` を使い、timer/focus/visibility/StrictModeでも同一keyの通知・開始を一度だけ行う。
- 18:30値引はDone画面の「18:30値引を開始」または既存start画面の時刻選択から明示操作で開始する。Done画面の操作は既存 `startNextDoneSession()` / `openNextSessionInput()` を使い、weather確認後の `startSession()` で初めて18:30sessionを作る。17時sourceを保持したまま新しい18時の作業mapへ切り替え、開始時に未入力状態の18時 `DailySessionSnapshot` を既存journalへ保存する。
- 同日実開始済みの18:30session、またはその開始snapshotがある場合は `hasStarted1830Session()` がReview19手動・自動開始を抑止する。snapshotはarchive memoryとoperational journalから再ロードされるため、reload後も抑止する。開始画面draftを18にしただけでは抑止しない。legacyの18時sessionは削除・改変しない。
- `resolveDiscountTime()` と `getNextDoneDiscountInfo()` の時刻境界、manualDiscountTimeOverrideの意味、18:30のweather/rate/AreaCount処理、fixed-time READ ONLYは維持する。fixed-timeではReview19・snapshot・sessionへのproduction writeを行わない。

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

### 9-22: Review19完了画面のJSON download復帰

- Review19完了画面の主操作は `JSONをダウンロード`。`buildDirectReview19DataExportPayload({ record, exportedAt })` と既存 `downloadJsonFile()` を使い、9-20までのpretty JSONファイル出力へ戻した。完了画面からclipboard APIやcopy専用stateを呼ばない。
- export payloadのformat、version、dataSchemaVersion、appVersion、buildId、dataQuality、records、Review19 areaCounts、human/auto evaluation、calendar/weather、productionAnalysis、snapshot、daySnapshot、rateDecisionSnapshot等は変更・削除・要約していない。downloadはReview19保存、archive、outbox、cloud、localStorage、IndexedDBを変更しない。
- 設定画面の `19:00チェックデータを全件出力` / `最新の19:00チェックデータを出力` は従来どおりJSON downloadする。完了画面は `buildDirectReview19DataExportPayload()`、設定画面は従来の全件/最新export builderを使う。

### 9-22導入 / 9-23表示順: AreaCount自動判定の±1 quick adjustment

- 通常の `rate_display` で履歴自動判定がready、countが存在する15/17/18/19 session（summer/normal）に、元の自動判定から1段上げる・1段下げるボタンをこの順で表示する。fewはhigherだけ、manyはlowerだけ。Review19、fixed-time、20:30、履歴不足・不明は対象外で、full manual selectorは残す。
- quickの基準は常に元の `automaticEvaluation`。連打や反対方向への押し直しで累積しない。`humanEvaluationDetails.evaluationAdjustment` に `applied/source/direction/steps/originalEvaluation/finalEvaluation` を保存し、`areaCountEvaluation` / `suggestedEvaluation` はfinal、`areaCountDecisionBasis.baseEvaluation` はoriginal、`finalEvaluation` と `areaRateAdjustment` はfinalに対応させる。
- 保存は既存 `judgeCurrentArea()` → AreaCount record / current session / checkpoint / daily snapshot / finalized day / export / `record_details` の伝播経路を共用し、`rateDecisionSnapshot`へquick専用metadataを追加しない。既存のmany→slightly_many semanticと値引率engineを維持する。

## 10. Supabaseとfixed-time

- 既存table: `area_count_records`、`review19_records`
- local-first。remote失敗だけで現場入力を失わない。
- pending 0はlocal outboxが空という意味で、remote全履歴同期済みの保証ではない。
- AreaCount manual direct backfill、Review19 pendingなし正本rescue、legacy pending、CAS/finality/in-flight guardを維持。
- 実Supabase mutationは9-24開発検証でも実施していない。

fixed-timeはproduction AreaCount履歴をSupabaseからREAD ONLYで使い、同じmedian engineへ渡す。productionのAreaCount/pending/Review19/finalized/learning/global settingへWRITEしない。fixed-time cycle、clock、temperature、global adjustmentは専用state。

DB migration、SQL、RLS、grant、trigger、service role、client DELETE機能は9-24でも変更していない。

## 11. そのほかの現行UX

### 9-24: 通常Done基準ラベル・15/17先行値引

- 通常 `DoneScreen` に `derived.basisGuide.referenceConditionLabel` を表示する。RateDisplayと同じ既存formatter / resolved referenceを使用し、手動曜日指定、holiday / Obon等の解決、summer / normalを尊重する。Review19DoneScreenは非変更。
- 通常15/17の新しいsession開始では、天候確認を確定した後 `screen: "advance_discount"` に入り、`AdvanceDiscountScreen` を表示する。18/19/20、Review19、fixed-timeには追加しない。
- 文面は「夏・木曜日・17時を基準に考えて」「多い商品のうち10個以上ある商品を」「10％で引いてください」の形でlabel・rateを動的表示。「多い」は既存RateDisplayと同じ赤、操作は「エリア別値引へ進む」。
- `getAdvanceDiscountRate()` は `getBaseRate()` + `getWeekdayBaseInfo(...resolvedWeather...).baseRateBonus` + 商品が多い固定10を、`applyGlobalDiscountAdjustmentToRate()` でsessionのglobal補正を加算し共通0〜50%へ制限する。0以下も必ず「0％で引いてください」と数値表示する。既存エリア画面の「引かない」は非変更。
- このhelperはsessionのdate / weekday / discountTime / globalと既存解決済みweatherだけを受け取る。AreaCount / median / area評価 / quick / decrease / 商品個別policyを参照せず、lateTimeBonus / early-next補正も新画面の式に加えない。新画面のlabelはsessionの時刻を既存 `getReferenceConditionLabel()` で解決する。
- 押下までは新画面のまま保存・復元し、`continueAfterAdvanceDiscount()` で既存current area / normal-flow入口へ進む。session・area mapを変更せず、架空のAreaCount・評価・完了snapshotを作らない。既存current / checkpoint / runtime保存を使い、新flagやstorage keyは増やさない。
- 同sessionの既存作業・Doneから条件編集して再開する場合は指示を再表示しない。未完了の指示から条件編集した場合は指示へ戻る。通過時は同sessionの指示およびその復帰先を指すnavigation履歴だけを除き、他session・通常作業履歴を残す。
- 17時の指示画面で18:55を迎えた場合も既存Review19自動遷移とsource / 未測定snapshot保全を使用する。15→17の時刻切替後は天候確定してから17時の先行指示へ入る。保存schemaは3のまま。


- 最後の未完了エリアでskipしてもdoneにせず、他候補がない旨を通知して未完了のまま残す。
- skip直後の自己loopを防ぎ、後からの再訪は可能。
- title右側に正規 `APP_VERSION` を表示。buildId/schemaは常時表示しない。
- 全体値引補正UIは `-5% / なし / +5%`。説明文は9-18で削除したが機能は維持。
- 「アウトパック → 多い側に寄せる」案内だけ削除済み。関連data/logicは維持。
- Review19の新規 `not_applicable` 登録はなく、legacy read compatibilityのみ。
- 2026-08-25 debug Review19 one-time cleanupは完了。9-16で専用code/remote exclusionを撤去済みで、現行機能ではない。

## 12. 最新releaseの検証結果

`CHANGE_REPORT_2026.8.9-24.md` の結果:

- 全 `check:*`: 57/57 PASS。先行率15/15、UI35/35、先行flow30/30。Review19 priority transition70/70、quick40/40を含む既存checkもPASS。最後に追加したflow testは単独再実行で30件の結果に更新した。
- TypeScript / production build PASS（101 modules）、PWA generateSW PASS（precache 10 entries）。chunk size / Browserslist dataの既存警告あり。
- focused ESLint: 0 errors / 4 existing warnings（useNebikiAppの既存hook依存警告）。full lint: 9 errors / 7 warnings。9-23とfile / rule / severity / message比較で新規0。
- appVersion `2026.8.9-24`、buildId `build-20260912-171652-jst`、dataSchemaVersion `3`。SQL 9本・AGENTS.mdは9-23 baselineとbyte-identical。Supabase / schema変更なし。

headless Microsoft Edge、production preview、390×844、Asia/Tokyo、隔離fixtureで実操作した。

- 夏15 / 夏17 / 通常17の天候入力を実際に確認・確定し、先行指示→エリア別値引入口へ進めた。率は0 / 10 / 20％のfixtureを確認。0％も「引かない」にならない。
- 指示待機中のtimer / focus / visibility再評価とreload後も指示を保持。押下後reloadはarea_judgeのまま。session・未測定area mapは通過前後で一致し、AreaCount record / 架空評価を生成しない。
- Doneの完成state fixtureで夏15 / 夏17 / 通常17 / 手動曜日指定 / Obonの5ラベルを実表示確認した。Doneまで12エリアを実入力した検証ではない。
- 横overflow・文字切れなし。多いは赤。buttonは画面内に収まりtap正常。console error / warning、pageerror、外部通信、dialog / download / popupは0件。
- Review19 / manual 18:30 / quick / fixed-time / 20:30 / archive等は今回の自動checkで回帰確認した。これらの全フローの実ブラウザ再実行はしていない。

実Supabase mutation・全量cloud同期、インストール済みPWA実機、実店舗端末の長時間background復帰は未確認。証跡は `work/advance24/checks.json`、各check log、`lint-comparison24.json`、`browser-results24.json`。ZIP再open結果とSHAはZIP外の `outputs/RELEASE_REPORT_2026.8.9-24.md` / `ZIP_VALIDATION_2026.8.9-24.json`。

## 13. 既知課題、検討中だが未実装の案

既知課題:

- full project ESLintに既存9 errors / 7 warnings。
- `README.md` はrelease年表を含み、一部に9-16以前のlocal retention説明、legacy文章表現、全51本より少ないcheck一覧が残る。現行判断は `AGENTS.md`、この文書、`package.json`、実コード、最新CHANGE REPORTを優先。
- 実Supabase mutation、インストール済みPWA実機、実端末の長時間バックグラウンド復帰は未確認。
- 9-17大量storage/360日検証は自動fixtureで、同規模の実端末再検証ではない。

検討可能だが未実装:

- quick adjustmentの任意方向/複数step UI。現行buttonは元autoからの±1のみで、2段以上はfull manual selectorを使う。
- quick適用有無とReview19/廃棄結果を比較するdashboardや自動学習。
- 通常運用AreaCount outboxのlightweight reference化。現在はmanual bulk backfillだけがdirect方式。
- full project ESLint debtの別作業での解消。

実装済みと誤認してはいけないもの:

- IndexedDBへの全面移行。current/active localStorage journalは意図的に残る。
- global adjustment/quick adjustmentの自動推論。
- generic history DELETE UI/API、client DELETE権限、service role。
- Review19 quick adjustment。Review19はhuman observation専用のまま。
- archiveのTTL削除。正式履歴はIndexedDBで増える設計。
- Review19件数をlegacy local件数へ合わせる自動削除。
- 実Supabase mutationによる9-19確認。

## 14. 次セッションが最初に確認するファイル

1. `AGENTS.md`
2. `CHATGPT_HANDOFF.md`
3. `package.json`
4. `CHANGE_REPORT_2026.8.9-24.md`（9-23 baselineは `CHANGE_REPORT_2026.8.9-23.md`）
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
17. `src/components/screens/Review19DoneScreen.tsx`、`DoneScreen.tsx`、`RateDisplayScreen.tsx` と対応する `scripts/check-*.ts`
18. `src/domain/advanceDiscount.ts`、`src/components/screens/AdvanceDiscountScreen.tsx` と `scripts/check-advance-discount*.ts`
19. 必要な場合だけ過去CHANGE REPORT / README / SQL artifact

再開時は、version metadataとGit rootの有無を再確認し、最新ZIPとの差分を取ってから編集する。恒久的な検証・packagingルールは `AGENTS.md` に従う。
