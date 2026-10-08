# 2026.8.9-43 変更報告

検証日: 2026-10-07 JST

baseline: `nebiki-helper-2026.8.9-42.zip` / SHA-256 `06262897b62f1ec04f7633a2ab14b30ced6ed74ed52c112dabb34e3fa1163cc5`。

## 表示変更

`JudgeHintDialog` の本文を必須 `purpose: "product" | "manual-area"` で分けた。用途を見た目のcompact指定や画面名だけで推測しない。未使用のcompact propは削除。

- RateDisplayScreenの「多い商品」「どちらでもない商品」の両指示段階はproduct。大小パック・期限・分かれていない場合の時刻別寄せ方だけを表示し、選択肢の長押しや中間評価の記録説明を含めない。
- AreaJudgeScreenの残数入力後、履歴不足で表示されるHumanEvaluationSelectorの直前に「迷ったら…」を追加。既存の3択legacy分岐や最終値引へ長押し説明を流用しない。
- RateDisplayScreenの「自動判定を手動で変更」を展開した選択肢の直前もmanual-area。大小パック・期限・「分かれていなければ」の商品用3行を含めない。
- manual-areaは専用`ManualAreaJudgeHint`で開閉だけを管理し、評価・完了・保存のcallbackを受け取らない。Review19の観察評価と20:30には追加しない。
- 「明らかに多い場合は無理に下げず、夕方〜夜の売れ方も考慮して個別に判断します。」は両用途から削除。
- 本文の既存強調を維持。dialog内のtouchを親のエリアskipへ伝播させず、画面高を超える場合は本文側でscrollできる。通常画面のswipe/selector処理は変更しない。

指定本文は通常・夏季それぞれそのまま採用した。商品用は通常15時が少ない側、17時以降が多い側、夏季15時・17時が少ない側、18時以降が多い側。手動エリア用は同じ時刻表記の行に「2つの間で迷う場合は選択肢を長押し。中間評価として記録し、値引率は少ない側/多い側の判定で計算します。」を表示する。商品用は現場判断の案内であり、商品別の自動分類・加算減算・入力・保存を追加していない。

## 文言と処理の照合結果

単にtestの成功だけから「矛盾なし」と結論していない。選択操作→`judgeCurrentArea()`→AreaCount record / area progress→採用evaluation / areaRateAdjustment→現在率表示 / 完了rateDecisionSnapshotを追った。

- normalは元`sessionDiscountTime === "15"`ならlower、その他ならhigher。実時計が17時/18時を過ぎても手動固定15ならlowerのまま。
- summerは元session時刻ではなく、選択確定時のJST実時計18:00未満ならlower、18:00以降ならhigher。manualDiscountTimeOverrideはこのhuman方向判定を止めない。
- 500ms長押し→隣接選択でraw9=2/4/6/8と選択順を記録。4組ともlower/higherの端点評価を採用し、補正は-10/-5/0/+5/+10。2.5%などの算術平均は使わない。
- full manualは自動評価より優先され、元autoから±1段に制限しない。automatic減り方補正とquickが±1段の対象。quickは元automatic基準で非累積。
- 0〜50%制限、early-next -5、global補正の結果、方向が違っても最終率が同じになる場合がある。評価解決と率clampを分けて照合した。
- 保存済みのhuman解決値は時計tickで再計算しない。基準時刻がearly-nextへ変わっても保存raw9/解決値は保持し、現在率は保存採用値を使う。Review19はresolutionReason=review19_observationで値引計算の解決を行わない。

### 未解決の業務仕様と指定文言の食い違い

夏の静的「15時・17時は少ない側 / 18時以降は多い側」と実時計の境界は常に一致しない。業務ルールの変更を必要とするため、指定本文を独自に書き換えたり計算を変更したりして隠していない。

fixtureは2026-09-08(火)、晴れ・25℃・弱風、auto=普通、選択=普通+やや多い(raw9=6)、global=0。率は通常商品/多い商品。

| 元session / 判定時JST | 表示・保存される実処理 | 実際の表示率 |
| --- | --- | --- |
| 夏17時 / 17:59 | lower→普通、17時基準、天候-10 | 0% / 10% |
| 夏17時 / 18:00・18:01（手動固定なし） | higher→やや多い、18:30基準-5の先取り | 15% / 25% |
| 夏17時 / 18:00（手動時刻指定あり） | 17時表示のままhigher→やや多い | 5% / 15% |
| 夏18:30 / 実時計17:59（手動時刻指定） | 18:30表示だがlower→普通 | 15% / 25% |

