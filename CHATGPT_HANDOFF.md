# 値引ヘルパー 現行引継ぎ（2026.8.9-48）

最終更新: 2026-10-10 JST

この文書は、過去の会話を知らない新しいCodexセッションへ、現在の実装状態を渡すためのメモである。長期的な開発ルールとリリース規則は先に `AGENTS.md` を読むこと。ここでは最新release、現行architecture、実装済み機能、検証範囲、既知課題、未実装事項を扱う。

## 1. 正本と現在のローカル状態

### 最新の検証済みrelease

| 項目 | 値 |
| --- | --- |
| ZIP | `nebiki-helper-2026.8.9-48.zip` |
| 成果物workspace root相対path | `outputs/nebiki-helper-2026.8.9-48.zip` |
| appVersion | `2026.8.9-48` |
| buildId | `build-20261010-190352-jst` |
| dataSchemaVersion | `3` |
| SHA-256 | ZIP外の`.zip.sha256` / `RELEASE_REPORT_2026.8.9-48.md`参照（自己参照回避） |

application rootは`work/threeDay48/nebiki-helper`。比較基準は完成9-47 ZIP `nebiki-helper-2026.8.9-47.zip`（SHA-256 `c987bb9582befbf39a4d5b6269745bcd78b5d1ef24cc61de42ea7889fd6eb2ef`）。9-48は、ちょうど三連休中日の17/18:30/19:30/20:30で日曜側を普通の日曜3件以上なら単独参照、不足時だけ火木日へ代替し、金土との中央値50:50・片側採用を維持する。採用根拠はoptional metadataと共通formatterで保存・表示。15時/通常曜日/4日以上連休/値引engine/20:30固定rule/47開始2列は維持。schema3、SQL/AGENTS/過去報告、version/build方式を維持。詳細は第5節9-48項と`CHANGE_REPORT_2026.8.9-48.md`。

### Git

この作業場所には有効なGit repositoryがない。

- `Get-Location`: `C:\Users\s0a6g\Documents\Codex\2026-09-05\codex-1-agents-md-agents-override-5\work\threeDay48\nebiki-helper`
- application root直下に `.git` なし。
- 作業workspace root、作業copy親、application rootの `git rev-parse --show-toplevel` はいずれも `fatal: not a git repository`。
- branch、git status、recent commitは取得不能。

したがって「値引ヘルパーGit root」は存在を確認できない。上記application rootを作業対象rootとして使い、差分は検証済みZIPとのhash比較で確認する。将来Git checkoutが用意された場合は、その時点で再度 `git rev-parse` する。

## 2. アプリの目的と現場フロー

値引ヘルパーはスーパー惣菜の値引支援Webアプリ。単純な早期売り切りではなく、19時の品ぞろえを確保しながら、20時の全品半額で翌日廃棄を十分少なくできる残量へ、主に15時・17時の判断で導く。

翌日廃棄の目安は理想5点以下、許容10点以下、10点超は改善対象。19時に売場が薄すぎる状態と、20時半額でも捌けないほど残る状態の双方を避ける。

- 値引session: 15:00、17:00、18:30、19:30、20:30
- Review19: 19:00時点の対象エリア残数と人間評価（6〜11月12、12〜5月11。過去保存routeは保持）。主に15時・17時判断と製造量の評価地点。
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
- AreaCount判断用履歴はnormal/summer通年共通。保存metadata、remote cycle別query、setting、cycle別exportは維持。cycle欠損legacy recordは互換上normalとして読み、物理書換えしない。
- 値引率画面の `中央値判定：○○` はhuman override前のauto。履歴不足を普通へ偽装せず、表示値を再度rate計算へ適用しない。

### 9-36: AreaCount判断用履歴は通年共通

- `getAreaCountRecommendation()` はnormal/summer両方の履歴を参照する。過去日と当日の取得、減り方の前時刻lookupからcycle filterを外し、summerの当年short/前年以前long分離も廃止した。両cycleとも同一比較条件の直近16件をshort、直近52件をlongへ使う。履歴の並びは従来normalと同じrecordedAt順で、当日・未来日は過去中央値へ入れない。
- 同曜日3件以上を優先し、未満なら現行group、groupも3件未満ならinsufficient。混在normal2+summer2なら同曜日4件。short < longの場合だけ `max(short, long-2)` を採用し、group fallbackはguardなし。三連休の50/50合成、4日以上連休内部17時の比較先、Obon/calendarは維持する。
- 新しい `dedupeLatestAreaCountCalculationRecordsByDateAreaTime()` は計算時だけ同一営業日・area・時刻を1観測へ寄せる。保存identity内の既存canonical mergeを再利用し、recordedAt、sessionStartedAt、richness、deterministic fingerprintで正式な観測を選ぶ。3件以上の同identityコピーも入力順で結果が変わらないようraw copyを安定順序へ並べてからmergeする。異なる保存identity間でmetadataを補完せず、選んだ観測自身のcycle/decisionを保持する。入力と保存済みrecordは書き換えない。
- 減り方補正の過去時刻間sampleと当日前時刻は通年のcanonical観測から取得。対象area、20ポイント差、1段補正は維持する。20:30の参照中央値も同じ母集団を使うが、30/40/50型、40/50型、all50、個数別の業務ruleは非変更。
- `buildReview19HistoryStatistics()` へ渡す過去Review19由来の一時AreaCountも両cycleを含め、各recordの元cycleを保持する。この一時recordは保存しない。結果は引き続き履歴統計だけで、廃止済みautoEvaluationを生成しない。正式なhuman raw9、tap-toggle、完了、JSON形式、productionAnalysisの判定定義は非変更。
- 保存・archive・remote identity・Supabase `demand_cycle`・session/snapshot/Review19/rateDecisionSnapshot/exportはnormal/summer metadataを維持する。remoteは従来のcycle別2queryをmemory mergeする方式で、production local-first/失敗時継続/fixed-time READ ONLYは非変更。明示cycle指定のpure export builderは維持する。Review19設定の全件出力は9-41から両cycleを1ファイルにまとめる。
- 履歴説明は「同じ曜日の記録」「短期中央値」「長期中央値」等の共通文言。夏の手動残数noteは「残数基準で手動判定します。」、mode ON/OFF確認は共通履歴を使う旨へ変更。基準表示は9-39で営業月表示となるが、human even解決・summer17 dry快適上限-10%・7/1〜9/30 gate/lockは維持する。

### 9-37: 履歴前処理の再利用・17時early-next継続・季節商品

