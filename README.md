# 値引ヘルパー

惣菜の値引判断と残数記録を支援する、React + TypeScript + Vite製の業務用PWAです。

## 起動と確認

```powershell
npm install
npm run dev
npm run check:logic
npm run check:integration
npm run check:weekday-groups
npm run check:three-day-holiday-middle
npm run check:holiday-before-normal-weekday
npm run check:full-mode
npm run check:rate-decision-snapshot
npm run check:auto-skip-ui
npm run check:data-export-and-supabase
npm run check:schema-v3
npm run check:demand-cycle
npm run check:summer-mode
npm run check:done-summary-current-rate
npm run check:review19-human-auto
npm run check:human-evaluation-9scale
npm run check:supabase-sync-domain
npm run check:review19-remote-storage
npm run check:supabase-cloud-sync-sql
npm run check:cycle-separated-export
npm run check:analysis-metadata-ui
npm run check:obon-calendar
npm run check:review19-completion-safety
npm run check:review19-storage-diagnostics
npm run check:session-completion-storage-safety
npm run check:storage-write-boundary
npm run check:daily-session-snapshot-storage
npm run check:long-run-storage-safety
npm run check:median-version-ui
npm run check:last-area-skip
npm run check:fixed-time-supabase-read
npm run check:initial-weather-focus
npm run check:quota-root-fix
npm run check:review19-lightweight-outbox
npm run check:global-discount-adjustment
npx tsc -b --pretty false
npm run build
```

## 現在の運用

- 操作フローは従来の詳細モード相当の1種類です。簡易モードとモード切替はありません。
- 15時・17時・18時30分・19時30分・20時30分の値引フロー、19時チェック、自動時刻遷移、早め次時刻−5％を維持しています。
- 天候入力は16時〜21時です。15時値引そのものは維持し、15時専用の天候欄だけを廃止しています。
- fresh起動直後は最初の天候欄へ自動スクロールせず、タイトル、appVersion、夏季モードを画面上部で確認できます。最初の欄を確定した後は、次の時刻へ進む既存の自動スクロールを維持します。条件編集resumeと自動時刻遷移では既存の初回スクロールを維持します。
- 天候入力の確認表は、天気記号の行名だけを「天気」と表示します。内部の天候データ名・計算・保存形式は変更していません。
- エリアの残数評価は5つの基準ボタンを維持し、長押し時だけ隣接項目との中間を選べる9段階入力です。曜日グループ、祝前日、三連休中日、翌日平日祝日のロジックは維持しています。
- 20時30分は従来の最終残数入力と1個・2個・3個以上ルールを維持し、5択の人間評価UIがないため9段階入力の対象外です。
- 個別商品の「10個以上＋5％」は廃止しています。
- 広告商品は当日の売れ方にかかわらず、表示値引率から常に−10％です。
- 定番商品−10％、夜によく売れる商品−10％、見た目が悪い商品＋10％、不人気商品＋10％は従来どおりです。

## 中央値自動判定の表示

- 残数入力と人間判定を終えた値引率表示画面では、20時30分を除き、履歴中央値から得た上書き前のrecommendationを `中央値判定：普通` 等として表示します。
- 人間が判定を変更した場合も、`humanEvaluationDetails.automaticEvaluation` を表示の正本とし、採用判定／`finalEvaluation` を中央値判定として表示しません。表示値を値引率計算へ再適用することもありません。
- `recommendationStatus: "insufficient"` 等で自動判定が成立していない場合は `中央値判定：履歴不足`、成立状態と値が矛盾する場合は `中央値判定：取得できません` とし、「普通」へ偽装しません。
- トップ画面は正規の `APP_VERSION` を「値引ヘルパー」と同じ行の右側へ表示します。build IDとdata schema versionは常時表示しません。

## スキップ遷移と業務中storage保存の安全性

