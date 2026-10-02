# 2026.8.9-38 変更報告

検証日: 2026-10-01 JST

## 実際のボトルネックと修正

fresh launchのStart/weatherで毎render全archiveをJSON cloneし、Review19件数表示のため全recordをclone/normalizeしてproductionAnalysisまで再構築していた。rich2000件+84日分のReview19/daily/finalized fixtureではrender subset中央値だけ約724.3ms（Node監査）。Edge CPU4倍ではnavigation0の天候変更でも約2.2秒となり、navigation24の有無だけでは説明できなかった。

### 9-38: 起動直後の天候入力と復元処理の重複削減

- 起動用設定・archive snapshotはlazy useStateで1回取得する。以前のuseRef引数の全archive deep cloneが毎renderで評価される処理を廃止。Review19件数は既に正規化済みのrecorded recordを数えるだけで、export builder/productionAnalysisをrenderから呼ばない。
- 日次履歴・Review19 source・pendingの派生viewは実際の保存/同期/他タブstorage eventで更新する。日次wrapperはjournal bytesが変わった場合だけinvalidateし、Done completion effectの再保存循環を防ぐ。weather/early-nextの履歴参照も同じcached viewを使い、30秒clockで全履歴を再読込しない。業務確定handlerのfresh readは維持。
- AreaCountのprivate WeakMap/prepared indexは維持。useMemo内のlazy get()で最初のrecommendation時に同期準備する。Start/weatherでは全件prepareせず、AreaJudgeの実計算より前に必ずreadyになる。Review19のlazy prepared履歴も維持。
- navigationはscreen/area/finalTimeStepの変化を先に確認し、変化なしでは既存履歴をcloneしない。既に隔離された履歴entryは不変として共有し、追加/復元時に対象snapshotだけdeep copy。previousRenderRefはimmutable AppState参照を保持し、weather項目ごとに複製しない。
- runtime effectはnavigation/undo等の実際のruntime条件だけに依存。current/checkpointには1回のnormalized snapshotとserializeを共用し、実localStorage bytesが一致すればwriteを省く。天候変更は従来どおり直ちに保存し、debounce/blur依存は導入しない。quota retry時や欠損copyは実storage比較で再保存する。
- 期間外のnormal lockとseason-normalizationが交互に更新される既存effect循環を解消。inferred lock候補にも既存normalizeDemandCycleStateForBusinessDateを通すだけで、7〜9月の夏季gate・active cycle・値引率は変えない。
- archive repositoryが既にcanonical化した結果は、対応legacy fallbackが空なら再mergeしない。legacy overlap/失敗時の復元経路・migrationのverify/delete順・clone getterの独立性は維持。


## 保存・業務互換

weather1変更の即時current/checkpoint保存を維持し、保存頻度を落としていない。最新天候入力はreload/checkpoint-only recoveryで復元し、back/undoは対象snapshotを復元する。daily/archive/outbox/remote identity/schemaは非変更。preparedの実計算は同期でreadyとなり、履歴不足を一瞬表示するraceを作らない。sourceと未完了areaの保存経路も維持する。

過去recordを再計算/書換えしない。productionAnalysis定義、weather、夏17快適-10、cold guide、global、weekday/calendar、商品policy、rate、20:30、季節商品、manual18/Review19通常ルート、raw9/tap-toggleはbyte-identicalまたは全既存checkで確認。新しいmode/入力UI/永続field/SQL/migrationはない。

## 変更ファイル

production6本:
- src/app/App.tsx
- src/hooks/useNebikiApp.ts
- src/hooks/nebikiApp/stateNormalization.ts
- src/domain/historicalArchiveRuntime.ts
- src/domain/navigationHistory.ts
- src/domain/storage.ts