- AreaCountは `prepareAreaCountCalculationPopulation()` でnormalize/canonical化・area/time索引を履歴変更時だけ作る。hookは `[areaCountRecords]` のuseMemo、recommendation callbackはarea/date/time/weekday/cycle等の明示依存useCallback、AreaJudgeはcount/callbackをuseMemoする。30秒clock、電卓表示等の同条件renderで全履歴を再構築しない。
- prepared populationは呼出側が明示的に渡す不変snapshot。内部索引はprivate WeakMap、返す選択履歴は独立clone。従来のpreparedなし呼出は毎回freshに計算し、入力配列のin-place変更にも対応する。保存のcycle-aware canonical merge、通年計算時の1観測化、16/52・3件・group/long guard・decrease・20:30の意味は変更しない。
- Review19履歴も `prepareReview19HistoryPopulation()` へまとめて準備し、local/remote arrayが置き換わったときだけmemory mergeと前処理を再実行する。統計だけを返し、廃止済みの5段階auto判定は復活させない。archive/outbox/localStorage/Supabaseの責務は変更しない。
- 17時sessionのearly-nextは18:00以降に `effectiveRateDiscountTime="18"` / `calculationMode="early_next_minus5"` を使い続ける。旧18:25上限を廃止。別session・fixed-timeでは対象外。9-44は旧activeのmanual overrideを解除するがDone/歴史値は保持。Review19 weather/input/doneではhookの明示flow guardで終了する。通常Doneの現時点表示は継続。18:55 Review19、18:30 manual only、次時刻skip予約、保存済みsnapshot非書換えを維持する。
- `ryomi` のIDは維持し、master表示名だけ「夏商品」。新規 `autumn`「秋商品」は独立ID。6〜9月はryomi、10〜11月はautumn、12〜5月は季節枠なし。新sessionはsession日付を基準に、天ぷらとコロッケ系の間へ片方だけ置く。通常/Done/Review19/dataQuality/exportで対象数12/12/11を揃える。
- 保存済みroute/map/expectedAreaIdsを尊重し、9-36以前の10月11エリアへ秋商品の欠測を捏造しない。Review19Result/Review19Check/Review19DaySnapshotへschema3互換optional `expectedAreaIds` を保持し、legacyは保存証拠と当時の季節枠から解決する。legacyの `areaName:"涼味商品"` は物理変更しない。現masterから表示する画面と新snapshotは「夏商品」。ryomiとautumnのhistory/median/Review/analysis/backfillは独立、autumn3件未満は既存insufficient/manual。
- 巡回のunfinished priority順と表示用canonical順を分け、Done/Review19/日次snapshotでは保存された季節slotの通常業務順を使う。他エリアの順を変えない。productionAnalysisの判定関数・定義はbyte-identical、追加エリアを渡す対象範囲だけ拡張。

### 9-38: 起動直後の天候入力と復元処理の重複削減

- 起動用設定・archive snapshotはlazy useStateで1回取得する。以前のuseRef引数の全archive deep cloneが毎renderで評価される処理を廃止。Review19件数は既に正規化済みのrecorded recordを数えるだけで、export builder/productionAnalysisをrenderから呼ばない。
- 日次履歴・Review19 source・pendingの派生viewは実際の保存/同期/他タブstorage eventで更新する。日次wrapperはjournal bytesが変わった場合だけinvalidateし、Done completion effectの再保存循環を防ぐ。weather/early-nextの履歴参照も同じcached viewを使い、30秒clockで全履歴を再読込しない。業務確定handlerのfresh readは維持。
- AreaCountのprivate WeakMap/prepared indexは維持。useMemo内のlazy get()で最初のrecommendation時に同期準備する。Start/weatherでは全件prepareせず、AreaJudgeの実計算より前に必ずreadyになる。Review19のlazy prepared履歴も維持。
- navigationはscreen/area/finalTimeStepの変化を先に確認し、変化なしでは既存履歴をcloneしない。既に隔離された履歴entryは不変として共有し、追加/復元時に対象snapshotだけdeep copy。previousRenderRefはimmutable AppState参照を保持し、weather項目ごとに複製しない。
- runtime effectはnavigation/undo等の実際のruntime条件だけに依存。current/checkpointには1回のnormalized snapshotとserializeを共用し、実localStorage bytesが一致すればwriteを省く。天候変更は従来どおり直ちに保存し、debounce/blur依存は導入しない。quota retry時や欠損copyは実storage比較で再保存する。
- 期間外のnormal lockとseason-normalizationが交互に更新される既存effect循環を解消。inferred lock候補にも既存normalizeDemandCycleStateForBusinessDateを通すだけで、7〜9月の夏季gate・active cycle・値引率は変えない。
- archive repositoryが既にcanonical化した結果は、対応legacy fallbackが空なら再mergeしない。legacy overlap/失敗時の復元経路・migrationのverify/delete順・clone getterの独立性は維持。

### 9-40: エリア残数・減少率表示と追加製造例外

- AreaJudge、RateDisplay（多い/どちらでもない/注意事項）、AutoSkipNotice、AutoSkipCount、FinalTimeの同一エリア画面で `AreaCountStatusPanel` を使う。値は現在の `areaProgressMap[currentAreaId].areaCount`。AreaJudgeの入力確定後は既存count draftとmemo済みrecommendationを使い、残数用の重複state/keyを追加しない。未知の数を捏造しない。
- 減少率は保存済みdecisionBasisまたは既存recommendationのraw decreaseから表示。`canUse=false` は判定なし、`more_few` は良い、`none` は普通、`more_many` は悪い。比較は中央値±20pt、履歴最低3件。17時だけ、厳密な20pt境界の浮動小数点誤差をNumber.EPSILONで吸収する。19:30の判定式/結果は旧仕様を維持する。
- 17時15→17対象は `bento_men,tempura,onigiri,inari,hosomaki,ryomi,autumn,yakitori`。ryomiの内部ID・表示名「夏商品」は維持。croquette/fry_chicken/chuka_fish/sushi/futomaki_chumakiとlegacy balance_bentoは対象外。18:30は減少率比較なし。19:30は全エリアで18:30→19:30を維持。
- 17時の対象エリアでready/canUse/raw more_many/previousTime15が成立し、fixed-timeではない場合だけ、RateDisplayで「追加製造あり・補正を取り消す」/「補正を戻す」を表示する。良い/普通/判定なし/対象外/19:30には取消UIを出さない。
- canonical optional metadataは `AreaCountDecisionBasis.decreaseAdjustment.suppressed?: boolean` と `suppressionReason?: "additional_production"`。取消はtrue+reason、復元は両fieldを省略。raw currentDecreaseRate/medianDecreaseRate/directionは不変。欠損は取消なしとして読み、legacyをmigration/backfillで書き換えない。
- 自動判定なら取消後final=raw baseEvaluation、復元後final=raw baseから多い側へ1段。既存5段階clampとrate adjustmentを使い、非累積。explicit manual/quickは人間final・rate・raw9・automaticEvaluation/evaluationAdjustmentを優先して保持する。既存quickのbaseEvaluation=original autoというsemanticも維持する。
- 取消/復元は既存local-first AreaCount保存境界を先に通し、成功時だけcurrent progressを更新する。失敗時はstate/判定/recordを変更せず再試行できる。cycleを含む既存identityでcurrent recordを選び、memoryは1recordをshallow置換する。通常renderで全history clone/全archive getter/normalizeを追加しない。
- 同session/同areaの既存navigation snapshotだけ更新し、Backで入力済み残数と取消を失わない。Undoのpre-action snapshotは改変せず、quick/残数修正のUndoを維持する。count修正時にraw bad比較が引き続き成立する場合だけ取消を引き継ぎ、good/none/比較不能なら無効な取消を新判定へ持ち込まない。
- current/checkpoint、daily session snapshot、Review19 daySnapshot、finalized/archive、AreaCount record_details、export/remote JSONは既存propagationでmetadataを保持する。rateDecisionSnapshotへ新しい取消fieldを重複追加しない。source state/履歴/productionAnalysis/businessMonthは維持する。
- Doneの多い/どちらでもないはfinite numeric > 0だけ赤#ff0000/緑#008000。0/unknown/skip/20:30は従来色。既存snapshot numericと、既存rate coreを共有するcurrent numeric helperを使い、文字列をparseして色を決めない。エリア順・judge/status/note・表示値引率は不変。