- 「スキップ先を選ぶ」で移動したエリアをさらに「今はスキップ」しても、その操作直後に同じエリア自身を次候補として再選択しません。候補選択では現在エリアを先に除外してからmanual／fewの優先順位と経路方向を評価します。
- スキップしたstatusは消さないため、別エリアを処理した後に後回しエリアへ戻る既存動作は維持します。現在エリア以外に処理可能な未完了候補がない場合は `他にスキップできるエリアがありません` と通知し、現在エリアを未完了のまま表示します。skipをcompletedやdoneへ変換しません。
- skip recordは永続化用と純粋なin-memory用の2経路で、それぞれ同じidentityを1件へまとめます。コード上の2つの `cloneSkipRecord` 追加は別関数であり、同一操作を2回記録する重複バグではありません。
- 通常sessionの完了、`daily-session-snapshots` 保存、15時→17時などの自動時刻遷移、20時30分の最終確定、AreaCount／Review19、Supabase pending、backfill、起動時mergeを含む業務中のstorage writeは、失敗を構造化結果として受け止めます。補助writeの例外をReact rootへ漏らして白画面化させません。
- 自動時刻遷移では、補助的なdaily snapshotを安全に保存した後、その成否だけを理由に時刻到達通知と次session開始を中止しません。15時完了後もappのtimer／effectを維持し、17時到達時の既存ダイアログを表示できる構造です。
- React StrictModeで同じ自動遷移effectが再実行されても、同一session・同一遷移先の通知と開始は1回だけです。開始に失敗した場合は再試行でき、手動遷移の挙動は変更しません。
- `daily-session-snapshots` は単なるdebug cacheではありません。Review19／productionAnalysis／finalized day作成、temperature continuity、legacy export／backfillに使う中間業務証跡であり、当日や未確定日のsnapshotは削除しません。従来の最大120件に加え、localStorageのUTF-16 key＋value概算で1 MiBのsoft budgetを設け、正式なfinalized-day recordへ封印済みの古い日付groupだけを再構築可能な重複copyとして整理します。日付groupの途中だけを削除しません。
- 容量不足時は完成Review19、finalized day、未同期pending、進行中session、local-only／remote未確認AreaCountを優先します。削除可能なのは完全包含を証明済みのlegacy mirror、正式recordへ封印済みのdaily snapshot、navigation/debug用runtime、重複checkpointです。quota時の再試行は1回に限定し、同じ操作を無限に繰り返しません。
- 19:00チェックは、12エリアの完成recordを `nebiki-helper/review19-records` へ保存してからSupabase outboxを準備し、その後に `review19_done` へ遷移します。端末正本を保存できなければ完了扱いにせず、入力stateを保持したまま、保存先・操作・実際の `errorName`・quota該当有無・再試行結果をalertへ表示します。
- `QuotaExceededError` のときだけ、このアプリで利用できるブラウザ保存領域の上限に達した可能性を説明し、Android端末本体の空き容量不足とは断定しません。`SecurityError` は保存領域へのアクセス拒否として表示し、それ以外や安全に表示できない名前は推測せず `UnknownError` へ正規化します。
- `localStorage.setItem()`／`removeItem()` の失敗は、key・操作・例外名・quota該当有無だけを構造化して扱います。Review19本文、12エリアpayload、error message、credentialは画面やconsoleへ出しません。正本とpendingのattempt列を分け、どちらが再試行されたかを混同しません。
- Review19本体の保存後にcloud outboxだけ準備できなかった場合は、端末正本失敗とは異なる保存先として診断表示し、完成recordを保持します。管理設定の「端末内データをSupabaseへ同期」からbackfillできます。local-first、pending、retry、CAS、fixed-time隔離は変更しません。
- 静的checkは、raw `localStorage.setItem()`／`removeItem()` をレビュー済み低レベルmoduleだけにallowlistし、App／hook／component層のraw callを0件に固定します。`sessionStorage` のcalculator draft 3操作も従来どおり各操作内で例外を捕捉します。
- 基準版の通常done effectと自動時刻遷移には、daily snapshotのraw writeが例外を上位へ漏らす経路があり、人工的な `QuotaExceededError` で再現しました。これは確定したコード上の不具合です。一方、実端末事故時のconsole例外とlocalStorage実使用量は取得できていないため、実端末でも同じ例外が発生したという部分は高い整合性を持つ推定であり、確定診断とは区別します。

## localStorage quota root fix（2026.8.9-12）

