# 値引ヘルパー 2026.8.9-11 CHANGE REPORT

## 基準版

- ZIP: `nebiki-helper-20260822-1736.zip`
- appVersion: `2026.8.9-10`
- buildId: `build-20260822-173017-jst`
- dataSchemaVersion: `3`

## 1. 実端末で発生したReview19保存失敗

2026-08-24の実端末運用で、19時チェックの全エリア入力後に「完了」を押しても、Review19端末正本を保存できない警告が繰り返し表示されました。旧警告は端末の空き容量確認を一律に案内していましたが、Android端末本体には約169 GBの空きがありました。

## 2. 現時点で原因未確定

実端末で捕捉されたDOMException名やブラウザorigin単位のstorage使用量は取得できていません。したがって、実際の原因が `QuotaExceededError`、`SecurityError`、storage unavailable、その他のどれであったかは現時点では未確定です。

このreleaseでは原因を推測してstorage retention、保存方式、cleanup対象を変更していません。次回発生時に実端末画面へ表示されたerrorNameを確認してから、必要な根本対策を別releaseで判断します。

## 3. 旧メッセージが空き容量を一律案内していた理由

`StorageOperationResult`は既に、以下のstructured metadataを捕捉していました。

- `ok`
- `key`
- `operation`
- `errorName`
- `quotaExceeded`

しかし`useNebikiApp.saveReview19()`の正本失敗分岐がこの結果を固定文言へ置換し、原因に関係なく「端末の空き容量を確認」と表示していました。またquota retry時には最終結果へ変数を上書きしていたため、正本とpendingのどちらを再試行したかをUI直前で正確に復元できませんでした。

## 4. structured failureの現在の情報

Review19 completion resultへ、正式record schemaとは別の一時結果として以下を追加しました。

- `localAttempts`: Review19端末正本の初回writeと任意の1回retry
- `cloudQueueAttempts`: Supabase未送信queue準備の初回writeと任意の1回retry

既存の`localResult`、`cloudQueueResult`、`recoveryResults`は維持しています。stage別attemptを分けたため、正本がquota retryで復旧した後にpendingが`SecurityError`で失敗しても、pendingを誤って「再試行済み」と表示しません。

## 5. 新しい診断UI

既存のnative alertを使い、最終的に残ったfailureを次のmetadataだけで表示します。

```text
保存先：19時チェック端末正本
操作：書き込み
エラー：QuotaExceededError
容量上限エラー：はい
再試行：実施済み（失敗）
```

pending-onlyの場合は保存先を`クラウド同期用の未送信キュー`と表示します。内部storage key、record本文、例外messageは表示しません。

consoleには`[review19-storage-failure]`として、stage、operation、errorName、quotaExceeded、retryAttempted、retrySucceededだけを出します。

## 6. QuotaExceededError表示

`quotaExceeded=true`のときだけ、次の補助説明を表示します。

```text
このアプリで利用できるブラウザ保存領域の上限に達した可能性があります。
端末本体の空き容量不足を示すものとは限りません。
```

Android端末本体のストレージ不足とは断定しません。

## 7. SecurityError表示

`errorName=SecurityError`はそのまま表示し、容量上限エラーは`いいえ`、非quotaのため再試行は`未実施`と表示します。補助説明は「ブラウザ保存領域へのアクセスが拒否されました」という捕捉事実に限定し、Chrome、PWA、権限設定などの原因を断定しません。

## 8. unknown error表示

errorNameが欠損しているか、改行・credentialらしき本文を含むなど安全な短いtokenとして表示できない場合は`UnknownError`へ正規化します。`String(error)`や例外messageを表示しません。

## 9. authoritative save failureとの関係

Review19端末正本が保存できなかった場合は従来どおり、次の処理へ進みません。

- Supabase pending準備
- Review19 source cleanup
- `review19_done`

診断alertを閉じてもReview19画面に留まり、同じidentityで再度「完了」を押せます。

## 10. pending-only failureとの区別

端末正本が保存済みでpending準備だけ失敗した場合は、次のように明確に区別します。

```text
19時チェックは端末へ保存されましたが、クラウド同期の準備に失敗しました。
保存先：クラウド同期用の未送信キュー
```

端末正本を削除せずcompleteを維持し、既存どおり管理設定の手動Supabase同期によるbackfillが可能です。pending準備済みで`changed=false`だった成功も失敗扱いにしません。

## 11. quota recovery変更有無

quota recoveryの対象・順序・回数は変更していません。

1. navigation/debug用`runtime-state`を解放
2. 重複`work-session-checkpoint`を解放
3. 同じstageのwriteを1回だけretry

