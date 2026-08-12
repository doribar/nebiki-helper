# productionAnalysis checkpoint取得修正 変更報告

作成日: 2026-08-12（JST）

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260812-0051.zip`
- 基準appVersion: `2026.8.9-4`
- appVersion: `2026.8.9-5`
- buildId: `build-20260812-082404-jst`
- dataSchemaVersion: `3`

## 修正概要

2026.8.9-4の `productionAnalysis` は、15時・17時のcheckpointを人間が手動エリア判定した場合だけ有効にしていました。このため、履歴に基づく自動5段階判定へ納得して変更しなかった正常な運用でも、15時／17時がmissingとなり、19時の人間評価が存在しても `productionShortageSuspicion` が `insufficient` になる問題がありました。

2026.8.9-5では、15時・17時にそのsessionの値引判断へ最終的に採用された5段階エリア判定をcheckpointの正本とします。

- 自動中央値判定をそのまま採用: 最終5段階を使用し、`source = "history"`
- 人間が手動変更: 変更後の最終5段階を使用し、`source = "manual"`
- 19時: Review19の人間観察raw評価だけを使用し、`source = "human_review19"`

15時・17時に手動変更がないことだけを理由に `insufficient` にはしません。19時の中央値 `autoEvaluation` は従来どおり人間評価の代用にしません。

## checkpointの保存形式

既存 `productionAnalysis` version 1を維持し、optionalな情報を追加します。

- `checkpointEvaluations["15" | "17"]`: 実際に採用した5段階エリア判定
- `checkpointSources["15" | "17" | "19"]`: `history / manual / human_review19`
- `checkpointScores`: 人間raw 9段階が存在するcheckpointだけを保持
- `checkpointSourceScale`: 人間評価のscaleが存在するcheckpointだけを保持
- `checkpointStatus`: `recorded / missing / excluded / not_measured / session_missing`

15時・17時のmanual checkpointでは、既存 `humanEvaluationDetails` のraw 9段階とscaleを保持します。history採用時には、ユーザーが入力していない人間raw scoreやscaleを生成しません。automatic evaluation、manual evaluation、resolved final evaluationの既存情報も上書き・削除せず、`productionAnalysis` はそれらからderiveするだけです。

## 少ない側と強度

15時・17時は最終採用5段階を使用します。

- `few / slightly_few`: 少ない側
- `normal`: 普通
- `slightly_many / many`: 多い側

19時はReview19 human raw scoreを使用します。

- `1 / 2 / 3 / 4`: 少ない側
- `5`: 普通
- `6 / 7 / 8 / 9`: 多い側

3 checkpointが全て有効な場合だけ、従来どおり以下を適用します。

- 少ない側 3/3: `strong`
- 少ない側 2/3: `medium`
- 少ない側 1/3: `weak`
- 少ない側 0/3: `none`

15時session、17時session、19時Review19、対象エリアの最終採用判定、19時human評価のいずれかが欠ける場合、またはexcluded／not measuredの場合は `insufficient` です。2/2や1/1から強度を推測しません。

## 旧データ互換

- 既存5段階human評価は `few / slightly_few / normal / slightly_many / many` を `1 / 3 / 5 / 7 / 9` へ論理deriveし、`humanEvaluationScale: 5` を維持します。
- 2026.8.9-4で保存された `productionAnalysis` は、新しいoptional mapがなくても読込み可能です。
- 旧snapshotに最終採用5段階とsourceが明示されている場合は有効checkpointとして安全に再deriveします。情報がなければ推測せず `insufficient` とします。
- 過去recordの物理書換えや、history checkpointへの架空raw score追加は行いません。

## 変更しない仕様

- 19時はReview19 human observationのみ。中央値autoEvaluationは分析用の別観測のままです。
- 雨・雪でもrawな製造不足疑いを消去・弱体化しません。`analysisWeatherContext` と併読します。
- `calendarContext`、実曜日、祝日条件、採用reference、comparison modeは変更しません。
- 値引率、`areaRateAdjustment`、商品属性補正、天候補正、温度快適度、夏季中央値、完了画面の現在時刻連動表示、20時30分の最終値引は変更しません。
- normal／summer別export、Review19 export、daily／統合JSONの既存経路を維持します。追加checkpoint metadataも同じ経路で保持します。
- Supabase cloud sync、JSONB rich merge、pending、retry、CAS、in-flight guard、backfill、fixed-time隔離を変更しません。

## Supabase / DB

- SQL変更: なし
- migration追加: なし
- column／table／unique key／index／trigger／RLS／policy変更: なし
- 既存 `record_details jsonb` と `review19_records.payload jsonb` のoptional metadataで保存可能です。
- `dataSchemaVersion` は、version 1のanalysis metadataへの後方互換なoptional追加であるため `3` を維持します。

## 変更ファイル

- `src/domain/analysisMetadata.ts`
- `scripts/check-analysis-metadata.ts`
- `scripts/check-refactor-characterization.ts`（optional checkpoint metadataを含むexport固定値を更新）
- `README.md`
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_20260812_PRODUCTION_CHECKPOINT.md`
- `package.json`
- `package-lock.json`
- `dist/**`（確定したappVersion／buildIdによる既存アプリの本番build成果物）

## テスト

専用回帰では最低限、以下を確認します。

- 15 history few + 17 history few + 19 human score1 = `strong`
- history／manual／human_review19のsourceを区別
- 17時のauto normalをmanual fewへ変更した場合、final few／manualを採用
- 17時のhistory fewを変更しない場合、final few／historyを採用し、人間rawを生成しない
- 15 normal + 17 slightly_many + 19 score8 = `none`
- 19時human欠損 = `insufficient`
- manual時のraw 9-scale／scale保持
- 旧scale 5と2026.8.9-4形式の後方互換
- weather／calendar／normal-summer export／Supabase／Review19／9-scale／20:30／temperature comfort／done screenの既存回帰

実行結果:

- productionAnalysis専用テスト: `19 / 19` 成功
- 全 `check:*`: `30 / 30` 成功
- TypeScript: `npx tsc -b --pretty false` 成功
- 変更対象ESLint: `src/domain/analysisMetadata.ts`、`scripts/check-analysis-metadata.ts`、`scripts/check-refactor-characterization.ts` の全て成功（error 0）
- production build: `NEBIKI_BUILD_ID=build-20260812-082404-jst npm run build` 成功（Vite 8.0.0、85 modules transformed）
- PWA generateSW／生成物確認: 成功（precache 10 entries、`dist/sw.js` と `dist/workbox-9c191d2f.js` 生成、現行JS/CSS assetを参照）

## 未解決事項

なし。実運用データの物理migrationやDB作業は不要です。
