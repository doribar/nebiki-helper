# 変更報告 2026.8.9-63

完成62 ZIP（SHA-256 `98a54a90cb42278285c869f5de66a8d2b1b3492c0928e8630ddef63a7bb6655f`）を比較基準に作成。appVersion `2026.8.9-63` / buildId `build-20261114-135825-jst` / dataSchemaVersion `3`。

## 実装と判定の優先順

17時の残数未入力エリアを明示スキップした場合も、同じ業務日の15時で最終採用判定が多い側なら、別エリアの値引を正規完遂した後に優先復帰する。

1. `getAdoptedEvaluation`による現在17時の採用値を優先（areaCountEvaluation→保存済みhuman resolvedEvaluation→decisionBasis.finalEvaluation）。
2. 17時の採用値がなければ、同業務日・同areaの15時保存snapshotへ同じresolverを使う。
3. 得られた値がmany/slightly_manyだけ候補にする。17normal/slightly_few/fewなら15manyでも候補外。17many側なら15fewでも候補。
4. 15時sourceや採用値もなければ従来どおり。自動のbase、3段階areaJudge、count/率、未解決raw9から推測しない。保存済み中間評価を時計で再解決しない。

15時参照候補とown17候補は同じ集合へ入れ、現在地からの距離順、同距離は既存area orderで選ぶ。active/現在route/未完了/明示skipped_manual/完了したarea自身を除く条件を維持する。1段階目、判定、残数入力、スキップだけでは発動しない。既存の訂正returnを先に尊重する。

## 同日の15時source・訂正・復元

既存`getHistoricalDailySessionSnapshotsForDate(session.date)`がIndexedDB runtimeと当日local journalをidentity単位でcanonical mergeしたviewを、必要な完遂操作の時点で読み直す。対象は同日15時、doneまたはauto_time_transitionで保存済みのsnapshot。最新capturedAtのoperationを選んでからareaの採用値を読む。最新がnormal/few/欠損なら、古いmanyへ戻らない。別日・別時刻・別area、欠損areasや不一致areaIdは使用しない。保存済み15sourceがない場合は従来の一般pending/通常ルートを使う。

既存の訂正はvisitedAt/measurementRecordedAt、完遂時completedAt/confirmedAtを更新する。保存側はそのcompletion signatureが変わったsnapshotを採用し、archive/current journalの同identityでは新しいcapturedAtが選ばれる。新機能はこの既存の訂正・復元仕様を使い、保存normalizerや過去データの書換え処理を追加しない。sourceの更新をメモ化した古い値で判断しない。

専用検証では、実hook/TSXで15時Done→訂正action→残数keypad/手動選択→完遂→保存→reload/17時開始→未入力skip→別area完遂を実行した。many→normalで対象外、normal→manyで優先復帰となり、訂正後のareas/basis/capturedAtを保持することを確認した。

読出しは通常17時で、active/current routeの明示スキップにown17採用値欠損がある時だけ。通常完了、own17判定だけで足りる場合、render、最初の指示段階、固定時計では新しい履歴読出しを行わない。固定時計はproduction15snapshotを参照せず、従来のown17 priorityとREAD ONLYを維持する。実ハンドラ内のjournal read counterでも、1段階目/通常完了/own17判定のみ/fixedは0回、fallbackが必要な17時正規完遂だけ1回と確認した。

## 進行と保全

例：15時フライ・鶏惣菜がやや多い→17時残数未入力のままスキップ→焼鳥の多い商品とどちらでもない商品を完遂→フライ・鶏惣菜の17時残数入力へ復帰する。焼鳥の1段階目だけでは復帰しない。

15時の残数・判定・値引率・snapshotを17時mapへコピーしない。復帰時にも17時count/areaCountEvaluation/humanEvaluationDetails/decisionBasis/rateDecisionSnapshotは未入力のまま。既存`getPendingResumeScreen`とarea_judge/keypadへ接続する。

既存priorityReturnContextの通常再開位置を保持し、候補を完遂するたびにlive mapで次候補を選ぶ。候補が尽きたら通常ルートの続きへ戻る。候補queue・15時判定の複製・新永続field/storage keyを設けず、reload/back/undo/訂正は既存contextの復元を利用する。15時自身の優先復帰、スキップ後の自己loop防止、最後のareaのskip制限を維持。

## 変更ファイル

- `src/domain/pending.ts`：任意のsession/previousSessionSnapshotsを受け、own17→同日15の採用順で候補を判断。既存距離sort/タイ順/一般pendingは維持。
- `src/hooks/useNebikiApp.ts`：正規完遂時に必要な場合だけ既存canonical15snapshotをfresh readし、selectorへ渡す。既存の復帰・継続・保存処理を使用。
- `scripts/check-priority-previous63.ts`：専用pure/実hook/TSXイベント検証。既存priority55の13/45件は変更しない。
- package/lockのversionと専用check1本、distのindex/JS/sw、CHATGPT_HANDOFF、本報告。依存/build方法・過去報告は非変更。

src108中、変更は上記2本、残り106本は完成62ZIPとbyte-identical。採用判定そのもの、値引計算/60global順/46快適補正/62group/時刻境界/15late-many例外/注意8項目/Review19/productionAnalysis/履歴・export・同期は非変更。schema3、新migrationなし。SQL9本・Supabase構造・AGENTS.mdも変更なし。

## 検証

- 全check **102/102 PASS**、専用 **65/65 PASS**。多い/やや多い、自動history/手動/保存済み中間解決、17優先、15欠損/別日/別時刻/不明、混在距離/同距離、最新source/partial auto-transition、正規完遂/通常再開、未入力keypad、reload/back/undo/訂正、古いクリック、fixed-time隔離/READ ONLYを検証。
- 既存priority pure **13/13**、実flow **45/45**、17継続/旧先取り互換 **14/14 PASS**。既存の保証を削除していない。
- TypeScript / production build / PWA generateSW **PASS**、111modules、precache10。既存chunk500kB超・Browserslist更新案内は維持。
- full ESLint **7 existing errors / 5 existing warnings**、focused **0 errors / 2 existing warnings**。62とfile/rule/severity/message比較で新規0、増減なし。
- 独立source audit・resolver比較 **970/970 PASS**。同じsource/current fixtureを凍結して入力不変、own17優先/15fallback/日付/欠損/距離と、従来15・旧呼出しの62互換を確認。
- 実Edge production、360/390×844、人工データ/localhostで **38/38 PASS**。未入力スキップ→別area両指示段階→残数keypadへの復帰、通常続き、最新15根拠、17優先、候補混在、再読込/戻る/訂正、従来15を確認。最終bundle hashを検証し、横overflow/文字欠け/アプリconsole error・warning/不要な外部通信なし。

## 未確認事項と成果物

実店舗物理端末、インストール済みPWAのSW更新・長時間バックグラウンド運用、実Supabase通信は未確認。自動hook/TSX検証と、隔離した実Edgeエンジンでの人工データ操作を区別する。保留中の曜日文言と夏17時中間評価案内の既存不一致は変更せず、引継ぎに残す。

`nebiki-helper-2026.8.9-63.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-63.md`、`ZIP_VALIDATION_2026.8.9-63.json`を作成する。完成ZIPそのものを再openし、CRC・重複/casefold・path/除外物/秘密情報・single root・file集合/bytes・version/JST build/schema・dist/PWA・SQL/AGENTS同一性・SHA-256を検査する。
