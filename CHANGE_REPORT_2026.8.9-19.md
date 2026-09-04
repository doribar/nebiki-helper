# 値引ヘルパー 2026.8.9-19 CHANGE REPORT

作成日: 2026-09-04（JST）  
基準: 検証済み `2026.8.9-18`  
`appVersion`: `2026.8.9-19`  
`buildId`: `build-20260904-173214-jst`  
`dataSchemaVersion`: `3`

## 1. 修正概要

変更は、判定画面の参照条件ラベル統一と、履歴中央値の自動判定 `many` を人間が1段だけ `slightly_many` へ弱める高速操作の追加に限定した。値引率engine、曜日reference選択、中央値population、Review19の観測仕様、productionAnalysis、storage／IndexedDB、Supabase／SQLは変更していない。

## 2. 基準表示

### 実装方式

`src/domain/weekdayBase.ts` に共通formatterを追加した。入力は `demandCycle`、既存ロジックが解決済みの `IndividualAmountReferenceContext`、表示用discount timeであり、次の形式を返す。

- normal: `火曜日・15時`、`火曜日・17時`、`火曜日・19時`
- summer: `夏・火曜日・15時`、`夏・火曜日・17時`、`夏・火曜日・19時`

エリア手動判定、値引率表示、Review19の3画面は同じformatter結果を使う。「の」と中点を混在させず、「を基準に考えて」は対象UIから除いた。

### 参照曜日の取得元

今日の曜日をUI側で再計算していない。既存の `getIndividualAmountReferenceContext()` が祝日、祝日前日、三連休中日、お盆、曜日overrideを解決した後の `referenceWeekday`／`referenceWeekdayGroup` を表示する。したがって、祝日相当で日曜を採用した場合は日曜日、既存overrideが別曜日を採用した場合はその曜日がラベルになる。reference選択と履歴抽出条件は未変更。

Review19は保存済みのreference contextを使い、表示時刻だけ現場のチェック時刻 `19` を指定する。内部の `referenceDiscountTime` が19時30分でも、UIに「19時30分」は表示しない。保存済みreferenceは書き換えない。

## 3. `many` → `slightly_many` 1段補正

### 表示条件

`src/domain/areaEvaluationAdjustment.ts` に純粋なeligibility判定を隔離した。次をすべて満たす場合だけ `やや多いにする` を表示する。

- historyによる自動判定が成立し、`autoEvaluation === "many"`
- normalなら15時
- summerなら15時または17時
- Review19ではない

normal 17時以降、summer 18時以降、`slightly_many / normal / slightly_few / few`、履歴不足では非表示。既存の5段階フル手動判定はそのまま残した。

### 保存方式

押下時は既存9段階の単独 `slightly_many` selectionを通常の `judgeCurrentArea`／persist経路へ渡す。元の自動判定は `areaCountEvaluation`／`suggestedEvaluation`／decision basis上で `many` のまま保持し、最終採用だけ `slightly_many` になる。

人間操作の事実は、既存 `HumanEvaluationDetails` へのoptional metadataとして次を保存する。

```json
{
  "evaluationAdjustment": {
    "applied": true,
    "source": "human",
    "direction": "lower",
    "steps": 1,
    "originalEvaluation": "many",
    "finalEvaluation": "slightly_many"
  }
}
```

normalizerはauto／resolved値との整合が取れたmetadataだけを受理する。操作しなかったrecordにはこのfieldを作らないため、「補正なし」を人間の明示同意とは記録しない。旧recordはfieldなしのまま正常に読め、物理migrationはない。

### 値引率計算への接続

別のrate計算は追加していない。既存の最終採用判定へ `slightly_many` を渡すため、エリア補正は既存どおり `many=+10` ではなく `slightly_many=+5` になる。その後のweather、商品属性、全体値引補正、clamp、forced rateは従来の順序を通る。専用testでbase 20に対しmany相当30、quick adjustment後25、さらに全体+5で30になることを確認した。

## 4. 分析・後方互換

- original auto、human adjustment、final evaluationを別々に追跡できる。
- `humanEvaluationDetails` は既存session snapshot、rate decision、daySnapshot、finalized/export、AreaCount cloud `record_details` の経路を利用する。AppStateや巨大payloadの新規複製は追加していない。
- productionAnalysisは従来どおり15／17の最終採用値を使い、人間変更なのでsourceは既存semanticsの `manual` になる。19時は `human_review19` のままで、quick buttonは存在しない。
- optional field追加のみのため `dataSchemaVersion=3`。旧JSON／cloud recordは変更・migrationしない。

