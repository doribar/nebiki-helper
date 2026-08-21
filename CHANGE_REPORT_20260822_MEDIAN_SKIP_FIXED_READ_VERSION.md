# 値引ヘルパー 中央値表示・最後のエリアskip・固定モードREAD ONLY・version表示 変更報告

## リリース識別情報

- 基準版: `nebiki-helper-20260821-0918.zip`
- 基準appVersion: `2026.8.9-8`
- appVersion: `2026.8.9-9`
- buildId: `build-20260822-031104-jst`
- dataSchemaVersion: `3`

今回の変更範囲は、履歴中央値による自動判定の表示、最後の未完了エリアにおけるskipの扱い、時刻固定モードに対する本番Supabase AreaCount履歴のREAD ONLY提供、トップ画面のversion表示です。値引率計算、9段階human evaluation、productionAnalysis、normal / summer、祝日・Obon、weather・temperature、Review19、通常モードcloud sync、storage safetyの意味は変更していません。

## 1. 中央値自動判定表示の仕様

値引率表示画面へ、今回の残数に対して履歴中央値から算出済みの自動recommendationを次の形式で追加しました。

```text
中央値判定：普通
```

表示は既存のAreaCount判定結果を読むだけで、画面表示のために中央値や値引率を再計算しません。表示専用のpure helperが、現在エリアの保存済み`AreaProgress`から自動判定を安全に取り出します。

- 自動判定をそのまま採用した場合: `areaCountEvaluationSource = history`であることを確認し、保存済み`areaCountEvaluation`を表示
- 人間が手動変更した場合: `humanEvaluationDetails.automaticEvaluation`を表示
- 判定対象外または旧データに判断材料がない場合: 推測値を作らない

自動recommendationには、中央値との単純比較後に既存の減少率補正まで適用した`recommended/suggested evaluation`を使用します。`areaCountDecisionBasis.baseEvaluation`は減少率補正前の値であるため、これを自動判定表示へ誤用していません。

## 2. auto / human / finalの区別

次の3つを別の情報として維持しています。

- auto: 履歴中央値と既存補正から得た、人間変更前の自動recommendation
- human/manual: 9段階入力と既存resolution ruleから得た人間の変更内容
- final: 実際の値引判断へ採用された最終5段階評価

例えば、autoが`normal`、human/finalが`slightly_few`であれば、画面は`中央値判定：普通`と表示します。`finalEvaluation`を中央値判定として表示することはありません。raw9、even score、`resolutionDirection`、normal / summerの時刻別resolution ruleも変更していません。

この表示値は`areaRateAdjustment`や値引率計算へ戻さないため、同一入力・同一finalEvaluationに対する表示値引率は基準版と同じです。

## 3. 履歴不足表示

`areaCountDecisionBasis.recommendationStatus = insufficient`の場合は、次のように表示します。

```text
中央値判定：履歴不足
```

履歴不足を`normal`へfallbackせず、「普通」と偽装しません。また、statusが`ready`なのにauto値を復元できない不整合データでは、推測せず`取得できません`と表示します。`disabled`または判断basis自体がない旧・対象外フローでは不要な中央値欄を出しません。

## 4. 最後のエリアskipの旧挙動

2026.8.9-7では、skip直後に現在エリア自身を次候補へ選ぶ自己ループを防ぐため、現在エリアを次候補から除外しました。一方、現在エリア以外に未完了候補がない場合、従来のnavigation fallbackが`done`へ進む経路が残っていました。

その結果、最後の未完了エリアを「今はスキップ」すると、未完了のままなのに完了画面へ到達し得ました。`completed`と`skipped/deferred`の意味が一致しない不具合です。

## 5. 新しいskip挙動

skip stateやundo snapshotを変更する前に、現在エリア以外の未完了候補があるかをpure decision helperで事前判定します。

- 他候補あり: 従来どおり別の未完了エリアへ移動
- 他候補なし: skipを実行せず現在エリアに留まる
- 通知: `他にスキップできるエリアがありません`
- 現在エリア: 未完了のまま。`completed`、`done`、measurement completeへ変換しない

通知には既存のstatus/toast領域を使用し、大きな新規画面は追加していません。block時はskip record、undo snapshot、pending順序も変更しません。

## 6. 2026.8.9-7自己ループ修正の維持

別候補がある場合、次候補から現在エリア自身を除外する2026.8.9-7の仕様を維持しています。例えば`pending = [B, C]`、`current = B`なら、Bのskip直後はCへ進み、Bへ即時自己ループしません。

一方でBを永久除外しません。C等を処理した後は、deferred候補としてBへ再訪できます。skip recordのidentity（date / target time / area）、dedupe、順序、restore、consumeも維持しました。

## 7. fixed-time Supabase READの仕組み

AreaCountの「履歴source」と「保存destination」を構造上分離しました。

