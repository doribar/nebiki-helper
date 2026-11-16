# 変更報告 2026.8.9-64

完成63 ZIP（SHA-256 `1dbe33e9b92866a835ee2801c153b5db586d367c533e0a66f340cb238579b22f`）を比較基準に作成。appVersion `2026.8.9-64` / buildId `build-20261116-222511-jst` / dataSchemaVersion `3`。

## 変更内容

15→17時の減少率を、エリア判定の自動補正から、人間が手動補正を考える参考情報へ分離した。残数中央値の5段階判定・閾値は維持し、新17時判定ではその結果をそのまま自動採用する。減少率が良い/普通/悪いのどれでも、それだけでは採用判定・エリア補正・値引率を変えない。手動quickは元の残数判定から±1、非累積、full manual/長押しも維持する。

履歴中央値の対象は弁当・麺類、天ぷら、焼鳥、中華・魚惣菜、おにぎり、寿司、太巻・中巻、いなり、細巻きの9エリア。コロッケ系とフライ・鶏惣菜は当日の15/17推移と率だけを表示する。指定9エリアを現行対象とし、季節商品の旧保存根拠は履歴として残す。追加投入を推測した履歴除外・補完はしない。

既存の残数判定が採用した履歴、正式観測/canonical merge、同日同エリアの15/17ペア、直近最大16件・最低3件・15時正数、通年/曜日参照を使う。良い=当日率が中央値より20ポイント以上高い、悪い=20ポイント以上低い、普通=間。未丸め値と既存の17時Number.EPSILONを使い、表示は小数1桁だけに丸める。

## 表示・操作

共通パネルに残数推移、減少率、履歴中央値と、独立した「減少率判定」を表示する。良いは緑の枠/背景/文字badge、悪いは赤の枠/背景/文字badge、普通は通常表示。色だけでなく良い/悪いの文字で区別する。負の率は「−xx.x％（増加）」のまま、履歴比較の良い/悪いも別に表示する。売れ行き自体を断定する文言は追加しない。

履歴不足・比較元なし・15時0・不正・中央値未保存・比較対象外を区別する。比較可能な中央値/15時元データ/率を確認できない場合は良い/普通/悪いと推測しない。15時作業に15→17の数値を出さない。

「追加製造あり・補正を取り消す」「補正を戻す」のUI、props/callback/public actionを削除した。入力時に旧suppressionをかぶせる処理、hookの再適用経路も撤去した。旧suppressed/reasonや純粋互換helperは過去データの意味を保持するため残すが、現在のhookからは呼ばない。

## 保存・旧進行中状態

新17時の`decreaseAdjustment`へoptional `mode: "reference_only_v1"` / `applied: false`を保存する。既存のcanUseは「履歴比較が可能」、directionは「比較の向き」の意味として残し、modeで旧自動補正と区別する。previousCount/currentDecreaseRate/medianDecreaseRate/件数/方向を保持し、既存のcurrent/checkpoint→area snapshot/daily/day/finalized/exportとAreaCount record_details/remote JSONへ伝播する。新fieldのためのstorage key、SQL、migrationは追加しない。

旧mode/applied欠損へ新方式を推測補完しない。旧進行中/完了済みの採用結果・率・snapshotは、表示・再読込・再開だけで再計算しない。古い補正の説明は「過去の保存時の減少率補正」と区別する。新規判定、残数訂正からの再判定、明示manual/quickを行ったエリアから新方式を使う。保存済み中間評価は現在時計で再解決しない。

旧quickではbaseEvaluationが減少補正後のautoで上書きされ得たため、旧17の明示quickは保存済み残数+基準中央値から既存の残数閾値で元baselineを取得する。新方式は保存済み残数baseを使う。旧quickで元baselineを確かめられない場合は推測せずquickを隠し、full manualを維持する。これ自体で旧採用結果を変更しない。

## 実際の63/64の比較例

通常・火曜17時、17時残数50、残数基準中央値50、天候0/global0/遅延前を固定。過去の15→17ペアは100→50で減少率中央値50％。下表は63の実recommendationと既存の率計算を実行した値（先に多い商品率、次にどちらでもない商品率）。

| 当日15→17 | 当日の減少率・比較 | 63採用・表示率 | 64採用・表示率 |
| --- | --- | --- | --- |
| 200→50 | 75.0％・良い | やや少ない / 15％・5％ | 普通 / 20％・10％ |
| 100→50 | 50.0％・普通 | 普通 / 20％・10％ | 普通 / 20％・10％ |
| 60→50 | 16.7％・悪い | やや多い / 25％・15％ | 普通 / 20％・10％ |

64で人が明示higherならやや多い/25％・15％、lowerならやや少ない/15％・5％となり、比較結果による二重補正はない。旧良いの保存済みやや少ない/15％・5％を再開するだけならその確定値は保持し、明示再判定した場合だけ普通/20％・10％へ変わる。63優先復帰は保存済み最終採用結果を使い続け、減少率の良い/悪いを直接候補条件へ加えない。

## 変更ファイル