### 9-48: 三連休中日の夜参照は普通の日曜を優先

- 既存の「ちょうど三連休中日」の17/18/19/20だけ、同area/timeの普通の日曜3件以上を先に選ぶ。日曜不足時のみ既存火木日を代替し、金土側の選択方法は維持。両側有効は採用中央値を50:50、片側のみはその中央値、両側不足は従来のinsufficient/manual。値引率を平均しない。中日が土曜でも日曜側は普通の日曜。
- 通年・date<today・canonical/dedupeと必要3件を共用し、short16/long52、日曜単独の `max(short,long-2)` guardを既存helperで適用する。group fallbackは従来どおりguardなし。新しい日曜候補だけ実日付/実曜日が日曜で、holiday/祝前日/三連休/長期連休/当時Obon/captured特殊calendarを除外する。その他通常曜日の母集団処理は変更しない。
- `threeDayHolidayMiddleReference.sundayReference?` にsource(`weekday`/`fallback_group`)、adopted、普通日曜件数、採用側全件数/short/long件数、各中央値/guard、fallbackReason(`insufficient_sunday_history`)を保持する。旧 `fireThursdaySunday*` は火木日groupの意味を維持し、日曜単独を入れない。日曜採用時の旧group中央値は未採用として省略。adoptedSourceは日曜だけなら`日`、双方は従来の`both`＋sundayReference.sourceで識別する。
- basisはAreaProgress→確定area snapshot/daily/day/finalized/export、AreaCount record_detailsの既存経路へ伝播。rateDecisionSnapshot内へ新しいAreaCount metadataを追加しない。calendarContextは普通日曜+金土のとき `composite_weekday_and_group` / referenceWeekday=`日` / groups=`金土`、日曜だけならweekday。fallback/legacyの火木日・金土表現を維持。
- 共通 `getThreeDayHolidayMiddleReferenceDetailLines()` は保存metadataだけを読み、日曜単独/代替理由・実件数/中央値/guard・50:50か片側かを表示する。RateDisplayの三連休時だけdetails「三連休中日の履歴基準」を追加。開閉は判定・保存・再計算しない。AreaJudgeの静的火木日50:50断定は内訳案内へ変更。
- Review19参考統計も共通median処理を使い、optional参照根拠を保存する。正式評価は9段階人間入力のまま。auto5段階を復活させずproductionAnalysisは変更しない。過去のsundayReference欠損へ新ルール採用実績を補完せず、保存済み率/評価/中央値は再計算しない。
- 15時/通常日曜/その他曜日/4日以上の連休、基本率/天候46快適緩和/area・商品・global/時刻補正/20:30固定本体、47開始2列/注意7項目/長押しは非変更。新storage key/migration/SQLなし、schema3。

## 6. calendar、reference、summer / normal

個別量referenceの優先順:

1. 三連休中日（17時以降。15時は実曜日。既存の「ちょうど3日」判定を維持）
2. 4日以上続く土日祝連休の内部日、かつ17時だけ（9-29）
3. Obon
4. 非祝日の祝日前日
5. 法定祝日/振替休日
6. 実曜日

Obonは毎年8月13日〜16日。`isObon=true`、`calendarCondition="obon"` として法定祝日とは別に保存し、現行需要判断はholiday-equivalent。Obonだけで三連休中日扱いせず、8月12日をObon前日にしない。導入前recordを遡及変更しない。

上位の三連休/長期連休ルールに該当しない祝日/Obonは日曜reference、祝日前日は金土group。実曜日と採用referenceは別metadataとして保持する。

### 9-29: 長期連休内部の17時は金土reference

- `isLongHolidayMiddle()` は既存 `isJapaneseHolidayOrWeekend()` を再利用する。当日・前日・翌日が休日で、前々日または翌々日も休日なら4日以上のブロック内部。初日・最終日・ちょうど3日は対象外。Obonだけの日を休日ブロックへ加えない。
- 個別量は `getIndividualAmountReferenceContext()` の三連休分岐の後で17時だけ金土group。表示は「金曜日・土曜日の17時を基準に考えて」、短いラベルは共通formatterによる「○月・金曜日・土曜日・17時」（9-39以降、営業月prefix）。
- 残数は `getAreaCountComparisonWeekdayGroup()` とrecommendationの比較basis/force fallbackへ17時限定適用。同曜日データが3件以上あっても対象日は金土を使う。中央値/減少率アルゴリズムは変更しない。
- **履歴recordの分類** `getAreaCountFallbackWeekdayGroup()`、そのnormalizerと書込経路は維持。新しい比較先選択によって過去recordを再分類しない。新規の `areaCountDecisionBasis` / calendar `areaCountReference` には実際に採用した金土比較を保存する。
- 既存JSON構造のkind/reasonに `long_holiday_middle` を許可するだけで、field/schemaを追加しない。既存contextはそのまま保持。calendarContext欠損の旧snapshotを復元する2経路は `applyLongHolidayRule: false` で旧referenceを再現する。このflagは保存fieldではない。
- 2026-09-20/21/22の17時が対象。9/19は初日、9/23は最終日で対象外。15/18:30/19:30/20:30とReview19の19時referenceは非変更。

9-19以降の対象UIは共通の `formatReferenceConditionLabel()` を使う。9-39では営業日 `date` の月を先頭へ付け、normal/summerを問わず1〜12月を表示する。エリア手動判定・RateDisplay・AdvanceDiscount・通常Done・Review19へ既存propsで伝播し、component側に月計算を重複追加しない。

- 文型: `10月の金曜日の17時を基準に考えて`
- 単一曜日の短いラベル: `10月・金曜日・17時`
- 解決済みgroup: `10月・金曜日・土曜日・17時`
- Review19: `10月・金曜日・19時` / group `10月・金曜日・土曜日・19時`。既存の19時表示を維持し、内部19:30相当をラベルへ出さない。

表示月はsession/recordの営業日だけから導出し、UTC timestampや現在のclockを参照しない。weekday/groupは既存reference resolver・calendar/holiday/Obon/長期連休を尊重する。9-45以降の通常操作は業務日由来自動曜日で、保存済みmanual weekday/referenceは当時の証跡として保持。`getIndividualAmountReferenceContext()` のraw contextや保存済みreferenceText自体は変えず、月を履歴filterや判定入力へ使わない。需要modeを示す既存「夏季モード基準」badgeは残り、曜日・時刻referenceの季節prefixとは区別する。

Review19は保存済み `IndividualAmountReferenceContext` を直接formatterへ渡さない。`review19ReferenceLabel` は `state.review19.date ?? reference.date`、保存済み `reference.weekday`、`discountTime: "19"`、現在の `applyObonRule` を既存 `getReferenceConditionLabel()` へ渡し再解決する。cycle正規化と `displayTimeText: "19時"` は維持する。recordとreferenceの日付が異なるlegacy caseでも表示月はrecord.dateを優先する。保存済みreferenceを物理変更しない。

### 9-39: Review19の営業月metadata

