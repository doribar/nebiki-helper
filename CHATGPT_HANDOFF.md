# 値引ヘルパー 引継ぎメモ

最終更新: 2026-08-09（日本時間）

## 正本と作業ルール

- ユーザーから渡された最新ZIPを展開し、その中身を正本として確認する。
- 変更前に `package.json`、型、localStorage、JSON出力、Supabase保存、テストを確認する。
- 値引率・閾値・上下限は、ユーザーが明示した範囲以外で変更しない。
- リリースZIPには検証済みの `dist` を含め、`node_modules`、`.env`、秘密情報、別のZIPは含めない。

## 現行リリース情報

- 作業基準ZIP: `nebiki-helper-20260808-1837.zip`
- `appVersion`: `2026.8.9-1`
- `dataSchemaVersion`: `3`
- `buildId`: `build-20260809-213438-jst`
- リリースZIP: `nebiki-helper-20260809-2144.zip`。本欄と同じ識別情報で再生成した `dist` を収録する。

## 現行フロー

- 操作モードは従来の詳細モード相当の1種類。簡易モードと習熟Step制は廃止済み。
- 15時、17時、18時30分、19時30分、20時30分を維持。
- 天候入力は16時〜21時。15時天候欄はない。
- 19時チェック開始は天候入力画面から行う。18時30分完了画面には開始ボタンを出さない。
- 19時チェックの新規「対象外」登録はない。旧 `not_applicable` は読み込み互換のみ。
- 20時30分は従来の最終残数入力と1個・2個・3個以上ルールを維持する。既存5択の人間評価UIがないため、今回の9段階入力は適用しない。

## 人間残数評価（5ボタン・9段階）

- 共通UIは既存5ボタンを維持する。通常タップは即確定し、`few / slightly_few / normal / slightly_many / many` をscore `1 / 3 / 5 / 7 / 9` として保存する。
- 500ms長押し成立時に第1選択を即時強調し、対応端末では15ms振動する。長押し後は同じ項目または隣接項目だけを第2選択にできる。
- 同じ項目の再タップは単独選択へ戻り奇数score、隣接項目は偶数score `2 / 4 / 6 / 8`。第1・第2選択の順序を保存し、非隣接はvalidatorで拒否する。キャンセル操作で中間モードを終了できる。
- 成立済み長押しの `pointerup` とghost clickをone-shotで抑止する。移動、`pointercancel`、pointer capture喪失、blur・visibility changeもcleanupし、画面左スワイプは長押し成立時にキャンセルする。
- action入力の `HumanEvaluationSelection` はraw scoreと選択列だけを持つ。hook/domain境界で `HumanEvaluationDetails` を構築し、入力オブジェクトと順序を変更しない。
- 新規記録は `humanEvaluationScale: 9`。通常値引では偶数だけを既存 `AreaCountEvaluation` へ解決し、その解決値を既存運用ロジックへ渡す。通常サイクルは15時=`lower`、17時以降=`higher`。夏季モードはJST 18:00未満=`lower`、18:00以降=`higher`。奇数は選択値のまま。
- 夏季境界には固定時間対応のruntime clockを使い、`evaluatedAt` とresolution reasonの整合もnormalizerで検証する。
- 旧5段階は保存物を移行せず、読み込み・分析・出力時に奇数score、`humanEvaluationScale: 5`、単独selectionへ論理deriveする。

## 夏季モード（内部 `demandCycle`）

- ユーザー向け名称は「夏季モード」。内部保存値は互換性のため `normal` / `summer` のまま維持する。
- JSTの営業日が7月1日〜9月30日の場合だけ開始画面へON/OFFを表示し、ユーザーが手動で切り替える。気温による自動切替は行わない。
- 期間外は保存済み `summer` も `normal` へ正規化し、翌年7月に勝手にONへ戻さない。
- モードは15時、17時、18時30分、19時30分、20時30分、19時チェックを含む営業日全体へ適用する。
- 当日の運用開始後は変更できない。期間内の選択状態は翌日以降へ引き継ぐ。
- 時間固定モードは固定したJST日時で期間判定し、本番とは独立した選択・日次ロックを使用する。固定モードでは本番の残数履歴を読み書きしない。
- ONかつ17:59までは、9段階の中間値を少ない側へ解決する案内を表示する。18:00以降は中間値を多い側へ解決し、単独の5基準項目は変更しない。
- 通常履歴と夏履歴は混ぜない。旧データで `demandCycle` が欠ける場合は `normal` として扱う。
- `summer` の短期中央値は対象年と同じ年の夏データだけ、長期中央値は対象年より前の年の夏データだけを使用する。
- 前年以前の夏データは、今年の自動判定開始3件へ含めない。
- 今年の同曜日が3件以上なら曜日単体判定を使用する。同曜日が3件未満で曜日グループが3件以上ならグループ判定、どちらも3件未満なら手動判定とする。
- 曜日単体判定では、既存の「長期中央値より最大2個低い位置まで」のガードを使用する。曜日グループ判定では長期ガードを使用しない。
- 減少率履歴と20時30分の中央値判定もサイクル別に分離する。
- 19時チェック、日次スナップショット、`rateDecisionSnapshot`、JSON出力へ需要サイクルを保存する。

## 夏季モードの保存制約

