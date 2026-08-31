# 値引ヘルパー 2026.8.9-18 CHANGE REPORT

作成日: 2026-08-30（JST）  
基準ZIP: `nebiki-helper-20260830-1125.zip`  
基準appVersion: `2026.8.9-17`  
`appVersion`: `2026.8.9-18`  
`buildId`: `build-20260830-215459-jst`  
`dataSchemaVersion`: `3`

## 1. 変更した3点

### 全体値引補正の説明文を削除

StartScreenの「全体値引補正」は `-5% / なし / +5%` の3ボタンをそのまま残し、ボタン下の次の説明だけを削除した。

- 通常の値引率へ最後に5ポイント加減する旨
- 20時30分の固定値引には適用しない旨
- fixed-time専用という補足suffix

`globalDiscountAdjustmentPercent`、-5／0／+5 percentage points計算、0〜50 clamp、session開始時capture、日付reset、production／fixed-time保存分離、rate snapshotの補正前後、20:30 forced 30／40／50およびforced 50除外は変更していない。

### 夏季「迷ったら…」の境界表示を正本へ一致

内部の `resolveHumanEvaluationForDiscount` を確認した結果、判定ロジックは修正前から正しかった。

- normal: sessionの15時だけ少ない側、17時以降は多い側
- summer: JST 18:00未満は少ない側、18:00以降は多い側

旧UIはsummer 18時前に通常15時案内と夏季パネルを重ね、18時以降は通常用17時案内へ戻っていた。9-18はRateDisplayが既に持つ `demandCycle` をJudgeHintDialogへ渡し、モード別に次の1組だけを表示する。

- 通常: `15時 → 少ない側`、`17時以降 → 多い側`
- 夏季: `15時・17時 → 少ない側`、`18時以降 → 多い側`

内部resolution、raw9、even score、finalEvaluation、値引率計算は変更していない。

### アウトパック案内を削除

JudgeHintDialogから「アウトパック → 多い側に寄せる」案内だけを削除した。次の既存案内は維持する。

- 大パックだけ値引
- 期限が近いものだけ値引

アウトパックに関係し得る他のロジック、型、保存データは変更していない。

## 2. 非対象／互換性

- AreaCount中央値、Review19、productionAnalysis、weather／temperature、normal／summer履歴分離、Obon、global adjustment計算、20:30 forced rate、fixed-time、Supabase sync、AreaCount direct backfill、Review19 lightweight outbox、IndexedDB archive、localStorage headroom対策は変更なし。
- Supabase migration／table／column／index／trigger／RLS／grant変更なし。
- SQL artifactは基準9-17と9/9 byte-identical。
- record schema変更なし。`dataSchemaVersion=3`を維持。

## 3. test結果

- 全 `check:*`: `50/50 PASS`
- `check:summer-mode`: `16/16 PASS`
- `check:human-evaluation-9scale`: `15/15 PASS`
- `check:analysis-metadata-ui`: `11/11 PASS`
- `check:global-discount-adjustment`: `10/10 PASS`
- storage／headroom、Review19、AreaCount、fixed-timeを含む既存全check: `PASS`
- TypeScript／production build／PWA generateSW: `PASS`
- changed-file ESLint: `0 error / 0 warning`

## 4. browser確認（390×844）

実ブラウザで固定時刻fixtureを入力し、RateDisplayの「迷ったら…」を開いて確認した。

- fresh start: appVersion `2026.8.9-18`、補正3ボタン表示、説明文なし、`scrollY=0`
- normal 15時: `15時=少ない側 / 17時以降=多い側`
- summer 17時: `15時・17時=少ない側 / 18時以降=多い側`
- summer 18時30分: 同じ夏季境界を表示し、18時以降が多い側と読める
- アウトパック案内なし
- 大パック／期限が近い案内あり
- viewport `390×844`、document `scrollWidth=clientWidth=375`、横overflowなし
- console error／warning `0`

実Supabase mutationは行っていない。今回の変更に通信／DB経路は含まれない。

## 5. release確認

- 完成ZIP: `nebiki-helper-20260830-2157.zip`
- production `dist`にappVersion／buildIdを埋め込み
- SQL 9ファイルを基準ZIPとbyte比較
- 完成ZIPを生成後に再openし、testzip、重複、backslash、traversal、single root、nested ZIP、node_modules、cache、env、credential、dist／PWA artifactを検査
