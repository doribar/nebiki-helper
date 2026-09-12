# 2026.8.9-24 変更報告

検証日: 2026-09-12 JST

## 実装内容

通常Done画面へ共通基準ラベルを追加し、通常15時・17時の天候確定後へ先行値引指示画面を追加した。

DoneScreenはAppRouterから `derived.basisGuide.referenceConditionLabel` を受け取る。RateDisplayと同じ既存 `getBasisGuideDisplay()` → `getIndividualAmountReferenceContext()` → `formatReferenceConditionLabel()` の解決結果であり、summer / normal、manual weekday override、holiday / Obon等のresolved referenceを尊重する。formatterの重複実装はない。既存表示時刻補正を含むbasisGuideを共用する。Review19DoneScreenは非変更。

新componentは `AdvanceDiscountScreen`、screen名は `advance_discount`。通常の新規15/17sessionで、天候の「この内容で確定」後に次の形式の指示を表示する。

> 夏・木曜日・17時を基準に考えて  
> 多い商品のうち10個以上ある商品を  
> 10％で引いてください

labelと率はsessionに応じて動的表示する。「多い」は既存RateDisplayと同じ赤 `#ff0000`。本文は18px / font-weight 700、率も赤。既存の枠・余白・PrimaryButtonに合わせ、商品・残数・評価の入力欄は作らない。「温惣菜」などの説明は追加していない。

操作は **エリア別値引へ進む**。18:30 / 19:30 / 20:30 / Review19 / fixed-timeには新画面を表示しない。

## 先行率の計算

pure helper `getAdvanceDiscountRate()` は次を共用する。

- `getBaseRate()`: 15時0%、17時10%の基本率。
- `getWeekdayBaseInfo(...resolvedWeather...).baseRateBonus`: 既存の天候・未来天候・気温快適度補正。hookの既存 `sessionSourceResolvedWeather` を渡し、温度snapshotも尊重する。
- `normalizeGlobalDiscountAdjustmentPercent()` / `applyGlobalDiscountAdjustmentToRate()`: sessionへcaptureされたglobal -5 / 0 / +5を最後に1回加算し、既存共通0〜50%制限を適用。

計算式は **基本率 + 解決済み天候補正 + 商品が多い固定10 + global補正**。例の `10 - 5 - 5 + 10 = 10%` をtestと実ブラウザで確認した。新画面では0以下も必ず「0％で引いてください」と表示し、既存エリア画面の「引かない」表示は変更しない。

session入力はdate / weekday / discountTime / globalだけに限定する。AreaCount、area評価・補正、quick、decrease、median、エリア別履歴、商品個別policyを参照しない。late-time / early-next補正も新画面の式へ加えない。fake area manyによる計算やmetadata生成はない。既存の基本率・weather・global・商品policy・rate limit本体は変更しない。

## 遷移・保存・復帰

- `startSession()` が既存session・温度解析・ルートを準備した後、新規の通常15/17だけscreenを差し替える。初回15時、初回17時、15→17の切替が対象。
- 押下まで指示画面を保持し、`continueAfterAdvanceDiscount()` が既存current area / `getNormalFlowScreenForArea()` で元の入口へ進む。area欠損時も既存の残りエリア探索 / doneへfallbackする。
- 既存current session / checkpoint / runtime保存でpendingと通過後を復元する。新しいstorage key・永続flag・schema versionは追加しない。
- 指示中の条件編集は `resolveResumeState()` が指示へ戻す。既存のarea作業・Doneから条件編集する同sessionは再表示せず元の作業へ戻す。
- continueはscreenとnavigation履歴だけを処理。同じdate / discountTime / startedAtの指示・指示への復帰先だけを履歴から除外し、他session・通常作業履歴を保持。重複callbackはno-op。
- sessionと未完了area mapを変えず、通過だけでAreaCount・架空評価・完了実績・新しいDailySessionSnapshotを作らない。既存snapshot / finalized / export責務を維持する。
- 17時の指示待機中に18:55以降になった場合は既存Review19優先処理・未測定source / snapshot保全・失敗時保持を使用する。

## 非変更領域

9-23 quickのhigher→lower順と保存semantic、17→Review19、18:30 manual onlyと開始日のReview19抑止、Review19 download、summer / normal、weather / future weather / temperature、global、median / decrease、weekday / calendar、human evaluation、productionAnalysis、product policy、fixed-time、20:30 forced 50%、IDB / localStorage、Supabaseは非変更。

SQL / Supabase / RLS / grant / trigger変更なし。root SQL 9本とAGENTS.mdは9-23 baselineとbyte-identical。dataSchemaVersionは3のまま。

## baseline・version

| 項目 | 値 |
| --- | --- |
| baseline | 2026.8.9-23 |
| baseline ZIP | nebiki-helper-20260910-1420.zip |
| baseline SHA-256 | 643334f3c117f3eb5d60bba961254c11972e6017440339b356d45506521dfc14 |
| appVersion | 2026.8.9-24 |
| buildId | build-20260912-171652-jst |
| dataSchemaVersion | 3 |
| release ZIP | nebiki-helper-20260912-2229.zip |

