# 2026.8.9-44 変更報告

検証日: 2026-10-08 JST。baseline: `nebiki-helper-2026.8.9-43.zip` / SHA-256 `3be82d6913e6afe1e8f0d92b272107669906cf231e30e7188c47862c7cc7ec50`。

## 3件の変更

1. `fullMode.ts` のやや不人気の1項目だけを次の本文へ変更。4つの強調を維持し、他6項目の本文・順序・強調は保持。

   やや不人気な商品は、10個以上ある場合のみ表示値引率に+10%。大パックと小パックに分かれている場合は大パックのみ+10%

   「やや不人気な商品」「10個以上」「+10%」「大パックのみ+10%」は既存の太字。個数判定・小パック除外・補正の適用・重複加算・商品別自動計算を変更していない。「同一商品が、小パックを含めずに20個以上ある場合は、表示値引率に＋10％。」を含む残り6項目も保持。

2. その日最初のrate前の専用注意確認画面を廃止。`showDailyNoticeBeforeRate` / `showDailyNotice`、確認callback/action、router渡し、swipe無効条件、OK専用returnを削除。ready history残数入力または必要な人間エリア判定から直接rateへ入り、最初は従来の多い商品指示（1/2）、次にどちらでもない商品指示（2/2）。下部NoticeSection7項目は残る。弁当案内・天候確認・祝日通知・20:30の注意扱いは保持。`DailyMessageState.rateNoticeShownDate` のlegacy読込形はstorage互換のため残すが、確認待ち・判断・確認保存には使わない。

3. Startの値引時刻manual toggle / auto return / select / wheelと専用options・重複clock helperを削除。現在の自動判定時刻だけを表示。曜日の手動変更、エリア手動判定、quick、長押し500ms、固定時計検証panelは保持。Doneの次値引開始は既存clock unlockで提供される次の枠を明示開始する経路として維持し、任意の時刻を選択・固定する機能ではない。18:30の実開始証拠によるReview19抑止も維持。

## 旧手動固定状態の互換引継ぎ

新しいpure helper `retireManualDiscountTimeOverride()` をcurrent/checkpointの起動復元、navigation/undo復元、条件編集、Doneからの残数修正開始だけで適用する。genericなsession/history/snapshot normalizerやclone関数は変更しない。raw localStorage write、storage key、永続field、migrationは追加していない。

- 未開始draft: 旧manual flagをfalseにし、既存の正当な天候入力lockがある場合はそれを使い、なければ既存自動clockへ移す。既存の通常fresh reload方針は保持。旧手動時刻のweather確認待ちが復元後時刻と一致しない場合は確認待ちを解除し、再確認する。天候値は消さず、sessionは確認前に生成しない。
- 進行中session: `discountTime` / `startedAt` / route / count / raw9 / 採用評価 / 完了areaの率text・rateDecisionSnapshotを保持してmanual flagだけ解除。以後は既存early-next−5 / late+5 / 次回skipの自動条件が有効になる。
- 同日sessionの条件編集・再開では、明示的な`timeSwitchTarget`がなければ元session時刻を保持する。解除直後にdraftが実時計の別枠へ変わり、同じstartedAt/mapのままsession時刻を付け替える不具合を防ぐ。明示targetへの天候入力・次枠開始は従来どおり。
- Done / Review19保存stateはhelper単体で変更しない。Doneから作業へ再入する瞬間に解除する。過去AreaCount / DailySessionSnapshot / Review19 / finalized-dayを遡及書換えしない。固定時計検証ではhelperはno-opで、production READ ONLYを維持。

現在の推奨率への影響（通常商品/多い商品の順、晴れ25℃弱風・火曜・global0）:

| 旧固定の進行中状態と実時計 | 保存評価を維持した現在推奨率の変化 | 保存済み完了率/snapshot |
| --- | --- | --- |
| 夏17時・raw6の普通lower / 18:00 | 0/10% → 10/20%（18:30基準−5の先取り復帰） | 不変 |
| 夏17時・raw6のやや多いhigher / 18:01 | 5/15% → 15/25%（同上） | 不変 |
| 通常15時・普通lower / 16:00 | 0/0% → 0/5%（既存late+5復帰、下限適用） | 不変 |
| 夏19:30・やや多いhigher / 20:15 | 30/40% → 35/45%（既存late+5復帰） | 不変 |

