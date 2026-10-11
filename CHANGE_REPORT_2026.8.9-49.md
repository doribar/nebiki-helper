# CHANGE REPORT 2026.8.9-49

- appVersion: `2026.8.9-49` / buildId: `build-20261011-220012-jst` / dataSchemaVersion: `3`。
- 完成ZIP: `nebiki-helper-2026.8.9-49.zip`。SHA-256はZIP外の同名`.sha256` / RELEASE_REPORT / ZIP_VALIDATION参照（自己参照回避）。
- baseline: 完成9-48 ZIP `nebiki-helper-2026.8.9-48.zip`、SHA-256 `0a5f95feb0275f26bdeea52abe553dc59454e27a81ad57a779432d5d7a4a6613`、build `build-20261010-190352-jst`。

## 新しい値引操作と追加指示

通常の新規値引は15時・17時のみ。開始の自動時刻は16:40前15時、16:40以降は17時を維持する。夜に起動しても18:30/19:30/20:30 sessionを生成しない。開始UIの曜日・時刻同幅2列、16〜21時天候入力と入力中の時刻保持、先行値引/冷惣菜ガイド、注意7項目・中間評価・quickは維持。

`clock.resolveDiscountTime()`/`getNextDoneDiscountInfo()`を15/17に限定し、15→17移行を維持。hook `startSession()`/`openNextSessionInput()`で廃止枠を拒否する。Doneの18:30開始/夜担当説明、Review19後→19:30処理/action、routerの通常final_time経路を撤去。旧保存状態・checkpoint・undo/history・条件編集・weather lockは操作境界で夜枠へ戻さず安全な開始表示にする。汎用歴史normalizerとlegacy夜計算のpure helperは保持する。

17→18:30、18:30→19:30のoperational early-nextはnull、auto reservationはfalse、新skip targetはnull。古いprogress markerがあっても新規skip記録を作らず、旧skip/early snapshotの読込形式は保持する。18:00/18:25/19:25/20:25で廃止枠の率・画面へ切り替えない。

作業中の追加指示「17時値引が18時を超えたら15時値引が16時を超えた場合と同じ」により、当初依頼の「代わり+5なし」は変更。**17時sessionは18:00以降、17時の計算に遅延+5ポイント**を適用する。15時session16:00以降+5は維持。normal/summer共通。early-next率/次回skipは使わない。新しい確定時は `sessionDiscountTime` / `effectiveRateDiscountTime` とも元15/17、`calculationMode=late_plus5`、`lateTimeAdjustmentPercent=5`、`earlyNextAdjustmentPercent=0`。再表示で+5を累積せず、過去の確定snapshotは時計だけで再計算しない。

天候0・area補正0・global0の具体例（普通商品/多い商品）：15時15:59は0/10%、16:00は5/15%。17時17:59は10/20%、18:00は15/25%。既存0〜50上限を適用する。先行値引ガイドは従来どおりsession basic+weather+many10+globalで、エリア作業のlate補正を追加しない。

## Review19を夜枠から独立

`doneNextSessionInfo`の18:30条件を使わず、timer/focus/visibilityの共通effectから `startAutomaticReview19()` を評価する。当日17source、18:55以降（19:25/20:30/23:59等に上限なし）、Review19未開始/未記録、Start/weather入力中・Review画面以外、fixed-timeでない、同日actual18:30開始証拠なしが条件。once keyで通知/開始を重複させない。

開始画面の手動Review19も18:55以降、現在又は保存済み当日17sourceから開始し、18:30枠を条件にしない。共通 `beginReview19FromSource()` → `createReview19StartState()` を再利用する。source date/cycle/startedAt/weather/referenceを既存logicで生成し、fake18session/AreaCountを作らない。

遷移前に `finalizeUnmeasuredAreasForAutoTransition()`、DailySessionSnapshot、Review19 sourceを順に保存。実数・確定評価・確定率・rateDecisionSnapshotを保持。summaryは保存済み率を優先し、未測定はnot_measured/auto_time_transitionのまま、未完了statusも未完了。保存失敗はstateを変更せずonce guardを解除し再試行する。Review19 raw9/正式保存/archive/outbox/direct rescue/同期/download/productionAnalysisの本体は変更しない。