AreaCount正式履歴、Review19正本、pending、finalized day、current sessionはcleanupしません。recursive retryやcleanup対象追加はありません。

## 12. Review19入力state保持

authoritative save失敗時は`setState`によるdone遷移より前にreturnします。したがって次をReact stateに保持します。

- 12/12 areaCounts
- 12/12 human evaluationとraw9
- productionAnalysis材料
- calendarContext / analysisWeatherContext
- daySnapshot
- session identity

正式record schemaや過去recordは変更しません。

## 13. retry挙動

- quota以外: cleanup・retryなし
- quota: cleanup後に最大1回retry
- retry成功: alertを出さず、正本保存・pending準備・doneへ通常進行
- retry再失敗: doneへ進まず、errorNameと`再試行：実施済み（失敗）`を表示
- 同じ失敗で「完了」を複数回押しても、各完了attempt内でretryは1回だけ

同じReview19 identityのupsert／dedupeとpending identityは変更していません。

## 14. sensitive data非表示

診断UI・追加console diagnosticに以下を出しません。

- Review19 record本文
- 12エリアpayload
- 商品データ本文
- error message
- localStorage全内容
- Supabase URL / credential / API key
- access / refresh / session token

errorNameは英数字・`.`・`_`・`-`からなる最大64文字のtokenだけを許可し、それ以外は`UnknownError`とします。

## 15. storage safety回帰

2026.8.9-8以降の次の仕様を維持しました。

- structured storage result
- React rootへstorage例外を漏らさない
- quota retry最大1回
- daily snapshot 120件＋1 MiB soft budget
- current / unfinalized date保護
- finalized duplicateだけprune
- 15→17等の自動時刻遷移
- StrictMode in-flight guard
- Review19 local-first completion safety
- raw storage write boundary

storageのcleanup・retention・authoritative保存方式は変更していません。

## 16. Supabase / DB変更有無

変更なしです。

- migration追加なし
- SQL変更なし
- table / column / index / trigger変更なし
- RLS変更なし
- pending / retry / CAS / in-flight guard変更なし
- fixed-time READ ONLY / production WRITE隔離変更なし

## 17. tests

- `check:review19-storage-diagnostics`: 10/10 PASS
- `check:review19-completion-safety`: 16/16 PASS
- 全`check:*`: 41/41 PASS
- TypeScript (`tsc -b`): PASS
- changed-file ESLint: 0 error / 4 warning（`useNebikiApp.ts`に基準版から存在する同一4件の`react-hooks/exhaustive-deps`。今回の差分による新規warning 0）
- production build: PASS
- PWA generateSW: PASS（10 entries、544.12 KiB）

専用testは次を確認しました。

- authoritative QuotaExceededError、cleanup＋最大1回retry、最終診断
- SecurityError、quota=false、cleanup/retryなし
- unknown / 不正errorNameのsanitization
- StorageUnavailableError
- quota retry成功時は正常完了経路
- retryも失敗した場合のattempt数
- pending-only SecurityError / QuotaExceededError
- 同じ失敗で複数回完了しても再帰retryなし・identity不変
- consoleへstorage metadata以外を出さない
- hookでauthoritative/pending stageを分け、正本失敗時はdone前にreturn

全回帰にはinitial weather scroll、median display、last-area skip、fixed-time Supabase READ ONLY / WRITE isolation、storage boundary、daily snapshot、long-run fixture、Review19、Supabase sync、pending/retry/CAS、normal/summer、Obon、productionAnalysis、weather/temperature、9段階human evaluationを含みます。

## 18. browser確認

production previewを390×844で確認しました。

- appVersion `2026.8.9-11`表示
- buildId `build-20260824-203336-jst`表示
- `scrollWidth=375` / `clientWidth=375`でdocument-level横scrollなし
- console error 0
- console warning 0
- 通常画面・管理設定dialogのrender正常

本番bundleに人工storage failureを注入するdebug hookは存在せず、診断のためだけに追加しませんでした。そのためQuota／Security／unknownのnative alert自体は実ブラウザでは未注入です。表示文字列とcompletion分岐は自動storage mock 10/10で確認し、実ブラウザでは通常production UIとモバイル幅を確認しました。未確認事項を確認済みとはしていません。

## 19. appVersion / buildId / schema

- appVersion: `2026.8.9-11`
- buildId: `build-20260824-203336-jst`
- dataSchemaVersion: `3`

診断は完了attempt内の一時metadataであり、Review19 record、JSON export、Supabase payloadへ追加しないためdataSchemaVersion 3を維持しました。