- canonical fieldはoptional `businessMonth?: number` 1つ。値は整数1..12。新規Review19作成/確定は営業日ISO `date` から `monthFromBusinessDate()` で導出する。normal/summerに関係なく全月へ適用する。
- Review19Result root、review19Check、Review19DaySnapshot root / daySnapshot.review19Check、current/checkpoint JSON、authoritative IndexedDB archive、Review19各exportへ保持する。既存remote rowのJSON payload内で保存可能なためSQL/column/RLS/grant/triggerは変更しない。
- lightweight outboxは従来のidentity参照だけであり、monthやrich snapshotをpayloadへ増やさない。送信時にauthoritative recordを解決してremote JSONへmonthを伝播する。pendingなしdirect rescueも既存正本を使う。
- 旧recordのmonth欠損はnormalize/read/archive/remoteで欠損のまま。必要な読み出しは `resolveBusinessMonth()` でvalidな保存monthを優先し、なければ営業日dateからfallbackする。exportは独立copyにのみmonthを補う。migration、backfill、storageへの埋戻し、過去recordの再計算は行わない。不正monthは採用しない。無効な営業日は現在月で補完しない。
- AreaCount通年rolling16/52、同曜日3件、group/median/decrease、Review19統計、rate/weather/summer17、productionAnalysisは非変更。month計算は小さい文字列処理のみで、render全archive read/全normalize/大量cloneを追加しない。

human 9-scaleのeven解決は、normalでは15時が少ない側、17時以降が多い側。summerではJST 18:00未満が少ない側、18:00以降が多い側。

## 7. 人間評価と±1 quick adjustment（9-23表示順）

### 9-45: 通常運用は曜日の自動判定のみ

- Startの曜日toggle/auto-return/select/wheelと専用helper/now propを撤去し自然曜日表示だけを残す。時刻manual UIは44で廃止済み。エリアmanual/longpress/quickは維持。
- operationalWeekday helperは既存date-only utility公開aliasを使い、current/checkpoint・navigation/undo・条件編集・Done再入で旧manualWeekdayOverrideを解除。未開始は現在日、activeは元session.dateの曜日。raw9/resolved/evaluatedAt/count/completed率/snapshotは保持。
- 条件編集中に日付を跨いでもactive業務日を保持。既存別日startSession gateで新日sessionを作る時はdraft.date/weekdayも揃える。旧日通常current/checkpoint除外・未保存完成Review19翌日救済は維持。
- Done/開始済みReview19復元は証跡保護のためno-op。Done再入/新19:30開始で解除。新Reviewはsource session/mapを保持し、新draft/reference/入力統計だけ自動曜日へ。未確定Review weatherの確認も新draft/refだけ解除。
- generic normalize/clone/historyから旧manual情報を削除しない。運用buildStartDefaultDraftのみ現在日・曜日・flagfalse化。fixedTime helper no-op、production READ ONLY、schema3、既存storage keyを維持。
- holiday/祝前日/三連休/長期連休/Obon/reference/group/基本率は不変。自動曜日に戻った新規判定・現在率は変わり得るが保存済み値を遡及置換しない。火曜旧金曜指定の新再判定は普通→少ない・10/20→0/10%、金曜20:30旧火曜指定は40/50/50→30/40/50%を実codeで照合。
- 44のnotice7/太字/文言、商品/manual hint、weather lock、early/late、Review19/20:30、保存評価を時計だけで再解決しない仕様を保持。既存weather effect3件は理由付き局所lint例外で同期挙動維持、global lint config不変。

### 9-44: 自動時刻運用・daily注意確認廃止（当時の記録。曜日は上の9-45項）

- Startの時刻select/toggle/auto-return/wheelは削除。自動時刻表示、当時のweekday override（9-45で通常操作廃止）、weather input lock、固定時計検証panelを維持。既存clock境界・早取り−5・late+5・次枠skip・17→Review19優先は変更しない。Doneの次枠明示開始はclockでunlockした次枠だけで、任意時刻の指定ではない。
- `showDailyNoticeBeforeRate` / `showDailyNotice` / 確認action・callback・swipe disableは撤去。残数入力/必要な評価後に直接最初のmany指示へ進む。下部注意7項目は保持。やや不人気の本文から「実際に」と「（小パックは補正なし）」だけを削除し4つの太字を維持。他6項目・20個実数rule・商品policyは不変。旧`rateNoticeShownDate`は読込互換だけで確認待ちに使わない。弁当/天候/祝日/20:30の別案内は保持。
- operationalTime helperはcurrent/checkpoint・navigation/undo・条件編集/Done再活性化だけに適用。activeのmanual flagはfalseへ、元time/startedAt/count/raw9/adopted評価/completed rate/snapshotを保持。sessionless旧draftはautoclock（正当な既存weatherlockがあればそれを尊重）、旧weatherpending不一致は解除して再確認。Done/Review19/historical normalizerは変更せずfixed-time helperはno-op。保存key/schema/migration追加なし。
- 同日current sessionを再開/条件編集する場合、明示timeSwitchTargetがなければ元timeを使う。解除直後に別枠へsession identityを付け替えない。固定解除後のcurrent率では既存early/late/次skipが復帰する。旧17lowerが18:00に0/10→10/20%、higherが5/15→15/25%となり得るが、既存完了率・snapshotは再計算しない。
- normalの偶数解決は原session15=lower/他=higher。summerは新規確定時JST18:00未満lower/以降higherのまま。17:59:59新規raw6=普通0/10%、18:00/18:01新規=やや多い15/25%。保存lowerを保持した18時以降は10/20%。表示は「判定確定時に…を採用して計算」とし、時計だけで再判定したような説明を削除。
- 43の商品/手動エリアhint分離・指定本文・長押し/隣接/キャンセル/swipe・Review19観察を保持。未解決: 旧summer18:30 activeを18時前に復元すると新規raw6はlower/普通、15/25%。静的18時以降higher文と相違し、原session保持と実時計規則を両立したまま独自業務変更は行っていない。元15を18時以降に直接評価するsynthetic例外は通常UI到達を証明していない。

### 9-43: 迷ったら案内を用途別に分離（当時の記録。現行差分は上の9-44項）

- `JudgeHintDialog`は必須`purpose`でproduct/manual-areaを明示。商品量判断の両指示カードは大小パック・期限・時刻ごとの寄せ方だけ。手動エリアは長押し・中間記録・lower/higher計算だけ。指定の通常/夏季本文をそのまま使用し、旧「明らかに多い場合は…」は削除。
- 手動入口はAreaJudgeのHumanEvaluationSelector直前、およびRateDisplay「自動判定を手動で変更」の展開内。Review19観察評価や20:30へ計算説明を追加しない。開閉はcomponent内stateのみ。dialog touchを親skipへ伝播させない。長押し500ms・隣接2項目・cancel・通常swipeは維持。
- 通常のhuman偶数解決は元session15=lower、他=higher。夏は選択確定時のJST実時計18:00未満=lower、以降=higher。manual overrideは夏humanの実時計境界を無効にしない。計算ルールは9-42と同一。
- 未解決: 夏17時sessionを手動固定し18:00以降に新しく判定すると、表示17時/指定本文lowerと実判定higherが食い違う。逆に夏18:30を実時計17:59に手動選択して判定すると、指定18時以降higherに対し実判定lower。原session時刻と実時計を統一する業務ルール変更は今回行っていない。
- 晴れ25℃弱風・火曜・raw6・auto普通・global0の例: 夏17時17:59は普通lowerで通常/多い=0/10%、18:00/18:01の通常先取りはやや多いhigherで15/25%、手動固定17時18:00はhigherで5/15%。夏18:30を17:59に手動開始するとlowerで15/25%。
- 保存済みlowerは時計だけではhigherへ再解決しない。17:59確定raw6を保持した18:00の先取り率は10/20%、新しく再選択した場合15/25%。現在の率は保存resolvedを使っており、再解決は行わない。「この時間帯」の既存表現を現在時計の毎回再解決と読むと曖昧さが残る。
- 隣接4組はraw9=2/4/6/8を保持して端点5段階を採用する。率平均は使わない。±1制限はauto減り方/quickのみで、full manualは元autoからの距離制限なし。clampで最終率が同じでも方向判定は別。



