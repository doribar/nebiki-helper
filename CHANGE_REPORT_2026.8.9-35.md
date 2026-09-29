# 2026.8.9-35 変更報告

検証日: 2026-09-28 JST

## 変更内容

19時チェックの人間評価を、普通のタップで選択・解除し既存「完了」で確定する方式にした。既存5buttonの単独1/3/5/7/9と隣接2項目2/4/6/8という意味は変えない。最後の選択を解除すると未選択となり「完了」は無効。記録済みエリアの編集でも古い評価を復活させず、確定前に正式記録を削除しない。

### 9-35: Review19だけタップで選択・解除

- 共通selectorへ明示的に `interactionMode="tap-toggle"` を指定するのはReview19のみ。未指定のAreaJudge/Rate手動判定は従来の単独タップ確定・500ms長押し中間評価を維持する。layoutは操作仕様の条件にしない。
- 5つの既存buttonをタップすると選択/解除する。単独または隣接2つだけ有効。非隣接・3つ目の未選択項目はdisabledで、既存選択を置き換えない。選択済みは解除でき、色・枠・aria-pressedで両方を表示する。
- `createHumanEvaluationSelection()` で従来のscore9/選択順へ変換。tap側はclickだけで `onSelectionChange(selection | null)` を呼び、長押しタイマー・振動・中間モードを開始しない。移動/cancel/ghost click保護を共用する。Review19 selector内のtouchstartは親swipeへ渡さない。Enter/Spaceもnative button clickで同じ変更となる。
- 画面内の既存draftはarea/session key付きで `details: HumanEvaluationDetails | null`。同じkeyのnullは明示的全解除を表し、保存済み値へのfallbackをさせない。未編集（draft key不一致）は既存recordを表示する。全解除だけで正式記録を削除しない。
- 有効な残数と評価が揃ったときだけ既存「完了」で確定。選択だけではonCompleteArea/onSave/次エリア移動は起こさず、既存の最終エリア保存payloadを維持する。画面内下書きと保存済み値の区別、戻る/スキップ/修正/reloadの従来復元範囲は維持。新しい永続field/keyはない。
- 短い案内は「タップで選択・解除。迷う場合は隣り合う2つを選択。」。Review19には「中間選択をやめる」を表示しない。raw9・scale・resolutionReason=review19_observation / resolutionDirection=not_applicable・旧5段階互換・JSON形式は非変更。


## 変更ファイル

- `src/components/common/HumanEvaluationSelector.tsx`: 明示的tap-toggle mode、nullableな選択変更callback、追加可能項目の制限。既存default long-pressを維持。
- `src/components/screens/Review19Screen.tsx`: mode指定、nullを含む既存draft、selector gestureと親swipeの分離、短い説明。
- `scripts/check-review19-tap-selection.ts`: 41件の実component event検証を追加。
- `scripts/check-human-evaluation-9scale.ts`, `scripts/check-review19-human-auto.ts`: Review19の旧長押し前提を今回の仕様へ更新。
- `package.json`, `package-lock.json`: version9-35、package.jsonへ専用check登録。依存関係は非変更。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

## 非変更領域

Review19の人間評価変換・確定保存・過去5/9段階読込・JSON/history/schema3・productionAnalysis・統計は非変更。廃止済みのReview19自動評価は復活させない。通常値引・天候/global・calendar/reference・AreaCount・商品policy・先行値引/冷惣菜50%上限・Supabase/SQL/AGENTSも非変更。新しい永続field/key/migrationはない。

## 検証

- 全 `check:*` **65/65 PASS**（既存64 + 今回専用1）。package.jsonの全check名と実行結果の集合一致。
- `check:review19-tap-selection` **41/41 PASS**。実TSXと既存domainを読み込むstate/effect/event harnessで、単独5種、隣接4ペアの両順序、各解除、全解除、不正追加、pointerup/click二重発火なし、長押しタイマー非起動、残数validation、既存評価の編集、全解除のnull保持、完了payload、戻る/スキップ/修正とarea/scope分離、従来long-pressを確認。DOM文字列の確認だけでなく実handlerと再描画を実行する。実ブラウザのnative event検証は別途下記。
- human 9-scale **15/15**、Review19 human/history **31/31 PASS**。既存互換・保存/archive/outbox/export・productionAnalysis・通常rate・先行/冷惣菜・fixed-time等のcheckもPASS。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLintは **3 errors / 3 warnings**（Review19Screenの既存診断のみ）、新規 **0**。変更selectorとtest3本は0 errors/warnings。全体lintは9-34と同じ **9 errors / 7 warnings**。file/rule/severity/message比較で新規・消失diagnostic **0**（message内の作業root絶対pathだけ統一）。既知lint修正は今回の範囲外。
- Microsoft Edge production preview（headless、390×844）**18項目 PASS**。マウスとタッチそれぞれ単独5種+隣接ペア8順序、解除/全解除/無効選択、Enter/Space、700ms touch hold、pointercancel、縦横gesture、短い間隔の操作、戻る/修正/スキップを確認。gesture後も同じactive areaであることを確認。
- ブラウザでmouse/touch各12エリアを完了し、単独/中間raw9・選択順・scale・Review19 resolutionをJSONとIndexedDBで確認。完了直後とreload後の計4downloadをparse・比較。Review19 auto判定の再生成なし。AreaJudge/Rate手動画面は499msでidle、500msで従来中間モードになることも実ブラウザで確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/popupは0。6件の既存Review19自動遷移alertと4件のJSON downloadは意図した操作。Service Workerブロックによる検証環境警告10件は別計上。入力・隣接2項目選択・完了の画像も目視確認。
- 9-34 ZIPとのbyte比較: production97 source中95本同一。変更はselectorとReview19画面のdraft型/selector表示blockだけ。Review19確定/移動関数、humanEvaluation変換、hook/router/storage、他画面、swipe hook、全domainは非変更。
- SQL9本、AGENTS.md、過去CHANGE_REPORT全件、version/build生成方法・schema3は9-34とbyte-identical。依存関係は非変更。
- GPT-6 Astra / Ultraのみ使用。

未確認: 実店舗端末の物理タッチ、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計によるソフトウェア自動検証。保存互換は既存testと隔離されたブラウザarchive/exportで検証した。

証跡: `work/review19Tap35/checks.json`, `check-review19-tap-selection.log`, `baseline-comparison35.json`, `lint-comparison35.json`, `browser-work/browser-results35.json`, `browser-work/BROWSER_REPORT_35.md`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONへ記録。

## Release

- appVersion: `2026.8.9-35`
- buildId: `build-20260928-215944-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260928-2206.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260927-1115.zip`
- baseline SHA-256: `dd4d657cc5723a1f1cfeedbb250d7847cf093b8cdd5a7be419e11e11f1a09bf6`