```text
production:
  history source = production local cache + Supabase AreaCount
  persistence destination = production local / pending / Supabase

fixed_time_readonly:
  history source = production Supabase AreaCount READ only
  persistence destination = fixed-time isolated state only
```

時刻固定モード開始時は、既存`loadRemoteAreaCountRecords()`を使ってnormal / summerの本番AreaCount履歴をGETし、`fixed_time_readonly` sourceとしてReact memoryだけに保持します。production local AreaCount履歴は固定モードのsourceへ混ぜず、取得したremote recordsをproduction localStorageへcache保存もしません。

中央値判定は通常モードと同じ`getAreaCountRecommendation()`を使用します。固定モード専用の中央値アルゴリズムは追加していません。

## 8. fixed-timeで利用するreference条件

固定モードでも、通常モードと同じ入力条件を中央値判定へ渡します。

- business date
- discountTime
- demandCycle
- areaId
- actual weekday
- calendar condition
- manual weekday overrideを含む既存session条件
- 既存の曜日/fallback/特殊連休reference

ordinary、holiday、day-before-holiday、three-day-holiday-middle、Obonのreference選択を分岐コピーせず、通常モードと同じ既存ロジックを共有します。専用testでは同じ履歴sourceに対するproductionとfixed-timeのrecommendationをdeep equalityで比較しています。

## 9. normal / summer分離

remote readはnormalとsummerをそれぞれ既存の`demand_cycle` filter付きGETで取得します。memory上で両方を保持しても、中央値選択時はsessionの`demandCycle`により母集団を分離します。

専用fixtureではnormal中央値100、summer中央値10を同時に用意し、normal判定が`few`、summer判定が`normal`となること、および各matched recordsに異なるcycleが混入しないことを確認しました。

## 10. Obon / holidayとの関係

2026.8.9-6のObon仕様を維持しています。

```text
毎年8/13〜8/16
isObon = true
calendarCondition = obon
需要判断 = holiday-equivalent
```

Obonを`isHoliday`へ書き換えず、分析上はholidayと区別します。固定モードでも`applyObonRule`と通常のcalendar/reference helperを共有するため、固定モードだけ曜日referenceが異なることはありません。Obon期間の真ん中を日付だけでthree-day-holiday-middleへ分類する変更もありません。

## 11. 固定モードWRITE隔離

固定モードから本番へ書き込まない既存guardを維持し、READ許可とWRITE許可を連動させていません。固定モードでは次を禁止しています。

- Supabase AreaCount INSERT / UPSERT / UPDATE
- Supabase Review19 mutation
- production cloud pending queue追加
- production AreaCount local history追加
- production Review19 local record追加
- production finalized-day追加
- production daily snapshot / current-session / checkpoint / runtime history追加
- production learning / median populationへの追加

固定モード固有のdemand cycle、temperature memory、fixed clock等の隔離stateは従来どおりです。production sync、retry、CAS、backfillを固定モードから呼びません。

## 12. Supabase mutation 0の検証

専用checkはremote AreaCount呼び出しが`GET`であり、URLに`demand_cycle=eq.<cycle>`が付くことを確認しています。hookの固定モード分岐にはproduction save関数やReview19 remote loadを含めず、`judgeCurrentArea`、Review19保存、手動syncも`isTestMode` guardでWRITE経路から隔離されています。

390×844のブラウザfixtureでも、固定モードで全12エリアを完了して`done`へ到達するまでのSupabase mock mutationは0件でした。READの許可を理由にINSERT / UPSERT / UPDATE、pending retryへ接続していません。

## 13. production local historyへのWRITE 0

固定モードのremote recordsはReact memoryにだけ保持し、`saveLocalAreaCountRecords`へ渡しません。固定モードの入力record作成も既存の`!isTestMode` guardの外へ出していないため、次のproduction keyへ固定モード由来recordを追加しません。

- `nebiki-helper/area-count-records-v2`
- `nebiki-helper/pending-supabase-sync-v1`
- production Review19 records
- production finalized-day / daily session history

ブラウザ制御の安全制約上、テスト中のlocalStorage本文を直接検査していません。そのため「production local write 0」は、WRITE callを捕捉する専用test、固定モード分岐の構造guard、既存`check:storage-write-boundary`によって検証しました。ブラウザで直接localStorageを読んだとする虚偽報告は行いません。

## 14. 通信失敗時のfallback

Supabase READの一方または両方が失敗した場合、fixed-time history sourceはremote statusを`error`として保持し、失敗した履歴をproduction local dataや推測値で補いません。利用可能な履歴がなければ自動判定は成立せず、画面は`履歴不足`または復元不能時の`取得できません`として扱います。

通信失敗はfixed-time session開始・残数入力・human evaluation・値引率確定を停止しません。人間判定と既存値引ロジックで業務を続行でき、READ失敗をWRITE用pendingへ変換しません。

