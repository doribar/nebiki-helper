# 値引ヘルパー変更報告（2026-07-29）

## リリース情報

- appVersion: `2026.7.29-1`
- buildId: `build-20260729002144`
- dataSchemaVersion: `3`（変更なし）
- Supabase SQL: 変更なし・再実行不要

## 実装内容

1. 15時セッション中に16:00を過ぎた場合、基準案内だけを「16時を基準に」へ切り替えるようにしました。値引計算に渡す基準、値引率、スナップショットは変更していません。
2. 注意事項を整理し、定番・夜によく売れる・広告商品（-10%）を1項目、見た目が悪い・不人気商品（+10%）を1項目に統合しました。分類と補正処理は維持しています。
3. 19:00チェック入力画面と完了画面へ「戻る」を追加しました。入力途中の前エリア修正と、完了直後の再修正ができます。
4. エリア判定画面から天候入力へ戻る場合だけ、`天候入力画面に戻りますか？` を表示します。キャンセル時は元画面を維持します。
5. 設定PINの入力・判定・保存・UIを削除し、設定を直接表示するようにしました。
6. 通常フロー、先取り残数のみ入力、19:00チェックへ「入力した残数を修正」を追加しました。既存レコードは同一キーでupsertし、同一セッションの重複を作りません。判定確定前の現在エリアも修正でき、既存値を再入力欄へ引き継ぎます。
7. 20:30残数入力へ任意の「うち定番」個数を追加しました。空欄は`null`、0は`0`、非負整数だけを受理し、総残数超過を拒否します。値引計算には使用しません。
8. 20:30の全エリア入力完了時に日次スナップショットを正式確定し、専用localStorageへ保存するようにしました。
9. 20:30完了後の旧done保存経路を停止しました。確定後のdone表示、再描画、再起動では日次本体を再構築しません。明示的な残数修正後だけ同じ安定IDの本体を置換し、メモ等は維持します。
10. 20:30完了画面へ任意メモと、その直前に確定した1日データ1件の直接出力を追加しました。メモ更新はメタデータだけを書き換えます。
11. 設定へ19:00チェック／1日データそれぞれの「全件」「最新」計4ボタンを追加しました。両データは別JSONです。最新判定は対象日付と実施日時を使い、データなしの場合はファイルを作らず画面通知します。
12. 日本時間の前日に正式な1日データがある場合だけ、天候入力画面へ「廃棄個数を入力」を表示します。
13. 前日の対象日を明示し、空欄`null`、0を含む非負整数で廃棄個数を同じ正式記録へ追加・更新します。日次本体は再構築しません。
14. 19:00チェック完了画面へ、完了直前に確定した19:00チェック1件を直接出力するボタンを追加しました。
15. 20:30完了画面の直接出力は、日時検索を行わず画面遷移直前に保持した正式日次ID・記録を使用します。

## データ構造と後方互換

- `AreaProgress.stapleItemCount?: number | null` とエリアスナップショット側の同項目を追加しました。旧データの欠損はそのまま許可し、`null`と`0`を区別します。
- `AppState.areaCountCorrection?` は修正対象と復帰先を保持します。旧状態に存在しなくても初期値へ正規化します。
- `AppState.finalizedDayRecordId?` は20:30完了直前に確定した日次記録を直接参照します。旧状態では任意項目として扱います。
- 正式日次は既存の`Review19DaySnapshot`を本体として、`recordId`、`finalizedAt`、`memo`、`discardCount`を任意／null互換で付加し、`nebiki-helper/finalized-day-data`へ日付単位で保存します。
- 旧20:30 doneスナップショットは読み込み互換を維持し、正式日次がない日だけ出力時に既存経路から再構成します。既存正式日次は上書きしません。
- 19:00チェック出力形式と日次出力形式を分離しました。日次全件は`nebiki-helper-day-data-export`、最新／直接日次は既存の1日出力形式、19:00チェックは既存の19:00チェック出力形式を使用します。
- Supabaseの列、読み書き、SQL、dataSchemaVersionは変更していません。

## 主な変更ファイル

- `src/hooks/useNebikiApp.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/domain/types.ts`
- `src/domain/fullMode.ts`
- `src/domain/finalizedDayData.ts`（新規）
- `src/domain/separateDataExport.ts`（新規）
- `src/domain/jstCalendar.ts`（新規）
- `src/app/App.tsx`
- `src/app/AppRouter.tsx`
- `src/components/common/AdminSettingsDialog.tsx`
- `src/components/common/AreaCountCorrectionPanel.tsx`（新規）
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/screens/AutoSkipCountScreen.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/Review19Screen.tsx`
- `src/components/screens/Review19DoneScreen.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/components/screens/DoneScreen.tsx`
- `src/domain/adminSettings.ts`（削除）
- `scripts/check-feature-20260728.ts`（新規）
- `scripts/check-workflow-20260728.ts`（新規）
- `scripts/check-finalized-day-data.ts`（新規）
- `scripts/check-staple-item-count.ts`（新規）
- 既存回帰テスト、`package.json`、`package-lock.json`、`README.md`

## 検証結果

- TypeScript: `npx tsc -b --pretty false` 成功
- 本番ビルド/PWA: `npm run build` 成功
  - Vite 8.0.0、66 modules transformed
  - PWA precache 10 entries
  - `sw.js`、`workbox-9c191d2f.js`生成
- 自動テスト: 15スクリプト、合計297確認すべて成功
  - 既存ロジック 87/87
  - 既存統合 19/19
  - 曜日グループ 29/29
  - 三連休中日 33/33
  - 翌日平日祝日 37/37
  - 完成版回帰 36/36
  - schema v3 18/18
  - データ出力／Supabase 9/9
  - 今回の機能 6/6
  - 画面遷移・修正・日次確定 8/8
  - 正式日次・分離出力 11/11
  - その他4スクリプト成功
- 390×844px実画面: 設定、残数入力／判定、値引率表示、残数修正一覧を確認。横スクロールなし、ボタン重なりなし、ブラウザconsole warning/error 0件。
- SQL 5ファイルは基準版とSHA-256一致、依存／開発依存も基準版と一致しました。

## 変更していないもの

- 基本値引率、天候・快適度・雨雪・風速補正
- 曜日グループ、祝前日、祝日当日、三連休中日の判定
- 5段階エリア判定、商品分類、各商品補正率
- 先取り値引、時刻自動遷移、19:00チェックの評価方法
- rateDecisionSnapshotとcompleted系の意味
- Supabase構造・SQL・dataSchemaVersion

## 未解決事項・既知の範囲外事項

- `npm run lint`は基準版と同じ14 errors／10 warningsで失敗します。既存のHook依存配列、条件付きHook、未使用引数等で、今回の指定範囲外のため変更していません。型チェック、全テスト、ビルドは成功しています。
- 20:30の「最終入力→戻る／undo→再入力→done→再起動」は、保存純粋関数とソース回帰テストで固定していますが、ブラウザ自動操作で12エリア全件を通す専用E2Eテストはありません。
- 既存コードは通常ルートをモジュール読込時の季節で確定するため、アプリを再読込せず5月末／9月末の季節境界を跨ぐと涼味商品の対象が当日とずれる可能性があります。今回の機能とは無関係の既存候補として未変更です。

