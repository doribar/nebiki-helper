# 値引ヘルパー 2026.8.9-22 CHANGE REPORT

作成日: 2026-09-08 JST。baseline: 検証済み2026.8.9-21系列。
appVersion: `2026.8.9-22` / buildId: `build-20260908-064825-jst` / dataSchemaVersion: `3`。

## 実装内容

Review19完了画面の主操作を9-20までのJSONファイルdownloadへ戻した。`buildDirectReview19DataExportPayload()` と `downloadJsonFile()` を使い、export payload・pretty JSON・完了保存状態を変更していない。設定画面の全件・最新Review19 downloadも維持した。9-21専用の完了画面clipboard helper、UI state、専用checkは削除し、download専用checkへ置き換えた。

17時から18:30への自動遷移を廃止した。18:25〜18:54は17時sessionを保持し、18:55以降は同日18:30を明示開始しておらず、Review19未開始・未完了・authoritative recordなし等の既存安全条件を満たす場合に、17時sourceからReview19へ直接移行する。19:25、20:30、23:59でも上限を設けない。Review19開始は `createReview19StartState()` を手動経路と共用し、18:30session・AreaCount・合成測定値は生成しない。

Done画面に「18:30値引を開始」を追加した。既存 `startNextDoneSession()` / `openNextSessionInput()` でweather確認へ入り、確認後の `startSession()` で初めて18:30sessionを生成する。実開始時に未入力値を捏造しない18時 `DailySessionSnapshot` を既存safe journalへ保存する。`hasStarted1830Session()` がcurrent sessionまたはarchive/operational journalの18時開始snapshotを検出し、同日Review19の自動・手動開始を抑止する。reload後もこの判定を使う。保存失敗時は開始stateを確定せず再試行できる。

AreaCount自動判定のquick adjustmentを、`few < slightly_few < normal < slightly_many < many` の元autoから±1段へ一般化した。readyな通常15/17/18/19 sessionだけを対象とし、Review19、fixed-time、20:30、履歴不足・不明では表示しない。端の方向は表示せず、full manual selectorは残した。quickは `judgeCurrentArea()` の既存保存・値引率経路を共用し、`humanEvaluationDetails.evaluationAdjustment` に方向・1段・original/finalを保存する。`areaCountEvaluation` / `suggestedEvaluation` はfinal、`areaCountDecisionBasis.baseEvaluation` はoriginal、`finalEvaluation` と `areaRateAdjustment` はfinalに対応する。`rateDecisionSnapshot`にquick専用fieldは追加していない。

## 変更ファイル

- `src/hooks/useNebikiApp.ts`: 17→Review19自動条件、18時開始snapshot、manual18抑止、download復帰、±1 action。
- `src/hooks/nebikiApp/review19Flow.ts`: 18時開始session/snapshotの判定とReview19自動keyの安全条件。
- `src/app/AppRouter.tsx`、`src/domain/types.ts`: 新action、Done画面の18時開始、quick UIの配線、Review19 download action。
- `src/components/screens/DoneScreen.tsx`: 明示的な「18:30値引を開始」。
- `src/components/screens/Review19DoneScreen.tsx`: 「JSONをダウンロード」へ復帰。
- `src/components/screens/RateDisplayScreen.tsx`: 元auto±1 quick button。
- `src/domain/areaEvaluationAdjustment.ts`: 5段階のquick adjustment helper。
- `scripts/check-review19-download.ts`: 完了画面download専用check（15/15）。
- `scripts/check-review19-priority-transition.ts`: 17→Review19通常ルート、manual18抑止、snapshot/retry/fixed-time check（64/64）。
- `scripts/check-session-completion-storage-safety.ts`: 18時開始snapshotのsafe boundary check（10/10）。
- `scripts/check-area-quick-adjustment.ts`: ±1、非累積、metadata伝播、UI check（28/28）。
- 既存workflow/refactor characterization checks、`package.json` / `package-lock.json`、`CHATGPT_HANDOFF.md`。
- `CHANGE_REPORT_2026.8.9-22.md`。

`AGENTS.md`、root SQL 9本、Supabase schema/RLS/grant/trigger、fixed-time、IndexedDB/localStorage architecture、Review19入力・保存・archive/outbox/cloud、rate engine、summer/normal、weekday reference、global adjustmentは変更していない。

## 検証結果

- package.jsonの全 `check:*`: **54/54 PASS**。
- 専用check: Review19 download **15/15**、Review19 transition **64/64**、session completion storage safety **10/10**、AreaCount quick **28/28**。
- TypeScript: **PASS**。
- production build: **PASS**（99 modules）。PWA `generateSW`: **PASS**（precache 10 entries）。chunk sizeとBrowserslist dataの既存警告は残る。
- changed-file focused ESLint: **0 errors / 4 warnings**。warningはuseNebikiAppの既存hook依存のみ。
- full lint: **9 errors / 7 warnings**。9-21 baselineとfile/rule/severity/messageを正規化して比較し、新規diagnostic **0**。
- appVersion `2026.8.9-22`、buildId `build-20260908-064825-jst`、dataSchemaVersion `3`。

## 実ブラウザ確認

Edge Chromiumのproduction previewを390×844、Asia/Tokyo、隔離local originで確認した。18:25は17時done画面に留まり、18:55は18:30を経由せずReview19へ直接移行した。Done画面から明示的に18:30を開始し、weather確認後だけ18時sessionが生成され、19:25以降とreload後もReview19へ移行しないことを確認した。Review19を12エリア入力して完了画面downloadを取得しJSON.parse、設定画面の全件・最新download、横overflow、console error/warning、pageerror、外部通信を確認した。auto few/normal/manyのquick buttonも実表示で確認した。詳細は `work/review19-standard/browser-work/browser-results.json`。

実Supabase mutation、インストール済みPWA実機、実店舗端末の長時間background復帰、quick操作後の全量cloud同期は未確認。

## release

完成ZIP: `outputs/nebiki-helper-20260908-0652.zip`（JST形式）。完成ZIPの再open検査、SHA-256、SQL 9本とAGENTS.mdの同一性はZIP外の `RELEASE_REPORT_2026.8.9-22.md` と `ZIP_VALIDATION_2026.8.9-22.json` に記録する。