旧版で実際に開始した同日18:30session又はsnapshotは、既存のReview19対象外証拠として保持する。reload後も同じ判定。draft又は早期遷移マーカーだけでは実施証拠とせず、過去authoritative Review19は削除しない。9-49から新しい18:30開始はできない。

## 旧進行中状態と日次保存の保全

日付cleanup/操作normalization前のcurrent、work checkpoint、runtime undo/history、Review19 sourceから旧夜枠の原本を収集し、date×discountTime×startedAtのidentity単位で退避する。Review19画面は内部"19"を含め夜枠廃止対象から除外する。

既存DailySessionSnapshotは元の時刻/area/status/count/評価/率/内訳を保持し、optional `retiredOperation`に原本AppStateと由来を添付する。snapshotがない場合は既存builderと保存済み確定率だけを使い、未記録率は未記録、未保存basisは `basisCaptureStatus=unavailable` と明示する。新計算の率を過去採用値へ補わず、未測定を測定済み・未完了を完了済みにしない。archive/journal mergeの変更はこのoptional証拠のunionだけで、既存snapshot選択規則を維持する。

UIは直ちに安全な開始表示へ隔離するが、IndexedDB upsert→再read→全原本証拠確認の後だけ、元キーの解除・安全状態への置換保存と通常操作の再開を許可する。退避失敗中は元current/checkpoint/runtimeのbytesを保持し、cleanup・quota recovery・completion日次保存・AreaCount確定・Review19完了保存/同期・reset/new startを保護する。読込検証成功後に保存effectを再開。固定時計では退避を含めproduction writeなし。破損identity等で安全な検証ができなければ原本を消さずretry対象とする。

新storage key/DB migrationなし、schema3。原本証拠を持つ退避用DailySessionSnapshotは19時の正式Review記録やformal day確定の代用品ではない。今後の実15/17は既存DailySessionSnapshot、Review19完了は実同日sessions/AreaCountを持つdaySnapshotとして保存/exportする。20:30完了の旧formal finalized-day入口は通常UIから到達しない。過去finalized-dayのread/archive/backfill/exportと旧夜枠AreaCount/Review JSON互換は保持し、fake20:30記録を作らない。

## 変更ファイル

### application

- `src/hooks/useNebikiApp.ts`（15/17許可、late17+5、独立Review19、旧状態退避・pending保護、旧夜開始action撤去）
- `src/hooks/nebikiApp/clock.ts` / `operationalTime.ts` / `timeTransitions.ts` / `review19Flow.ts` / `stateNormalization.ts`
- `src/hooks/nebikiApp/retiredNightOperation.ts`（追加）
- `src/domain/retiredNightEvidence.ts`（追加）、`types.ts` / `historicalArchive.ts` / `storage.ts`（optional証拠の型・狭いmerge）
- `src/app/AppRouter.tsx` / `src/components/screens/DoneScreen.tsx`

### 検証・release

- 専用 `scripts/check-daytime-time49.ts` / `check-retired-night49.ts` / `check-daytime-operation49.ts`（追加）
- 既存check: advance-discount-flow/ui、area-count-status-ui、automatic-time-operation、daily-ui-removal、done-rate-colors、early-next-17-continuity、evening-comfort-flow、fixed-time-supabase-read、interactive-persistence、refactor-characterization、review19-priority-transition、session-completion-storage-safety、weather-confirmation、supabase-sync-domain、review19-business-month（運用仕様/guard依存のfixture更新のみ）
- `package.json` / `package-lock.json`（versionと専用check3登録・依存不変）、`dist/*`、`CHATGPT_HANDOFF.md`、本CHANGE_REPORT。

独立byte比較：production103既存filesのうち92同一、11変更＋2追加（最終105files）。46天候/48calendar・AreaCount median、fullMode/ratecore/global、human/manual、同期/outbox/export、build方式、SQL9、AGENTS、過去CHANGE57を含むprotected104filesは48ZIPとbyte-identical。Supabase/SQL/AGENTSは変更なし。

