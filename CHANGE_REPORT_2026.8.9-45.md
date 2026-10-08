# CHANGE REPORT 2026.8.9-45

完成JST: 2026-10-08T11:10:31.250043+09:00

- appVersion: `2026.8.9-45` / buildId: `build-20261008-110344-jst` / dataSchemaVersion: `3`
- 完成ZIP: `nebiki-helper-2026.8.9-45.zip`（SHA-256はZIP外の同名`.sha256` / RELEASE_REPORT / ZIP_VALIDATION参照）
- baseline: 完成9-44 ZIP `nebiki-helper-2026.8.9-44.zip`、SHA-256 `04645949da174b3615137c5c43e9a016c8414cc9148ba4a0d041dfe674d8160b`、build `build-20261007-235103-jst`。

## 変更と解除方法

通常開始画面の曜日は自然曜日の表示だけにした。曜日の切替/自動戻し、select、wheel、専用options/handler/helper/now propを削除。他の通常操作から曜日指定へ入る経路はない。

新 `operationalWeekday.ts` は既存 `japaneseHoliday.ts` の検証済みdate-only weekday utilityを公開alias `getCalendarWeekday()`で再利用。祝日/祝前日/三連休/長期連休/Obon/reference/group/基本率の実装は変更しない。自然曜日と計算referenceは別概念として既存resolverを通す。

- 起動current/checkpoint、navigation復元（戻る・undo共通）、条件編集、残数修正の通常作業境界で、44のtime helperとweekday helperを共用して旧manualWeekdayOverrideを解除。
- 未開始draftは運用default/既存Start同期で現在日・自然曜日へ戻す。日付が変わる場合だけ従来どおりweather時刻lockを解除し、天候値は消さない。
- 進行中discount sessionは元session.dateから自然曜日を取る。date/time/startedAt/route/count/確定済みraw9・resolved評価・evaluatedAt・完了率text/snapshotを保持。日付を跨ぐ条件編集でもdraft業務日を保持し、現在日の曜日だけを古いsessionへ付けない。
- 通常updateSessionDraftは曜日指定patchを手動指定にしない。新規sessionと新19:30開始も自動曜日へ揃える。別日startSessionが既存gateに従い新日sessionを開始する時はdraft.date/weekdayも新sessionへ揃える。旧日通常current/checkpointのreload除外は維持し、別日の通常再開を新たに許可しない。
- Done/開始済みReview19の復元は証跡保護のためno-op。Doneから通常作業へ再入、新19:30開始で解除。新Review19はsource session/mapの証跡を変更せず、新draft/referenceだけ業務日の自然曜日へ戻す。入力統計もreference.weekdayを使って一致。未確定review19_weatherの確認時も新draft/referenceだけ解除し、既存正式記録を書換えない。
- 汎用normalizeSessionDraft/session/progress/calendar/Review19 normalizer、clone、historical archive/exportから旧manual情報を削除しない。運用default buildStartDefaultDraftのみ現在日・自然曜日・flagfalse化。legacy読込互換を維持。
- fixed-time helperはno-op、新Review factoryへfixedTimeを伝播。固定時計検証/production READ ONLYを維持。新storage key/field/SQL/migrationなし、schema3。

## 表示・判定・率・保存値の照合

実helper、実hook判定確定/Review入力handler、既存recommendation/calendar/rate engine、実完了snapshot式を実行して照合。React/外部保存はmemory stubの自動fixtureで、実ブラウザ結果とは区別する。

自然曜日と計算referenceの7例：普通火曜、祝日火曜、祝前日月曜、三連休中日日曜、長期連休内部月曜、お盆木曜、三連休日曜15時。自然曜日は日付と一致し、既存祝日等のreference/group/補正と優先順位は不変。新AreaCountのactualWeekday/decisionBasis/calendarContext、individual reference、override falseが整合し、旧recordのbytesは不変。

| 条件 | 自動曜日へ戻った新規判定/現在率への影響 | 既存確定値 |
| --- | --- | --- |
| 9/8火17時、旧金曜指定、晴れ28℃弱風weather0/global0、残24、金中央値24・火40 | 新再判定は普通0pt→少ない-10pt、通常/多い10/20%→0/10% | 解除直後の確定済み普通・現在10/20%、完了area率/snapshotは保持。明示再判定時だけ新basis/record |
| 10/1木17時、旧月曜指定、残40、月中央値100・木10、weather0/global0 | 新判定few(-10)→many(+10)、通常/多い0/10%→20/30% | 元records・保存済みhumanDetailsは不変 |
| 10/9金20:30、旧火曜指定、晴れ10℃comfort1・普通 | 既存金土最終補正へ復帰し、1個/2個/3個以上40/50/50%→30/40/50% | 最終ruleは不変、完了済み保存率を置換しない |