通常値引・値引率画面の既存full manual判定は5つの基準ボタンを維持する。表示ボタンは1/3/5/7/9、長押し後に隣接項目を選ぶと2/4/6/8を保存する。raw score、選択順、scale、resolution direction/reasonを保持する。旧5段階recordは互換読込し、物理migrationしない。

Review19のraw9は19時時点の人間観測。even scoreを15/17のような最終5段階へ丸めない。Review19の履歴中央値は参考統計であり、正式評価はhuman raw9。9-26以降の新規データは5段階auto判定fieldを生成しない。

### 9-35: Review19だけタップで選択・解除

- 共通selectorへ明示的に `interactionMode="tap-toggle"` を指定するのはReview19のみ。未指定のAreaJudge/Rate手動判定は従来の単独タップ確定・500ms長押し中間評価を維持する。layoutは操作仕様の条件にしない。
- 5つの既存buttonをタップすると選択/解除する。単独または隣接2つだけ有効。非隣接・3つ目の未選択項目はdisabledで、既存選択を置き換えない。選択済みは解除でき、色・枠・aria-pressedで両方を表示する。
- `createHumanEvaluationSelection()` で従来のscore9/選択順へ変換。tap側はclickだけで `onSelectionChange(selection | null)` を呼び、長押しタイマー・振動・中間モードを開始しない。移動/cancel/ghost click保護を共用する。Review19 selector内のtouchstartは親swipeへ渡さない。Enter/Spaceもnative button clickで同じ変更となる。
- 画面内の既存draftはarea/session key付きで `details: HumanEvaluationDetails | null`。同じkeyのnullは明示的全解除を表し、保存済み値へのfallbackをさせない。未編集（draft key不一致）は既存recordを表示する。全解除だけで正式記録を削除しない。
- 有効な残数と評価が揃ったときだけ既存「完了」で確定。選択だけではonCompleteArea/onSave/次エリア移動は起こさず、既存の最終エリア保存payloadを維持する。画面内下書きと保存済み値の区別、戻る/スキップ/修正/reloadの従来復元範囲は維持。新しい永続field/keyはない。
- 短い案内は「タップで選択・解除。迷う場合は隣り合う2つを選択。」。Review19には「中間選択をやめる」を表示しない。raw9・scale・resolutionReason=review19_observation / resolutionDirection=not_applicable・旧5段階互換・JSON形式は非変更。

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
| 内部finalized day / 旧形式の互換builder | `StoredFinalizedDayData` はdaySnapshotを展開した形で `sessions` / `areaCountRecords` を保持する。旧全件日次形式は `records[]`、旧単日形式は `daySnapshot` 配下にこれらを保持する。9-28ではユーザー向け日次export導線を撤去し、互換builderと内部保存は維持。 |
| Review19 export / cloud | 対象 `Review19Result` に含まれる `snapshot.areas` / `daySnapshot.sessions` / `daySnapshot.areaCountRecords` 内のmetadataを保持する。exportでは `records[]`、cloudでは `review19_records.payload` 配下となる。 |
| AreaCount cloud | `area_count_records.record_details.humanEvaluationDetails.evaluationAdjustment`。`buildRemoteAreaCountDetails()` が元recordの `humanEvaluationDetails` をdeep copyする。 |

上記は有効なmetadataを持つsnapshot / recordが対象に含まれる場合の保存・出力経路であり、cloud送信成功や欠損した過去metadataの復元を保証するものではない。exportのlegacy互換処理は既存 `humanEvaluationDetails` を保持し、欠損からquick操作を推測して生成しない。根拠は `types.ts`、`useNebikiApp.ts`、`sessionSnapshots.ts`、`areaCountHistory.ts`、`finalizedDayData.ts`、`dayExport.ts`、`separateDataExport.ts`、`review19.ts`、`areaCountRemoteStorage.ts`、`review19RemoteStorage.ts`。

### 9-27: DoneScreenの重複曜日・時刻表示を削除

通常の値引完了画面は上部の `referenceConditionLabel`（例: `10月・木曜日・17時`）を残し、「全エリアの値引率」内の `BasisTimeMiniPanel` を表示しない。一覧の全行・値引率、ボタン、メモ、日次exportの挙動は維持。DoneScreen内だけのpanel・2helperと不要なreferenceText/timeText props、およびDoneScreenへの2属性渡しを削除した。他画面のpanel、AreaJudgeScreenの曜日・時刻、共通formatter・resolved referenceは変更していない。

## 8. rate、global adjustment、productionAnalysis

rate計算の正本は `discount.ts`、`weekdayBase.ts`、`rateDecisionSnapshot.ts`、`globalDiscountAdjustment.ts`。

### 9-46: 夕方から夜の快適度低下では負の快適補正を5ポイント緩和

- normal/summerの元session15/17のみ。入力済み16/21単時間の気温・風・晴雨雪を既存hourly pointの逆符号で比較（大きいほど不快、clamp前）。絶対差5℃以上かつ21score>16scoreで成立。晴弱23→18℃は-2→-1（超快適→快適）でも対象。未来合計/時刻季節limit/暑さ抑制/新処理を比較に混ぜない。
- `weekdayBase.ts` が既存時刻・季節・雨雪制限後BにB<0のみmin(0,B+5)、その後降水を合算。元session時刻はcontextへ明示し、15late/17earlyにも適用、独立18/19/20は除外。rawカテゴリを変更せず内訳に理由・気温差・前後値を表示。毎回元Bから解決し重複適用しない。
- `getEveningComfortReliefContext()` をhook通常/early、advance/coldに伝播。独自cold/advance規則は不変だが同じWが変わるため、翌日休日summer17/global0のcold25→30等は既存条件の結果として変わる。Review19 reference自身/最終guideの規則は変更しない。
- 新規default/欠損補完予報はoptional weather.eveningComfortUnavailableForecastHoursで区別。3field明示確認後だけ該当hour解除、最後は[]明示patch。新日draftへ持越す数値を本日入力済みとしない。旧完全mapは利用可能、旧集約/欠損は不適用。current/checkpoint/reload/部分修正でmarker保持、未入力を0℃へ変換しない。
- optional eveningComfortReliefに原/effective時刻、比較入力score、差/成立/理由、快適項目B/適用後を保存。確定RateDecisionSnapshot→progress→daily/Reviewsource snapshot→daySnapshot/finalized/analysisexportの既存経路で保持。weatherComfortAdjustmentPercentは既存の合計天候補正意味を維持。過去metadata欠損は補完せず保存済み率/評価/履歴は再計算しない。schema3、新storage key/SQLなし。
- 45の曜日/time自動、notice gate廃止・注意7全文/順序/太字、hint分離、長押しraw9/quick、確定済み評価を時計だけで再解決しない仕様、Review19/archive/cloud/productionAnalysisを維持。

### 9-30: 商品policy「やや不人気」

