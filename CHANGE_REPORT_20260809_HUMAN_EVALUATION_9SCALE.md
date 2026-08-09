# 人間残数評価 9段階対応 変更報告

## リリース識別情報

- `appVersion`: `2026.8.9-1`
- `buildId`: `build-20260809-213438-jst`
- `dataSchemaVersion`: `3`（変更なし）
- 最終ZIP名: `nebiki-helper-20260809-2144.zip`。最終検証結果は本報告末尾に記載する。

## 変更概要

既存の5つの残数評価ボタンを増やさず、通常タップの5基準値と長押しによる4中間値を合わせたscore 1〜9を保存できるようにした。raw入力と値引運用用の解決済み5段階値を分離し、既存の `AreaCountEvaluation`、値引率補正、中央値自動判定を拡張していない。

新しい正本は任意の `humanEvaluationDetails` である。旧5段階データは物理移行せず、読み込み・分析・出力時だけ奇数score・scale 5として論理deriveする。新規データはscale 9として保存する。

## UI操作契約

- 共通 `HumanEvaluationSelector` を通常値引の手動残数評価とReview19で共有する。画面に表示するボタンは従来の5つだけ。
- 通常タップは単独選択を即確定する。
- 500ms長押し成立時に、第1選択を即時に強調表示する。対応端末では `navigator.vibrate(15)` により15ms振動する。
- 長押し後の第2選択は、第1選択と同じ項目または隣接項目だけ。同じ項目の再タップは単独選択、隣接項目は中間選択となる。
- 「中間選択をやめる」で明示的にキャンセルできる。非隣接項目は無効化し、domain validatorでも拒否する。
- 長押し成立後の `pointerup` と後続ghost clickを抑止する。移動、`pointercancel`、pointer capture喪失、blur、visibility change、disabled化、画面遷移でもtimer・capture・抑止状態をcleanupする。
- 長押し成立時は親画面の左スワイプgestureをキャンセルし、中間選択とスキップ操作の競合を防ぐ。

## scoreとselection

単独選択の対応は次のとおり。

| `AreaCountEvaluation` | score |
| --- | ---: |
| `few` | 1 |
| `slightly_few` | 3 |
| `normal` | 5 |
| `slightly_many` | 7 |
| `many` | 9 |

隣接項目の中間はscore `2 / 4 / 6 / 8`。scoreは第1・第2選択の順序に依存しないが、`humanEvaluationSelections` は操作順をそのまま保持する。同じ項目を第2選択した場合は1要素tupleへ正規化する。

```ts
type HumanEvaluationDetails = {
  humanEvaluationScore9: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  humanEvaluationScale: 5 | 9;
  humanEvaluationSelections:
    | [AreaCountEvaluation]
    | [AreaCountEvaluation, AreaCountEvaluation];
  automaticEvaluation?: AreaCountEvaluation;
  resolvedEvaluation?: AreaCountEvaluation;
  resolutionDirection: "none" | "lower" | "higher" | "not_applicable";
  resolutionReason:
    | "single_selection"
    | "normal_15"
    | "normal_17_or_later"
    | "summer_before_1800"
    | "summer_1800_or_later"
    | "review19_observation"
    | "legacy_5_level";
  demandCycle?: "normal" | "summer";
  evaluatedAt?: string;
  sessionDiscountTime?: DiscountTime;
};
```

`automaticEvaluation` は手動変更前の履歴自動判定がある場合だけ保存する。`humanEvaluationDetails` は `decisionBasis` へ重複保存しない。

## 通常値引での解決

- action/UIからはraw `HumanEvaluationSelection` を渡し、hook/domain境界で `HumanEvaluationDetails` を構築する。resolverはraw score・selection順・呼出元オブジェクトを変更しない。
- 奇数scoreは選択した既存5段階値をそのまま `resolvedEvaluation` とする。
- `normal` の偶数scoreは15時なら少ない側（`lower`）、17時以降なら多い側（`higher`）へ解決する。
- `summer` の偶数scoreはJST 18:00未満なら少ない側、18:00以降なら多い側へ解決する。
- 解決後の既存 `AreaCountEvaluation` だけを既存の値引補正・エリア判定へ渡す。score 1〜9を既存enumへ追加していない。
- `evaluatedAt`、需要サイクル、値引時刻、解決方向・理由の組合せをnormalizerで検証する。夏季のbefore/after理由は `evaluatedAt` のJST 18:00境界とも一致しなければ受理しない。

## Review19

- Review19も共通5ボタン・9段階selectorを使用するが、raw観測値を値引用5段階へ解決しない。
- `humanEvaluationDetails` は `humanEvaluationScale: 9`、`resolutionDirection: "not_applicable"`、`resolutionReason: "review19_observation"`、`sessionDiscountTime: "19"` として保存する。
- 奇数scoreだけは完全一致する既存 `humanEvaluation` を後方互換用に併記する。偶数scoreでは架空の丸め値を作らず、`humanEvaluation` は欠損のままにする。
- `humanEvaluationDetails` の妥当な偶数scoreもdata quality上の記録済み評価として数える。旧 `humanEvaluation` だけの記録はscale 5・奇数scoreへ論理deriveする。
- 最終エリアのstate flush前保存にもraw selectionを渡すため、`latestObservation` 経路で偶数scoreを失わない。補正・再訪時も保存済みdetailsを復元する。
- 過去19:00残数から計算する既存の自動5段階評価は別観測値として維持し、入力画面・完了画面には表示しない。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は意味が異なるため流用しない。