baseline ZIPのSHA・testzip確認後、新しいworking copyへ展開した。Git repositoryは存在せず、baseline ZIPのfile / bytes比較で差分を確認した。親・担当agentの実行記録は全てGPT-6 Astra / Ultraを確認。利用制限による中断後も、ユーザーの再開時にモデルを再確認した。

## 変更ファイル

- `src/components/screens/DoneScreen.tsx`: 基準ラベルpropと表示。
- `src/components/screens/AdvanceDiscountScreen.tsx`: 新指示UI。
- `src/domain/advanceDiscount.ts`: 既存rate処理を共用するpure helper。
- `src/domain/types.ts`: screen名、derived表示値、continue action型。
- `src/hooks/useNebikiApp.ts`: screen分岐、resolved label / rate、continue、復帰・navigation履歴処理。
- `src/app/AppRouter.tsx`: 新画面とDone labelの接続。
- `scripts/check-advance-discount.ts`: 先行率・非参照領域・limit。
- `scripts/check-advance-discount-ui.ts`: 実UIのlabel・文面・style・handler。
- `scripts/check-advance-discount-flow.ts`: 実hook action / effect、保存・復元・履歴。
- `scripts/check-review19-priority-transition.ts`: 指示待機中のReview19遷移・保存失敗保持。
- `scripts/check-refactor-characterization.ts`: 公開hook contractの新derived / actionキー。
- `package.json` / `package-lock.json`: version更新、package.jsonへ専用check3本追加。依存関係は非変更。
- `CHATGPT_HANDOFF.md` / `CHANGE_REPORT_2026.8.9-24.md`: 現行状態・本報告。
- `dist/index.html` / `dist/sw.js` / `dist/assets/index-*.js`: production成果物。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| 先行率 | 15/15 PASS |
| 先行UI・Done label | 35/35 PASS |
| 先行flow・保存復帰 | 30/30 PASS |
| 全check:* | 57/57 PASS |
| Review19 priority transition | 70/70 PASS |
| Area quick adjustment | 40/40 PASS |
| TypeScript | PASS |
| production build | PASS、101 modules |
| PWA generateSW | PASS、precache 10 entries |
| focused ESLint | 0 errors / 4 existing warnings |
| full lint | 9 errors / 7 warnings（既存） |
| full lint baseline比較 | file / rule / severity / messageで新規0 |

全57本実行後、最後に追加したflow test4件を単独再実行し30/30で証跡を更新した。既存hook依存のfocused warning、buildのchunk size・Browserslist data警告は維持。full lintをPASSとは扱わず既存diagnosticを区別した。

証跡はapplication root外の `work/advance24/checks.json`、各check log、`tested-input-hashes24.json`、`lint-comparison24.json`、`build24.log`。

## 実ブラウザ

headless Microsoft Edge production preview、390×844、Asia/Tokyo、隔離originで実操作した。

- 夏15時: 天候各欄を確認 → 確定 → 夏・木曜日・15時 / 0％ → エリア別値引へ進む → area_judge。
- 夏17時: 同じflowで夏・木曜日・17時 / 10％。global -5を反映。
- 通常17時: 木曜日・17時 / 20％。global +5を反映。
- 多いのcomputed colorは赤、進むbuttonは画面内に収まりtap正常。0％を「引かない」に変換しない。
- 指示待機中の30秒timer、focus / visibility、reloadでpending保持。通過後reloadでは再表示しない。
- 通過前後でsessionとarea mapが一致。AreaCount record・架空area評価を生成しない。
- Done完成state fixtureで夏15 / 夏17 / 通常17 / 手動曜日指定 / Obonの5ラベルを確認。実曜日が木曜でもoverride火曜、お盆は日曜referenceとなる。
- 横overflow・文字切れなし。console error / warning、pageerror、外部通信、dialog、download、popupは0件。

Doneの確認にはfixtureを使い、12エリアを完了まで実入力するブラウザ検証は今回行っていない。Review19 / manual 18:30 / quick / fixed-time / 20:30 / archive等の回帰は自動checkのみ確認。

証跡: `work/advance24/browser-results24.json`、`advance-*-24.png`、`done-*-24.png`。

## ZIP検査・未確認事項

完成ZIPを再openし、testzip、duplicate / case-insensitive duplicate、backslash / invalid / traversal、single root、symlink、nested ZIP / node_modules / cache / .env / credential、dist / PWA、version / build / schema、working treeとのfile集合・bytes一致を確認する。SQL 9本・AGENTS.mdをbaseline bytesと比較する。

最終結果とSHA-256は自己参照回避のためZIP外の `outputs/ZIP_VALIDATION_2026.8.9-24.json`、`outputs/RELEASE_REPORT_2026.8.9-24.md`、`outputs/nebiki-helper-20260912-2229.zip.sha256` に記録する。

未確認: 実Supabase mutation・全量cloud同期、インストール済みPWA実機、実店舗端末の操作・長時間background復帰。実ブラウザは隔離fixtureのproduction preview。