## 15. appVersion表示

トップ画面最上部の既存タイトルと同じ行へ、補助情報としてappVersionを追加しました。

```text
値引ヘルパー    2026.8.9-9
```

versionはUIへハードコードせず、`src/domain/dataVersion.ts`の正規`APP_VERSION`を参照します。`APP_VERSION`はVite build時にpackage versionから注入されるため、次回リリースでversionを更新すれば表示も追従します。buildIdとdataSchemaVersionは常時表示していません。

タイトルは同一flex row、versionは小さい補助文字とし、設定buttonや既存subtitleを変更していません。390×844で同一行表示と横overflowなしを確認しました。

## 16. storage safety 2026.8.9-8回帰

2026.8.9-8のstorage safetyを維持しています。

- App / hook / component層へ危険なraw `localStorage.setItem/removeItem`を追加しない
- structured storage result
- authoritative data優先
- quota recoveryは安全なderived/duplicate履歴を整理後、最大1回retry
- daily snapshotの件数上限＋soft byte budget
- current / unfinalized date保護
- finalized duplicateのみprune
- 15→17等の自動時刻遷移
- React StrictModeのin-flight guard
- Review19 completion safety

`check:storage-write-boundary`、session completion、daily snapshot、long-run storage、Review19 completionを含む全checkを通しています。今回のfixed-time READ処理はremote dataをmemoryへ載せるだけで、storage安全境界を迂回しません。

## 17. Supabase / DB変更有無

DB migration、SQL、table、column、index、unique key、trigger、RLS、tenancyの変更はありません。既存AreaCount SELECT経路を固定モードからREAD ONLYで再利用しただけです。

通常モードのlocal-first、pending、retry、CAS、in-flight guard、rich merge、backfill、normal / summer cloud identityも変更していません。

## 18. backward compatibility

dataSchemaVersionは`3`を維持しました。新しい必須保存fieldや物理migrationはありません。

- 旧recordに`areaCountDecisionBasis`がない場合、中央値を推測表示しない
- `recommendationStatus = insufficient`の旧・現行recordは履歴不足として扱う
- auto/human/finalの既存保存fieldを上書きしない
- 既存normal / summer recordを混合しない
- Obon導入前recordをretroactive rewriteしない
- fixed-time remote read結果をproduction local recordへ変換しない

既存export、Review19、productionAnalysis、weather metadata、calendarContext、median populationのschemaと意味を維持しています。

## 19. test結果

最終検証結果は次のとおりです。

- `check:median-version-ui`: 6 / 6 PASS
- `check:last-area-skip`: 5 / 5 PASS
- `check:fixed-time-supabase-read`: 7 / 7 PASS
- 全`check:*`: 39 / 39 PASS
- TypeScript (`tsc`): PASS
- changed-file ESLint: 0 errors / 6 existing warnings
- production build: PASS
- PWA `generateSW`: PASS

専用checkでは、autoとmanual/finalの相違、履歴不足、同一判定、最後1件skip block、他候補への移動、後からの再訪、skip identity/dedupe、normal/summer分離、通常/固定recommendation一致、ordinary/holiday/Obon reference、READ failure継続、GET-only、WRITE guardを確認しています。

全checkには15:00、17:00、18:30、19:30、20:30、done、自動時刻遷移、quota safety、daily retention、Review19、productionAnalysis、weather、temperature、export、Supabase sync、pending/retry/CAS、backfill、fixed-time isolation、calendar各条件の既存回帰を含みます。

## 20. browser確認

Codex in-app Browserを390×844に設定し、次を確認しました。

- トップ: `値引ヘルパー`と`2026.8.9-9`が同一行
- トップ: document-level横overflowなし
- 通常値引: 値引率画面に中央値判定を表示
- 固定モード: Supabase mock履歴由来の中央値判定を表示
- 最後1件skip: `他にスキップできるエリアがありません`のtoastを表示
- 最後1件skip: doneへ進まず、現在エリア画面と未完了状態を維持
- 固定モード: human判定を含む全12エリアを完了し、done画面へ到達
- 固定モード: Supabase mock mutation 0件
- console error: 0件
- console warning: 0件

ブラウザではlocalStorageを直接読み取らず、production local write 0は前述の構造guardと専用自動checkで確認しています。また、固定モードのSupabase確認は制御可能なmock履歴を用いたものであり、実DBへmutationを送る確認ではありません。

## 21. appVersion / buildId / schema

- appVersion: `2026.8.9-9`
- buildId: `build-20260822-031104-jst`
- dataSchemaVersion: `3`

今回の追加は表示、navigation guard、READ-only history sourceの切り替えであり、既存JSON schemaへの破壊的変更がないためdataSchemaVersionを`3`のまま維持しました。