## 保存・スナップショット・エクスポート

- 通常運用の `AreaProgress`、`AreaCountRecord`、セッション／Review19 snapshot、Review19 area evaluationへ任意のpeer `humanEvaluationDetails` を保持する。
- state normalizerと履歴normalizerはscore・selection・scale・解決条件を検証し、防御的cloneでroundtripする。
- 日次個別出力、19:00個別出力、統合JSONの各経路でscale 9詳細を保持する。
- 旧5段階は保存済みlocalStorageを更新しない。出力時はcloneだけにscale 5・奇数score・単独selectionをmaterializeする。
- Review19の偶数scoreはexportでも非解決のまま保持する。

## Supabase / SQL / schema

- Supabase `area_count_records` の列は追加していない。通常サイクルのremote rowは従来の最小11列だけで、`humanEvaluationDetails`、score、selection、resolved valueを送信しない。
- 通常サイクルの端末内 `AreaCountRecord` にはraw詳細を保持するが、Supabaseの最小残数履歴だけからraw詳細を復元できない。完了済み日次スナップショットとJSONエクスポートが通常履歴raw詳細のdurableな正本となる。
- SQLファイルは変更なし。追加実行は不要。
- `dataSchemaVersion` は `3` のまま。新規フィールドはJSON上の後方互換なoptional項目である。

## 固定時間・対象外フロー

- 解決時刻は固定時間対応のruntime clockから取得し、`Date.now()` や実時計へ迂回しない。
- 時間固定モードは従来どおり本番の残数履歴、summer履歴、Review19履歴、日次保存、Supabaseを読み書きしない。
- 20時30分は既存の最終残数入力と1個・2個・3個以上ルールを維持する。5択の人間評価UIがないため9段階対応の対象外である。

## 主な変更ファイル

- `src/domain/types.ts`
- `src/domain/humanEvaluation.ts`（新規）
- `src/domain/areaCountHistory.ts`
- `src/domain/review19.ts`
- `src/domain/dayExport.ts`
- `src/domain/separateDataExport.ts`
- `src/domain/allDataExport.ts`
- `src/hooks/useSwipeToSkip.ts`
- `src/hooks/useNebikiApp.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/components/common/HumanEvaluationSelector.tsx`（新規）
- `src/components/common/JudgeHintDialog.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/Review19Screen.tsx`
- `src/app/AppRouter.tsx`
- `scripts/check-human-evaluation-9scale.ts`（新規）
- `scripts/check-review19-human-auto.ts`
- `scripts/check-refactor-characterization.ts`
- `package.json`
- `README.md`
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_20260809_HUMAN_EVALUATION_9SCALE.md`（本報告）

## リリース最終化

- `package.json` と `package-lock.json` のプロジェクトversionを `2026.8.9-1` へ同期した。
- build IDを `build-20260809-213438-jst` として本番/PWA `dist/**` を再生成した。
- 最終検証結果とZIP名は次節に記載する。

## 検証結果

- 全 `check:*`: 23/23成功。専用 `check:human-evaluation-9scale` は14/14、`check:review19-human-auto` は24/24成功。
- TypeScript: `npx tsc -b` 成功。
- 本番ビルド/PWA: `npm run build` 成功。Vite build後、generateSWで10件をprecacheし、`manifest.webmanifest`、`sw.js`、`registerSW.js` を生成。
- 変更対象ESLint: 新規domain、共通selector、swipe hook、専用・更新テストを対象に成功。差分ファイル全体には基準版から存在する `set-state-in-effect` 等が残るが、今回追加行由来の新規lint違反は0件。
- 実画面: 390×844pxの固定時間17時フローで5ボタンを維持し、長押し成立後の指離しで確定しないこと、隣接選択でscore 6となり「やや多い」へ解決されることを確認。横スクロール、console warning/errorは0件。
- 保存/出力: scale 9のroundtrip、旧scale 5の出力時論理derive、Review19偶数score非解決、snapshot非破壊を専用テストで確認。
- 不変確認: Supabase SQL 5本は基準版とSHA-256一致、`dataSchemaVersion` は3、package-lockの依存関係グラフはプロジェクトversion以外一致。
- ZIP: `nebiki-helper-20260809-2144.zip` をPOSIX区切り・直下1フォルダで作成し、`ZipFile.testzip()`、重複、不正パス、展開後ハッシュを確認する。`node_modules`、元ZIP、一時ログは除外する。

## 未解決事項・運用上の境界

- Supabase SQLを変更しない方針のため、通常サイクルのremote `area_count_records` は従来どおり残数中心の最小列であり、raw 9段階詳細は送信しない。raw詳細のdurableな正本は完了済みの日次スナップショットとJSONエクスポートである。
- 20時30分には既存の5択人間評価画面がないため、今回の長押し9段階入力の対象外。既存の最終値引ロジックは変更していない。