- 2026-08-24の実端末Review19では、端末正本writeと安全整理後の1回retryの両方で `QuotaExceededError` が確認されました。端末本体容量ではなく、`nebiki-helper.vercel.app` originのブラウザ保存領域上限です。
- 最大の継続増加要因は、Supabase AreaCount全履歴を起動ごとに統合local keyへ再保存し、summer subsetをlegacy mirrorへ重複保存していたことでした。productionの全remote履歴は中央値用にメモリへ保持し、localへ全件再保存しません。summer mirrorの新規dual-writeも停止しました。
- 旧normal／summer keyは読み込み互換を残し、統合v2だけで完全に同じmerge結果になる場合に限りstartup housekeepingで削除します。legacy側だけのrecord、新しいrevision、よりrichなrecordは削除しません。
- Supabase AreaCountはcycle別に1,000件単位で全page取得します。remote/localを既存の5-field identity、revision、richness semanticsでdedupeし、中央値engineには同一recordを1件だけ渡します。
- 統合AreaCount local cacheはUTF-16 key＋value概算1 MiBのsoft budgetです。remote内容を完全確認できた古いcacheだけを整理し、pending identity、current date、local-only、remote未確認recordは上限を超えても保護します。offline fallback用にcycle／area／time／曜日・fallback groupごとの最低3件を優先します。
- 起動時はcurrent-sessionを先に読み、保護日を確定してから安全なduplicateだけを整理します。9-11のcurrent-sessionに12/12入力完備・Review19／session identity一致の未保存stateが実在すれば、翌日deployでも復元し、再度「完了」で正式保存できます。内容の推測補完はしません。
- remote unavailable時は正式AreaCountを削除しません。local履歴と人間判定で業務を続け、安全なduplicate整理だけで容量が足りなければReview19入力を保持して既存のstorage診断を表示します。
- anonymous rich long-run fixtureでは、UTF-16概算使用量を `5011.6 KiB` から `2516.7 KiB` へ49.8%削減しました。AreaCount 2,000件中、pending／current／local-onlyを保護しつつ897件をoffline cacheとして残しました。

## Review19 lightweight cloud outbox（2026.8.9-13）

- Review19の端末正本は従来どおりrich payloadを保持しますが、新規cloud outboxは同じpayloadを複製せず、`review19_ref_v1` のdate・demandCycle・sessionStartedAt・sourceUpdatedAt・final／complete情報だけを保持します。送信時にidentityから端末正本、current-session、checkpoint、Review19 source stateを解決します。
- 旧full-payload pendingは読み込み・送信互換を維持します。finalからpartialへ退行せず、より新しいlocal finalが旧partialを覆う場合はfinalを送信し、成功したrevisionで安全に覆われるpendingだけを削除します。
- 管理設定の手動同期はcomplete・finalなlocal Review19正本をpendingへ複製せず、Supabaseへ直接idempotent upsertします。このため、9-12で端末正本保存後にpending作成だけQuotaExceededErrorとなったrecordも、local正本が残っていれば手動同期で救済できます。
- offline／通信失敗時はlocal正本を保持し、必要なら軽量referenceだけを残します。referenceすら保存できなくても正本を削除せず、後日の手動同期で再検出します。
- 管理設定の件数はremote全件の同期済み保証ではなく、local outboxの件数であることを明確にするため `未送信キュー` と表示します。手動同期結果ではReview19正本の直接確認・送信件数を別表示します。
- 匿名rich fixtureのUTF-16 key＋value概算は、Review19正本96.6 KiB、旧full pending 97.0 KiB、新reference pending 0.9 KiBで、pending部分を99.1%削減しました。

## 全体値引補正（2026.8.9-13）

- StartScreenで人間が `-5% / なし / +5%` を明示選択します。曜日、中央値、human判定、商品、weather、temperature等の既存計算を終えた通常表示率へ、最後に5 percentage pointsを1回だけ加減し、0〜50%へclampします。
- 例: 基準20%＋5は25%、基準20%−5は15%。`引かない` は基準0%として、＋5なら5%、−5なら0%です。中央値auto、human raw9、finalEvaluation、productionAnalysisは変更しません。
- 20:30の既存forced 50%／30・40・50ルールは補正対象外です。＋5／−5のどちらでも既存の最終値引表示を維持します。
- 設定はbusiness date単位で保存し、新しい日付は0へ戻ります。session開始時の値を `globalDiscountAdjustmentPercent: -5 | 0 | 5` として固定し、途中変更で完了済みsessionを遡及変更しません。率snapshotは補正前・補正値・補正後を分離して保存するため、resumeや再renderでも二重適用しません。
- 通常／fixed-timeは別storage keyです。fixed-timeでも同じ率計算を利用できますが、本番AreaCount、pending、Review19、finalized day、learning populationへのWRITE隔離を維持します。
- optional additive metadataとして既存session／daySnapshot／Review19／export経路に保持し、旧recordの欠損は0相当です。物理migrationとDB変更はありません。

