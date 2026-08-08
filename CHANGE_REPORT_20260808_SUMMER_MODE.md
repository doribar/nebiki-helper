# 値引ヘルパー 夏季モード・完了画面動的推奨値 変更報告

## リリース識別情報

- appVersion: `2026.8.8-1`
- buildId: `build-20260808-163017-jst`
- dataSchemaVersion: `3`（変更なし）

## 実装内容

### 1. ユーザー向け「夏季モード」

- 内部の `demandCycle: "normal" | "summer"`、既存JSON、履歴分類は変更せず、ユーザー向け名称を「夏季モード」ON/OFFへ統一した。
- 共通関数 `isSummerModeAvailable(date)` で、JSTへ解決済みの営業日が7月1日〜9月30日の場合だけ利用可能とする。
- 期間外は開始画面の操作を表示せず、選択状態と当日ロックを `normal` へ正規化して保存する。これにより10月1日にOFFとなった状態が翌年7月に自動復活しない。
- 既存の日次ロックと保存データ証跡によるロックを維持し、営業開始後は変更できない。
- 過去の `summer` 履歴、今年短期／前年以前長期、同曜日3件／曜日グループ3件、減少率、20時30分中央値の分離処理は変更していない。

### 2. 時間固定モードとの分離

- 固定したJST営業日で7〜9月判定を行う。
- 本番キー `nebiki-helper/demand-cycle-state-v1` と別に、`nebiki-helper/fixed-time-demand-cycle-state-v1` へ選択状態・日次ロックを保存する。
- 固定モードではSupabase残数履歴、端末内summer残数履歴、日次スナップショット、19時チェック元データを運用判断へ読み込まず、それらへ書き込まない。
- 固定日を期間外へ移すとOFFに正規化し、期間内へ戻しても自動的にONへ復帰しない。

### 3. 「迷ったら…」の夏季案内

- 夏季モードON、同一営業日のJST時刻が17:59までの場合だけ、既存ダイアログへ次の趣旨を追加した。
  - 境界で迷った残数判定だけを1段階少ない側へ寄せる。
  - 明らかに多い場合は下げず、夕方〜夜の売れ方も考慮して個別判断する。
- 18:00以降、夏季モードOFF、対象期間外では表示しない。
- 5段階判定値や自動判定ロジック自体は変更していない。

### 4. 完了画面の現在推奨値

- 確定時一覧 `capturedDoneSummaryItems` と、画面表示用 `doneSummaryItems` を分離した。
- 画面表示用だけ、完了済みエリアの確定済み `areaJudge`・`areaRateAdjustment`・曜日・天候等を維持し、既存の `getNormalTimeRateDisplay`、16時超過補正、次時刻基準−5％を共有して現在推奨値を算出する。
- 既存の30秒runtime clock、focus、visibility更新、および固定時間の `testNow` 更新に追従する。
- 20時30分最終値引、未完了、先取り値引済み自動スキップの表示は従来どおり。

## 保存データを変更しないことの確認

- `rateDecisionSnapshot`、`completed*`、`confirmedAt` は再計算・上書きしない。
- 日次セッション保存、19時チェック用snapshot、自動時刻遷移時snapshotには、画面用の動的一覧ではなく確定時一覧を渡す。
- daily snapshot、finalized day data、19:00 export、統合JSONへ動的表示値を書き戻さない。
- 新しい永続データ項目は追加していない。追加したlocalStorageキーは固定時間モード専用のUI選択・日次ロックだけである。

## 主な変更ファイル

- `src/domain/demandCycle.ts`
- `src/domain/demandCycleStorage.ts`
- `src/domain/areaCountHistory.ts`
- `src/hooks/nebikiApp/ratePresentation.ts`
- `src/hooks/useNebikiApp.ts`
- `src/app/App.tsx`
- `src/app/AppRouter.tsx`
- `src/components/common/JudgeHintDialog.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `scripts/check-summer-mode.ts`（追加）
- `scripts/check-done-summary-current-rate.ts`（追加）
- `scripts/check-refactor-characterization.ts`
- `scripts/check-full-mode.ts`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHATGPT_HANDOFF.md`
- `dist/**`（本番/PWA再生成）

## Supabase / SQL

- Supabaseテーブル・列・保存形式は変更していない。
- SQLファイルは変更していない。
- SQL Editorでの再実行は不要。

## 検証

- 夏季モード専用回帰: 16/16成功
- demand-cycle回帰: 35/35成功
- 完了画面の現在推奨値・確定値不変テスト: 成功
- temperature comfort回帰: 12/12成功
- 既存 `check:*` 全21スクリプト: 成功
- TypeScript `tsc -b`: 成功
- 本番ビルド: 成功
- PWA `generateSW`: 成功（`manifest.webmanifest`、`registerSW.js`、`sw.js`生成）
- 390×844px実画面: 8月の開始画面で「夏季モード：OFF」と変更操作を確認。6月30日・10月1日は操作非表示。各画面で `scrollWidth <= clientWidth`、console warning/error 0件を確認

## 未解決事項・注意点

- 夏季モードの残数履歴は従来どおり端末内localStorageが正本で、別端末へ自動同期されない。
- 既存プロジェクトの全体ESLintには今回変更前から存在するHook/UIの指摘がある。今回追加したドメイン・表示計算・テストファイルの対象lintは個別に確認する。