- 通常サイクルの残数履歴は従来どおりSupabaseへ保存する。
- 夏サイクルの残数履歴はlocalStorage専用で、キーは `nebiki-helper/summer-area-count-records-v1`。
- サイクル選択と当日ロックのキーは `nebiki-helper/demand-cycle-state-v1`。
- 時間固定モードの選択と当日ロックは `nebiki-helper/fixed-time-demand-cycle-state-v1`。本番キーと相互に変更しない。
- 夏履歴は別端末へ自動同期されず、ブラウザデータを削除すると失われる。
- 完了済み日の夏履歴は日次JSONにも含まれる。
- 20時30分まで完了していない日の夏履歴は、端末内履歴だけに存在する可能性がある。
- Supabase SQL、列、`dataSchemaVersion` は需要サイクル対応では変更していない。
- 9段階対応でもSupabase SQL・列・`dataSchemaVersion` は変更しない。固定時間モードは人間評価rawを含む本番履歴・日次保存・Supabaseを読み書きしない。

## 分析データ

- 新規完了エリアでは `rateDecisionSnapshot` が実表示率の正本。
- `completed*` は画面表示・旧データ互換用。
- エリア完了後に時計が進んでも `rateDecisionSnapshot`・`completed*`・保存用完了サマリーを再計算しない。
- 完了画面の値引率一覧だけは最終確認用途のため、確定済み判定を維持し、現在時刻の既存時間補正で動的に再計算する。表示値はセッション・日次データ・エクスポートへ書き戻さない。
- 旧完了データにスナップショットがない場合は `legacy_not_captured`。架空の値を作らない。
- セッション `basis` は完了保存時に `basisCapturedAt` とともに固定し、エリア率の正本には使わない。
- 日次品質は `processComplete` と `measurementComplete` を分離する。
- `humanEvaluationDetails` はraw score・選択順・scale・解決値と理由を保持する。`decisionBasis` へ重複保存しない。

## 19:00チェックの人間評価と中央値評価

- 各対象エリアは、19:00実残数と共通5ボタンによる人間9段階raw評価が揃って完了する。除外エリアには要求しない。
- 人間評価は売場を見た担当者の観測値であり、ground truthではない。数値と感覚が矛盾しても、どちらも入力どおり保持する。
- Review19では偶数scoreを値引用5段階へ解決しない。`humanEvaluationDetails` のscore・selection・scale 9が正本であり、`resolutionDirection: "not_applicable"`、`resolutionReason: "review19_observation"`、`sessionDiscountTime: "19"` を保存する。
- 新規の奇数scoreだけは完全一致する既存 `humanEvaluation` を互換用に併記する。偶数scoreでは丸めた `humanEvaluation` を作らない。旧 `humanEvaluation` だけの記録はscale 5・奇数scoreとして論理deriveし、保存済みデータ自体は更新しない。
- 過去の19:00チェック残数だけを一時的な19時履歴として既存中央値エンジンへ渡し、中央値ベースの5段階評価を別センサーとして保存する。当日自身は母集団へ含めない。
- `normal` / `summer` を混ぜず、既存の同曜日3件優先・曜日グループfallback・祝日例外を維持する。`summer` は今年を短期、前年以前を長期として分離する。
- 履歴不足は `autoEvaluation: null` と `autoEvaluationStatus: "insufficient"` であり、「普通」を代入しない。
- エリア別の正本は `areaEvaluations[areaId]`。`humanEvaluationDetails`、互換 `humanEvaluation`、`autoEvaluation`、`autoEvaluationStatus`、`autoEvaluationBasis` を19:00個別出力、日次スナップショット、統合JSONから追跡できる。
- 自動5段階評価、中央値、件数、基準は入力画面にも完了画面にも表示しない。Work/Data Analyticsで human raw evaluation / median-based five-level evaluation / later outcome・discard を比較するためのデータである。
- 旧 `ratingStatus` / `ratings` / `ratingScores` は「減りすぎ／残りすぎ」の旧評価で意味が異なるため再利用しない。これら旧rating系から人間評価を推測・補完しない。
- 時間固定モードは本番19:00履歴を読み込まず、本番履歴・Supabase・本番日次データへ保存しないため、自動評価は履歴不足になる。

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
- 新しいscale 9詳細はセッション、日次スナップショット、19:00個別、日次個別、統合JSONでroundtripする。旧scale 5は保存済みデータを変更せず、出力用cloneだけへ奇数scoreとしてmaterializeする。

## Supabase

- `area_count_records` は残数履歴の最小列だけを使用する。
- 通常サイクルの端末内 `AreaCountRecord` は `humanEvaluationDetails` を持つが、Supabase送信rowへraw詳細の列は追加しない。したがって通常履歴のraw詳細は完了済み日次スナップショット／JSON exportがdurable正本であり、Supabaseの最小履歴だけからは復元できない。
- 9段階対応によるSQL変更はなく、`dataSchemaVersion` は `3` のまま。SQL Editorで追加作業は不要。
- 以前の最小列migrationが未適用の環境だけは、従来どおりbackup → migration → verifyの順でSQL Editorから手動実行する。
- 問題時はrollbackを使用する。リモートSQLを自動実行しない。

## 確認コマンド

README記載の全 `check:*`（特に `check:human-evaluation-9scale` と `check:review19-human-auto`）、TypeScript型チェック、`npm run build` を実行する。PWA生成物は `dist/manifest.webmanifest`、`dist/sw.js`、`dist/registerSW.js` を確認する。今回の実行結果は変更報告を参照する。