専用test: scripts/check-startup-archive-performance.ts、scripts/check-interactive-persistence.ts。
既存testのharness更新: check-advance-discount-flow.ts、check-early-next-17-continuity.ts、check-review19-priority-transition.ts、check-session-completion-storage-safety.ts。business確定条件の期待値は変えず、cached view/safe日次wrapper/sharedserializeの実経路を追うよう更新。
package.json(version+check2本)、package-lock.json(version)、CHATGPT_HANDOFF.md、本CHANGE_REPORT、dist/*。
AGENTS.md、root SQL9本、過去CHANGE_REPORTは9-37 ZIPとbyte-identical。

## 検証

- 全check:* **71/71 PASS**（既存69+新規2）。startup専用6/6、interactive/recovery12/12。
- 1260 recommendation +32 Review19統計を9-37との全出力比較で一致。9-36互換は以前の1260/32比較と37/38計算source同一hashで確認（新たな36再実行とは区別）。
- TypeScript / production build / PWA generateSW PASS、101 modules / precache10。
- focused ESLint **0 errors /3 existing warnings**。full **9 errors /6 warnings**（9-37 baseline9/7）。file/rule/severity/message比較で新規error/warning0、既存warning1件減。既存largechunk/Browserslist warningは残る。
- 恒久structuraltest: no-nav weather historyclone0/runtimewrite0/wholeAreaCountprepare再実行0、fullAppStateclone1。同条件のrender onlyと17:05台の30秒clock fixtureはJSONparse/stringify/storage reads/writes/history/preparation0。業務時刻境界・Done保存は別途確認。24件履歴、next/back/undo/reload、checkpoint-only crash、missing/stalecopy recreation、quota retry、dailyDone安定化、他タブstorage更新を確認。

## Release

- appVersion: `2026.8.9-38`
- buildId: `build-20261001-223736-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-38.zip`
- SQL / Supabase schema / RLS / grant / trigger変更なし。
- AGENTS.md変更なし。version/buildId生成方法変更なし。

## 未確認・測定上の制限

実店舗物理端末、native touch、インストール済みPWA、実Supabase通信/remote取得時間、店舗全過去archive、物理crash/長時間backgroundは未確認。Edgeは隔離fixture、固定営業日時、実Performance API/タイマー、software touch/click。CPU4倍はAndroidの近似で実店舗保証ではない。

計測用production buildには外部instrumentationを使用し、releaseには含めない。関数spanは入れ子を含むため単純に足さない。通常productionとの補助比較を区別する。archive gateのread後canonical処理は残り、AreaCount反復が速いことだけで全体の問題が解決したとはしない。

## Edge性能測定（最終clean比較）

CPU4x, 390×844, production Vite builds, isolated synthetic data. Function timings are inclusive and overlap. A layout effect marks the real React commit; rAF marks a frame opportunity, not physical paint. Native timers/performance are preserved; only Date is fixed. No concurrent CPU benchmark ran during the final clean matrix.

|AreaCount records|Navigation history|37 first interactive commit ms|38 first interactive commit ms|37 weather ms|38 weather ms|37 median / p95 / max ms|38 median / p95 / max ms|
|---:|---:|---:|---:|---:|---:|---|---|
|0|0|401.9|418.7|17.4|14.6|12.3 / 17.4 / 17.4|9.5 / 14.6 / 14.6|
|500|0|1996.3|1388.4|636|13.6|612.6 / 650.4 / 650.4|9.9 / 19.8 / 19.8|
|1000|0|3483.3|2298.5|1236.1|13.8|1201.3 / 1236.1 / 1236.1|9.6 / 13.8 / 13.8|
|2000|0|6398.7|4010.8|2454|14.9|2410.6 / 2554.4 / 2554.4|9.3 / 14.9 / 14.9|
|2000|5|6343.7|3972.8|2468|16.1|2413.8 / 2468 / 2468|9.6 / 16.1 / 16.1|
|2000|12|6419.2|3990.8|2446.5|15|2395.4 / 2460.5 / 2460.5|9.3 / 15.7 / 15.7|
|2000|24|6344.3|4303.5|2467.8|15.2|2353.5 / 2467.8 / 2467.8|11.9 / 16.5 / 16.5|

|2000 records / history24 weather change|37|38|
|---|---:|---:|
|fullAppStateClones|29|1|
|persistedSnapshotBuilders|2|2|
|JSONstringify|65744|14|
|JSONparse|1553|1|
|localStorageGet|55|40|
|localStorageSet|13|10|
|IndexedDBread|0|0|
|IndexedDBwrite|0|0|
|historySnapshotClone|24|0|
|historySnapshotCreate|1|0|
|runtimeWrite|1|0|
|currentSessionWrite|2|1|
|checkpointWrite|2|1|
|historicalDailyGetter|2|0|
|historicalDailyStorageRead|2|0|
|AreaCountPrepare|0|0|
|Review19Prepare|0|0|
|archiveFullSnapshotGetter|2|0|
|Review19NormalizeClone|2|0|
|productionAnalysis|168|0|

|CPU4x representative operation, 2000/history24|37 handler→setState / reducer / state→commit / commit→rAF / settled total ms|38 same ms|
|---|---|---|
|fresh.weather.change|0 / 0 / 1221.1 / 35.8 / 2467.8|0 / 0 / 5.1 / 4.2 / 15.2|
|fresh.temperature.change|0 / 0 / 1137.2 / 35.5 / 2326.5|0 / 0 / 3.3 / 2.5 / 13.4|
|fresh.wind.change|0 / 0.2 / 1181.2 / 28.1 / 2353.5|0 / 0.2 / 2.3 / 2.6 / 8.5|

|Startup phase, 2000/history24|37 ms|38 ms|
|---|---:|---:|
|firstAppRenderMs|191.5|167.9|
|firstHookRenderMs|4733|3794.6|
|firstInteractiveCommitMs|6344.3|4303.5|
|firstInteractiveFrameMs|6344.9|4304.1|
|firstInteractiveObservedMs|9307.3|4571.9|
|moduleResponseEndToFirstAppMs|126.6|125|
|currentPersistenceHydrateMs|19.9|27.2|
|IndexedDBopenElapsedMs|60.1|1.8|
|migrationCheckMs|115|57.9|
|archiveHydrateInclusiveMs|4064.4|3049|
|lastArchiveReadSuccessToHydrateReturnMs|3826.2|2798.3|
|AreaCountPrepareMs|399.7|0|
|Review19PrepareMs|0|0|
|archiveFullSnapshotCloneMs|1265.3|748.6|
|Review19NormalizeCloneMs|2461.2|0|
|hookRenderInclusiveMs|4230.5|497.9|

Archive post-read tail means the elapsed interval from the final native getAll success callback to hydrate return. Earlier per-store JavaScript normalization can run before that final callback; the tail is not all archive JS. Archive hydrate includes I/O and JS. Hook/clone/merge times must not be added to latency because their spans overlap. Action total starts at captured click and ends at the rAF after the last observed layout commit. Pointerup→handler is reported separately. The first commit time and the first commit’s frame time are separate summary fields.

The principal baseline bottleneck is rich Review19 normalization/cloning plus the entire historical archive snapshot clone during ordinary hook renders. Navigation history contributes clones but the2000/history0 case is already slow. 38 removes those operations from unchanged weather fields. AreaCount and Review19 preparation remain reused and are absent from these field changes. Current/checkpoint recovery copies remain saved immediately.

Full reload/back/wait/work-return, clock, render-only, uninstrumented release, and Done evidence is embedded in final-browser-summary38.json. Full before/after uses the same final valid-pending fixture at2000/history24; the earlier baseline auxiliary run is excluded. After38 also completes full flows for0/500/1000/2000 at history0. The wait is3 seconds after reload actions; this does not measure long background suspension. Done completes the last remaining area and then observes3 seconds of settled state. Root release report supplies domain result compatibility, recovery checks, all check:* results, TypeScript/build/PWA/lint, production change files, SQL comparison, ZIP reopen validation and SHA-256.

|Actual uninstrumented production bundle,2000/history24|37 click→second rAF ms|38 click→second rAF ms|
|---|---:|---:|
|fresh.weather.change|1145.8|10.6|
|fresh.temperature.change|1139.7|8.1|
|fresh.wind.change|1135|7.7|

The uninstrumented bundles use native JSON and Storage functions and carry no diagnostic handler/commit wrappers. Their13-control distributions compare the same fresh actions, excluding later reload/wait/back actions. They show the practical event-to-frame improvement while the diagnostic matrix explains operation counts. Actual physical display paint remains unmeasured.

Fixture bytes (UTF-8; browser storage uses UTF-16 DOM strings): {"appStateUTF8":20059,"currentSessionUTF8":20059,"runtimeUTF8":504962,"navigationSnapshotUTF8":20191,"navigation24UTF8":484619,"areaCountHistoryUTF8":2647676,"review19ArchiveUTF8":9942451,"finalizedArchiveUTF8":6583207,"dailyArchiveUTF8":2082613,"archiveDays":84}.

Remaining startup work is explicit: archive normalization/hydrate still causes long tasks. No shop-device, installed PWA, real Supabase mutation, long background sleep, native Android touch or complete real shop archive was measured.

### navigation操作とlong task

|件数 / navigation履歴|次時刻37→38 ms|前時刻37→38 ms|startup long tasks37→38（件数 / 最大ms）|weather controls long tasks37→38（件数 / 最大ms）|
|---|---|---|---|---|
|0 / 0|15.2 → 11.1|12.3 → 12.8|3 / 136 → 3 / 137|0 / 0 → 0 / 0|
|500 / 0|619.4 → 11.2|622.2 → 11.1|8 / 533 → 6 / 511|26 / 416 → 0 / 0|
|1000 / 0|1227.7 → 12.2|1220.5 → 10.2|7 / 2183 → 5 / 1511|26 / 649 → 0 / 0|
|2000 / 0|2423.8 → 12.8|2446.6 → 11.5|8 / 4216 → 6 / 2889|26 / 1360 → 0 / 0|
|2000 / 5|2467.4 → 13.2|2409.5 → 9.6|9 / 4118 → 6 / 2868|26 / 1296 → 0 / 0|
|2000 / 12|2460.5 → 13.7|2452.7 → 13.9|10 / 2450 → 6 / 2872|26 / 1270 → 0 / 0|
|2000 / 24|2444.8 → 14.3|2382.8 → 13.3|9 / 4113 → 6 / 3168|26 / 1259 → 0 / 0|

long taskはPerformanceObserver（50ms以上）の実観測。各行の操作分布は13種類の異なる操作を1回ずつ集計したmedian/p95/maxであり、同一操作を13回反復した統計ではない。startup代表値も各条件1回の観測。rAFは次描画の機会で、物理画面のpaint完了を保証する測定ではない。

比較営業日は2026-09-30に固定した。10月の期間外normal lockと季節正規化のeffect往復は別に検出し、9-38で同じ中央正規化を通すよう修正した。10月の安定化は恒久hook testで確認したが、before側が安定しない条件の時間をこの比較へ混ぜていない。

### 3種類の入力の処理回数（2000件 / 履歴24）

|処理|天候37→38|気温37→38|風速37→38|
|---|---|---|---|
|fullAppStateClones|29 → 1|29 → 1|29 → 1|
|persistedSnapshotBuilders|2 → 2|2 → 2|2 → 2|
|JSONstringify|65744 → 14|65744 → 14|65744 → 14|
|JSONparse|1553 → 1|1553 → 1|1553 → 1|
|localStorageGet|55 → 40|55 → 40|55 → 40|
|localStorageSet|13 → 10|13 → 10|13 → 10|
|IndexedDBread|0 → 0|0 → 0|0 → 0|
|IndexedDBwrite|0 → 0|0 → 0|0 → 0|
|historySnapshotClone|24 → 0|24 → 0|24 → 0|
|historySnapshotCreate|1 → 0|1 → 0|1 → 0|
|runtimeWrite|1 → 0|1 → 0|1 → 0|
|currentSessionWrite|2 → 1|2 → 1|2 → 1|
|checkpointWrite|2 → 1|2 → 1|2 → 1|
|historicalDailyGetter|2 → 0|2 → 0|2 → 0|
|historicalDailyStorageRead|2 → 0|2 → 0|2 → 0|
|AreaCountPrepare|0 → 0|0 → 0|0 → 0|
|Review19Prepare|0 → 0|0 → 0|0 → 0|
|archiveFullSnapshotGetter|2 → 0|2 → 0|2 → 0|
|Review19NormalizeClone|2 → 0|2 → 0|2 → 0|
|productionAnalysis|168 → 0|168 → 0|168 → 0|

fullAppStateClonesはnamed cloneAppStateの呼出し回数。JSON.stringify/parseは小objectも含む全呼出し回数で、すべてが巨大AppStateのserializeではない。historicalDailyStorageRead / AreaCountPrepare / Review19Prepareが0であることを別に確認する。残るoperational read/writeは即時保存・headroom確認等であり、履歴全件の再parseとは区別する。

|操作別inclusive処理時間ms（2000件 / 履歴24）|天候37→38|気温37→38|風速37→38|
|---|---|---|---|
|useNebikiApp|2424.1 → 3|2284.6 → 2.2|2319.4 → 1.3|
|AppRouter|0 → 0.2|0 → 0|0 → 0|
|StartScreen|0.7 → 0.7|0.8 → 0.5|0.3 → 0.2|
|cloneAppState|9.0 → 0.4|9.6 → 1|7.5 → 0.4|
|clonePersistedNebikiStateSnapshot|1.3 → 0.6|0.9 → 0|0.8 → 0.1|
|getHistoricalArchiveRuntimeSnapshot|674.2 → 0|611.9 → 0|630.3 → 0|
|cloneReview19Records|1620.9 → 0|1547.3 → 0|1567 → 0|
|buildProductionAnalysis|32.7 → 0|31.7 → 0|29.0 → 0|
|getHistoricalDailySessionSnapshots|124.5 → 0|122.3 → 0|119 → 0|
|appendNavigationHistory|7.6 → 0|8.9 → 0|6.5 → 0|
|savePersistedNebikiStateWithAuxiliaryRecovery|2.7 → 0.9|2.3 → 1.1|2.2 → 1.6|
|saveWorkSessionCheckpointSafely|1.1 → 0.6|1.4 → 0.5|1.4 → 0.1|
|JSON.stringify|1157.4 → 0.5|1085.2 → 0.4|1108.5 → 0.5|
|JSON.parse|725.2 → 0.2|692.7 → 0.6|705.5 → 0.3|
|localStorage.getItem|2.3 → 0|2 → 0.2|2.2 → 0|
|localStorage.setItem|7.8 → 0.7|7.8 → 0.7|7.1 → 0.7|
|IndexedDB.read|0 → 0|0 → 0|0 → 0|
|IndexedDB.write|0 → 0|0 → 0|0 → 0|
|storage.setItem:nebiki-helper/runtime-state|7 → 0|6.8 → 0|5.8 → 0|
|storage.setItem:nebiki-helper/current-session|0.4 → 0|0.2 → 0.2|0.5 → 0.1|
|storage.setItem:nebiki-helper/work-session-checkpoint|0.3 → 0.3|0.4 → 0.1|0.5 → 0|

0msは未呼出し、またはtimer分解能内の短い処理。各spanは包含関係を持ち、JSON時間とclone/render/persistence時間を足してtotalを作らない。weather panel内の全callbackや全componentを個別に分離したReact Profiler captureではない。

### fixture容量

|項目|UTF-8 bytes（2000件 / 履歴24）|
|---|---:|
|appStateUTF8|20059|
|currentSessionUTF8|20059|
|runtimeUTF8|504962|
|navigationSnapshotUTF8|20191|
|navigation24UTF8|484619|
|areaCountHistoryUTF8|2647676|
|review19ArchiveUTF8|9942451|
|finalizedArchiveUTF8|6583207|
|dailyArchiveUTF8|2082613|
|archiveDays|84|

容量表は最終clean比較のfixture値。Review19/daily/finalizedも含むrich archiveで、以前のAreaCountのみのfixtureやNodeメモリadapterの数値とは異なる。runtimeはundoとnavigation24件を含む。localStorageの実quotaはUTF-16等実装依存なのでUTF-8値をそのままquotaとみなさない。

### reload / 起動後待機 / 作業から戻る

|操作（rich2000件）|37 ms|38 ms|
|---|---:|---:|
|reload.weather.change|2475|11.4|
|reload.temperature.change|2265.7|13.7|
|waited.weather.change|2282.9|11.5|
|navigation.weather.complete|2713.2|289.6|
|work.return.weather|1345.4|31.8|
|work.weather.modify|2357.9|9.2|
|renderonly.settings.open|1210.7|76.9|
|renderonly.settings.close|1170.3|3.4|

最新weatherのreload復元: 37=True /38=True。38 clock counter: `{"fullAppStateClones": 0, "persistedSnapshotBuilders": 0, "JSONstringify": 1, "JSONparse": 0, "localStorageGet": 0, "localStorageSet": 0, "IndexedDBread": 0, "IndexedDBwrite": 0, "historySnapshotClone": 0, "historySnapshotCreate": 0, "runtimeWrite": 0, "currentSessionWrite": 0, "checkpointWrite": 0, "historicalDailyGetter": 0, "historicalDailyStorageRead": 0, "AreaCountPrepare": 0, "Review19Prepare": 0, "archiveFullSnapshotGetter": 0, "Review19NormalizeClone": 0, "productionAnalysis": 0}`。

最終ブラウザclock観測では小さいJSON.stringifyが1回残る。JSON.parse・Storage・full AppState/history clone・archive getter/normalize・population preparation・productionAnalysisは0。全操作が0という意味ではなく、前述の恒久testの同条件fixtureとは区別する。

fresh matrixは7条件を比較し、9-38のreload・待機後・AreaJudgeからweatherへ戻る追加フローは0/500/1000/2000件・2000件navigation24の5条件で確認。before側との追加フロー比較はrich2000件navigation24のcontextを使う。AreaJudgeまでの全フローを全7条件で反復したとはしない。back/undo/checkpoint-only crashは恒久testでも確認。物理クラッシュ・ブラウザの強制終了試験とは区別する。

### instrumentationを含めない完成buildの補助確認

|version / 条件|first interactive観測 ms|操作median / p95 / max ms|
|---|---:|---|
|37 / 2000件 / 履歴24|8422.1|1135 / 1157.5 / 1157.5|
|38 / 0件 / 履歴0|605.1|7.9 / 10.3 / 10.3|
|38 / 2000件 / 履歴24|3950|7.9 / 10.6 / 10.6|

補助値は無instrumentation buildに対するbrowser event→2回目rAF等の観測。上表のinstrumented handler→React commitと同じ測定境界ではないため、直接混ぜて比較しない。完成buildのmetadata一致を確認し、application console error/warning・不要な外部通信はすべて0。Done表示後の安定化: {"completed": true, "settledHookRenders": 0, "settledOperations": {}, "screen": "done"}。

|無instrumentation完成コード・2000件/履歴24（event→2回目rAF）|37 ms|38 ms|
|---|---:|---:|
|fresh.weather.change|1145.8|10.6|
|fresh.temperature.change|1139.7|8.1|
|fresh.wind.change|1135|7.7|

全JSON等の計測wrapperはbaseline側の時間を大きく増やすため、細かな内訳・構造回数はinstrumented比較、実際の完成コードの入力応答はこの無instrumentation補助比較を優先して読む。

### startup監査と測定範囲

JS startupはmodule response end→最初のApp renderを代理区間として記録した。IndexedDB open、migration check、hydrate、last read→hydrate return、hook load/renderとprepared populationの実測は上のphase表を参照。current session / checkpoint / runtime / undo / calculator / weather / demandCycle / globalは既存loaderによる復元を保持する。日次・Review19・finalized・AreaCount archiveのhydrate順・legacy migration順も維持し、repositoryのcanonical結果と空fallbackとの重複mergeだけを省く。pending/sourceは初期viewと実更新時だけ読込む。

read後のJSはlast native getAll成功→hydrate returnのtailと、normalize/cloneのinclusive spanで確認した。複数storeの処理は最後のread完了以前にも走るため、tailだけを全archive JS時間とはしない。remoteはlocal-firstを維持し、非空取得時の既存mergeを保持。今回は実Supabase取得を行っていないのでnetwork/I/Oとremote mergeの実時間は未計測。

React hook/commitと表示中componentのspanを採取し、weather変更時に非表示のDone/AreaJudge/Review19 componentをrenderしないことを確認。今回、全componentの恒久memo化やcallback整理はしていない。archive clone/統計deriveの除去とstorage再読込抑制を優先し、無関係なUI最適化は加えていない。

実店舗2026-10-01 JSONはreadonlyで確認し、SHA-256 `0fb658d004118e287d1572d1b066dc454be059ab1d9fbedb9ef5ea2bc8d3e044`を維持。これは1日のexportであって端末の全archiveではないため、店舗全体の容量や実機の体感改善までは断定しない。

