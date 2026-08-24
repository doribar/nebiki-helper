# 値引ヘルパー 引継ぎメモ

最終更新: 2026-08-24（日本時間）

## 正本と作業ルール

- ユーザーから渡された最新ZIPを展開し、その中身を正本として確認する。
- 変更前に `package.json`、型、localStorage、JSON出力、Supabase保存、テストを確認する。
- 値引率・閾値・上下限は、ユーザーが明示した範囲以外で変更しない。
- リリースZIPには検証済みの `dist` を含め、`node_modules`、`.env`、秘密情報、別のZIPは含めない。

## 現行リリース情報

- 作業基準ZIP: `nebiki-helper-20260824-2040.zip`
- `appVersion`: `2026.8.9-12`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260824-215940-jst`
- リリースZIP: この文書と同梱された `nebiki-helper-YYYYMMDD-HHMM.zip`。確定した識別情報で再生成した `dist` を収録する。

## 値引ヘルパーの運用目的

値引ヘルパーの目的は、単純に早く商品を売り切ることではない。

19時時点の商品品ぞろえを確保しつつ、20時の全品半額によって翌日の廃棄を十分少なく抑えられる状態へ、15時・17時を中心とした値引判断で導くことを目的とする。

翌日廃棄の目安：

- 理想：5点以下
- 許容：10点以下
- 10点超：改善対象

したがって、19時までに売れすぎて売場が極端に薄くなることと、19時に残りすぎて20時半額でも翌日へ大量に残ることのどちらも望ましくない。

19時チェックは、19時時点の商品品ぞろえと残量を確認し、15時・17時の値引判断や製造量がこの最終目標に対して適切だったかを振り返るための評価地点である。

18:30値引は、ユーザー本人が夜値引を担当する場合の専用運用枠。UI上は18:30画面から19時チェックへ入るが、19時チェックの主な評価対象は15時・17時の判断であり、18:30そのものを評価するための機能ではない。

## 現行フロー

- 操作モードは従来の詳細モード相当の1種類。簡易モードと習熟Step制は廃止済み。
- 15時、17時、18時30分、19時30分、20時30分を維持。
- 天候入力は16時〜21時。15時天候欄はない。
- 19時チェック開始は天候入力画面から行う。18時30分完了画面には開始ボタンを出さない。
- 19時チェックの新規「対象外」登録はない。旧 `not_applicable` は読み込み互換のみ。
- 20時30分は従来の最終残数入力と1個・2個・3個以上ルールを維持する。既存5択の人間評価UIがないため、今回の9段階入力は適用しない。
- 天候確認表の天気記号行は「天気」と表示する。見出しや他画面を一括置換せず、内部のweather field・計算・保存形式は変更しない。
- エリア残数判定側の「迷ったら…」は削除済み。個別商品の量判断側の「迷ったら…」は維持する。

## Initial weather focus

アプリを開いた直後は、最初の天候入力欄（現行15時準備では16時）へ自動focus／自動scrollしない。起動直後は画面上部をそのまま表示し、appVersionやsummer / normal状態をユーザーが確認できるようにする。

最初の天候入力をユーザーが完了した後は、次の時刻へ従来どおり自動scrollする。

```text
起動 → focus・自動scrollなし
16時入力 → 17時へ自動scroll
17時入力 → 18時へ自動scroll
以降も従来どおり
```

基準版にDOMの `autoFocus`／`.focus()` はなく、旧問題の実体はmount約80ms後の `scrollIntoView()`だった。fresh startだけを既存の `startButtonLabel` で区別して抑止し、条件編集resumeと自動時刻遷移では既存の初回scrollを維持する。値引率、中央値判定、fixed-time READ ONLY、last-area skip、storage safety等の既存仕様は変更しない。

## 中央値判定表示とバージョンUI

- 値引率表示画面では、履歴中央値による上書き前の `autoEvaluation` を `中央値判定：○○` として表示する。manual／final evaluationとは別情報であり、表示値を値引率計算へ再適用しない。
- manual変更時は `humanEvaluationDetails.automaticEvaluation`、history採用時はhistory由来の自動判定を表示する。履歴不足は `中央値判定：履歴不足` とし、「普通」へfallbackしない。
- トップ画面は正規sourceの `APP_VERSION` を「値引ヘルパー」の右側へ同一行表示する。build IDとdata schema versionは常時表示しない。

## 2026.8.9-9 handoff summary

Median display:

値引率表示画面で、履歴中央値によるautoEvaluationを「中央値判定：○○」として表示する。manual/final evaluationとは別情報で、履歴不足は「履歴不足」と表示する。

Last-area skip:

最後の未完了エリアで「今はスキップ」を押してもdoneへ進まない。他候補がない旨を通知し、現在エリアを未完了のまま維持する。

Fixed-time Supabase:

時刻固定モードは本番Supabase AreaCount履歴をREAD ONLYで利用し、通常モードと同じ中央値自動判定を利用できる。ただし固定モードから本番Supabase WRITE、production pending、production local history、Review19、learning populationへのWRITEは一切禁止する。

Version UI:

トップ画面の「値引ヘルパー」右側にappVersionを表示する。buildIdは常時表示しない。

Storage:

2026.8.9-8のstorage safety、quota recovery、15→17自動遷移、daily snapshot retentionを維持する。

## スキップ自己ループ修正

- 「スキップ先を選ぶ」で移動した後、そのエリアを「今はスキップ」した直後は、現在エリア自身をpending候補から除外してからmanual／few優先順位と経路方向を評価する。同じエリアへの即時自己ループは行わない。
- 現在以外に処理可能な未完了候補があればそこへ進む。現在の1エリアしか残っていない場合は `他にスキップできるエリアがありません` と通知し、現在エリアを未完了のまま維持する。skipをcompleted／doneへ変換せず、別エリア処理後の後回しエリア再訪も維持する。
- `storage.ts` にあるskip recordのpushは、永続化を行う関数と純粋なin-memory関数に各1回ある。連続した同一pushではなく、両経路ともidentity dedupeするためduplicate bugではない。今回この2つのpushは削除していない。
- 通常の「次へ」、スキップ先選択、先取りスキップ、session resume、navigation history、doneSummary、Review19 excluded、fixed-time隔離は変更しない。

## 業務中のstorage write安全性

- 2026.8.9-7基準版では、通常sessionの `done` effectが `upsertDailySessionSnapshot()` を通じてraw `localStorage.setItem()` へ到達し、storage例外をReactへ漏らす経路があった。人工的な `QuotaExceededError` でこのthrowを再現した。実端末事故のconsole例外とquota使用量は未取得なので、実端末でも同じ例外だったことまでは確定扱いにしない。
- 未処理例外がpassive effectからReact rootを停止させると白画面になり、30秒timer／focus監視も止まるため、15時完了後に17時自動遷移ダイアログが出ない実症状と整合する。さらに自動遷移経路自体も、alertと次session開始より前のdaily snapshot raw writeがthrowすると通知を中断する独立した欠陥を持っていた。
- 2026.8.9-8では、通常session完了、daily snapshot、15→17／17→18:30／18:30→19:30等の自動遷移、20時30分最終確定、AreaCount／Review19、pending、backfill、起動時remote merge、demand cycle保存を安全なstorage boundaryへ通す。失敗は `ok`、key、set/remove、error name、quota該当有無のmetadataとして扱い、record本文・payload・credentialをログへ出さない。
- 補助daily snapshotの保存失敗だけで時刻到達通知と次session開始を中止しない。正式なsession／AreaCount／finalized dayを保存できない場合は偽の完了へ進まず、ユーザーへ再試行可能な案内を出す。AreaCount正本を保存できてpendingだけ失敗した場合は正本を残し、管理設定のbackfillで再送可能にする。
- 自動遷移は `date × startedAt × 遷移元 × 遷移先` のin-flight keyでStrictModeのeffect再実行を抑止し、同じ時刻到達alert／snapshot／session開始を二重実行しない。次session開始が失敗した時だけguardを解放して再試行可能にし、手動遷移は従来どおりguard対象外とする。
- quota recoveryは、完全に統合済みと証明できるlegacy mirror、finalized-dayへ封印済みのdaily snapshot重複copy、navigation/debug用 `runtime-state`、重複した `work-session-checkpoint` の順で解放し、対象writeを1回だけ再試行する。Review19完成record、finalized day、未同期pending、進行中current-session、local-only／remote未確認AreaCountをcleanup対象にしない。無限retryは行わない。
- raw `localStorage.setItem()`／`removeItem()` はレビュー済み低レベルmoduleだけにallowlistする。`check:storage-write-boundary` はApp／hook／component層のraw callを0件に固定する。calculator draftの `sessionStorage` 3操作は各操作内で例外を捕捉済み。

### daily-session-snapshotsの役割とretention

- `nebiki-helper/daily-session-snapshots` は、Review19 daySnapshot、productionAnalysis、finalized day、temperature continuity、legacy export／backfillの入力となる中間業務証跡であり、常に捨てられるdebug cacheではない。
- retentionは従来の最大120件に、UTF-16のlocalStorage key＋value概算1 MiB soft budgetを加える。snapshotは日付group単位で保持し、最新側を優先する。ただし現在営業日と、finalized-day recordへまだ封印されていない日付は両limitのsoft exceptionとして必ず保持する。
- 容量整理の対象は、正式なfinalized-day recordへ同じsession群が保存済みの古い日付groupだけである。normal／summer、Obon、calendarContext、productionAnalysisをretention中に書き換えない。current／unfinalized、AreaCount、Review19、pendingは削除しない。
- anonymous rich fixtureのUTF-16概算ではdaily snapshot 1件約66.1 KiB、30件約1.94 MiB、60件約3.87 MiB、120件約7.75 MiBだった。これは設計fixtureであり、実端末の正確な使用量ではない。長期fixtureでは80 snapshotが641.6 KiB、整理後のcurrent-day snapshotが160.1 KiBだった。

## Review19完了とstorage失敗の安全化

- 最後の人間評価はReact state反映待ちに依存せずfinal buildへ明示的に渡し、12/12の `areaCounts` と `areaEvaluations` が揃った完成recordを1件だけ作る。
- 完了順序は、完成Review19本体のlocal保存 → Supabase pending準備 → source cleanup → `screen: "review19_done"`。完成recordのlocal保存に成功しない限りdoneへ進まず、再試行可能な案内を出す。
- 容量不足時は、完成Review19本体、cloud pending、完了済みcurrent-sessionを優先する。証明済みlegacy duplicate、封印済みsnapshot duplicate、navigation/debug用runtime、重複checkpointだけを安全な順序で解放し、対象の正本保存を1回再試行する。
- state／checkpoint／runtime／Review19／cloud enqueue／source cleanupのstorage操作は例外を構造化して受け止め、補助write failureをReactへthrowしない。diagnosticはkey、set/remove、error name、quota該当有無だけで、record本文やcredentialを出さない。
- current-sessionがquotaで失敗した場合も補助領域を解放して1回再試行するため、reload後に完了前stateへ戻る危険を抑える。Review19完成recordは独立した正本として残り、同一identityの再保存は1件へ統合する。
- Review19本体は保存済みだがpending準備だけに失敗した場合、完成recordを捨てず、管理設定の手動backfillで再送するよう案内する。local-first、pending queue、retry、CAS、merge、partial/final、RLSは変更しない。
- 確認済み事実: 基準版ではstate、checkpoint、runtime等の `localStorage` writeが未処理例外になり得た。`review19_done` component／routerと完成record shapeに直接のrender異常は確認されていない。実運用exportには12/12・completeのrecordが残っていた。
- 実端末原因の扱い: 完成record保存後の補助writeでquota等がthrowし、Reactを白画面化させた経路は症状と強く整合する。ただし実端末の例外ログ／正確な使用量がないため、`QuotaExceededError` 発生自体は高確度の推定であり確定事実とはしない。
- 2026.8.9-8の共通storage安全化でも、2026.8.9-7で導入した「完成Review19正本を最優先」「pendingは別段階」「local正本失敗時はdoneへ進まない」「pendingだけ失敗なら正本を維持」「同一identity duplicate防止」「reload後complete維持」を変更しない。

## Review19 storage diagnostics

2026.8.9-11では、Review19の端末正本保存に失敗した場合、一律に「端末の空き容量」と案内せず、storage safety layerが捕捉した実際の `errorName`、set/remove操作、quota該当有無、stage別の再試行結果を画面へ表示する。

```text
エラー：QuotaExceededError
エラー：SecurityError
```

- 表示対象はstorage metadataだけで、Review19本文、12エリアpayload、商品本文、error message、localStorage全内容、credentialを表示・console出力しない。安全な短いerror nameとして扱えない値は `UnknownError` とする。
- `QuotaExceededError` の場合だけ、このアプリで使えるブラウザ保存領域の上限に達した可能性を説明する。Android端末本体の空き容量不足とは断定しない。`SecurityError` もアクセス拒否という捕捉事実だけを示し、Chrome／PWA／端末設定などの原因を推測しない。
- Review19 authoritative save失敗時は従来どおりdoneへ進まず、12/12入力、human raw9、productionAnalysis材料、daySnapshotをReact stateに保持して再試行可能とする。
- pendingだけ失敗した場合はauthoritative local save failureと区別し、端末正本が保存済みであることとbackfill可能であることを表示する。正本を削除せず、`review19_done`への既存遷移を維持する。
- 正本とpendingのattempt列は別々に保持し、どちらのstageでretryしたかを混同しない。2026.8.9-8のquota recovery、補助runtime/checkpointだけのcleanup、1 attempt内最大1回retry、authoritative data保護は変更しない。
- 9-11の診断導入時点では原因を推測せずretentionを変更しなかった。その後、実端末で `QuotaExceededError` が確認されたため、9-12では下記のbounded storage対策を追加した。診断表示自体は維持する。

## 2026.8.9-12 localStorage quota root fix

- 実端末でReview19端末正本write、safe cleanup後の1回retryとも `QuotaExceededError` になったことを確認済み。Android本体容量ではなく、origin単位のブラウザ保存領域上限である。
- 起動時はcurrent-session／checkpointを先にメモリへ読み、保護日を確定してからhousekeepingする。進行中Review19、pending、finalized day、Review19正本、Review19 source、current／unfinalized evidenceは削除しない。
- `nebiki-helper/summer-area-count-records-v1` と旧normal keyは、正規化・既存mergeの結果が統合v2だけの場合に限り完全duplicateと証明して削除する。mirror-only、新しいrevision、よりrichなlegacy recordは残す。新規AreaCountは統合v2だけへ保存し、summer mirrorの再生成を停止した。
- productionの中央値sourceは `local unsynced／bounded recent cache + Supabaseの全paged remote history` をメモリ上でmergeする。同一5-field identityは既存revision／richness semanticsで1件へdedupeする。中央値engine、閾値、値引率は変更しない。
- Supabase AreaCount GETはcycle別に1,000件単位で全pageを取得する。remote取得が全page成功した場合だけ、5-field identity一致、remote revisionがlocal以上、local detailをremoteが包含、pending identityではないrecordをremote-confirmed cacheとして整理できる。
- 統合AreaCountのlocal cacheはUTF-16 key＋value概算1 MiBのsoft budget。pending、current date、local-only、remote未確認をbudget超過でも保護し、cycle×area×time×weekday／fallback groupごとに最低3件を優先してoffline母集団を残す。オンライン時はremote全履歴をメモリで使う。
- remote unavailable時は正式AreaCountをpruneしない。安全なlocal duplicate整理だけで足りなければ、Review19入力を保持して9-11のQuota診断を正直に表示する。remote取得失敗で業務開始や人間判定を停止しない。
- 9-11のcurrent-sessionに、12/12入力完備、Review19とsessionの日付／sessionStartedAt一致、未保存の `review19`／`review19_weather` stateが実在する場合だけ、翌日deployを含むreload後も復元する。日付から内容を推測せず、保存済み`review19_done`、incomplete、不一致stateは従来どおり復元しない。再度「完了」で同一Review19 identity／pending identityへdedupeして正式保存できる。
- fixed-timeは本番Supabase AreaCountをREAD ONLYで使う既存仕様を維持し、production housekeeping／cache write／pending／Review19／finalized day／learning populationへ一切writeしない。
- anonymous rich long-run fixture（AreaCount 2,000、pending 100、Review19複数、daily snapshot 80等）では、UTF-16概算 `5011.6 KiB` から `2516.7 KiB` へ49.8%削減し、AreaCount local cacheは2,000件から897件になった。protected dataはbyte-identicalである。

## 人間残数評価（5ボタン・9段階）

- 共通UIは既存5ボタンを維持する。通常タップは即確定し、`few / slightly_few / normal / slightly_many / many` をscore `1 / 3 / 5 / 7 / 9` として保存する。
- 500ms長押し成立時に第1選択を即時強調し、対応端末では15ms振動する。長押し後は同じ項目または隣接項目だけを第2選択にできる。
- 同じ項目の再タップは単独選択へ戻り奇数score、隣接項目は偶数score `2 / 4 / 6 / 8`。第1・第2選択の順序を保存し、非隣接はvalidatorで拒否する。キャンセル操作で中間モードを終了できる。
- 成立済み長押しの `pointerup` とghost clickをone-shotで抑止する。移動、`pointercancel`、pointer capture喪失、blur・visibility changeもcleanupし、画面左スワイプは長押し成立時にキャンセルする。
- action入力の `HumanEvaluationSelection` はraw scoreと選択列だけを持つ。hook/domain境界で `HumanEvaluationDetails` を構築し、入力オブジェクトと順序を変更しない。
- 新規記録は `humanEvaluationScale: 9`。通常値引では偶数だけを既存 `AreaCountEvaluation` へ解決し、その解決値を既存運用ロジックへ渡す。通常サイクルは15時=`lower`、17時以降=`higher`。夏季モードはJST 18:00未満=`lower`、18:00以降=`higher`。奇数は選択値のまま。
- 夏季境界には固定時間対応のruntime clockを使い、`evaluatedAt` とresolution reasonの整合もnormalizerで検証する。
- 旧5段階は保存物を移行せず、読み込み・分析・出力時に奇数score、`humanEvaluationScale: 5`、単独selectionへ論理deriveする。

## 夏季モード（内部 `demandCycle`）

- ユーザー向け名称は「夏季モード」。内部保存値は互換性のため `normal` / `summer` のまま維持する。
- JSTの営業日が7月1日〜9月30日の場合だけ開始画面へON/OFFを表示し、ユーザーが手動で切り替える。気温による自動切替は行わない。
- 期間外は保存済み `summer` も `normal` へ正規化し、翌年7月に勝手にONへ戻さない。
- モードは15時、17時、18時30分、19時30分、20時30分、19時チェックを含む営業日全体へ適用する。
- 当日の運用開始後は変更できない。期間内の選択状態は翌日以降へ引き継ぐ。
- 時間固定モードは固定したJST日時で期間判定し、本番とは独立した選択・日次ロックを使用する。中央値判定の入力に限り、本番Supabase AreaCount履歴をREAD ONLYで参照する。固定モード由来のrecordは本番local履歴・Supabase・pending・Review19・learning populationへ書かない。
- ONかつ17:59までは、9段階の中間値を少ない側へ解決する案内を表示する。18:00以降は中間値を多い側へ解決し、単独の5基準項目は変更しない。
- 通常履歴と夏履歴は混ぜない。旧データで `demandCycle` が欠ける場合は `normal` として扱う。
- `summer` の短期中央値は対象年と同じ年の夏データだけ、長期中央値は対象年より前の年の夏データだけを使用する。
- 前年以前の夏データは、今年の自動判定開始3件へ含めない。
- 今年の同曜日が3件以上なら曜日単体判定を使用する。同曜日が3件未満で曜日グループが3件以上ならグループ判定、どちらも3件未満なら手動判定とする。
- 曜日単体判定では、既存の「長期中央値より最大2個低い位置まで」のガードを使用する。曜日グループ判定では長期ガードを使用しない。
- 減少率履歴と20時30分の中央値判定もサイクル別に分離する。
- 19時チェック、日次スナップショット、`rateDecisionSnapshot`、JSON出力へ需要サイクルを保存する。
- 個別商品の量判断ではsummer時だけ、採用基準の先頭へ「夏の」を付ける。手動エリア残数判定も「夏季モード基準：夏の残数基準」を表示する。normal時は夏表示を出さない。

## 夏季モードとクラウド保存

- 通常・夏季の残数履歴を同じlocal-first同期経路で扱う。端末保存が先、Supabase upsertは後であり、remote失敗で値引フローを止めない。
- 統合端末cacheは `nebiki-helper/area-count-records-v2`。旧normalの `nebiki-helper/area-count-records` と旧summerの `nebiki-helper/summer-area-count-records-v1` は読込／import互換を維持するが、新規dual-writeは行わない。legacy keyは統合v2への完全包含を証明できた場合だけhousekeepingで除去し、local-only／pending／remote未確認の正式recordは削除しない。
- Supabaseの `area_count_records.demand_cycle` へ `normal` / `summer` を正式保存する。remote queryも必ずcycleで分離し、normalとsummerを同じ中央値・減少率・20時30分判定の母集団へ混ぜない。
- サイクル選択と当日ロックのキーは `nebiki-helper/demand-cycle-state-v1`。時間固定モード側は `nebiki-helper/fixed-time-demand-cycle-state-v1` で、本番設定と相互に変更しない。
- 固定時間モードのhistory sourceは本番Supabase AreaCountのREAD ONLY、persistence destinationはfixed-time隔離領域である。normal／summerを別queryで読み、通常モードと同じ曜日・holiday・Obon referenceと中央値engineを使う。通信失敗時は履歴なしで固定モードを続行する。
- 固定時間モードから本番Supabase mutation、pending queue、AreaCount local history、Review19、finalized day、learning populationへのwriteは行わず、手動backfillも `fixed_time_mode` として実行しない。
- 完了済み日の通常・夏季履歴は日次JSONにも含まれ、JSON exportは引き続き分析・監査・可搬backupとして維持する。
- `dataSchemaVersion` はJSON schemaのversionであり、今回のJSON側追加はoptionalかつ後方互換なため `3` のまま。Supabase schema migrationは別管理とする。

## 分析データ

- 新規完了エリアでは `rateDecisionSnapshot` が実表示率の正本。
- `completed*` は画面表示・旧データ互換用。
- エリア完了後に時計が進んでも `rateDecisionSnapshot`・`completed*`・保存用完了サマリーを再計算しない。
- 完了画面の値引率一覧だけは最終確認用途のため、確定済み判定を維持し、現在時刻の既存時間補正で動的に再計算する。表示値はセッション・日次データ・エクスポートへ書き戻さない。
- 旧完了データにスナップショットがない場合は `legacy_not_captured`。架空の値を作らない。
- セッション `basis` は完了保存時に `basisCapturedAt` とともに固定し、エリア率の正本には使わない。
- 日次品質は `processComplete` と `measurementComplete` を分離する。
- `humanEvaluationDetails` はraw score・選択順・scale・解決値と理由を保持する。`decisionBasis` へ重複保存しない。

### 祝日基準と `calendarContext`

- お盆は毎年8月13日〜16日。法定祝日とは分離し、新規sessionの `calendarContext` に `isObon: true` と `calendarCondition: "obon"` を保存する。実際の祝日と重なる場合も `isHoliday` と `isObon` の両方の事実を失わない。
- 現時点のお盆需要判断はholiday-equivalent。個別量判断とエリア残数referenceは現行の祝日当日と同じロジックを使うが、reference reason／calendar conditionは `obon` として識別できる形で保持する。
- エリア残数ではお盆当日を既存の祝日相当としてfallback強制する。お盆最終日の翌日が通常平日なら、祝日当日と同じ `翌日平日祝日` 専用母集団を使う。一方、8月12日の前日特例や8月17日の翌日特例は新設しない。
- お盆期間の中日というだけで `three_day_holiday_middle` へ分類しない。既存カレンダー上で本当に三連休中日へ該当する場合だけ従来の特例を優先する。8月12日をお盆前日／祝日前日、8月17日をお盆翌日として特別扱いしない。
- お盆は `normal / summer`、天気、気温、`productionAnalysis` と独立したcalendar factである。通常の8月運用では `demandCycle: "summer"` と `calendarCondition: "obon"` を併記し、天候補正や製造不足疑いの強度は変えない。
- 新ルールは導入後に作成するsessionから適用する。導入前に `calendarCondition: "ordinary"` と実曜日referenceで保存済みの8月13日等は、normalize／day統合／export／cloud mergeで日付から遡及変換しない。
- 個別量判断の採用優先順位は、三連休中日の既存特殊基準（17時以降）→お盆→非祝日の祝日前日→祝日当日→通常曜日。三連休中日の15時は従来どおり実曜日を使う。
- 非祝日の祝日前日は金土基準、祝日当日は日曜基準。祝日であり翌日も祝日のケースは「祝日前日」へ落とさず、祝日／連休の既存特殊判定を優先する。
- 個別量の祝日前日表示は「金曜日・土曜日の○時を基準に考えて」、祝日当日は「日曜日の○時を基準に考えて」とし、人間に追加考慮を求めず採用済み基準を説明する。
- エリア残数の履歴選択ロジックは変更しない。祝日前日の既存15時／17時以降の基準、同曜日優先、曜日group fallback、三連休中日、翌日平日祝日の比較結果を正本にし、採用結果をメタデータへ写す。
- `calendarContext` は `version: 1` のoptional情報。`date`、`scope`、`actualWeekday`、`isHoliday`、`isDayBeforeHoliday`、`calendarCondition`、手動曜日override有無を持つ。
- `individualAmountReference` はセッションごとにkind／comparison mode／採用曜日またはgroup／対象値引時刻／reason／表示基準を保持する。`areaCountReference` はセッション・値引時刻・エリアごとに、同曜日、曜日group、複合group、履歴不足等の実際のcomparison modeとreasonを保持する。
- 日次 `calendarContext` は各sessionとAreaCount recordのcontextを統合し、15時と17時、またはエリア間で基準が異なる場合も潰さない。Workは `actualWeekday` から採用基準を推測せず、各referenceを使用する。

### `productionAnalysis`（製造不足疑い）

- day-levelの `productionAnalysis.areas[areaId]` に15時・17時の最終採用5段階判定、19時のhuman raw score、checkpoint status／source、human source scale、low-side件数、`productionShortageSuspicion` を保存する。確定診断やground truthではなく、3 checkpointから機械的に作る分析flagである。
- 15時・17時は、その時点で値引判断へ最終的に採用した `areaCountEvaluation`／`areaCountDecisionBasis.finalEvaluation` 相当の5段階を正本にする。自動中央値判定をそのまま採用した場合も有効checkpointで、sourceは既存canonical値の `history`。人間が変更した場合は変更後の最終判定を使い、sourceは `manual`。
- 15時・17時は最終採用5段階の `few / slightly_few` を少ない側とする。manual時は既存のraw 9-scaleとscaleを保持するが、history時に人間raw scoreやscaleを捏造しない。元のautomatic evaluation、manual evaluation、final evaluationは相互に上書きせず、`productionAnalysis` は既存データからderiveする。
- 19時はReview19のhuman observationだけを使用し、sourceは `human_review19`。raw score `1 / 2 / 3 / 4` を少ない側、`5` を普通、`6 / 7 / 8 / 9` を多い側とし、中央値 `autoEvaluation` は人間評価の代用にしない。
- 3 checkpointが全て有効な場合だけ、low側3=`strong`、2=`medium`、1=`weak`、0=`none`。15時／17時のsessionまたは最終採用判定、19時のReview19 human評価がない場合、あるいはmissing／excluded／not measured／session missingなら `insufficient`。2/2や1/1から強度を推測しない。15時／17時にhuman manual評価がないことだけでは `insufficient` にしない。
- 旧5段階human評価は既存互換に従い `few / slightly_few / normal / slightly_many / many` を `1 / 3 / 5 / 7 / 9` へ論理deriveするが、source scaleは5のまま。2026.8.9-4の保存済み `productionAnalysis` もoptional field欠損を許容して読込み、既存session／recordから安全に復元できる場合だけ再deriveする。過去recordを物理更新しない。
- 雨・雪・予報状態を理由にflagを削除・弱体化しない。15/17/19が全て少ない側ならrainでもsnowでも `strong` を保持し、天気は別のanalysis variableとして併読する。

### `analysisWeatherContext`

- 各値引セッションで既存入力対象となる時間別予報（15時は16〜21時、17時は18〜21時、18時30分は19〜21時、19時30分は20〜21時、20時30分は21時）を `weatherDataSource: "entered_hourly_forecast"`、`analysisWeatherClass: "dry" | "rain" | "snow" | "mixed" | "unknown"` へ要約する。実測天候を示すfield名は使わない。
- 雨だけならrain、雪だけならsnow、雨と雪が混在すればmixed、全対象時刻が揃い降水なしならdry、対象時間の不足・判別不能はunknown。`hasPrecipitation`、`precipitationTypes`、判定対象・dry・rain・snowの時刻も保持する。
- このsummaryは元の `hourlyForecasts`、`resolvedWeather`、`precipitationRateBonus`、`weatherPointScore` を置換しない。値引率・天候補正にも使わない。

### Work / Data Analyticsの解釈規則

- `normal` と `summer` は別母集団として扱う。
- dry／rain／snow／mixedでデータセットを物理分割しない。weather classはnormal／summer内の説明変数・層別条件とし、製造量や残数水準では可能な限り同条件比較する。
- `productionShortageSuspicion` は15時・17時の最終採用エリア判定と19時のraw human observation由来で、天候補正済みの結論ではない。checkpoint source（`history / manual / human_review19`）を区別し、必ず `analysisWeatherContext` と併読して雨天時の製造抑制等は分析段階で解釈する。
- 祝日分析は実曜日だけを使わず、`calendarContext` の採用reference・reason・comparison modeを使う。
- 将来はhuman raw evaluation、中央値auto evaluation、製造不足疑い、その後の残数、最終廃棄、天気予報contextを並べて検証する。どれかを正解ラベルとして相互上書きしない。

## 19:00チェックの人間評価と中央値評価

- 各対象エリアは、19:00実残数と共通5ボタンによる人間9段階raw評価が揃って完了する。除外エリアには要求しない。
- 人間評価は売場を見た担当者の観測値であり、ground truthではない。数値と感覚が矛盾しても、どちらも入力どおり保持する。
- Review19では偶数scoreを値引用5段階へ解決しない。`humanEvaluationDetails` のscore・selection・scale 9が正本であり、`resolutionDirection: "not_applicable"`、`resolutionReason: "review19_observation"`、`sessionDiscountTime: "19"` を保存する。
- 新規の奇数scoreだけは完全一致する既存 `humanEvaluation` を互換用に併記する。偶数scoreでは丸めた `humanEvaluation` を作らない。旧 `humanEvaluation` だけの記録はscale 5・奇数scoreとして論理deriveし、保存済みデータ自体は更新しない。
- 過去の19:00チェック残数だけを一時的な19時履歴として既存中央値エンジンへ渡し、中央値ベースの5段階評価を別センサーとして保存する。当日自身は母集団へ含めない。
- `normal` / `summer` を混ぜず、既存の同曜日3件優先・曜日グループfallback・祝日例外を維持する。`summer` は今年を短期、前年以前を長期として分離する。
- 履歴不足は `autoEvaluation: null` と `autoEvaluationStatus: "insufficient"` であり、「普通」を代入しない。
- エリア別の正本は `areaEvaluations[areaId]`。`humanEvaluationDetails`、互換 `humanEvaluation`、`autoEvaluation`、`autoEvaluationStatus`、`autoEvaluationBasis` を19:00個別出力、日次スナップショット、統合JSONから追跡できる。
- 自動5段階評価、中央値、件数、基準は入力画面にも完了画面にも表示しない。Work/Data Analyticsで human raw evaluation / median-based five-level evaluation / later outcome・discard を比較するためのデータである。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」の旧評価で意味が異なるため再利用しない。これら旧rating系から人間評価を推測・補完しない。
- 時間固定モードのReview19は本番19:00履歴を読み込まず、本番Review19履歴・Supabase・本番日次データへ保存しないため、Review19側の自動評価は履歴不足になる。これは固定モードの通常値引で許可するAreaCount Supabase READ ONLYとは別経路である。

## 先取り値引済みエリア

正式時刻では3択:

1. 残数だけ記録する
2. 今回は値引する
3. 測定せずスキップする

未測定時は残数を補完せず、`measurementStatus`、`missingReason`、先取り元情報、確認時刻、`rateOrigin` を保存する。

## 現行の商品ルール

- 「10個以上＋5％」は廃止済み。
- 広告商品は常時−10％。
- 定番−10％、夜によく売れる−10％、見た目が悪い＋10％、不人気＋10％は維持。
- 20時30分の1個・2個・3個以上ルールは維持。

## 出力

- 管理設定の「全データを出力」で日次データと19時チェックを1 JSONへ統合。
- 同日は日次データを正本とし、19時チェック側を除外。
- 重複除外・判定不能・旧対象外の件数を `dataQuality` に保存。
- 新しいscale 9詳細はセッション、日次スナップショット、19:00個別、日次個別、統合JSONでroundtripする。旧scale 5は保存済みデータを変更せず、出力用cloneだけへ奇数scoreとしてmaterializeする。
- 「19:00チェックデータを全件出力」と「1日データを全件出力」は、UIボタンを増やさずnormal／summer別ファイルを生成する。両方にrecordがあれば2ファイル、片側0件なら有効側だけ。ファイル名は `nebiki-review19-{cycle}-YYYYMMDD-HHMM.json` と `nebiki-daily-{cycle}-YYYYMMDD-HHMM.json`（JST）。
- 各全件ファイルは従来の完全schemaを保ち、optionalな `exportFilter.demandCycle` をrootへ加える。normal fileへsummer、summer fileへnormalを混ぜない。
- 「最新の19:00チェックデータ」「最新の1日データ」は従来どおり、対象recordのcycleに関係なく1操作1ファイル。
- `calendarContext`、`analysisWeatherContext`、`productionAnalysis` をday snapshot／Review19／日次・統合JSONの既存経路で追跡可能にする。旧データでfield欠損なら未取得として扱い、推測補完しない。

## Supabaseクラウド同期

### 現行schema確認とmigration

- migration前の `area_count_records` は `id`、version 3列、日付・session・record時刻、area・discount時刻、曜日・曜日group、count、作成・更新時刻の14列。unique keyは `date × session_started_at × area_id × discount_time`。RLSは共有売場を前提にanonのSELECT／INSERT／UPDATEを許可し、DELETEは許可しない。
- 新migrationは既存rowを削除せず、`demand_cycle text not null default 'normal'` と `record_details jsonb not null default '{}'` を追加する。既存rowはDEFAULTでnormalとなる。CHECKでcycleを `normal` / `summer`、detailsをJSON objectへ制限する。
- unique keyを `date × session_started_at × area_id × discount_time × demand_cycle` へ置換し、cycle・area・discount時刻・曜日／曜日group・record時刻用indexを追加する。
- `record_details` は `userJudge`、`humanEvaluationDetails`、`suggestedEvaluation`、`areaRateAdjustment`、`evaluationSource`、`decisionBasis`、`comfortPoint` を保持する。旧5段階はcloud payload上だけscale 5と奇数scoreへ展開し、新9段階はraw score、selection順、resolved 5段階、direction/reasonを保持する。アプリstate全体は格納しない。
- `review19_records` を新設し、1営業日・1cycleを1 rowとしてupsertする。version、date、session、cycle、`recorded_at`、`source_updated_at`、`is_complete`、`payload jsonb`、作成・更新時刻を持ち、unique keyは `date × demand_cycle`。
- Review19のpartialは `recorded_at = null`、finalはrecorded_atあり。各入力・除外・修正・完了で `sourceUpdatedAt` を単調増加させる。triggerは古いrevisionとfinalからpartialへの逆戻りを拒否する。旧recordに `sourceUpdatedAt` がなければrecorded/completed/area count/start時刻のうち最新の有効時刻を論理的に利用する。
- 新tableのRLS／権限は既存area tableと同じanon SELECT／INSERT／UPDATE、DELETEなし。area tableの現行RLS modelは変更しない。service role keyはfrontendへ追加しない。
- 今回のanalysis metadataは `area_count_records.record_details` と `review19_records.payload` の既存JSONB、および既存snapshot経路にoptional fieldとして保存する。新column、migration、RLS／policy変更はない。

### local-first、pending、retry

- AreaCountは端末cacheへupsertしてからoutboxへ積み、Review19は端末state／recordを保存してからoutboxへ積む。Supabase成功を現場保存の条件にしない。
- pending keyは `nebiki-helper/pending-supabase-sync-v1`。itemは `type`（`area_count` / `review19`）、identity、payload、`firstFailedAt`、`lastAttemptAt`、`attemptCount`、`enqueuedAt`、`lastError` を持つ。
- 同じtype・identityはqueue内で1 itemにまとめる。retryはapp起動、online event、新しいAreaCount／Review19保存後、管理設定の手動同期で行う。送信は直列で、process内のsingle in-flight lockにより並列flushを抑止する。送信中に同identityの新revisionが積まれた場合はCASで消さず、必要なら成功後にもう一度だけ追送する。
- remote失敗、Supabase設定なし、schema未適用はすべてpendingに残す。特にsummerを旧schemaへnormalとして送るfallbackはない。
- Review19は各エリア確定後のpartialも送る。final payloadがpartialへ退行しないようqueueとDB triggerの両方で保護する。remoteから中央値履歴へ取り込むのはcomplete・finalだけ。

### pending同期エラー診断

- pendingが1件以上ある場合だけ、管理設定に「エラー詳細」を表示する。既存の `nebiki-helper/pending-supabase-sync-v1` を直接読み、別のerror logは作らない。
- group keyは `type × payload直下のdemandCycle × sanitized lastError`。cycle欠損はnormalへ推測せず「不明」、error欠損も「エラー未記録」としてgroup件数へ含める。
- 表示・コピー対象はtype、cycle、件数、試行回数の最小／最大、最初の失敗、最後の試行、error本文。payload全体や全record一覧は表示しない。
- コピー前にAuthorization、Cookie、API key、access／refresh token、JWT、Supabase key、URL認証情報を除去する。HTTP status、PostgREST code／message／details／hint、constraint、columnは保持する。
- 新規HTTP失敗は安全なPostgREST本文を `lastError` へ追加保持する。既存pending schema、retry回数／時機、CAS、in-flight guard、identity、local-first同期は変更しない。
- retry成功後は既存のcloud sync version更新でgroupを再生成し、pending 0なら診断UIを消す。固定時間モードではqueueを読まず、診断groupも空にする。
- 2026.8.9-3の実使用端末では、残数950件・19:00チェック3件の計953件が成功、失敗0件・pending 0まで同期完走し、Supabase上の `demand_cycle = summer` も確認済み。これは利用者による実端末確認結果であり、今回のリリースではcloud sync基盤を変更していない。

### identity、dedupe、merge precedence

- AreaCount identityは `date × sessionStartedAt × areaId × discountTime × demandCycle`。同じlocal／remote recordを1sampleにし、normalとsummerは別recordとして扱う。
- app側はrecordedAtが新しいrecordのcount・固定値を優先し、欠けたoptional detailを古いrecordから補完する。同一revisionでは詳細量の多い方を優先して不足項目を補い、同率なら安定fingerprintで決定する。
- DB側は遅れて届いた古いrecordedAtを無視する。同じrecordedAtでは既存固定値を保持し、欠けたJSON keyだけ補完する。ただしscale 9の `humanEvaluationDetails` はscale 5 envelopeより優先する。新しいrecordedAtでは新revisionの値を採用し、未送信の旧JSON keyを残す。
- Review19 identityは `date × demandCycle`。local／remote中央値履歴はcomplete・finalだけを1日1cycleへ統合し、完全なtieではremoteを採用する。人間rawと中央値auto評価はpayload内に共存し、相互に上書きしない。

### 端末内データbackfill

- 管理設定の「端末内データをSupabaseへ同期」で手動実行する。対象は統合cache、旧normal cache、旧summer cache、finalized day、Review19のday snapshot、daily session snapshot、確定済みcurrent session、およびlocalのcomplete・final Review19。
- future record、invalid date／area／count／timestamp／cycle、未測定、確定前UI state、fixed-time dataを除外する。複数保存元の同一recordは送信前にidentityで統合し、rich detailsを保持する。
- 送信はidempotent upsert。何度実行してもrow／中央値sampleを増殖させず、remote既存rowをnull detailで劣化させず、localデータは削除しない。
- 結果UIは残数／19:00の検出数、送信対象、成功、失敗、pendingを表示する。pending 0だけを「すべて同期済み」の条件とする。Supabase APIのため新規／更新を推測表示しない。

### SQL実行と実環境確認

- SQLは `supabase_area_count_records_cloud_sync_backup.sql` → `supabase_area_count_records_cloud_sync_migration.sql` → `supabase_area_count_records_cloud_sync_verify.sql` の順。旧clientの書込みを止めてから実行し、verify成功後に新アプリをdeployする。
- deploy後、実使用端末で新版を起動し、「端末内データをSupabaseへ同期」を実行して成功／失敗／pendingを確認する。
- 問題時は新アプリを停止／旧版へ戻してから `supabase_area_count_records_cloud_sync_rollback.sql` を使う。summer rowがある場合はrollbackを中止し、Review19 tableは削除せずprivate quarantineへrenameする。
- 利用者報告では、2026-08-11にcloud-sync migrationを実DBへ適用済みで、guard関数自体も正常。旧verify SQLだけが `pg_get_functiondef()` 内の改行位置に依存して誤失敗し、該当判定を手動修正するとverify全体が完走した。
- 2026.8.9-3のverifyは関数定義の空白・改行・インデントを正規化してから、final→partial禁止、古いrevision禁止、同一revision guard、partial→final例外の4条件を検査する。migration、guard runtime、schema、unique、RLS、rollbackは変更しない。
- この開発環境にはSupabase接続情報がないため、新verifyを実DBで再実行したとは報告しない。実端末の同期error本文を確認後に原因と次の修正を判断する。
- 20時30分の残数中央値、30/40/50型・40/50型・全品50型、1個・2個・3個以上ルールは変更しない。20時30分recordもcycleを保持して同期するが、人間9段階UIは追加しない。

## 今回変更しない重要仕様

- cloud syncのlocal-first、pending queue、retry timing、CAS、in-flight guard、rich merge、normal／summer dedupe、Review19 partial／final、backfill、fixed-time隔離を変更しない。
- Supabase SQL、schema、column、unique key、index、RLS、policyを変更しない。追加analysis metadataは既存JSONBで保持する。
- 値引率基本値、天候・気温補正、夏季期間、9段階interaction／500ms長押し、完了画面の現在時刻率、20時30分ルールを変更しない。
- `dataSchemaVersion` はoptional additive metadataのみのため `3` を維持する。

## 確認コマンド

README記載の全 `check:*`（特に `check:review19-storage-diagnostics`、`check:review19-completion-safety`、`check:initial-weather-focus`、`check:weather-confirmation`、`check:median-version-ui`、`check:last-area-skip`、`check:fixed-time-supabase-read`、`check:session-completion-storage-safety`、`check:daily-session-snapshot-storage`、`check:long-run-storage-safety`、`check:storage-write-boundary`、`check:obon-calendar`、`check:analysis-metadata`、`check:supabase-sync-diagnostics`、`check:human-evaluation-9scale`、`check:review19-human-auto`、`check:supabase-sync-domain`、`check:review19-remote-storage`、`check:supabase-cloud-sync-sql`）、TypeScript型チェック、変更対象ESLint、`npm run build` を実行する。PWA生成物は `dist/manifest.webmanifest`、`dist/sw.js`、`dist/registerSW.js` を確認する。今回の最終結果は `CHANGE_REPORT_20260824_REVIEW19_STORAGE_DIAGNOSTICS.md` を参照する。