- 通常商品の中間区分として、実際に10個以上（10を含む）ある場合だけ表示率へ+10 percentage points。9個以下は補正なし。大小パックに分かれる場合は大パックだけが対象で、小パックは補正しない。
- 既存と同じ現場適用の注意事項であり、商品入力・商品別保存・自動計算の機能は追加しない。不人気/見た目が悪い+10、定番/夜売れる/広告-10の既存文言とmetadataは維持する。
- 新規 `rateDecisionSnapshot.otherAdjustments.productPolicy.slightlyUnpopular` は `{ adjustmentPercent: 10, minimumActualCount: 10, splitPackTarget: "large_only" }`。`minimumActualCount` は商品実数の条件であり、エリア残数カウント上限とは別。型はoptionalでschema 3を維持する。
- normal/late/early/finalの新規snapshot builderは既存のpolicy保存位置へ記録する。これは個別商品への適用実績や自動加算ではなく、その時点のpolicy metadata。20:30 forced ruleを含む表示率・計算は変更しない。
- normalizerは入力に存在するpolicyだけを検証・複製する。旧snapshotにこのfieldがなければ欠損のまま読み込み/exportし、過去recordを遡及変更しない。新規metadataは既存session/daySnapshot/Review19/export等のsnapshot伝播経路を使用する。
- 注意事項は `fullMode.ts` の既存segment/太字方式で表示。エリア5段階評価、同一商品の10個カウント上限、先行指示の「多い商品10個以上」、weather/reference/Review19/productionAnalysisは非変更。

### 9-25: 夏17時の快適方向上限

- `weekdayBase.ts` の `applyComfortNegativeLimit()` が唯一の制限判定。rawを-2〜+2に制限し、既存の15時・雨抑制を先に適用した後、`demandCycle === "summer" && discountTime === "17"` の乾燥条件だけraw負値を-2（-10%）まで許可する。raw -1なら-5%、0/正方向は従来どおり。
- dryの15時はnormal/summerとも最大-10%、normal17とnormal/summer18・19は最大-5%のまま。雨あり15時は最大-5%、17時以降の雨ありは快適方向0%、雪は快適補正を使わない。起点/後続雨雪、future weather point、気温低下、風、after-rain recoveryは非変更。
- dryは既存の解決済み降水補正が0の条件を指す。後続枠に雨雪があっても起点判定で降水補正0となる場合は含み、後続天候は従来のfuture weather pointで扱う。雨雪の制限判定を全予報枠の降水有無へ変更していない。
- `getWeekdayBaseInfo()` の第5optional引数にdemandCycleを追加。cycle省略は従来のnormal相当。`getBasisGuideDisplay()` も同じ `resolveWeatherEffect()` を使い、bonus summary/calc/resultと率を一致させる。夏17時には旧「17時以降のため快適方向は-5%まで」を出さない。
- hookの通常計算・early-next対象時刻・手動18開始snapshot、`advanceDiscount.ts`、`sessionSnapshots.ts` のReview19 referenceへ明示的にcycleを渡す。Review19 referenceは19時として計算するので結果は従来どおり。
- 9/13相当の晴れ・弱風・25℃、気温点-2、未来6pt/-1点では夏17時の天候補正-10%。先行率は基本10 - 天候10 + 多い10 + global(-5/0/+5) = 5/10/15%。normal17・global-5では従来の10%。
- 新しく確定する `rateDecisionSnapshot.weatherComfortAdjustmentPercent` は既存のweather bonus入力から-10を保持し、session/daily/day/finalized/exportへ既存経路で伝播する。保存済み-5をnormalization/exportで再計算しない。同identity・同完了signatureの再保存でも既存storage/archiveが旧basis/areasを保持する。migration・schema変更なし。


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
- 18:30値引はDone画面の「18:30値引を開始」等、既存自動clockで許される次枠の明示操作で開始する。9-44でstartの任意時刻selectは廃止。Done画面の操作は既存 `startNextDoneSession()` / `openNextSessionInput()` を使い、weather確認後の `startSession()` で初めて18:30sessionを作る。17時sourceを保持したまま新しい18時の作業mapへ切り替え、開始時に未入力状態の18時 `DailySessionSnapshot` を既存journalへ保存する。
- 同日実開始済みの18:30session、またはその開始snapshotがある場合は `hasStarted1830Session()` がReview19手動・自動開始を抑止する。snapshotはarchive memoryとoperational journalから再ロードされるため、reload後も抑止する。開始画面draftを18にしただけでは抑止しない。legacyの18時sessionは削除・改変しない。
- `resolveDiscountTime()` と `getNextDoneDiscountInfo()` の時刻境界、18:30のweather/rate/AreaCount処理、fixed-time READ ONLYは維持する。9-44で通常manual time設定は廃止し、旧active flagだけ互換解除する。fixed-timeではReview19・snapshot・sessionへのproduction writeを行わない。

### 保存・完了

Review19は保存された季節routeの19時実残数と正式評価human raw9、履歴統計、daySnapshot、calendar/weather、productionAnalysisを持つ。19時input画面は既存9段階の人間入力と短いreference labelを維持し、自動判定結果を表示しない。baseline UIにも自動結果表示はなく、今回の変更は入力・最終保存時の自動判定fieldの生成・保存・採用を止めるもの。

9-26以降 `buildReview19HistoryStatistics()` は19時履歴・共通中央値計算を再利用し（9-36から両cycleの通年履歴）、`pickReview19HistoryStatistics()` のallowlistで履歴統計だけを取り出す。Review19の正式評価には中央値を使わない。新規Review19の `autoEvaluation` / `autoEvaluationStatus` は生成・補完しない。互換用の既存field名 `autoEvaluationBasis` は残すが、新規保存内容はruleVersion、標本充足status、cycle、weekday/group、比較方式・三連休参照、中央値・標本数、短期/長期統計・中央値下落guardのみ。5段階base/final評価、閾値、値引補正、減少補正は含めない。

`recommendationStatus` と `area_count_median_v1` は統計の充足状態・計算由来を示す内部metadataで、Review19の採用評価ではない。人間評価の正式な値は `humanEvaluationDetails.humanEvaluationScore9`、`humanEvaluation` は奇数段階の旧5段階互換値。偶数段階を5段階へ丸めない。

旧auto入りJSONの正規化枝は従来どおり保持する。過去recordを新ルールで再計算・削除せず、archive/export/remote互換を維持。旧版の途中Review19を再開した場合、再入力しないエリアの旧autoが残る場合があるが、UIや主要判断には使わない。新形式の正規化にも同じ統計allowlistを適用し、basisから自動評価を復活させない。

`productionAnalysis` / `productionShortageSuspicion` は従来どおり15/17履歴と19時human raw9を参照する別機能であり、変更していない。実残数、15/17/19履歴、過去同曜日count、median/sample、Review19記録の保存・archive責務は維持する。

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
- 9-22のdownload復帰時にはexport payloadのformat、version、dataSchemaVersion、appVersion、buildId、dataQuality、records、Review19 areaCounts、human/auto evaluation、calendar/weather、productionAnalysis、snapshot、daySnapshot、rateDecisionSnapshot等を変更・削除・要約していない。9-26では新規Review19のauto/status生成を停止し、既存export builderが人間評価と履歴統計をそのまま出力する。downloadはReview19保存、archive、outbox、cloud、localStorage、IndexedDBを変更しない。
- 設定画面の `19:00チェックデータを全件出力` / `最新の19:00チェックデータを出力` は従来どおりJSON downloadする。完了画面は `buildDirectReview19DataExportPayload()`、設定画面は従来の全件/最新export builderを使う。