3行目は「17時は少ない側」と実採用の多い側が食い違う。4行目は逆方向に食い違う。原因はsummer resolverがsession時刻を使わず実時計を見ること。early-nextは実時計18:00から18:30基準へ切り替え、manual overrideはそれを無効にするがhuman方向判定は無効にしない。通常の前倒し時は画面の18:30表示とhigherが合うが、手動指定でこの接続の一致は崩れる。

さらに17:59に確定済みのraw6/普通lowerを18:00に再選択せず保持した場合、effective基準だけ18:30へ変わって10%/20%になる。同時刻に新しく選び直すとやや多いhigherの15%/25%。保存値と表示率の不整合ではなく、確定時刻の解決値を維持する既存仕様。率画面の「この時間帯は…として計算」は保存resolvedを表示しており、現在の実時計で毎回再解決する説明として読むと曖昧さが残る。

## 変更ファイル

- `src/components/common/JudgeHintDialog.tsx`
- `src/components/screens/RateDisplayScreen.tsx`
- `src/components/screens/AreaJudgeScreen.tsx`
- `scripts/check-judge-hint-guidance.ts`（追加）
- `scripts/check-analysis-metadata-ui.ts` / `scripts/check-summer-mode.ts`（旧案内の期待値更新）
- `package.json` / `package-lock.json`（version / 新checkだけ）
- `CHATGPT_HANDOFF.md` / 本変更報告 / `dist/*`

production source100本中97本、humanEvaluation.ts、HumanEvaluationSelector.tsx、hook、rate engine/snapshot、保存/export/同期、fullMode注意事項、AGENTS.md、SQL9本、全過去CHANGE_REPORTは42版ZIPとbyte-identical。小パック除外の同一商品20個以上＋10％を含む7注意事項を保持。schema3・version/build生成方式・過去recordは変更していない。

## 検証

- 全check:* **79/79 PASS**。専用judge-hint-guidance **17/17**。関連analysis-metadata-ui11/11、summer-mode16/16、human9scale15/15、Review19tap41/41、AreaCount通年44/44、full-mode36/36。
- 実TSXをReact SSRで描画し、normal/summer×product/manual-areaの指定本文、混在防止、削除文、7注意事項を検証。別途production componentの継続state/event runnerで両カード・手動入口・close callback・親touch遮断を検証。これはnativeブラウザ操作とは区別する。
- 外部pipeline fixture: 隣接4組×両選択順×12時刻条件=96、quick10、automatic減り方10、clamp7、保存評価跨ぎ3。production ASTの実判定・採用関数と完了snapshot式、実median/率engineを実行。React/storage boundaryはmemory stubであり、実店舗通信・pointerの確認ではない。
- TypeScript / production build / PWA generateSW PASS。104 modules / precache10 / `/assets/index-Evw-LLFU.js`。既存large-chunk/Browserslist warningは残る。
- focused ESLint: 1 errors / 0 warnings（既存AreaJudgeのreact-hooks/set-state-in-effect1件）。full: 9 errors / 6 warnings。42版のfile/rule/severity/message比較で新規0。source座標・code-frame行番号だけを正規化し、診断本文/code tokenは保持。
- Edge最終production390×844: 8ケース、記録操作107件。通常/夏季の商品指示2段階・手動案内、開閉とstorage不変、長押し/隣接選択/cancel/swipe、summer境界の採用値と保存metadataを実ブラウザで確認。console error/warning・外部通信・横overflow0。詳細な実施項目と限界は`work/judgeHint43/browser-work/final-browser-summary43.json` / `browser-results43.json`。

ブラウザfixtureは隔離した合成履歴・時計・CDP touchを使用する。物理店舗端末、native touch、installed PWA、実Supabaseは未確認。限界の詳細: ["Isolated synthetic drafts and historical records; no production Supabase requests or mutation.", "Automated Microsoft Edge engine and CDP software touch; no physical device/native touch/installed PWA validation.", "Date-only fixed clock preserves native timers; summer boundary tests use identical input seed at17:59:59 vs18:00:00 JST."]。

## Release

- appVersion: `2026.8.9-43`
- buildId: `build-20261007-155016-jst`（既存JST生成方式）
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-43.zip`
- SQL / Supabase / AGENTS.md変更なし。

再open検査・SHA-256はZIP外の`RELEASE_REPORT_2026.8.9-43.md` / `ZIP_VALIDATION_2026.8.9-43.json` / `nebiki-helper-2026.8.9-43.zip.sha256`に記録する。ZIPとworking treeの対象file集合/bytes、path/除外物/secret、dist/PWA/version/build/schema、SQL9本/AGENTS/過去reportの同一性を検査する。
