# 2026.8.9-37 変更報告

検証日: 2026-10-01 JST

## 変更内容と根拠

9-36をbaselineに履歴判定の反復前処理を軽量化し、17時sessionの18:25後fallbackを修正、夏商品/秋商品を季節枠へ対応した。実9-35/9-36 ZIPのコードと共通fixtureを比較し、ユーザー提供の実店舗JSONはread-only使用した。

### 重さの実測

9-36はrecommendationごとに全履歴normalize、stable sort、保存identity merge/deep clone、再sort、計算identity canonical化を繰り返していた。AreaJudgeのrender計算と毎renderで変わるcallbackが30秒clock/電卓等でもこれを呼び得る。2000件の9-36はnormalize約7.92ms、canonical化約12.15ms（mergeのみ約7.73ms、内数）、全判定約20.06ms。9-35/9-36の同条件5回warm測定では約15.6〜15.8%の増加を確認した。startup mergeやnavigation cloneの9-35→36差分はなく、既存clone経路自体は今回変更しない。これを店舗全体の体感遅延の唯一原因とは断定しない。

| 履歴件数 | 9-35 warm/回 | 9-36 warm/回 | 9-37 prepared warm/回 | 100回: 9-35 / 9-36 / 9-37 | 9-36の9-35比 | 9-37の9-35比 |
| ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 500 | 4.50ms | 5.21ms | 0.027ms | 450.06 / 521.31 / 2.71ms | 1.158倍 | 0.0060倍 |
| 1000 | 8.81ms | 10.19ms | 0.030ms | 880.83 / 1018.67 / 3.01ms | 1.156倍 | 0.0034倍 |
| 2000 | 17.35ms | 20.06ms | 0.037ms | 1735.06 / 2006.00 / 3.73ms | 1.156倍 | 0.0021倍 |

| 履歴件数 | 9-35 cold/回 | 9-36 cold/回 | 9-37 cold/回（前処理込み） |
| ---: | ---: | ---: | ---: |
| 500 | 12.09ms | 11.35ms | 13.86ms |
| 1000 | 9.35ms | 10.49ms | 15.78ms |
| 2000 | 18.00ms | 20.03ms | 28.10ms |


warmは同じ履歴・変化するcount100回を5round測定した中央値。coldは同processの最初の判定で9-37は明示前処理込み（isolated browser startupではない）。9-35/36は同一事前run、9-37は別の短いisolated run。CPU時間が途中で変動した長い再測定はheadlineに使わず、`benchmark-time-drift37.json`に残した。厳密な端末横断speedup保証ではなく、構造testを主保証とする。新初回前処理約13〜28msを隠さず、warm反復処理の削減を改善対象とした。

### 17時基準へ戻る原因と修正

旧helperは17時sessionで18:00〜18:24だけtarget18を返し、18:25でnullになった。17→18session自動開始を廃止したflowと噛み合わず、effectiveRateDiscountTimeが17へfallbackしていた。実JSONの18:11/18:22→18と18:27→17のsnapshotが同経路を裏付ける。17時の時計上限だけ撤去し、Review19の3画面を明示除外。session変更・manual18開始・既存manualtime/fixed-time除外は従来経路を使う。17:59は17、18:00/24/25/30/40/54は18:30基準-5。weather/global二重加算なし、oldsnapshot非書換え、skip carry、reload/back/next、18:55Reviewを確認した。

### 9-37: 履歴前処理の再利用・17時early-next継続・季節商品

