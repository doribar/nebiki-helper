# 2026.8.9-36 変更報告

検証日: 2026-09-30 JST

## 変更内容

AreaCountの値引判断用履歴をnormal/summerで分離せず、通年共通へ変更した。保存や分析用の需要サイクルmetadataは残す。6/30→7/1、9/30→10/1に履歴が突然利用不能にならず、従来normalのrolling16/52で直近変化へ追従する。

### 9-36: AreaCount判断用履歴は通年共通

- `getAreaCountRecommendation()` はnormal/summer両方の履歴を参照する。過去日と当日の取得、減り方の前時刻lookupからcycle filterを外し、summerの当年short/前年以前long分離も廃止した。両cycleとも同一比較条件の直近16件をshort、直近52件をlongへ使う。履歴の並びは従来normalと同じrecordedAt順で、当日・未来日は過去中央値へ入れない。
- 同曜日3件以上を優先し、未満なら現行group、groupも3件未満ならinsufficient。混在normal2+summer2なら同曜日4件。short < longの場合だけ `max(short, long-2)` を採用し、group fallbackはguardなし。三連休の50/50合成、4日以上連休内部17時の比較先、Obon/calendarは維持する。
- 新しい `dedupeLatestAreaCountCalculationRecordsByDateAreaTime()` は計算時だけ同一営業日・area・時刻を1観測へ寄せる。保存identity内の既存canonical mergeを再利用し、recordedAt、sessionStartedAt、richness、deterministic fingerprintで正式な観測を選ぶ。3件以上の同identityコピーも入力順で結果が変わらないようraw copyを安定順序へ並べてからmergeする。異なる保存identity間でmetadataを補完せず、選んだ観測自身のcycle/decisionを保持する。入力と保存済みrecordは書き換えない。
- 減り方補正の過去時刻間sampleと当日前時刻は通年のcanonical観測から取得。対象area、20ポイント差、1段補正は維持する。20:30の参照中央値も同じ母集団を使うが、30/40/50型、40/50型、all50、個数別の業務ruleは非変更。
- `buildReview19HistoryStatistics()` へ渡す過去Review19由来の一時AreaCountも両cycleを含め、各recordの元cycleを保持する。この一時recordは保存しない。結果は引き続き履歴統計だけで、廃止済みautoEvaluationを生成しない。正式なhuman raw9、tap-toggle、完了、JSON形式、productionAnalysisの判定定義は非変更。
- 保存・archive・remote identity・Supabase `demand_cycle`・session/snapshot/Review19/rateDecisionSnapshot/exportはnormal/summer metadataを維持する。remoteは従来のcycle別2queryをmemory mergeする方式で、production local-first/失敗時継続/fixed-time READ ONLYは非変更。normal/summer別JSON exportも維持する。
- 履歴説明は「同じ曜日の記録」「短期中央値」「長期中央値」等の共通文言。夏の手動残数noteは「残数基準で手動判定します。」、mode ON/OFF確認は共通履歴を使う旨へ変更。実際の夏専用reference label・human even解決・summer17 dry快適上限-10%・7/1〜9/30 gate/lockは維持する。


## 変更ファイル

- `src/domain/areaCountHistory.ts`: 計算専用canonical化、過去/当日/減り方のcycle filterと夏年分離撤去、履歴文言共通化。
- `src/domain/review19Evaluation.ts`: 参考履歴統計へ両cycleを渡し、各recordの元cycleを保持。
- `src/components/screens/AreaJudgeScreen.tsx`: 手動残数noteの共通文言。
- `src/components/screens/StartScreen.tsx`: 夏ON/OFF確認の履歴説明を実態へ合わせた。
- `scripts/check-area-count-year-round.ts`: 通年共通化専用testを追加。
- `scripts/check-demand-cycle.ts`, `scripts/check-fixed-time-supabase-read.ts`, `scripts/check-review19-human-auto.ts`, `scripts/check-analysis-metadata-ui.ts`, `scripts/check-long-holiday-reference.ts`, `scripts/check-summer-mode.ts`: 今回変更する履歴参照/表示の期待だけを更新し、保存・export・夏固有の保証を維持。
- `package.json`, `package-lock.json`: version36、専用check登録。依存関係は非変更。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