### 9-41: Review19設定「全件出力」は両cycleの1ファイル

- 9-40までの全件出力は全archiveをnormal/summerの2ファイルへ分けていた。9-41は同じcanonical `archivedReview19RecordsRef.current` を既存 `buildAllReview19DataExportPayload()` へcycle指定なしで渡し、1つのpretty JSONへ出力する。active/current cycleに依存しない。最新/完了直接出力、明示cycle指定のpure builderは保持。
- filenameは `nebiki-review19-all-YYYYMMDD-HHmm.json`。既存JST formatterを再利用し、UIボタン/selectorを増やさない。
- recordのdemandCycle・businessMonth・human/productionAnalysis/calendar/weather/snapshot metadataとlegacy fallbackは保持。root count/dataQualityは既存builderが混在最終集合から再集計する。recordedなincompleteも含める。
- source/dedupeは既存archive: date×cycle×sessionStartedAtでfinal/complete/revision/richness優先。同日別operation identityは保持。local journal/remote ready記録は既存archive canonical upsertを経由し、remote失敗時はlocal archiveを保持。exportに中央値用complete-only merge・新migration/backfillを使わない。
- sortは既存date→実施時刻fallback→sessionStartedAt。通常render/起動へ全履歴処理を追加せず、明示export時だけ生成する。保存・計算・remote query・schema・SQLは非変更。

### 9-22導入 / 9-23表示順: AreaCount自動判定の±1 quick adjustment

- 通常の `rate_display` で履歴自動判定がready、countが存在する15/17/18/19 session（summer/normal）に、元の自動判定から1段上げる・1段下げるボタンをこの順で表示する。fewはhigherだけ、manyはlowerだけ。Review19、fixed-time、20:30、履歴不足・不明は対象外で、full manual selectorは残す。
- quickの基準は常に元の `automaticEvaluation`。連打や反対方向への押し直しで累積しない。`humanEvaluationDetails.evaluationAdjustment` に `applied/source/direction/steps/originalEvaluation/finalEvaluation` を保存し、`areaCountEvaluation` / `suggestedEvaluation` はfinal、`areaCountDecisionBasis.baseEvaluation` はoriginal、`finalEvaluation` と `areaRateAdjustment` はfinalに対応させる。
- 保存は既存 `judgeCurrentArea()` → AreaCount record / current session / checkpoint / daily snapshot / finalized day / export / `record_details` の伝播経路を共用し、`rateDecisionSnapshot`へquick専用metadataを追加しない。既存のmany→slightly_many semanticと値引率engineを維持する。

## 10. Supabaseとfixed-time

- 既存table: `area_count_records`、`review19_records`
- local-first。remote失敗だけで現場入力を失わない。
- pending 0はlocal outboxが空という意味で、remote全履歴同期済みの保証ではない。
- AreaCount manual direct backfill、Review19 pendingなし正本rescue、legacy pending、CAS/finality/in-flight guardを維持。
- 実Supabase mutationは9-26開発検証でも実施していない。

fixed-timeはproduction AreaCount履歴をSupabaseからREAD ONLYで使い、同じmedian engineへ渡す。productionのAreaCount/pending/Review19/finalized/learning/global settingへWRITEしない。fixed-time cycle、clock、temperature、global adjustmentは専用state。

DB migration、SQL、RLS、grant、trigger、service role、client DELETE機能は9-26でも変更していない。

### 9-42: 小パックを除く同一商品20個以上の注意書き

- `fullMode.ts` の `FULL_MODE_NOTICE_ITEMS` に「同一商品が、小パックを含めずに20個以上ある場合は、表示値引率に＋10％。」を独立追加。旧6項目を保持し、やや不人気の後/減り方の前へ置き、計7項目にする。
- 既存emphasis/strong方式で「同一商品」「小パックを含めずに」「20個以上」「＋10％」を強調する。RateDisplayScreenの表示条件・component/styleは非変更、20:30では従来どおり注意事項を表示しない。
- 同一商品の実際の個数で20ちょうどを含む。小パックは判定個数へ入れない。大20なら対象、大15+小10は対象外。＋10％は10 percentage points（表示20→30）。AreaCountの同一商品10個capとは別。
- 現場確認用の注意書きのみ。商品数input/自動加算/state/key/metadataを追加せず、ProductAdjustmentPolicySnapshot/保存形式/値引率の計算は変更しない。不人気/やや不人気などとの重複時の加算方法を新設・変更しない。

## 11. そのほかの現行UX

### 9-47: 開始画面の曜日・時刻は同幅2列

- StartScreenの表示JSXだけを変更。grid `repeat(2, minmax(0, 1fr))` / gap12px、子列minWidth0。左曜日/右時刻、ラベル上・既存表示欄下の2行。順序は全体値引補正→2列→天候。既存文字サイズ・padding/枠/色を維持。
- getWeekdayLabel(sessionDraft.weekday) / getDiscountTimeLabel(sessionDraft.discountTime)をそのまま使う。曜日/time自動、天候入力lock/開始時確定、46快適補正、計算/保存/履歴/Review19/注意7項目は非変更。手動button/select/wheelを復活させない。
- production source103本のうち102本byte-identical。新state/key/metadata/SQL/schema変更なし。実TSX配置/35表示組合せ/既存handlerと360/390実Edgeを別々に検証。

### 9-28: ユーザー向け「1日データ」機能を撤去

- 通常Doneの「1日データを出力」・メモ入力/保存、設定の日次全件/最新出力・日次件数表示、Startの前日廃棄個数入力を削除。上部referenceConditionLabel、全エリア値引率一覧、戻る/home/18:30手動開始は維持。
- 廃棄入力は前日のfinalized recordだけに依存し、値引計算・Review19・productionAnalysisの入力ではないため、UIと専用hook/APIのみ削除。過去recordの `memo` / `discardCount` は読み込み・保持する。
- 日次download handlerと専用state/props/helper、旧未使用統合download actionを削除。Review19の完了時・設定全件/最新の3出力導線は既存builderとdownload処理を維持する。
- `finalizedDayData`、20:30完了時の確定保存/失敗gate、`finalizedDayRecordId`、archive hydration、営業日/cycle判断、snapshot retention、AreaCount backfillは内部機能として維持。手動日次出力を廃止しても、これらの保存処理は必要。
- 日次・統合JSONのpure builder、過去metadata正規化、archive patch APIは互換と既存回帰検証のため維持。これらからユーザーが日次データを表示・downloadするUI/actionはない。
- 保存容量診断とSupabase同期は維持。設定診断の「IndexedDB 1日データ」表示行のみ削除し、内部の件数計測/診断payloadは変更しない。

### 9-31導入 / 9-32プラス補正 / 9-33上限 / 9-34個数表示: 15/17の冷惣菜ガイド