## 人間残数評価（5ボタン・9段階）

- 表示する基準ボタンは従来どおり「多い／やや多い／普通／やや少ない／少ない」の5つです。通常タップはその項目を直ちに確定し、内部scoreは順に `9 / 7 / 5 / 3 / 1` です。
- 500ms長押しが成立すると、その第1選択を直ちに強調表示し、対応端末では15ms振動します。第2選択として同じ項目か隣接項目だけを選べます。
- 同じ項目を再タップすると単独選択の奇数score、隣接項目を選ぶと中間の偶数score `2 / 4 / 6 / 8` になります。第1・第2選択の入力順は保存し、非隣接の組合せは受け付けません。「中間選択をやめる」でキャンセルできます。
- 長押し成立後の `pointerup` と後続ghost clickは抑止します。移動、`pointercancel`、pointer capture喪失、画面blur・非表示でもgestureを安全に終了し、長押しと画面左スワイプが競合しないようにしています。
- 新規入力は `humanEvaluationDetails` に `humanEvaluationScale: 9`、`humanEvaluationScore9`、`humanEvaluationSelections` と解決条件を保存します。raw score・選択順を変更せず、値引運用に必要な既存5段階値だけを別途解決します。
- 通常サイクルの偶数scoreは15時なら少ない側、17時以降なら多い側へ解決します。夏季モードの偶数scoreはJST 18:00未満なら少ない側、18:00以降なら多い側へ解決します。奇数scoreは選んだ基準項目のままです。
- 夏季境界は固定時間を含むruntime clockと `evaluatedAt` で検証します。時間固定モードの時計と保存先は引き続き本番運用から隔離し、中央値履歴だけを本番SupabaseからREAD ONLYで参照します。
- 旧5段階値は保存済みデータを書き換えず、読み込み・分析・出力時に奇数scoreと `humanEvaluationScale: 5` へ論理的に読み替えます。

## 夏季モード

- ユーザー向け名称は「夏季モード」です。内部互換のため、保存値とJSONは従来どおり `demandCycle: "normal" | "summer"` を維持します。
- 夏季モードはJSTの営業日が7月1日〜9月30日の場合だけ開始画面に表示し、ユーザーがON/OFFします。期間外は自動的にOFFとなり、翌年7月に勝手にONへ戻りません。
- 夏季モードは営業日全体へ適用し、当日の運用開始後は固定します。期間内の選択状態は翌日以降へ引き継ぎます。
- 時間固定モードでは固定したJST営業日を基準に期間判定し、本番設定とは別の `nebiki-helper/fixed-time-demand-cycle-state-v1` に選択と当日ロックを保存します。中央値の入力に限り、本番SupabaseのAreaCount履歴をcycle別にREAD ONLYで参照します。固定モード由来の残数を本番local履歴・Supabase・pending・Review19・learning populationへ書きません。
- ON時の17:59までは、9段階の中間値を少ない側へ解決する案内を表示します。18:00以降は中間値を多い側へ解決します。単独の5基準項目は時刻で変更しません。
- 個別商品の量判断は、ON時だけ基準文の先頭へ「夏の」を付けます。手動エリア残数判定にも「夏季モード基準：夏の残数基準」を表示し、現在summer基準であることを明示します。
- エリア残数判定側の「迷ったら…」は廃止しました。個別商品の量判断にある「迷ったら…」は従来どおり維持します。
- 残数履歴、自動判定、減少率履歴、20時30分の中央値判定は従来どおり `normal` / `summer` 別に分離します。
- `summer` の短期履歴は対象年と同じ年、長期履歴は対象年より前の年の夏データだけを使用します。
- `summer` では今年の同曜日3件を優先し、同曜日が不足する場合は今年の曜日グループ3件で自動判定します。どちらも3件未満なら手動判定です。
- 旧データに `demandCycle` がない場合は `normal` として扱います。既存の `summer` 履歴はそのまま再利用します。

## 19:00チェックの2つの残数評価