## 5. 変更ファイル

- `src/domain/weekdayBase.ts`
- `src/domain/areaEvaluationAdjustment.ts`（追加）
- `src/domain/types.ts`
- `src/domain/humanEvaluation.ts`
- `src/hooks/useNebikiApp.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/app/AppRouter.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/Review19Screen.tsx`
- `scripts/check-reference-label-quick-adjustment.ts`（追加）
- `scripts/check-refactor-characterization.ts`
- `scripts/check-analysis-metadata-ui.ts`
- `package.json`、`package-lock.json`
- `README.md`、`CHATGPT_HANDOFF.md`、本CHANGE REPORT
- production buildの `dist`

## 6. test結果

- 全 `check:*`: `51/51 PASS`
- 新規 `check:reference-label-quick-adjustment`: `29/29 PASS`
  - normal／summer 15・17・Review19のexact label
  - Review19に19時30分／旧説明文が出ないこと
  - holidayで既存日曜referenceを表示すること
  - quick button全表示／非表示条件
  - original many／human lower 1 step／final slightly_manyの保存
  - many +10ではなくslightly_many +5のrate path
  - 全体値引補正との合成、full manual維持、補正なし非同意
  - normalize／cloud details roundtrip、旧fieldless record互換
- `check:logic`: `91/91 PASS`
- `check:integration`: `19/19 PASS`
- `check:summer-mode`: `16/16 PASS`
- `check:human-evaluation-9scale`: `15/15 PASS`
- `check:review19-human-auto`: `24/24 PASS`
- global adjustment、forced 50、storage headroom、historical archives、AreaCount direct backfill、Review19 outbox／rescue、fixed-time READ ONLY、normal／summer／Obonを含む既存check: `PASS`
- storage write boundary: application raw write `0`
- TypeScript／production build: `PASS`（99 modules）
- PWA generateSW: `PASS`。`manifest.webmanifest`、`sw.js`、`registerSW.js`、workbox artifactを確認。
- focused changed-file ESLint: `0 error / 0 warning`
- project全体ESLint: `9 errors / 7 warnings`。9-18基準版と同一の既存指摘（未使用importと既存React hook規則）であり、今回差分による増加は0。無関係なrefactorは行わなかった。

## 7. browser確認（390×844）

ローカルproduction previewをin-app browserで確認した。

- fresh start: `2026.8.9-19`、`scrollY=0`
- viewport: `innerWidth=390 / innerHeight=844`
- document: `clientWidth=375 / scrollWidth=375`、横overflowなし
- normal 15時の手動判定で短いreference labelを表示
- normal 17時の手動判定とRateDisplayで `木曜日・17時` を表示
- summer 17時の手動判定で `夏・火曜日・17時` を表示
- normal 17時ではquick buttonが表示されないことを確認
- console error／warning: `0`

clean browserには中央値 `many` を成立させる本番履歴がなく、quick button押下の実ブラウザ確認は行っていない。押下後のrate更新は29件の自動testで確認した。Review19の全12エリア実入力も実ブラウザでは行わず、`夏・火曜日・19時`、19時30分非表示、Review19 quick button非表示は共通formatter／screen contractの自動testで確認した。未実施項目を実ブラウザ確認済みとは扱わない。

## 8. Supabase／DB／SQL

- Supabase table／column／index／trigger／RLS／grant変更なし。
- client sync、AreaCount direct backfill、Review19 lightweight outbox／direct rescue、fixed-time READ ONLY／production WRITE隔離は変更なし。
- root SQL artifact 9本は9-18基準と `9/9 byte-identical`。
- 実Supabase mutationは実施していない。

## 9. release

- 完成ZIP: `nebiki-helper-20260904-2218.zip`
- SHA-256: 完成ZIP自身へハッシュ文字列を埋め込む自己参照を避け、生成後に再openした最終報告へ記載する。
- 完成ZIPは生成後にPython `ZipFile`で再openし、testzip、duplicate、backslash、traversal、single root、nested ZIP、node_modules、cache、`.env`、credential、dist／PWA artifactを検査する。
