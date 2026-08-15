# スキップ自己ループ／Review19完了後白画面 変更報告

作成日: 2026-08-15（JST）

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260813-2321.zip`
- 基準appVersion: `2026.8.9-6`
- appVersion: `2026.8.9-7`
- buildId: `build-20260815-173057-jst`
- dataSchemaVersion: `3`

## 1. スキップ不具合の再現条件

`pending = [A, B, C]` でAから「スキップ先を選ぶ」によりBへ移動し、Bで「今はスキップ」を実行すると、基準版の候補選択ではB自身がmanual-priority候補として残り、BからBへ即時遷移できました。pendingがBだけの場合も同じ自己選択経路があり、画面上はスキップ操作が効いていないように見えました。

## 2. スキップ不具合の根本原因

`getNextPendingCandidate()` は候補をmanual／fewやdeferred状態で優先した後、`pickNextPending()` 内で現在エリアを除外していました。優先集合が現在エリア1件だけになると除外せずその1件へfallbackするため、他種別のpendingが存在しても現在エリアを返せました。現在エリア除外のタイミングが遅いことが確定した根本原因です。

## 3. 自己ループ修正内容

全pendingを取得した直後に `referenceAreaId` を除外し、その後でmanual／few、deferred、経路方向を評価します。現在以外のpendingがなければ `null` を返し、既存の通常フロー候補へ進むか、通常候補もなければdoneへ進みます。現在エリアのstatusは消さないため、別エリアを処理した後の後回しエリア再訪は維持します。

## 4. skip record重複の確認と処置

調査対象の `merged.push(cloneSkipRecord(record))` は、永続localStorage経路と純粋なin-memory経路という別関数に各1回あり、同一関数内の連続二重追加ではありませんでした。両方とも `date × targetDiscountTime × areaId` 相当のidentityでdedupeします。duplicate bugではないためpushは削除せず、1操作1件、順序、consume、restoreを回帰testで固定しました。

## 5. Review19白画面の再現条件

実運用では12エリアの最後の残数・人間評価を確定した直後に白画面となりました。一方、exportには `review19Status = recorded`、complete／measurementComplete／humanEvaluationComplete、12/12の観測が残っていました。

開発fixtureでは、完成record保存後に行われるstate／checkpoint／runtime等のstorage writeへ人工的な `QuotaExceededError` を発生させ、基準版のraw `localStorage.setItem()` が例外をそのまま上位へ投げる経路を確認しました。新版では同じstorage failureを構造化結果へ変換し、画面遷移処理まで未処理例外を伝播させません。

## 6. 白画面の根本原因――確定事実と推定の分離

### 確認済み事実

- 基準版には、Review19完成recordの保存後に実行されるcurrent-session、work-session checkpoint、runtime history、cloud queue等の `localStorage` writeが失敗した場合、例外を捕捉しない経路がありました。
- 完了用routerと `review19_done` component自体に、完成record shapeを原因とするrender crashは確認されませんでした。
- 実運用exportに完成recordが残っているため、少なくとも完成Review19本体の保存は成功していました。
- 未処理のstorage例外はReact更新／effect処理を中断し、app rootが正常描画できない危険があります。

### 高い整合性を持つ推定

完成record保存後の補助storage writeで `QuotaExceededError` 等が発生し、その未処理例外がReact側へ伝播したことが、保存済みrecordと白画面の同時発生を最もよく説明します。ただし実使用端末のconsole例外、storage使用量、quota上限は取得できていないため、実端末事故の例外名まで「確定」とは報告しません。

## 7. storage容量との関係

匿名化したrich fixtureのUTF-8概算は次のとおりです。これは再現用データの値で、実端末の正確な使用量ではありません。

| 保存物 | fixture概算 |
|---|---:|
| complete Review19 1件 | 138.3 KiB |
| 完了済みAppState 1件 | 144.3 KiB |
| Review19 pending 1件 | 138.5 KiB |
| runtime history 20 snapshot | 562.2 KiB |
| runtime history 50 snapshot | 789.9 KiB |
| area history 950件＋互換mirror | 約1.69 MiB |

current-sessionとwork-session checkpointには同系統のAppStateが入り、runtime historyは複数snapshotを持ちます。これらは端末quotaへの圧力になり得ますが、「大きい」というだけで実端末原因を確定したり、通常時の履歴を削除したりはしません。

## 8. localStorage例外処理

storage操作は `ok`、key、set/remove、失敗時のerror nameとquota該当有無を返す安全な境界を通します。ログはこのmetadataだけで、Review19本文、pending payload、credentialを出しません。

Review19完成時にquotaが確認された場合だけ、navigation/debug用runtime historyと重複checkpointを解放し、完成Review19本体またはpending保存を1回再試行します。完成本体がなお保存できなければdoneへ遷移せず、ユーザーへ容量確認と再試行を案内します。例外を単に握りつぶして正本を失う実装ではありません。

## 9. state重複保存の扱い

storage architectureの全面変更、通常時のsnapshot削除、navigation historyの仕様変更は行いません。通常容量ではcurrent-session、checkpoint、runtimeを従来どおり保存します。quota recovery時だけ、復元の補助であるruntimeと重複checkpointを解放します。current-session自体がquotaで失敗した場合も補助領域を解放して1回再試行します。

## 10. Review19データ保全

保存優先順位を次のように明示しました。

1. 完成済みReview19本体
2. Supabase同期用pending
3. 完了済みcurrent-session
4. navigation/debug runtimeと重複checkpoint

12/12のareaCounts、人間raw9、complete status、productionAnalysis、calendarContext、analysisWeatherContext、daySnapshot、export可能性を含む完成recordを弱体化しません。同一date／cycleの再保存は既存identity mergeによりduplicateを作りません。pendingだけ準備できなかった場合は完成recordを保持し、管理設定の手動backfillを案内します。

## 11. `review19_done` 遷移

最後の観測はReact state flush待ちに依存せずfinal buildへ直接渡します。完成recordのlocal保存成功後だけ `screen: "review19_done"` へ遷移し、既存の「19時売場チェックを記録しました」を表示します。local正本の保存に失敗した場合はReview19画面に留まり、もう一度完了操作を行えます。

## 12. Supabaseへの影響

local-first、pending queue、retry timing、CAS、in-flight guard、rich merge、AreaCount／Review19 sync、normal／summer分離、backfill、fixed-time隔離を変更しません。完成Review19本体を先に保存し、既存outboxへ積む順序を維持します。

## 13. DB / SQL変更

- migration追加: なし
- Supabase SQL変更: なし
- table／column／unique key／index／trigger変更: なし
- RLS／policy変更: なし
- dataSchemaVersion: 保存形式の変更がないため `3` を維持

## 14. backward compatibility

旧Review19、AreaCount、session snapshot、skip recordを物理migrationしません。既存normalizer、identity merge、reload、export、cloud mergeを維持します。optional fieldやDB schemaの追加はありません。

## 15. Obon等の回帰

毎年8月13日〜16日の `isObon: true`／`calendarCondition: "obon"` とholiday-equivalent需要判断、導入前recordの遡及書換え防止を変更しません。productionAnalysisの `history / manual / human_review19` source、9段階raw、weather／temperature、20時30分、done screen rate、normal／summer exportも変更対象外です。

## 16. tests

- skip自己ループ／1件fallback／後からの再訪／identity dedupe: `check:logic` 91/91 PASS
- Review19 12/12完成／1record／done遷移／reload／duplicate防止: `check:review19-completion-safety` 16/16 PASS
- artificial quota／保存優先順位／安全diagnostic: `check:review19-completion-safety` 内のQuota回帰を含め全件PASS
- 全 `check:*`: 32/32 PASS
- TypeScript: `npx tsc -b --pretty false` PASS
- 変更対象ESLint: 0 errors、既存の `react-hooks/exhaustive-deps` warning 4件のみ
- production build／PWA generateSW: PASS（10 precache entries、`dist/sw.js`／`dist/workbox-9c191d2f.js`生成）

## 17. browser実機相当確認

390×844の実ブラウザで、弁当・麺類から「スキップ先を選ぶ」→天ぷらへ移動→天ぷらで「今はスキップ」→涼味商品へ遷移し、自己ループしないことを確認しました。`innerWidth=390` に対してdocument／body幅は375pxで横溢れはなく、console errorは0件でした。

Review19は17時source sessionを固定時間UI内で準備する途中、in-app browser接続が切断され、12エリア全入力から `review19_done` までの実ブラウザ完走には未到達です。接続中に確認できた390×844画面はdocument幅375px、console error／warning 0件でした。したがってReview19の完了画面について「実ブラウザ確認済み」とはせず、12/12の完成record・done遷移・reload・Quota安全性は専用test 16/16とproduction buildで確認した結果として区別します。

## 18. appVersion / buildId / schema

- appVersion: `2026.8.9-7`
- buildId: `build-20260815-173057-jst`
- dataSchemaVersion: `3`

## 変更ファイル

- `src/domain/pending.ts`
- `src/domain/storage.ts`
- `src/domain/review19CompletionStorage.ts`
- `src/hooks/useNebikiApp.ts`
- `scripts/check-logic.ts`
- `scripts/check-review19-completion-safety.ts`
- `scripts/check-refactor-characterization.ts`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_20260815_SKIP_REVIEW19_WHITE_SCREEN.md`
- `dist/**`（最終build後）

## リリース成果物

- ZIP: `nebiki-helper-20260815-1755.zip`
- SHA-256: 最終回答の成果物欄を参照
