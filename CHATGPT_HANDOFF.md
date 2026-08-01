# 値引ヘルパー 引継ぎメモ

最終更新: 2026-08-01（日本時間）

## 正本と作業ルール

- ユーザーから渡された最新ZIPを展開し、その中身を正本として確認する。
- 変更前に `package.json`、型、localStorage、JSON出力、Supabase保存、テストを確認する。
- 値引率・閾値・上下限は、ユーザーが明示した範囲以外で変更しない。
- ZIPには `node_modules`、`dist`、`.env`、秘密情報、別のZIPを含めない。

## 現行バージョン

- `appVersion`: `2026.8.1-1`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260801-234913-jst`（ビルドごとに日本時間形式で生成。CIでは同形式の`NEBIKI_BUILD_ID`を使用可能）

## 現行フロー

- 操作モードは従来の詳細モード相当の1種類。簡易モードと習熟Step制は廃止済み。
- 15時、17時、18時30分、19時30分、20時30分を維持。
- 天候入力は16時〜21時。15時天候欄はない。
- 19時チェック開始は天候入力画面から行う。18時30分完了画面には開始ボタンを出さない。
- 19時チェックの新規「対象外」登録はない。旧 `not_applicable` は読み込み互換のみ。

## 分析データ

- 新規完了エリアでは `rateDecisionSnapshot` が実表示率の正本。
- `completed*` は画面表示・旧データ互換用。
- エリア完了後に時計が進んでもスナップショット・`completed*`・完了サマリーを再計算しない。
- 旧完了データにスナップショットがない場合は `legacy_not_captured`。架空の値を作らない。
- セッション `basis` は完了保存時に `basisCapturedAt` とともに固定し、エリア率の正本には使わない。
- 日次品質は `processComplete` と `measurementComplete` を分離する。

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

## Supabase

- `area_count_records` は残数履歴の最小列だけを使用する。
- アプリ更新後、backup → migration → verify の順でSQL Editorから手動実行する。
- 問題時はrollbackを使用する。リモートSQLを自動実行しない。

## 確認コマンド

README記載の全 `check:*`、TypeScript型チェック、`npm run build` を実行する。PWA生成物は `dist/manifest.webmanifest`、`dist/sw.js`、`dist/registerSW.js` を確認する。