44の時刻manual UI廃止・daily notice gate廃止・下部注意7項目/全文/順序/太字、商品/manual-area hint、長押し500ms/隣接/cancel/swipe、quick、weather lock/early/late/global、17→Review19、20:30を保持。確定済み中間評価を時計だけで再解決しない。

## 変更ファイル

- `CHANGE_REPORT_2026.8.9-45.md`
- `CHATGPT_HANDOFF.md`
- `dist/*`
- `package-lock.json`
- `package.json`
- `scripts/check-advance-discount-flow.ts`
- `scripts/check-automatic-time-operation.ts`
- `scripts/check-automatic-weekday-operation.ts`
- `scripts/check-early-next-17-continuity.ts`
- `scripts/check-interactive-persistence.ts`
- `scripts/check-review19-priority-transition.ts`
- `src/app/AppRouter.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/domain/japaneseHoliday.ts`
- `src/hooks/nebikiApp/operationalWeekday.ts`
- `src/hooks/nebikiApp/review19Flow.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/useNebikiApp.ts`

44版production101本中95本byte-identical、既存6本変更・helper1追加（現102本）。human evaluation/selector、clock、rate engine/weekdayBase、fullMode、types/schema、weather/advance/cold guide、AreaCount algorithm、sessionSnapshots、storage/archive/export/cloud/productionAnalysisは不変。japaneseHolidayはutility公開alias追加のみ。SQL9本、AGENTS.md、vite/dataVersion、全過去CHANGE_REPORTはbaseline ZIPとbyte-identical。

## 検証結果

- 全check:* **81/81 PASS**。曜日専用 **12/12**、実hook interactive **26/26**、時刻 **13/13**、Review19priority **71/71**、advance **48/48**、early17 **14/14**。weather/夏17/storage/archive/export/fixed-time等全既存checkを実行。
- 専用checkは実TSX SSR/eventとpure helper。interactiveは実hook dispatcherでcurrent/checkpoint/undo/Back/edit/newstart/日付境界/互換/production no-writeを検証。nativeブラウザ確認とは別。
- 外部pipeline監査：calendar7、restore7、率変化2、実judge3、Review観察1、実Start同期3。確定済みmap/details/完了率/snapshotと旧履歴bytesを比較。
- TypeScript/production build/PWA generateSW PASS、106 modules、precache10、asset `/assets/index-BvWt_V5q.js`。既存large-chunk/caniuse-lite更新警告は残る。
- focused ESLint **0 errors / 3 existing warnings**。full **9 existing errors / 6 existing warnings**。44版file/rule/severity/message比較で新規diagnostic **0**。pathとsource/code-frame座標だけ正規化し診断本文/code tokenは保持。
- 曜日UI/now削除で検出されるようになった既存Start weather effect3件は、同期reset/固定時計temperature再読込を保持する理由付き単行react-hooks/set-state-in-effect例外を付けた。effect callback全5本はコメント除外後44版と同一。global lint緩和やweather非同期化はなし。新局所例外3本を追加した事実と新規実装診断0を区別する。
- Edge production **390×844、26ケース**。曜日/time toggle/select/wheel廃止、旧draft/current/checkpoint/runtime Back/条件編集済み再開、日付境界、自然曜日/祝日reference、fixed clock、44の両stage/notice7/太字・product/manual hint・長押しcancel/swipe・夏18時境界・保存評価・Review19/20:30を確認。console error/warning・不要外部request・横overflow0、source/bundle hash最終build一致、owned preview停止済み。画像目視確認。

## 未解決・未確認

- 44既知の旧summer18:30 sessionを18時前に復元した時の静的18時以降hintと実時計lowerの相違は残る。曜日解除で解決したとはしておらず、業務規則を独自変更して埋めていない。
- undoは実hook自動test。通常UIに直接入口がない条件編集/undoは、ブラウザでは旧runtime Back/条件編集済み再開fixtureとして確認し、存在しない直接操作を行ったとはしない。
- 物理店舗端末/native touch hardware/installed PWA/実Supabase mutation/長時間background復帰は未確認。Edgeはisolated touch emulation/click/keyboardで、外部通信なし。
- full lint既存9 errors/6 warnings、build既存warningsは別作業課題として保持。