- `src/domain/areaCountHistory.ts`: 新17参考mode、対象9、当日pair証拠、17の自動段階補正廃止、optional metadata正規化/保存。
- `src/domain/areaEvaluationAdjustment.ts`: quickの残数baseline共通解決、旧quickの確認不能を推測しない。
- `src/domain/types.ts`: 廃止した取消actionを削除。
- `src/hooks/useNebikiApp.ts`: 新17の自動baseline、明示manual/quick保存、取消actionと旧suppression再適用接続を撤去。
- `src/domain/areaDecreaseDisplay.ts`: 独立比較/増加/比較不能の表示データ。
- `src/components/common/AreaCountStatusPanel.tsx`: 良い/悪い両方の強調、参考表示、旧保存時説明、取消操作撤去。
- `src/components/screens/AreaJudgeScreen.tsx`, `src/components/screens/RateDisplayScreen.tsx`, `src/app/AppRouter.tsx`: 表示接続と不要props/旧再適用の整理。
- 新専用`scripts/check-decrease-reference64.ts`。既存9チェック（area-count-status-ui/year-round、area-decrease-adjustment、area-quick-adjustment、decrease-numbers58、decrease-suppression-flow、holiday-sunday-reference52、refactor-characterization、weekday-fallback62）を更新。
- package/lockの版、check1本、distのindex/JS/sw、CHATGPT_HANDOFFと本報告。

src108中9本だけ変更、残り99本は63ZIPとbyte-identical。残数閾値、率計算本体、曜日/天候/46快適補正/60global、63priority resolver、Review19/productionAnalysis、履歴・同期・export builderは非変更。SQL9本・Supabase構造・AGENTS.md・過去CHANGE72本は非変更、schema3を維持する。

## テストの更新理由と結果

- 全`check:*` **103/103 PASS**、専用 **32/32 PASS**。9エリア/対象外2、未丸め±20pt/誤差/増加/履歴不足/0/欠損、同じ残数で比較だけ変えた自動/全5manualの率、実hook/TSXのquick/undo/訂正/保存/旧読込/exportを確認。
- 旧「良い/悪いで1段動く」期待だけを新17ではfinal=baseへ変更。中央値や曜日referenceを変えた期待値ではない。既存62の固定fixtureは変更せず、比較投影から新mode/appliedだけを分離し、別assertで新markerを検証した。
- 旧suppressionのpure helperと欠損modeを含む保存済み値の互換テストは維持。廃止hook actionのテストは、実際に残るmanual/quick/残数訂正/back/undo/保存失敗/fixed-timeで旧補正が再適用されない保証へ更新。areaquickの人工fixtureは、残数/medianと意図的に異なる5段階autoを検証するため明示new-mode基準を付け、legacy曖昧基準は別に検証した。
- 63 priority専用 **65/65**、55 pure/flow **13/13・45/45** PASS。減少率を候補条件に加えていない。従来15/旧夜枠純粋計算の互換を維持。
- 独立数値grid **2800**、比較不能 **24**、他時刻63互換 **60**、旧normalizer/clone/remote **45**、legacyquick **64**、保存全経路 **2** を検証。source audit PASS、入力不変/旧結果保持を確認。
- TypeScript / production build / PWA generateSW **PASS**。110 modules/precache10。chunk500kB超とBrowserslist案内は既存のbuild警告。
- full ESLint **7 existing errors / 5 existing warnings**、focused **1 existing error / 2 existing warnings**。63とfile/rule/severity/messageで比較して新規0、増減0。focused errorはAreaJudge既存`react-hooks/set-state-in-effect`、warningsはhook既存`exhaustive-deps`。変更scriptsは0 errors/0 warnings。既知lintをPASSや解消済みとは扱わない。

## 実ブラウザ・未確認事項

インストール済みMicrosoft Edgeのproduction engine、360/390×844、隔離した人工IndexedDB/localStorageと制御時計で **92/92 PASS**。9対象・対象外2、良い/普通/悪い/増加、履歴不足/比較元なし/0、旧保存根拠、手動quick/full selector、残数訂正・エリア移動・再読込、63の未入力スキップ→別area両段階完遂→残数入力への優先復帰を実操作した。横overflow/文字欠け/新console error・warning/不要な外部通信なし。最終bundleのversion/build/SHAを照合した。

実ブラウザはheadless Edgeへのsoftware touch/clickであり、実店舗の物理端末・実データ全件、インストール済みPWAのSW更新、実Supabase通信は未確認。自動hook/SSRとブラウザ描画/操作は別の証拠として記録する。保留中の曜日文言と夏17時の中間評価案内の既存不一致は今回変更しない。

## 成果物

`nebiki-helper-2026.8.9-64.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-64.md`、`ZIP_VALIDATION_2026.8.9-64.json`を作成する。完成ZIP自体のCRC、重複/casefold/path/symlink/除外物/秘密情報、single root、ファイル集合/bytes、version/JST build/schema、dist/PWA、SQL/AGENTS同一性とSHA-256を再検査する。ZIP内へ自己参照SHAは埋め込まない。