- 既存 `AdvanceDiscountScreen` 内の「冷惣菜」section。元の先行値引3行の文言・率計算・「エリア別値引へ進む」を維持。9-34で「多い」・率に加え「10個以上」だけを既存の赤字で強調し、「ある商品を」は通常色のまま。18:30以降、Review19、fixed-timeは非表示。
- `getColdDeliGuide()` は15/17とも、既存hookの `sessionSourceResolvedWeather`（気温snapshot反映済み）を `getWeekdayBaseInfo(...).baseRateBonus` に渡して、解決済み天候合計Wを取得。雨など個々のプラス要素を足し直さない。Gはsession.globalDiscountAdjustmentPercentを既存normalizerで正規化し、欠損/不正値は0。
- 追加分は `max(W,0) + max(G,0)`。W/Gを先に合算して相殺しない。global+5は率へ一度だけ加算し、global-5は率から引かず以下の独自条件にだけ使う。
- 15時: 上段個数は `2 + 翌日が土日祝なら1 + G=-5なら1`。helperの下段lowCountは従来どおり上段より1個少ない数を保持する。9-34の下段表示は、上段highCountを元に1〜highCount-1個を「1個」「1個・2個」「1個・2個・3個」と列挙する。少ないエリアの表示には個数を付けない。加算前率は20/15/10/5（上段/上段少ないエリア/下段/下段少ないエリア）。4率それぞれへ同じ追加分を加え、各最終値を独立に50%で制限して表示。通常エリアの上限適用後の率から5を引いて少ないエリアを作らない。W/G+5で個数範囲を変更しない。
- 17時: 元W/Gで `翌日土日祝 AND (W=-10 OR (W=-5 AND G=-5))` なら基準25%、それ以外は30%。その後に追加分を加算し、最後に50%上限を適用。翌日休日・W=-10/G=+5は25+5=30%。少ないエリア向けの率低下はなく、既存の「少ないエリア・判断に迷う場合は後回しにしてください。」を維持。
- 翌日の休日はsession実日付から既存 `addDaysToDateString / isJapaneseHolidayOrWeekend` を使用。手動weekday、個人の休日、reference、お盆需要区分で代替しない。
- 9-33の最終式は `min(50, B + max(W,0) + max(G,0))`。15時4率・17時1率それぞれ、加算後に上限を適用する。既存の雪によるW=+20/G=+5では17時30+20+5=55→50%。50%以下は9-32と同一で丸めは追加しない。通常値引engineの上限や20:30 forced ruleは非変更。
- 商品数入力や冷惣菜専用state/key/snapshot/AreaCountは増やさず、既存derivedだけで完結。保存形式・過去データ・Review19は非変更。冷惣菜へ「当日切れ」「10個以上+10%」を追加していない。

### 9-24: 通常Done基準ラベル・15/17先行値引

- 通常 `DoneScreen` に `derived.basisGuide.referenceConditionLabel` を表示する。RateDisplayと同じ既存formatter / resolved referenceを使用し、保存済みlegacy手動曜日、holiday / Obon等の解決（新規通常操作は9-45以降自動曜日）、summer / normalを尊重する。Review19DoneScreenは非変更。
- 通常15/17の新しいsession開始では、天候確認を確定した後 `screen: "advance_discount"` に入り、`AdvanceDiscountScreen` を表示する。18/19/20、Review19、fixed-timeには追加しない。
- 文面は「9月・木曜日・17時を基準に考えて」（9-39以降は営業月）「多い商品のうち10個以上ある商品を」「10％で引いてください」の形でlabel・rateを動的表示。9-34では「多い」・率・「10個以上」は既存RateDisplayと同じ赤、「ある商品を」は通常色。操作は「エリア別値引へ進む」。
- `getAdvanceDiscountRate()` は `getBaseRate()` + `getWeekdayBaseInfo(...resolvedWeather...).baseRateBonus` + 商品が多い固定10を、`applyGlobalDiscountAdjustmentToRate()` でsessionのglobal補正を加算し共通0〜50%へ制限する。0以下も必ず「0％で引いてください」と数値表示する。既存エリア画面の「引かない」は非変更。
- このhelperはsessionのdate / weekday / discountTime / demandCycle / globalと既存解決済みweatherだけを受け取る。AreaCount / median / area評価 / quick / decrease / 商品個別policyを参照せず、lateTimeBonus / early-next補正も新画面の式に加えない。新画面のlabelはsessionの時刻を既存 `getReferenceConditionLabel()` で解決する。
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

- 9-48: 全84/84 checks、専用Sunday-reference28/28、既存三連休33/33、関連長期連休17/17 PASS。47/48の同一fixture実行比較8ケースPASS。実RateDisplay TSXのReact SSRと実ブラウザ確認を区別。
- TypeScript/build/PWA PASS、107 modules/precache10、build `build-20261010-190352-jst`。bundle `/assets/index-Fche_LNf.js` / SHA-256 `71920a6a7274f6223b420a53c5cdecbbe68460e2a521d57876c7a970c68b1c75`。
- focused lint1 existing error/0 warnings（AreaJudgeScreen既存react-hooks/set-state-in-effect）、full9 existing errors/6 existing warnings。47比較file/rule/severity/message新規0、lint例外追加なし。
- 最終production Edge390×844の実操作確認完了。普通日曜優先/fallback/片側/不足、17/18/19/20、実残数→表示率→完了保存/再読込、内訳・Review19人間評価/JSON・開始2列/注意7項目を確認。詳細・タッチemulationの範囲・native未実施・未確認事項はCHANGE_REPORTと外部browser summary参照。
- SQL9/AGENTS/vite/dataVersion/過去CHANGE_REPORT56は47ZIPとbyte-identical。production103本中99本同一。CRC/path/除外物/version/build/schema/distPWA/対象file集合bytes/SHAはZIP再open結果参照。
- 詳細: `CHANGE_REPORT_2026.8.9-48.md`、ZIP外`RELEASE_REPORT_2026.8.9-48.md` / `ZIP_VALIDATION_2026.8.9-48.json`。

## 13. 既知課題、検討中だが未実装の案

既知課題:

- 旧summer18:30 activeを実時計18時前に復元する場合の静的hint不一致。9-44で新規manual time入口は撤去したが、この保存状態例外は残る。第7節の9-44項を参照。業務規則・過去値は非変更。

- 減り方の厳密な20ポイント境界のbinary誤差（40%→60%等）は9-40で17時だけ修正。19:30では従来の比較/境界結果を維持する。9-36通年化時点の計算自体は当時非変更だった。
- full project ESLintに既存9 errors / 6 warnings（9-37は9/7、新規0）。
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

9-48追加: `areaCountHistory.ts`のSunday参照/normalizer/共通formatter、`analysisMetadata.ts`の参照type、`RateDisplayScreen.tsx`の保存根拠details、専用`check-three-day-holiday-sunday-reference.ts`。

9-46追加: `src/domain/eveningComfortRelief.ts`、`weekdayBase.ts`、`hourlyWeather.ts`、`rateDecisionSnapshot.ts`、`useNebikiApp.ts`、`stateNormalization.ts`、`StartScreen.tsx`、専用`check-evening-comfort-relief/flow.ts`。

1. `AGENTS.md`
2. `CHATGPT_HANDOFF.md`
3. `package.json`
4. `CHANGE_REPORT_2026.8.9-48.md`（完成baselineは `CHANGE_REPORT_2026.8.9-47.md`）
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
18. `src/domain/advanceDiscount.ts`、`src/components/screens/AdvanceDiscountScreen.tsx`、`scripts/check-advance-discount*.ts`、`scripts/check-summer17-comfort*.ts`
19. `src/domain/coldDeliGuide.ts`、`scripts/check-cold-deli-guide*.ts`
20. 必要な場合だけ過去CHANGE REPORT / README / SQL artifact

再開時は、version metadataとGit rootの有無を再確認し、最新ZIPとの差分を取ってから編集する。恒久的な検証・packagingルールは `AGENTS.md` に従う。