- AreaCountは `prepareAreaCountCalculationPopulation()` でnormalize/canonical化・area/time索引を履歴変更時だけ作る。hookは `[areaCountRecords]` のuseMemo、recommendation callbackはarea/date/time/weekday/cycle等の明示依存useCallback、AreaJudgeはcount/callbackをuseMemoする。30秒clock、電卓表示等の同条件renderで全履歴を再構築しない。
- prepared populationは呼出側が明示的に渡す不変snapshot。内部索引はprivate WeakMap、返す選択履歴は独立clone。従来のpreparedなし呼出は毎回freshに計算し、入力配列のin-place変更にも対応する。保存のcycle-aware canonical merge、通年計算時の1観測化、16/52・3件・group/long guard・decrease・20:30の意味は変更しない。
- Review19履歴も `prepareReview19HistoryPopulation()` へまとめて準備し、local/remote arrayが置き換わったときだけmemory mergeと前処理を再実行する。統計だけを返し、廃止済みの5段階auto判定は復活させない。archive/outbox/localStorage/Supabaseの責務は変更しない。
- 17時sessionのearly-nextは18:00以降に `effectiveRateDiscountTime="18"` / `calculationMode="early_next_minus5"` を使い続ける。旧18:25上限を廃止。別session・既存manual time override/fixed-timeでは従来どおり対象外、Review19 weather/input/doneではhookの明示flow guardで終了する。通常Doneの現時点表示は継続。18:55 Review19、18:30 manual only、次時刻skip予約、保存済みsnapshot非書換えを維持する。
- `ryomi` のIDは維持し、master表示名だけ「夏商品」。新規 `autumn`「秋商品」は独立ID。6〜9月はryomi、10〜11月はautumn、12〜5月は季節枠なし。新sessionはsession日付を基準に、天ぷらとコロッケ系の間へ片方だけ置く。通常/Done/Review19/dataQuality/exportで対象数12/12/11を揃える。
- 保存済みroute/map/expectedAreaIdsを尊重し、9-36以前の10月11エリアへ秋商品の欠測を捏造しない。Review19Result/Review19Check/Review19DaySnapshotへschema3互換optional `expectedAreaIds` を保持し、legacyは保存証拠と当時の季節枠から解決する。legacyの `areaName:"涼味商品"` は物理変更しない。現masterから表示する画面と新snapshotは「夏商品」。ryomiとautumnのhistory/median/Review/analysis/backfillは独立、autumn3件未満は既存insufficient/manual。
- 巡回のunfinished priority順と表示用canonical順を分け、Done/Review19/日次snapshotでは保存された季節slotの通常業務順を使う。他エリアの順を変えない。productionAnalysisの判定関数・定義はbyte-identical、追加エリアを渡す対象範囲だけ拡張。


## 変更ファイル

production source16本:

- `src/components/screens/AreaJudgeScreen.tsx`
- `src/domain/area.ts`
- `src/domain/areaCountHistory.ts`
- `src/domain/dayExport.ts`
- `src/domain/earlyNextMinus5.ts`
- `src/domain/finalizedDayData.ts`
- `src/domain/pending.ts`
- `src/domain/review19.ts`
- `src/domain/review19Evaluation.ts`
- `src/domain/types.ts`
- `src/hooks/nebikiApp/normalFlow.ts`
- `src/hooks/nebikiApp/review19Flow.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/nebikiApp/timeTransitions.ts`
- `src/hooks/useNebikiApp.ts`

- 性能: AreaCount/Review19統計helper、hook memo/callback、AreaJudge memo。
- early-next: helper17上限撤去、hookReviewflowguard。18→19の既存19:25上限は非変更。
- 季節: area/types、normalFlow/pending/stateNormalization/timeTransitions、Review19/source/snapshot/day/finalizedの保存対象互換。
- 専用/更新test: `scripts/check-advance-discount-flow.ts`, `scripts/check-area-count-performance.ts`, `scripts/check-early-next-17-continuity.ts`, `scripts/check-integration.ts`, `scripts/check-logic.ts`, `scripts/check-quota-root-fix.ts`, `scripts/check-refactor-characterization.ts`, `scripts/check-review19-completion-safety.ts`, `scripts/check-review19-lightweight-outbox.ts`, `scripts/check-review19-priority-transition.ts`, `scripts/check-review19-remote-storage.ts`, `scripts/check-seasonal-areas.ts`。
- `package.json`（version/check3本登録）、`package-lock.json`（version）、`CHATGPT_HANDOFF.md`、本報告、`dist/*`。
- AGENTS.md、SQL9本、過去CHANGE_REPORTは非変更。