## 維持したもの

AreaCount保存identityとSupabase unique key、archive/outbox/pending/local-first/fixed-time隔離、history canonical/backfill責務、過去互換、全需要cycle metadataとcycle別exportは非変更。夏17時のhuman中間評価・dry快適上限、gate/lock、通常基本率/weather/global/商品policy/quick/先行値引/冷惣菜、20:30業務rule、Review19 raw9/tap/completion/download、productionAnalysisの判定定義、calendar/weekday group、schema3を維持する。過去recordの移行・統合・削除やSQL変更は行わない。

## 検証

- 全 `check:*` **66/66 PASS**。package.jsonの全check名と実行集合一致。今回専用: `AreaCount year-round checks passed: 44/44`。
- 専用testは両cycle参照、mixed2+2、rolling16/52、年分離撤去、6/30→7/1・9/30→10/1、long guard/group、cycle跨ぎ重複/最新revision/richness/入力順/非破壊、減り方、20:30、Review19参考統計、cycle metadata/別export/Supabase payload、夏固有のmanual/weather/gateを検証する。
- 実9-35/9-36エンジンのnormal単独・重複なし **3840ケース**でrecommendation全体が一致。calendar境界、時刻、area、sample数、count閾値、減り方を含む。証跡 `calculation-comparison36.json`。
- TypeScript / production build / PWA generateSW PASS。101 modules、precache10。既存のchunk size/Browserslist data警告あり。
- focused ESLint **1 errors / 0 warnings**、新規0。全体lint **9 errors / 7 warnings**。9-35とfile/rule/severity/message比較で新規diagnostic0（message内の絶対rootだけ統一）。既存診断は今回修正しない。
- Microsoft Edge production preview（headless、390×844）**23項目 PASS**。normalでsummer履歴、summerでnormal履歴、混在2+2/重複、履歴不足説明、area→rate、保存/完了/reload、mode境界の前日record参照を検証。境界fixtureは前日と同じ比較条件を明示的weekday overrideで維持し、曜日groupの変更とcycle参照の変更を切り分けた。
- browserではAreaCountのlocal-first journal、migration後IndexedDB、日次snapshot/rate snapshot/sessionのcycle・appVersion/buildId/schema、元履歴非破壊を確認。横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/downloadは0。SWをブロックした隔離検証環境の警告は別計上。
- 準備中に減り方の数学的20ポイント境界（40%→60%）で既存の浮動小数点丸めにより補正なしになるケースを観測した。9-35の同条件でも同結果で、今回は判定式を変更していない。詳細はbrowser報告を参照。
- production97 source中93本が9-35とbyte-identical。hook/router/storage/remote/archive、productionAnalysis、weather/rate/quick/coldDeli/fixed-timeは非変更。SQL9本、過去CHANGE_REPORT、version/build生成方法、schema3、依存関係を維持。
- AGENTS.mdは9-35 release後にユーザーが承認したversion名release規則を含む現行版とbyte-identical。9-36で編集していない。9-35 ZIP内の旧時刻名規則へ戻していない。
- GPT-6.1 Sol / Ultraのみ使用（並列agentを含む）。

未確認: 実Supabase通信、インストール済みPWA、実店舗データ・物理端末、長時間background復帰。browserは隔離した合成履歴と固定時計による検証。

証跡: `work/areaCountYearRound36/checks.json`, `check-area-count-year-round.log`, `baseline-comparison36.json`, `calculation-comparison36.json`, `lint-comparison36.json`, `browser-work/browser-results36.json`。ZIP再open検査とSHA-256は外部release報告/検査JSONに記録。

## Release

- appVersion: `2026.8.9-36`
- buildId: `build-20260930-170743-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-2026.8.9-36.zip`
- baseline ZIP: `nebiki-helper-20260928-2206.zip`
- baseline SHA-256: `726198bd1678c96e88135c3a77f7006d146c9a7848824775e869fff34b08f2a7`
