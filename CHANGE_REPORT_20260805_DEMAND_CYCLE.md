# 値引ヘルパー 需要サイクル分離 変更報告

## リリース情報

- appVersion: `2026.8.5-1`
- buildId: `build-20260805-224146-jst`
- dataSchemaVersion: `3`（変更なし）
- 基準版: `nebiki-helper-20260801-2353.zip`

## 実装内容

- 需要サイクルとして `normal`（通常サイクル）と `summer`（夏サイクル）を追加した。
- 開始画面に現在のサイクルと変更操作を追加し、値引運用中の画面には小さな基準表示を追加した。
- 選択したサイクルは端末へ保存し、翌日以降の初期選択へ引き継ぐ。
- 当日の値引セッション、残数履歴、値引率スナップショット、日次スナップショット、19時チェック等の証拠が存在する場合は、その日のサイクルを固定する。
- 再読み込み、戻る操作、自動時刻遷移、19時チェック開始後も、稼働中セッションのサイクルを維持する。
- 旧データで `demandCycle` が欠けている場合は `normal` として読み込む。月や気温から夏サイクルへ自動分類しない。

## 履歴の分離

次の処理へ需要サイクル条件を追加した。

- エリア残数履歴
- 同じ曜日・曜日グループの件数
- 短期中央値・長期中央値
- 5段階自動残数判定
- 時刻間の減少率履歴と減り方補正
- 20時30分の残数中央値
- 19時チェック
- 日次セッションスナップショット
- `rateDecisionSnapshot` とエリア判定根拠
- 日次・19時チェック・統合JSON出力
- ナビゲーション履歴および再開状態

通常サイクルでは、従来の履歴抽出と短期・長期の扱いを維持した。

夏サイクルでは次の条件を適用する。

- 短期履歴: 対象年と同じ年の夏サイクルだけ。既存上限16件を維持。
- 長期履歴: 対象年より前の年の夏サイクルだけ。既存上限52件を維持。
- 自動判定開始: 今年の同じ曜日が3件以上なら曜日単体、未満なら今年の曜日グループが3件以上の場合にグループ判定、どちらも未満なら手動判定。
- 前年以前の夏履歴は今年3件の件数へ含めない。
- 同じ曜日判定では、今年短期と前年以前長期に既存の「長期中央値より最大2個低い位置まで」のガードを適用する。
- 曜日グループ判定では、従来どおり長期ガードを適用しない。
- 前年以前の夏履歴がなくても、今年の有効な短期履歴が3件あれば自動判定できる。
- 祝前日、祝日、三連休中日等の強制グループ処理は変更していない。

## 保存方法とSupabase制約

- 通常サイクルの残数履歴は従来どおりSupabaseを利用する。
- 既存Supabaseテーブルには需要サイクルを格納できるJSON列がなく、列追加・SQL変更が禁止されているため、夏サイクルの残数履歴は専用キー `nebiki-helper/summer-area-count-records-v1` へ端末内保存する。
- サイクル選択・当日ロックは専用キー `nebiki-helper/demand-cycle-state-v1` へ保存する。
- 夏履歴をサイクル情報なしでSupabaseへ送信すると通常履歴へ混入するため、夏レコードのSupabase送信は行わない。
- 完了した営業日の夏履歴は、サイクル情報付きで日次スナップショットおよびJSON出力にも含まれる。
- Supabase SQL、列、`dataSchemaVersion` は変更していない。

## 既存データ互換

- 旧セッション、旧日次スナップショット、旧19時チェック、旧残数履歴、旧判定根拠でサイクルが欠ける場合は `normal` として正規化する。
- 親データが明示的に夏サイクルで、子の旧任意項目だけが欠ける部分データでは、営業日全体の夏サイクルを子のスナップショット・判定根拠へ伝播する。
- 保存済みの値引率、天候、曜日、判定値等は需要サイクル付与以外で変更しない。

## 変更ファイル

### 新規

- `src/domain/demandCycle.ts`
- `src/domain/demandCycleStorage.ts`
- `scripts/check-demand-cycle.ts`
- `CHANGE_REPORT_20260805_DEMAND_CYCLE.md`

### 更新

- `package.json`
- `package-lock.json`（プロジェクト自身のバージョン2箇所のみ）
- `scripts/check-full-mode.ts`
- `scripts/check-refactor-characterization.ts`
- `src/app/App.tsx`
- `src/app/AppRouter.tsx`
- `src/components/screens/StartScreen.tsx`
- `src/domain/allDataExport.ts`
- `src/domain/areaCountHistory.ts`
- `src/domain/areaCountRemoteStorage.ts`
- `src/domain/dayExport.ts`
- `src/domain/finalizedDayData.ts`
- `src/domain/navigationHistory.ts`
- `src/domain/rateDecisionSnapshot.ts`
- `src/domain/review19.ts`
- `src/domain/storage.ts`
- `src/domain/types.ts`
- `src/hooks/nebikiApp/ratePresentation.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/useNebikiApp.ts`
- `dist/`（再ビルド）

## 検証結果

- 需要サイクル専用テスト: 35/35 成功
- 気温専用回帰テスト: 12/12 成功
- package.json内の全テストスクリプト: 19/19 成功
- TypeScript型チェック: 成功
- 本番ビルド: 成功
- PWA生成: 成功（`dist/sw.js`、`dist/registerSW.js`、manifest生成済み）
- 変更対象ESLint: 0 error。基準版から存在する `App.tsx` の2 warningのみ。
- プロジェクト全体ESLint: 14 errors / 10 warnings。基準版の実行結果と同じ既存問題で、今回の禁止範囲に従い修正していない。
- 390×844px実画面: 開始画面の切替、夏表示、運用画面の「夏サイクル基準」を確認。`scrollWidth=375`、`innerWidth=390`で横スクロールなし。
- console warning/error: なし。
- dist確認: `2026.8.5-1` と `build-20260805-224146-jst` を確認。

## 変更していない領域

基準版とのハッシュ比較により、次が同一であることを確認した。

- 気温区分・気温低下中ロジック
- 基本値引率および商品補正
- 天候・雨・雪・風・未来天候ロジック
- 曜日グループ・祝日・祝前日・三連休ロジック
- CSS
- Supabase SQL 5ファイル
- npm依存関係

`package-lock.json` は `2026.8.1-1` から `2026.8.5-1` へのプロジェクト自身のバージョン置換以外に差分がない。

## 既知の制約・リスク

1. 夏サイクル残数履歴は端末内localStorageが正本であり、別端末へ自動同期されない。ブラウザデータを消去すると夏履歴も失われる。これは「Supabase列・SQLを変更しない」と「通常履歴へ夏履歴を混ぜない」を同時に満たすための制約である。
2. 20時30分まで完了していない日の夏履歴は日次JSONへ確定されないため、端末内専用履歴だけに存在する。完了済み日の日次出力には含まれる。
3. 切替・戻る・自動遷移の専用テストには純粋関数・保存復元・ソース配線検査が含まれる。実画面では開始時の切替と運用画面への引継ぎを確認した。

## リリース成果物

- `dist` 収録済み
- `node_modules`、キャッシュ、一時ファイル、元ZIPは除外
- ZIP名とSHA-256は、ZIP作成・展開検証後の外部提出値を正本とする