## 検証

- 全 `check:*` **69/69 PASS**。専用: 性能7/7、17時early-next14/14、季節商品30/30。全check名集合はpackage.jsonと一致。
- 9-36との全出力比較 **1260 recommendation + 32 Review19統計一致**。mixed cycle、重複revision、date exclusion、calendar/group/long guard、減り方/20:30を含む。入力非破壊を確認。恒久performance testは500/1000/2000件で100回のcount変更時にraw履歴読取0・全件sortなし、cache更新/戻り値独立性・実hook/AreaJudge memoの時計再renderと条件変更を検証する。
- TypeScript / production build / PWA generateSW PASS（101 modules、precache10）。従来の大chunk/Browserslist data警告は残る。version/build生成方法・schema3は非変更。
- focused ESLint **1 errors / 4 warnings**、全体 **9 errors / 7 warnings**。9-36 baselineとfile/rule/severity/message比較、新規error/warning **0**。既存AreaJudge effect error、hook4warnings等を含む既知診断は変更しない。
- Edge production preview（headless、390×844）**13 scenario groups / 502 actions PASS**。四季境界通常→Done→18:55Review→全エリアhuman入力→4件の実JSONdownload/parse、17:59〜18:54の実snapshot・weather/global一回・next/back/reload/既存snapshot保持、500/1000/2000件rich混在履歴のstart/weather/AreaJudge/calculator/rate/next/back/全Done/Reviewを確認。
- browser action Performance API: 500件median15ms/p9541ms/max61ms、1000件17/55/72ms、2000件21/76/91ms（各78action）。500件のlong taskは0、1000件は起動時66msが1件、2000件は起動時146msと操作中50/51/52/53/56/62/62msが7件。新規raw9 metadataを含む約0.54/1.07/2.15MBの履歴で、初期hydrate/準備や保存側のmain-thread作業は残る。pointerupから表示/次frameまでの自動操作往復を含む時間で、pure React commit/実店舗端末性能ではない。横overflow、アプリconsole error/warning、pageerror、不要外部通信0。既存Review alert8件、要求したJSONdownload4件のみ。SWblocked環境warning9件はアプリ診断と別計上。
- 実店舗JSON（2026-10-01、1Review・AreaCount22件）をread-only確認。tempura18:11/onigiri18:22はeffective18、fry_chicken18:27はeffective17へ戻っており旧18:25上限と一致する。実JSONのwarm100回は9-35=85.55ms、9-36=87.98ms、9-37prepared=1.68ms。実JSONは当日分だけで店舗の過去archiveを含まず、全店舗履歴の体感latency原因すべてを断定しない。入力ファイルbytesは維持。
- production97 source中81本が9-36とbyte-identical。変更16本は今回性能/early/季節互換に限定。SQL9本、AGENTS.md、過去CHANGE_REPORT、rate/weather/quick/冷惣菜/商品policy/productionAnalysis定義/remote/SQL責務・version/build生成方法を維持。
- GPT-6.1 Sol / Ultraのみ使用（並列agentを含む）。

未確認: 実Supabase通信、インストール済みPWA、実店舗物理端末・native touch・長時間background復帰、実店舗の全過去archiveを使った性能。browserは隔離synthetic data/Date固定時計、タイマー/Performance APIは実時間。通常季節シナリオの他エリアは完了fixture、Review全観測と性能シナリオ全エリアはUI入力。

証跡: `work/performanceSeasonal37/checks.json`, `lint-comparison37.json`, `baseline-comparison37.json`, `benchmark-comparison37.json`, `actual-performance37.json`, `calculation-comparison37.json`, `browser-work/browser-results37.json`。ZIP再open検査/SHAは外部release報告/検査JSONへ記録。

## Release

- appVersion: `2026.8.9-37`
- buildId: `build-20261001-205943-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-37.zip`
- SQL / Supabase schema / RLS / grant / trigger / migration変更なし。area_idは既存textでautumnを保存可能。
- AGENTS.mdは9-36 baselineとbyte-identical。
