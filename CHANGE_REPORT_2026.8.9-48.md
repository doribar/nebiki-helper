# CHANGE REPORT 2026.8.9-48

完成JST: 2026-10-10T19:34:24.728171+09:00

- appVersion: `2026.8.9-48` / buildId: `build-20261010-190352-jst` / dataSchemaVersion: `3`
- 完成ZIP: `nebiki-helper-2026.8.9-48.zip`。SHA-256はZIP外の同名`.sha256` / RELEASE_REPORT / ZIP_VALIDATIONを参照（自己参照回避）。
- baseline: 完成9-47 ZIP `nebiki-helper-2026.8.9-47.zip`、SHA-256 `c987bb9582befbf39a4d5b6269745bcd78b5d1ef24cc61de42ea7889fd6eb2ef`、build `build-20261009-214347-jst`。

## 三連休中日の残数参照

既存の「ちょうど三連休中日」かつ17/18:30/19:30/20:30に限り、日曜側を同area/timeの**普通の日曜3件以上**なら日曜単独へ切り替える。不足時だけ従来の火木日groupへ代替する。金土側は従来どおり。双方有効は**採用中央値を50:50**、片側有効はその基準を100%、双方不足は従来の履歴不足・手動判定。中日が土曜でも日曜側は普通の日曜から取得する。値引率の平均処理は追加しない。

通年母集団、今日より前、canonical/dedupe、必要3件、short16/long52・中央値処理を流用する。日曜単独には既存weekday guard `max(short,long-2)`、group fallbackには従来どおりguardなし。日曜候補だけ、実日付の日曜と保存実曜日が一致し、通常group火木日かつholiday/祝前日/三連休/4日以上連休/当時適用されるObon/captured特殊calendarでない記録を選ぶ。legacy手動曜日で火曜を日曜として記録したものは日曜単独へ混入させず、既存group処理自体は維持する。

15時、普通の日曜・他曜日の参照、4日以上の連休ruleは変更しない。基本率/時刻別率・天候46快適緩和/area評価threshold・decrease・商品・global・先取り/遅延・20:30固定本体も変更しない。production103本中4本を変更し、他99本は47ZIPとbyte-identical。coreの通常branch・canonical/guard/threshold/decrease/final処理区間、親表示の追加以外の区間もbyte比較で維持を確認した。

## 内訳・保存・互換性

optional `threeDayHolidayMiddleReference.sundayReference` に `source`、`adopted`、普通日曜件数 `weekdaySampleSize`、採用候補全件 `sampleSize`、短/長件数と中央値、採用中央値、guard、`fallbackReason: insufficient_sunday_history` を保存する。既存 `fireThursdaySunday*` は実火木日groupの件数・group採用時の中央値であり、日曜値に意味を変えない。日曜単独を採用した場合、この未採用groupの中央値は省略する。片側日曜のみは `adoptedSource: 日`、双方は既存`both`とoptional sourceで識別する。

採用basisは既存AreaProgress/current/checkpoint→確定area snapshot/daily/daySnapshot/finalized/分析export、AreaCount record_details/remote正規化へ伝播する。rateDecisionSnapshot内へ新しいAreaCount metadataを追加せず、そこに保存する表示率は選ばれたfinal評価に一致する。calendarContextではSunday+金土を `composite_weekday_and_group`、referenceWeekday=`日`/groups=`金土`で明示し、既存火木日をSundayの意味へ変えない。日曜だけならweekday型。normalizerは新typeを受け取り、legacy metadataは旧group表現のまま読む。

共通formatter `getThreeDayHolidayMiddleReferenceDetailLines()` は保存根拠だけを読み、source・件数/中央値・代替理由/guard・50:50/片側を表示する。AreaJudgeの静的火木日50:50断定を内訳確認案内へ変更。ready時に入力画面を通らないため、RateDisplayへ三連休時だけ折り畳み「三連休中日の履歴基準」を追加した。20:30も固定率本体を変更せず参考根拠を確認できる。開閉では再計算/評価確定/保存を行わず、内訳上のtouchをswipe skipへ誤認させない。