- 各対象エリアでは、実残数と、売場を見た担当者による共通5ボタン・9段階のraw評価を記録します。除外エリアを除き、両方が揃うと完了です。
- 人間評価は現場感覚を保存する観測値であり、正解ラベルではありません。
- Review19の `humanEvaluationDetails` は `humanEvaluationScale: 9` とraw score・選択順を正本にし、偶数scoreを値引用5段階へ解決しません。奇数scoreだけは完全一致する旧 `humanEvaluation` も互換用に保存し、偶数scoreへ架空の丸め値は保存しません。
- 入力した当日値を含めず、過去の19:00チェック残数だけから既存中央値ロジックによる5段階評価も計算し、別の観測値として保存します。
- 中央値評価は `normal` / `summer`、同曜日／既存曜日グループ、夏季モードの今年短期・前年以前長期の条件を維持します。履歴不足時は「普通」へ補完せず `insufficient` とします。
- 中央値による自動5段階評価、中央値、サンプル数、判定基準は入力中・完了後とも現場UIへ表示しません。JSON内の `areaEvaluations` から、人間raw評価・自動5段階評価・後日の結果や廃棄を分析時に比較できます。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」の旧評価であり、今回の人間9段階残数評価とは別データとして維持します。

## 判断基準と分析メタデータ

- 毎年8月13日〜16日はお盆です。法定祝日とは別の事実として `isObon: true`、`calendarCondition: "obon"` を保存し、現時点の個別量判断・エリア残数自動判定では祝日当日相当の基準を使います。お盆期間の中日というだけで三連休中日にはせず、8月12日を祝日前日扱いにもしません。
- お盆日の判断基準表示は「今日はお盆のため、祝日と同じ基準になっています。」と示し、個別量は日曜基準を表示します。夏季モードの既存接頭辞と組み合わせる場合も「夏の日曜日の…」を維持します。
- お盆と `demandCycle` は独立しており、通常は `demandCycle: "summer"` と `calendarCondition: "obon"` を併記します。天気・気温・製造不足疑いも別軸のままで、お盆を理由に補正値や `productionShortageSuspicion` を変えません。
- お盆対応導入前に保存された8月13日等の `calendarContext` と判断referenceは履歴の正本です。読み込み、日次統合、export、cloud mergeで日付だけからお盆へ遡及変換しません。
- 個別量判断の曜日基準は、三連休中日の既存特殊基準（17時以降）→お盆→非祝日の祝日前日→祝日当日→通常曜日の順で選びます。三連休中日の15時は従来どおり実曜日基準です。
- 非祝日の祝日前日は個別量判断を金土基準、祝日当日は日曜基準とし、表示文もアプリが採用済みの基準として示します。エリア残数判定は既存の履歴選択を変更せず、実際に採用した同曜日・曜日グループ・特殊比較を保存します。
- `calendarContext` は実曜日と採用基準を分けて保持します。日付、`actualWeekday`、祝日／祝日前日／三連休等の条件、個別量基準、セッション・エリアごとの残数比較基準、理由、比較モードを含みます。15時と17時、またはエリア間で基準が異なる場合も表示文の解析なしで追跡できます。
- `analysisWeatherContext` は各値引セッションで既存入力対象となる時間別予報（15時は16〜21時、17時は18〜21時、18時30分は19〜21時、19時30分は20〜21時、20時30分は21時）から `dry / rain / snow / mixed / unknown` を要約します。`weatherDataSource` は `entered_hourly_forecast` であり、実測天候を表しません。元の `hourlyForecasts`、解決済み天候、天候点・降水補正はそのまま残します。
- `productionAnalysis.areas[areaId].productionShortageSuspicion` は、15時・17時に実際の値引判断へ採用した最終5段階エリア判定と、19時のReview19人間raw評価から「製造不足疑い」を導出します。15時・17時は自動中央値判定を変更せず採用した場合も有効checkpointで、`source: "history"` として保持します。人間が変更した場合は変更後の判定を使い、`source: "manual"` とします。19時は引き続き `source: "human_review19"` の人間観察だけを使い、自動中央値評価で補完しません。
- 15時・17時は最終5段階の `few / slightly_few` を少ない側、19時はhuman raw score `1〜4` を少ない側とします。3/3=`strong`、2/3=`medium`、1/3=`weak`、0/3=`none` です。3時点のどれかが欠損・除外・未測定・セッション欠損、または必要な最終判定／19時人間評価がなければ `insufficient` とし、2/2等から推測しません。
- `checkpointEvaluations` は15時・17時の最終採用5段階、`checkpointSources` は `history / manual / human_review19` の情報源を追跡します。`checkpointScores` と `checkpointSourceScale` は人間評価があるcheckpointだけに保存し、手動変更時のraw 9段階／scaleを保持する一方、history採用へ架空の人間raw scoreを生成しません。旧5段階の人間評価は従来の互換規則で奇数scoreへ論理変換しますが、`humanEvaluationScale: 5` は維持し、保存済みデータを物理更新しません。
- 製造不足疑いは上記3checkpointの観測・採用結果から機械的に作る分析flagです。雨・雪を理由に消去・弱体化せず、Work/Data Analyticsでは `analysisWeatherContext` と併読します。これらのメタデータは値引率、20時30分tier、残数中央値へ影響しません。