更新後に未完了エリアを完了する場合は、その時点の現在率を既存の完了処理で新しく記録する。既に確定した履歴を新率へ置換する処理ではない。

## 案内・判定・値引率・保存値の照合

PASS数だけを根拠に矛盾なしとはしていない。選択確定→human raw9とresolved→AreaCount record / progress→areaRateAdjustment→実rate presentation→完了rateDecisionSnapshotを追い、元session、effective基準時刻、実時計、early offset、evaluatedAt、保存採用値を分けて照合した。

- normal: 元`sessionDiscountTime`15ならlower、他はhigher。
- summer: 判定確定時のJST実時計18:00未満ならlower、18:00以降ならhigher。元17時へ単純置換していない。
- 隣接4組を両選択順でraw9=2/4/6/8として記録し、少ない側/多い側の端点を採用。率の算術平均ではない。単独1/3/5/7/9、full manual、quick、減り方の意味は保持。
- 確定済みresolvedを時計変化だけで再計算しない。RateDisplayの「この時間帯は…として計算」を「判定確定時に『…』を採用して計算」へ修正。保存時点の採用評価を説明する。
- 0〜50% clampとglobal適用後clamp、early-next−5を独立に照合。同率になっても解決方向・評価・理由を区別。
- 商品用と手動エリア用の43版本文・入口を保持。Review19の観察評価・20:30へ計算用長押し案内を転用しない。

具体例（2026-09-08火、晴れ25℃弱風、auto普通、普通+やや多い=raw6、global0）:

| 元session / 確定時JST | 採用評価 / 有効基準 | 通常商品 / 多い商品 |
| --- | --- | --- |
| 夏17時 / 17:59:59 | 普通lower / 17時 | 0% / 10% |
| 夏17時 / 18:00:00 | やや多いhigher / 18:30先取り−5 | 15% / 25% |
| 夏17時 / 18:01 | 同上 | 15% / 25% |
| 17:59:59に普通lower確定、18:00以降も未選び直し | 普通lower、元evaluatedAt保持 / 18:30先取り−5 | 10% / 20% |
| 旧夏18:30session / 実時計17:59:59に復元・新規確定 | 普通lower / 元18:30を保持 | 15% / 25% |

全rate試験で実表示とproduction完了snapshot式のdisplayを一致確認。ブラウザの09-30合成fixtureも17:59:59/18:00/18:01・旧current/checkpoint・保存評価再利用で同じ採用値と率を確認。天候入力18:24:59→18:25で17時を保持、確認待ちreload後に17時sessionを開始し、その後effective18:30と夏higherを使う接続を確認した。

### 残る不一致と限界

- 旧手動指定で元18:30sessionを18時前に開始した進行中状態は、更新後も元のidentityを保持する。実時計17:59:59の新規中間評価はlowerだが、静的「夏18時以降は多い側」の時刻ラベルと一致しない。実ブラウザでも普通lower、通常15%/多い25%を確認。任意の新規manual entryはなくなったが、既存sessionの時刻を書換えず実時計ルールも保持するためこの例外は残る。業務規則を独自変更して埋めていない。
- 元15時の夏sessionを18時以降に直接評価するpure fixtureではhigher、effective15+late+5となる。自動画面遷移をstubした合成ケースであり、通常UIでそのまま選択できると証明していない。既存unlock時刻の自動遷移は維持。
- 18時前の保存lowerと18時以降に新しく確定するhigherの差は、確定時採用を保持する既存仕様。現在時刻で保存評価を再解決しないことを説明する表示へ修正した。
- 商品用寄せ方は現場判断の案内であり、商品別の自動分類・補正を追加していない。

## 変更ファイル