Review19の参考統計も共通処理を使い、同じoptional根拠を保持する。Review19の正式な9段階人間評価、productionAnalysis、完了/export処理は不変。自動5段階評価は復活させない。過去のoptional欠損は新ルールの採用実績として補完しない。旧保存値・率・評価・中央値を現在の履歴で再計算するmigrationは追加しない。schema3、新storage keyなし、SQL/Supabase/AGENTSなし。

## 47版との具体的な比較

同一fixtureを47/48のproduction moduleで実行。2026-07-19の三連休中日、同area/timeに普通日曜3件×6個・火木80件×30個・金土3件×10個、当日10個、天候/global0・decreaseなしの場合：

| 項目 | 47 | 48 |
| --- | --- | --- |
| 日曜側 | 火木日中央値30 | 普通日曜中央値6 |
| 合成基準 | 20個 | 8個 |
| 採用評価/area補正 | 少ない/-10 | やや多い/+5 |
| 17時・普通商品/多い商品 | 0/10% | 15/25% |
| 18:30・普通/多い | 10/20% | 25/35% |
| 19:30・普通/多い | 20/30% | 35/45% |

0%の既存「引かない」表示semanticは維持する。20:30は固定ルール本体を変更しないが、採用評価が変わることで既存A/B/C補正を通じて率も変わり得る。同じ残数fixtureで晴れ・25℃・comfortScore0の場合、47の少ない/A（1個/2個/3個以上=30/40/50%）から48のやや多い/B（40/50/50%）へ変わることを表示guideと確定snapshotで照合した。雪の強制全50%は両版で維持する。

普通日曜2件×30＋火木16件×30＋金土3件×10なら、両版とも火木日代替中央値30と金土10を合成して20個、当日10→少ない、17時普通0/多い10%。片側だけ有効/双方不足も同一fixtureで従来と一致。全8比較ケースをZIP外 `work/threeDay48/runtime-comparison-47-48.json` に入力・結果・両module hashとともに記録。

## 変更ファイル

- `src/domain/areaCountHistory.ts`（選択・optional型/normalizer・共通formatter）
- `src/domain/analysisMetadata.ts`（Sunday+groupの正確なcalendar表現・互換読込）
- `src/components/screens/AreaJudgeScreen.tsx`（静的断定の撤去）
- `src/components/screens/RateDisplayScreen.tsx`（保存basis内訳欄）
- `scripts/check-three-day-holiday-sunday-reference.ts`（新規28ケース）
- `scripts/check-long-holiday-reference.ts`（三連休ケースだけ55→25とSunday採用証拠を更新、長期連休ruleは不変）
- `package.json` / `package-lock.json`（version、packageの専用check登録のみ・依存不変）
- `CHATGPT_HANDOFF.md` / `CHANGE_REPORT_2026.8.9-48.md`
- `dist/*`（既存JST build方式でproduction/PWA更新）

AGENTS.md、root SQL9本、vite.config.ts、dataVersion.ts、過去CHANGE_REPORT56本は47ZIPとbyte-identical。

## 検証結果