分析時は `normal` と `summer` を別母集団として扱います。天気の `dry / rain / snow / mixed` は母集団自体を分断せず、各サイクル内の説明変数・層別条件として扱います。祝日分析では実曜日だけでなく、`calendarContext` に保存された実際のreference basisを使用してください。

## 値引率の保存

新規に完了した各エリアには `rateDecisionSnapshot` を保存します。これはエリア完了時点の次の情報を固定した分析上の正本です。

- 確定時刻、セッション時刻、実効計算時刻、計算モード
- 基本値引率、天候・快適度補正、遅い時間帯＋5％、早め次時刻−5％
- エリア残数判定補正、適用中の商品補正方針
- 上下限前後の通常商品率・多い商品率と上下限適用有無
- 実際の表示値引率、解決済み天候、`rateLogicVersion`
- `appVersion`、`buildId`、`dataSchemaVersion`

確定時の `rateDecisionSnapshot` と既存の `completed*` は、完了後の時計進行で再計算・上書きしません。完了画面の値引率一覧だけは最終確認用途のため、確定済みの残数判定・補正条件を維持したまま、現在時刻に応じた既存の時間補正で動的に再計算します。この表示値はセッション・日次スナップショット・エクスポートへ書き戻しません。旧データにスナップショットがなければ `legacy_not_captured` とし、架空のスナップショットは生成しません。

セッションの `basis` は `basisCapturedAt` とともに最初の完了保存時点で固定します。各エリアの実表示率の分析には `basis` ではなく `rateDecisionSnapshot` を使用してください。

## 先取り値引済みエリア

正式時刻では次の3つから選びます。

1. 残数だけ記録する
2. 今回は値引する
3. 測定せずスキップする

測定せずスキップした場合、残数へ0や別時刻の値を補完しません。`measurementStatus`、`missingReason`、先取り元の時刻・セッション・完了時刻、確認時刻、`rateOrigin` を保存します。日次品質では `processComplete` と `measurementComplete` を分けます。

## データ出力

管理設定の「全データを出力」から、1日通しデータと19時チェックを1つのJSONへ出力します。

- 同日に両方がある場合は1日通しデータだけを出力します。
- 日本時間の日付で重複を判定します。
- 除外した日付、旧形式や日付欠損で判定不能だった件数を `dataQuality` に記録します。
- 旧 `not_applicable` は読み込み可能なまま保持しますが、新規作成せず、統合出力の業務データから除外します。
- 旧15時天候フィールドは新しい統合出力へ持ち込みません。
- `humanEvaluationDetails` はセッション／日次スナップショット、19:00個別出力、日次個別出力、統合JSONで保持します。旧5段階は保存済みデータを更新せず、出力用cloneだけへ奇数score・scale 5を展開します。
- 管理設定の「19:00チェックデータを全件出力」と「1日データを全件出力」は、ボタンを増やさず `normal` / `summer` を別ファイルへ分けます。両方に有効データがあれば2ファイル、片方が0件なら有効な側だけを出力します。
- 全件ファイルは `nebiki-review19-{normal|summer}-YYYYMMDD-HHMM.json`、`nebiki-daily-{normal|summer}-YYYYMMDD-HHMM.json`（JST）です。rootの任意項目 `exportFilter.demandCycle` でも対象サイクルを判別できます。各ファイルの業務schema・detailは同一で、反対側のcycleを含みません。
- 「最新の19:00チェックデータを出力」「最新の1日データを出力」は従来どおり対象1件を1ファイルで出力します。
- `calendarContext`、`analysisWeatherContext`、`productionAnalysis` は日次・Review19・統合JSONの既存snapshot経路で保持します。旧データにこれらがなくても読込・出力を継続します。

## Supabaseクラウド同期