## 検証結果

- 全 `check:*` **87/87 PASS**。新規3 checksを含めpackageの全項目を実行。
- 専用time **17/17**、retirement **13/13**、実hook operation **18/18**、Review19 priority **74/74 PASS**。独立pendingguard VM **9/9 PASS**。46快適補正・48三連休日曜優先/代替・weather lock・fixed READ ONLY・storage/archive/outbox/export/human/quick等も全check内でPASS。
- 最終sourceでTypeScript `tsc -b --force`、production build、PWA generateSW **PASS**。108 modules、precache10。bundle `/assets/index-PPPfQN2d.js` / SHA-256 `1b188d59af2f6fcb9775124abf5c2ec0335285df4013c5180354948369e06e65`。
- changed-file focused ESLint **0 errors / 2 existing warnings**。全体 **9 existing errors / 5 existing warnings**（48は9/6）。file/rule/severity/message比較で**新規diagnostic0**、既存warning1削減。診断のroot/座標/code-frame行番号だけ正規化し本文/code tokenを保持。lint例外追加なし。
- large-chunk/caniuse-lite旧データ警告はbaselineからの既存build警告。
- guard追加で失敗した旧static assertion/VM fixtureは新guard条件へ更新後、全87項目を再実行してPASS。テストの保存・READ ONLY・同期保証は削除しない。

## 実ブラウザ確認

- installed Edge 155.0.4283.45のproduction dist、隔離profile・人工データで360×844 / 390×844、16ケース×2幅の **32/32 PASS**。15時開始→12エリア完了→16:40自動17時→12エリア完了→18:55 Review19、独立17時開始、夜の新規17時開始、遅い23:59復帰を実操作。
- 夏季fixtureは対象期間内の2026-09-29を使い、session/draft/snapshot/Review sourceのsummerを明示確認。18:54のエリア完了でeffective17 / late_plus5 / +5を確認し、reload後も保存snapshotを保持。18:30session/新skipを生成しない。
- pending先行画面・未測定17時・保存済み17sourceからの手動開始、旧予約だけではReviewを阻止しないこと、実開始18:30の対象外判定を確認。旧active18/19/20の隔離・原本退避、IDB退避失敗と容量回復時のcurrent/checkpoint/runtime保持、reload retryを確認。
- Review source/snapshot保存失敗では17stateを保持し、障害解除後にretry。Review19の12エリア残数と人間raw9を入力し、JSON **6件を実download・JSON.parse**。metadata/build/schema・12評価・再読込後のauthoritative archiveとのrecord深一致を確認。
- software touch **812 taps**、通常値引 **72エリア完了**、geometry **114件PASS**。横overflow・console error・想定外warning・外部通信0。意図的な保存障害warning8件、PlaywrightのService Worker block通知48件は検証環境由来として分離。source105本とbundle hashは実行前後一致。preview停止/listener0。
- pending安全Startにはreset/Home操作がないため、その保護は実hook専用testで確認し、ブラウザでresetを押したとはしない。normal/summerの15/17遅延境界全組合せ・fixed-time READ ONLY等も自動checkによる確認。証拠はZIP外 `work/daytime49/browser-work/browser-results49.json` / `final-browser-summary49.json`。

## 未確認事項・残る既存不一致

実Supabase通信、実店舗の物理端末・物理タッチ、インストール済みPWA、実端末の長時間background復帰は未確認。隔離Edge/人工データの確認と区別する。固定時計は自動testでREAD ONLY保護を確認する。

夏17時sessionを18時以降まで継続して新規中間評価を確定する場合、既存humanEvaluationは実時計18:00からhigher、静的hintの指定本文は「15時・17時:少ない側」のため不一致が残る。確定済み評価は時計だけで解決し直さない。今回の曜日基準表示・文言は保留指定のため変更せず、この不一致を解消したとはしない。旧summer18:30操作は退避して再開できない。今回の+5は評価方向を変更する処理ではない。

廃止した夜枠の過去保存・互換計算を削除していない。過去率/評価を49の値へ書換えるmigration、fake completion、schema/SQL改変はない。