- 全 `check:*` **84/84 PASS**。
- 専用Sunday-reference **28/28**、既存三連休 **33/33**、関連長期連休 **17/17 PASS**。必要3件、Sunday3＋異なる火木多数、Sunday0/1/2代替、双方/片側/不足、特殊日・Saturday中日、各時刻/15/通常/長期連休、通年cycle、canonical重複/境界、16/52 guardとfraction50:50、実率、current/checkpoint/daily/finalized/export/remote互換、Review19統計、legacy欠損非補完、実TSXのSSRを確認。
- 47/48 production runtime比較 **8/8 PASS**。独立scope review **22/22 PASS**。
- TypeScript `tsc -b --force` / production build / PWA generateSW **PASS**。107 modules、precache10。bundle `/assets/index-Fche_LNf.js` / SHA-256 `71920a6a7274f6223b420a53c5cdecbbe68460e2a521d57876c7a970c68b1c75`。
- focused ESLint **1 existing error / 0 warnings**（AreaJudgeScreen既存`react-hooks/set-state-in-effect`）。全体 **9 existing errors / 6 existing warnings**。47とのfile/rule/severity/message比較で新規diagnostic **0**。rootパスと診断内座標/code-frame行番号のみ正規化し、本文/code tokenを保持。lint例外の追加なし。
- large-chunk/caniuse-lite旧データのbuild警告は47から継続する既存警告。

## 実ブラウザ確認

インストール済みEdge 155.0.4283.45 のproduction distを、隔離profile・390×844でPlaywrightから実操作し、**14/14ケースPASS**。マウスclickとtouch emulationを使用し、SSRとは別に確認した。人工履歴と固定Dateを使い、実店舗データやユーザーprofileへ書き込んでいない。

- 17/18:30/19:30/20:30それぞれ普通日曜3件優先・日曜2件の火木日代替。日曜側だけ/金土側だけ/双方不足も確認。残数入力から実指示率、確定snapshot/AreaCount recordの根拠一致、再読込後の確定area保持を確認。
- 三連休の保存根拠detailsを開き、件数・短期/長期/採用中央値・代替理由・50:50/片側を確認。17時は開始→天候→先行案内→全12area→Doneまで実操作し、daily snapshotと各areaの根拠・率snapshotが一致。47の開始同幅2列、注意事項7項目、higher→lower quick順、hint開閉で保存不変を確認。
- Review19は優先/代替の2ケースで12areaの残数・human raw9=5を入力・完了保存し、実JSONファイルをdownloadしてJSON.parse。全12areaのoptional根拠・正式人間評価・dataQuality completeが保存正本と一致。自動5段階評価を生成していない。完了後reloadは従来どおりstartへ戻り、archive正本の根拠・人間評価は維持する。
- 横overflowなし。アプリconsole error/warning、新しいdialog、外部requestは0。Playwrightのservice worker遮断メッセージ26件はharness由来として別記し、アプリwarning0に混ぜない。PWA生成はbuildとZIP検査で確認し、このbrowser suiteではservice workerを遮断した。
- 実操作証拠: ZIP外 `work/threeDay48/parent-browser-work/browser-results48.json`（bundle/source hash、case別操作・保存値・download・geometry・screenshots）。初回のReview19 fixtureは未完了履歴のため不足となったので、complete final Review19の妥当な人工履歴へ直して全14caseを再実行した。applicationコードの追加変更はない。

native画面操作はComputer Useのアプリ承認timeoutにより入力0で未実施。隔離native browserだけを閉じた。証拠は `work/threeDay48/browser-work/native-attempt48.json`。物理タッチ端末・店舗端末・インストール済PWA・実Supabase・長時間background復帰は未確認。特殊日除外/Saturday中日/15時/通常曜日/4日以上連休、legacy metadata欠損、47/48の具体的な変更率比較は自動domain/SSR/runtime検証であり、全てを実browserで確認したとはしない。


## 未確認事項・既存課題

実店舗の物理端末・実タッチ機器、インストール済みPWA、実Supabase通信、長時間background復帰は未確認。ブラウザは隔離profile・人工履歴/予報を用い、店舗正本へ書き込まない。タッチemulationは物理端末の実タッチ確認とは区別する。追加の目視・操作確認の範囲は上記browser記録を参照。

既存lint診断/build警告、旧summer18:30 sessionを18時前に復元する場合の静的hint不一致は今回の対象外として保持。参照変更でこれらを解決したとはしない。履歴・値引率engine・storage・Supabase・SQL・schemaの不要な変更なし。