- `src/app/AppRouter.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/domain/fullMode.ts`
- `src/domain/types.ts`
- `src/hooks/nebikiApp/operationalTime.ts`
- `src/hooks/nebikiApp/timeTransitions.ts`
- `src/hooks/useNebikiApp.ts`
- `scripts/check-advance-discount-flow.ts`
- `scripts/check-area-count-status-ui.ts`
- `scripts/check-automatic-time-operation.ts`
- `scripts/check-early-next-17-continuity.ts`
- `scripts/check-feature-20260728.ts`
- `scripts/check-full-mode.ts`
- `scripts/check-interactive-persistence.ts`
- `scripts/check-judge-hint-guidance.ts`
- `scripts/check-refactor-characterization.ts`
- `scripts/check-review19-priority-transition.ts`
- `scripts/check-slightly-unpopular-policy.ts`
- `package.json` / `package-lock.json`（version、新check登録のみ）
- `CHATGPT_HANDOFF.md` / 本変更報告 / `dist/*`

43版production100本中93本はbyte-identical、7本を変更しhelper1本追加。clock、humanEvaluation、selector、rate engine、weather、先行値引、冷惣菜、AreaCount、snapshot/export/storage/cloud、Review19/productionAnalysis、AGENTS.md、SQL9本、過去CHANGE_REPORTは非変更。timeTransitionsはコメントのみ変更。typesはUI用derived/action2行だけ削除し保存型は維持。schema3とversion/buildId生成方式はbyte-identical。

## 検証結果

- 全check:* **80/80 PASS**。新規automatic-time-operation **13/13**、実hook interactive-persistence **16/16**、Review19優先遷移 **70/70**、advance flow **48/48**、17時先取り継続 **14/14**、用途別案内 **17/17**。既存weather/storage/archive/export/fixed-time/Review19等を全実行。
- 新規専用testは実TSX SSRと継続state/event runnerで直接rate第一段階、7項目・強調、swipe/cancel、時刻UI/weekday・weatherhold、legacyhelper・saved説明を確認。実Hook dispatcherでは旧15/18/19再開、pendingweather、heldweather、undo、保存performanceを検証。これはnativeブラウザ確認とは別。
- 外部production pipeline監査: {"pairRows": 96, "singleRows": 35, "legacyRows": 5, "quickRows": 10, "clampRows": 7, "boundaryRows": 3, "decreaseRows": 10}。合計166行と追加full manual / quick非累積 / fixed no-write probes。React/storage境界はmemory stub。実codeの完成snapshot式とrateを照合した。
- TypeScript / production build / PWA generateSW PASS。105 modules、precache10、asset `/assets/index-Crex1LxH.js`。既存large-chunk / caniuse-lite更新警告は残る。
- focused ESLint **0 errors / 3 existing warnings**。full **9 existing errors / 6 existing warnings**。43版とfile/rule/severity/message比較で新規diagnostic **0**。pathとsource/code-frame座標だけ正規化し、本文とcode tokenは保持。
- Edge production **390×844、17/17ケース / 172記録操作**。notice確認画面なしで最初のmany指示→normal指示、7項目、time toggle/select/wheel廃止・weekday保持、旧draft/current/checkpoint、weather boundary/reload、product/manual案内12回の開閉とstorage不変、長押し/隣接/cancel、AreaJudgeとRateのswipe、境界採用値/保存、Review19/20:30を確認。console error/warning、不要外部request、横overflow **0**。source/bundle hashは最終buildと一致しowned previewは停止済み。スクリーンショットを目視確認。

未確認: 実店舗端末/物理touch、installed PWA、実Supabase mutation、実端末の長時間background復帰。ブラウザは隔離合成state/履歴・Dateだけ固定しnative timerを維持したEdgeとCDP touch。全4隣接ペア・上下限の網羅はproduction pipeline自動testであり、全組合せを実機操作した結果ではない。

## Release

- appVersion: `2026.8.9-44`
- buildId: `build-20261007-235103-jst`（既存JST生成方式）
- dataSchemaVersion: `3`
- 完成ZIP: `nebiki-helper-2026.8.9-44.zip`
- SQL / Supabase / AGENTS.md変更なし。

ZIP再open・対象file集合/bytes・SHA-256・version/build/schema・dist/PWA・除外物・SQL9/AGENTS/過去report同一性の結果はZIP外の`RELEASE_REPORT_2026.8.9-44.md`、`ZIP_VALIDATION_2026.8.9-44.json`、`nebiki-helper-2026.8.9-44.zip.sha256`に記録する（ZIP自己参照回避）。
