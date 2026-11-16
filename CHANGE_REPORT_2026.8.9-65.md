# 変更報告 2026.8.9-65

完成64 ZIP（SHA-256 `710810219e74c57f82c31d75d3b4726089cbf954fce8d3569a3a8281035a4dd7`）を基準に、追加回答「季節商品も従来の比較対象として残す」を反映した。完成済み64を別内容で上書きしないAGENTSの規則に従い、65としてreleaseする。appVersion `2026.8.9-65` / buildId `build-20261117-074248-jst` / dataSchemaVersion `3`。

## 変更と維持範囲

`src/domain/areaCountHistory.ts`の比較対象集合へ`ryomi`（夏商品）/`autumn`（秋商品）を追加し、コメントを更新した。本番差分はこの1ファイル・2IDとコメントのみ。通常9エリアに季節商品も含め、既存の採用履歴・同日15/17ペア・最大16件・最低3件・15時正数・未丸め±20ポイント・EPS対策を使う。コロッケ系/フライ・鶏惣菜は当日率だけ、balance_bentoも比較対象外のまま。

減少率は引き続き参考情報のみ。良い/普通/悪いで採用判定・率を動かさず、mode:reference_only_v1/applied:falseと比較のraw率/中央値/件数/方向を既存経路へ保存する。良い/悪いのbadge、増加の負値と比較の併記、manual/quickは64と同じ。補正取消・復元操作は復活させない。

秋商品の一時無効化、夏商品の作業対象月は変更しない。秋商品の統計定義・過去履歴互換を維持することと、通常作業にエリアを再追加することは別であり、後者は行っていない。

旧採用判定・確定率・snapshot・履歴は再計算しない。64の季節商品で中央値が保存されていない場合も、現在履歴から推測補完せず、新規判定/明示再判定で比較を取得する。通常9エリア・63優先復帰・率計算・天候/曜日/時刻・注意事項・Review19・productionAnalysis・保存/同期/export builderは変更なし。

## 比較例

同じ季節商品エリア、17時残数50、残数中央値50、過去15→17が100→50（減少中央値50％）、天候/global0の条件で実64/65の関数を実行した。

| 当日15→17 | 減少率 | 64の比較 | 65の比較 | 両版の採用・率（多い商品／通常商品） |
| --- | --- | --- | --- | --- |
| 200→50 | 75.0％ | 対象外 | 良い | 普通・20％／10％ |
| 100→50 | 50.0％ | 対象外 | 普通 | 普通・20％／10％ |
| 60→50 | 16.7％ | 対象外 | 悪い | 普通・20％／10％ |

夏商品・秋商品双方で比較表示だけが追加され、採用判定/エリア補正/表示率は同値。手動のhigher/lowerだけが従来どおり判定・率を変更する。秋商品の数値例はdomain/保存互換の検証であり、無効化中の通常操作画面を復活させた例ではない。

## 変更ファイル

- 本番: `src/domain/areaCountHistory.ts`のみ。他107ソースは64とbyte-identical。
- `scripts/check-decrease-reference64.ts`, `scripts/check-area-decrease-adjustment.ts`: 「季節商品を除外」の64時点の期待を、ユーザー回答に合わせ継続対象へ変更。balance_bento/対象外2/旧保存互換の検証は残す。
- 新規`scripts/check-seasonal-reference65.ts`: 季節比較・率不変・保存/表示互換・秋無効化の専用検証。
- package/lockの版とcheck1本、dist index/JS/sw、CHATGPT_HANDOFF、本報告。

SQL9本・AGENTS・過去CHANGE73本、依存とbuild生成方法は非変更。Supabase構造・storage key・schema/migrationは変更しない。schema3を維持する。完成64の4成果物も上書きしない。

## 検証

- 全check **104/104 PASS**。季節商品専用 **38/38 PASS**、更新した64専用32件もPASS。両季節/両cycle、良い/普通/悪い/増加、±20pt/丸め・件数・15時0/欠損、manual/quick、保存/normalizer/snapshot/remote/export、秋無効化を検証。
- 独立監査: 非季節の実64同値7200件、季節の参考比較480件、他時刻72件、比較不能8件、実数例6、12か月gate、旧欠損mode/64比較なし/65比較ありの保存6経路PASS。source scopeは1本変更・107本不変。
- TypeScript / production build / PWA generateSW **PASS**（110 modules、precache10）。既存chunk500kB超/Browserslist案内あり。
- full lintは64と同じ **7 existing errors / 5 existing warnings**。変更箇所focused **0 errors / 0 warnings**。file/rule/severity/message比較で新規0。
- 実Edge production、360/390×844 **32/32 PASS**。夏商品の履歴中央値・良い/普通/悪い/増加・手動quick/修正・再読込、秋の通常ルート除外と保存済み秋記録の保全を確認。最終version/build/bundle SHAを照合。アプリconsole error/warning・横overflow・不要な外部通信なし。

## 未確認事項・成果物

実Edgeは隔離した人工IndexedDB/localStorage、localhost・制御時計・headless engineへのsoftware touch/click。実店舗物理端末、インストール済みPWA更新・長時間background、実Supabase通信は未確認。秋商品の新規作業画面は既存無効化を維持するため実操作せず、計算/保存経路は自動テスト、無効化と旧履歴は実ブラウザで確認した。既存の曜日文言・夏17時中間評価案内の保留事項は変更しない。

成果物: `nebiki-helper-2026.8.9-65.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-65.md`、`ZIP_VALIDATION_2026.8.9-65.json`。完成ZIP自体を再openし、CRC・重複/casefold/path/symlink・除外物/credential・single root・対象file集合/bytes・version/JST build/schema・dist/PWA・SQL/AGENTS・SHA-256を検査する。