通常・夏季の残数記録は、どちらも同じlocal-first経路で保存します。残数確定時は先に端末へ保存し、その後Supabase送信用outboxへ追加してupsertを試みます。通信、設定、SQL schemaのいずれかに問題があっても現場フローは止めず、未送信itemを `nebiki-helper/pending-supabase-sync-v1` に残します。Supabase送信成功を端末保存の条件にはしません。

AreaCount pendingは従来どおり `type`、record identity、送信payload、`firstFailedAt`、`lastAttemptAt`、`attemptCount`、`enqueuedAt`、`lastError` を持ちます。Review19の新規pendingは `review19_ref_v1` の軽量referenceで、rich payloadを二重保存せず、送信時にidentityから端末正本を解決します。旧full-payload Review19 pendingも後方互換で送信できます。同じtype・identityは1 itemへまとめ、app起動、online復帰、新しい残数／19:00チェック保存後、管理設定の手動同期時に直列再送します。同期処理はin-flight lockで多重実行を防ぎます。新schemaが未適用なら旧schemaへnormalとして送るfallbackは行わず、normal／summerを保持したままpendingに残します。

### 同期エラーの確認

pendingが1件以上ある場合だけ、管理設定のSupabase同期欄へ「エラー詳細」を表示します。既存の `nebiki-helper/pending-supabase-sync-v1` を正本とし、`record type × demandCycle × lastError` で同一原因を集約するため、大量の未同期recordを1件ずつ描画しません。cycleが欠けるlegacy／不正itemはnormalへ推測せず「不明」、`lastError`がないitemは「エラー未記録」として件数へ含めます。

「エラー内容をコピー」はappVersion、buildId、pending総数、group別のtype／cycle／件数／試行回数範囲／最初の失敗／最後の試行／全文errorを診断用テキストにします。payload全体は表示・コピーしません。Authorization、Cookie、API key、access／refresh token、JWT、Supabase key、URL認証情報等は除去し、HTTP status、PostgREST code／message／details／hint、constraint、column等は保持します。Clipboard APIが利用できない場合はアプリを停止せず画面へ失敗を通知します。

新規HTTP失敗では、安全に取得できるPostgREST診断本文を `lastError` に保持します。既存pendingのschemaは変更せず、すでに保存されている `lastError` もそのまま集約・表示できます。これは原因確認のためのUIであり、retry回数、retry timing、CAS、in-flight lock、queue identity、local-first動作は変更しません。

### `area_count_records`

既存14列を維持し、次を追加します。

- `demand_cycle text not null default 'normal'`（`normal` / `summer` のCHECK）
- `record_details jsonb not null default '{}'`（JSON objectのCHECK）

upsert identityとunique keyは `date × session_started_at × area_id × discount_time × demand_cycle` です。remote読込もcycle条件を必ず付け、normalとsummerを同じ中央値母集団へ混ぜません。旧remote rowはmigrationのDEFAULTによりnormalです。

`record_details` は1件の残数観測に属する `userJudge`、`humanEvaluationDetails`、`suggestedEvaluation`、`areaRateAdjustment`、`evaluationSource`、`decisionBasis`、`comfortPoint` と任意の分析メタデータを保持します。Review19側は既存の `payload jsonb` へ同日の分析メタデータを含めます。旧5段階記録はcloud payload上だけscale 5の奇数scoreとして表現し、新9段階記録のraw score・選択順・resolved 5段階・解決理由をlosslessに保存します。アプリstate全体は保存しません。

localとremoteは上記identityでdedupeします。異なるrevisionでは新しい `recordedAt` のcount・固定項目を採用し、欠けたoptional detailだけを古いrecordから補います。同一revisionでは詳細量が多いrecordを優先して不足項目を補い、同じ情報量なら安定したfingerprintで決定します。DB側でも古いupsertは無視し、同時刻では既存の固定値を維持しながら欠損JSONを補完します。`humanEvaluationScale: 9` はscale 5 envelopeより優先します。

### `review19_records`

19:00チェックは専用tableへ、営業日・cycleごとに1 rowとして保存します。主な列はversion情報、`date`、`session_started_at`、`demand_cycle`、`recorded_at`、`source_updated_at`、`is_complete`、`payload jsonb` です。unique keyは `date × demand_cycle` です。

