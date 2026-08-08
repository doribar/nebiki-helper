# 19:00チェック 人間評価・中央値評価 変更報告

## リリース情報

- 基準版: `nebiki-helper-20260808-1648.zip`
- `appVersion`: `2026.8.8-2`
- `buildId`: `build-20260808-182334-jst`
- `dataSchemaVersion`: `3`（変更なし）
- 出力ZIP: `nebiki-helper-20260808-1837.zip`

## 実装内容

- 19:00チェックの各対象エリアで、実残数に加えて既存 `AreaCountEvaluation` の5段階人間評価を必須入力にした。
- 残数と人間評価が両方揃った時点でそのエリアを完了できる。既存の除外エリアにはどちらも要求しない。
- 入力確定時に、当日を除く過去の19:00チェック実残数だけから中央値ベースの5段階評価を計算し、分析用の別観測値として保存する。
- 人間評価と中央値評価は相互に上書きしない。入力残数も評価へ合わせて補正しない。
- 中央値評価、中央値、件数、比較基準は入力画面にも完了画面にも表示しない。
- 既存の19:00エリア順、値引ロジック、完了画面の現在時刻追従表示、夏季モード履歴、気温ロジック、Supabase処理は維持した。

## 保存形式

`Review19Result` と `Review19DayCheckSnapshot` に、後方互換な任意項目として次を追加した。

```ts
areaEvaluations?: Partial<Record<AreaId, {
  humanEvaluation: AreaCountEvaluation;
  autoEvaluation: AreaCountEvaluation | null;
  autoEvaluationStatus: "ready" | "insufficient";
  autoEvaluationBasis?: AreaCountDecisionBasis;
}>>;
```

`autoEvaluationBasis` には既存の `AreaCountDecisionBasis` をそのまま利用し、少なくとも次を追跡できる。

- `demandCycle`
- `recommendationStatus`
- `comparisonMode`
- `actualWeekday` / `actualWeekdayGroup`
- `medianCount`
- `sampleSize` / `requiredSampleSize`
- 短期・長期中央値と件数
- 5段階境界値と採用評価

`dataQuality` には、人間評価の対象件数、記録件数、欠損エリア、完了状態を追加した。残数測定だけが完了していても人間評価が欠ける場合、`processComplete` と `complete` は `false` になる。除外エリアは欠損へ数えない。

## 中央値評価の計算

- 比較母集団は保存済みの過去19:00チェック残数だけ。15時・17時・18時30分・19時30分の残数履歴は混ぜない。
- 評価対象日と同日または未来日の記録を事前に除外するため、今日自身を母集団へ含めない。
- 既存の残数履歴エンジンへ一時的な19時レコードとして渡し、既存の中央値、5段階境界、曜日・曜日グループ、祝日例外、必要3件を再利用する。
- 自動評価には中央値比較そのものを表す `baseEvaluation` を保存し、減少率補正後の `suggestedEvaluation` は使用しない。
- `normal` と `summer` は完全に分離する。
- 夏季モードは今年の履歴を短期、前年以前を長期として扱う。前年以前の件数は今年の開始条件3件へ含めない。
- 同曜日3件を優先し、不足時は既存曜日グループへフォールバックする。どちらも不足なら `autoEvaluation: null`、`autoEvaluationStatus: "insufficient"` とし、「普通」へ補完しない。
- 時間固定モードは本番履歴を読み込まないため、本番履歴がない状態では `insufficient` となり、本番保存先やSupabaseを汚染しない。

## UI

- 既存の残数入力カード内に、5段階ボタンを同一エリアの入力として追加した。
- 表示ラベルは既存の `evaluationText()` を再利用し、別enum・別ラベル定義を作っていない。
- 残数確定前は評価ボタンを無効化し、残数と評価が揃うまで完了ボタンを無効化する。
- 390×844pxの実画面で5ボタンを均等5列・52pxのタップ領域として確認した。
- `scrollWidth <= clientWidth`、横スクロールなし、console warning/errorなしを確認した。
- 入力画面・完了画面のどちらにも中央値、自動評価、サンプル数、比較基準を表示していない。

## 既存rating系フィールド

既存の `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」を記録する旧評価であり、今回の「19:00時点の残数を人間がどう感じたか」と意味が異なる。このため再利用せず、`areaEvaluations` を新設した。旧rating系の読み込み・出力は維持し、旧値から人間評価を推測・補完しない。

## 旧データ互換

- `areaEvaluations` がない旧19:00 JSONは従来どおり読み込める。
- 旧データの人間評価は欠損のまま扱い、「普通」などへ補完しない。
- 壊れた自動評価データがあっても、妥当な人間評価は独立して保持する。
- `demandCycle` がない旧データは既存処理どおり `normal` として扱う。
- 新しい情報は19:00個別出力、日次スナップショット、統合JSONの既存19:00スナップショット経路へ含まれる。

## 変更ファイル

- `src/domain/types.ts`
- `src/domain/review19.ts`
- `src/domain/review19Evaluation.ts`（新規）
- `src/hooks/useNebikiApp.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/components/screens/Review19Screen.tsx`
- `src/app/AppRouter.tsx`
- `scripts/check-review19-human-auto.ts`（新規）
- `scripts/check-logic.ts`
- `scripts/check-refactor-characterization.ts`
- `package.json`
- `package-lock.json`（プロジェクト自身のversionのみ）
- `README.md`
- `CHATGPT_HANDOFF.md`
- `dist/**`（本番/PWA再生成物）
- 本変更報告

## 検証結果

- 19:00専用回帰テスト: 24/24成功
- `check:*`: 22スクリプトすべて成功
- TypeScript: `npx tsc -b --pretty false` 成功
- 本番ビルド: `npm run build` 成功
- PWA: `generateSW` 成功、precache 10 entries
- 390×844px実画面: 残数のみでは未完了、人間評価後に完了、次エリア遷移、横スクロールなし、console warning/errorなし
- 変更対象ESLint: 基準版から存在する2 errors / 8 warningsのみ。新規差分由来の指摘なし
- Supabase SQL 5ファイル: 基準版とSHA-256一致
- `dataSchemaVersion`: `3`
- `package-lock.json`: プロジェクトversion以外の依存関係差分なし

## Supabase / SQL

変更なし。今回の情報は既存の19:00・日次JSONへoptionalフィールドとして保存するため、SQL再実行は不要。

## 未解決事項

- 今回の範囲に関する未解決事項はない。
- 既存ESLintには、基準版から存在する条件付きHookおよびHook依存配列等の指摘が残る。今回の機能追加とは無関係のため修正していない。