入力途中も各エリアの更新後にlocal保存とSupabase upsertを行います。partialは `recorded_at = null`、正式完了は `recorded_at` ありです。`sourceUpdatedAt` は入力、除外、戻り修正、完了など同一営業日の更新を単調増加で順序付けます。DB triggerは古いrevisionとfinalからpartialへの逆戻りを拒否します。中央値履歴へ使うのはcompleteかつfinalのrecordだけで、localとremoteの同一日・cycleは1件へ統合します。人間9段階raw、自動中央値5段階、basis、data quality、app/build情報はpayloadで保持します。

### 端末内データの一括同期

管理設定の「端末内データをSupabaseへ同期」は、次の正式保存元を集約してからidentityごとに1件へまとめ、idempotent upsertします。

- 統合残数cache `nebiki-helper/area-count-records-v2`
- 旧normal cache `nebiki-helper/area-count-records`
- 旧summer cache `nebiki-helper/summer-area-count-records-v1`
- `nebiki-helper/finalized-day-data`
- 19:00記録内のday snapshot
- 日次session snapshot
- 確定済みの現在session state
- `nebiki-helper/review19-records` のcomplete・final 19:00記録

未来日／未来時刻、不正なarea・count・cycle、未測定、確定前UI入力、固定時間モードのデータは除外します。同じ操作を繰り返してもunique upsertで件数は増えず、端末データは削除しません。complete・finalなlocal Review19正本は、full pendingを作らず直接idempotent upsertするため、pending作成に失敗した保存済みrecordも救済できます。画面には検出件数、送信対象、成功、失敗、Review19正本の直接確認／送信件数、`未送信キュー`件数を表示します。`未送信キュー：0件` はlocal outboxが空という意味であり、remote全履歴の同期済み保証とは表現しません。時間固定モードでは中央値用のAreaCount SELECTだけを許可し、remote mutation、production local write、retry、backfillは行いません。

### SQL適用手順

リモートSQLはアプリから自動実行しません。既存clientの書込みを止めてから、次の順でSupabase SQL Editorから実行してください。

1. `supabase_area_count_records_cloud_sync_backup.sql`
2. `supabase_area_count_records_cloud_sync_migration.sql`
3. `supabase_area_count_records_cloud_sync_verify.sql`
4. schema検証成功後に新アプリをdeploy
5. 実使用端末で新版を起動
6. 管理設定の「端末内データをSupabaseへ同期」を実行し、pending 0を確認

問題時は新アプリを停止／旧版へ戻してから `supabase_area_count_records_cloud_sync_rollback.sql` を使用します。rollbackはsummer行がある場合に中止し、Review19 tableは削除せずprivate quarantineへ退避する保守的な手順です。

既存 `area_count_records` のRLSは、共有売場を前提としたanonのSELECT／INSERT／UPDATE許可、DELETE不許可の現行モデルを変更しません。新しい `review19_records` も同じモデルでRLSと権限を設定します。service role keyはフロントエンドへ追加しません。

2026-08-11に利用者が実DBへcloud-sync migrationを適用済みです。旧verify artifactはPL/pgSQL関数定義の改行位置に依存し、正常なguardを誤って失敗扱いにしていました。現行verifyは関数定義の空白・改行・インデントを正規化してから、final→partial禁止、古いrevision禁止、同一revision guard、同時刻partial→final例外の4条件を検証します。DB上のguard実動作、schema、migration、RLSはこの修正では変更しません。

このソースを検証した開発環境には実DB接続情報がないため、現在の端末に残る同期失敗の原因は未特定です。新版を実使用端末へdeploy後、管理設定の「エラー詳細」から診断内容をコピーして確認してください。

`dataSchemaVersion` はJSON schemaのversionです。今回のReview19 reference outboxはlocal同期用metadataで、全体値引補正は既存session／snapshotへ追加するoptional fieldです。正式schemaを破壊せず、旧recordのfield欠損は補正0として読めるため `3` を維持します。新しいDB migration、SQL、列、RLS変更はありません。中央値engine、last-area skip、initial weather scroll、fixed-time READ ONLYとWRITE隔離、Obon、productionAnalysis、20時30分、AreaCount cloud syncのpending／retry／CASは変更しません。

## バージョン

- `appVersion`: `2026.8.9-13`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260827-203600-jst`

今回の実装・検証結果は `CHANGE_REPORT_20260827_REVIEW19_OUTBOX_GLOBAL_ADJUSTMENT.md` を参照してください。
