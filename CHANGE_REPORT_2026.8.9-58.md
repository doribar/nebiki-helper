# 変更報告 2026.8.9-58

完成57 ZIP（SHA-256 `34d452cbb8e712439ce976bd9c2599cec08caad990e9a8ca28e5e7e81503d853`、build `build-20261021-170010-jst`）を基準に、17時作業の共通残数パネルへ15→17時の実残数推移・減少率・採用履歴中央値を表示した。appVersion `2026.8.9-58`、buildId `build-20261027-225436-jst`、dataSchemaVersion `3`。Git repositoryはなく完成ZIPとの集合/bytes/hash比較による。

## 実装

`areaDecreaseDisplay.ts` は表示専用pure helper。計算値は `(15時残数−17時残数)/15時残数` の比率で保持し、表示時だけ100倍・小数第1位に丸める。分類は既存 `getDecreaseRateAssessment()` が保存済み/既存recommendationのraw directionから返す良い/普通/悪いを使い、表示用丸め値から再判定しない。負の率は増加と分かる表示にし、raw分類/補正/評価を変更しない。

AreaJudge/RateDisplay/AutoSkipNotice/AutoSkipCountの `AreaCountStatusPanel` を共用する。現在のエリア残数を残し、その下に推移・率・中央値を表示。15時と旧夜枠へ今回の15→17数値は追加しない。17→19等の新比較や旧夜枠の復活はない。固定時計は既存のruntime/読み取り制約に従う。

## 表示例

| 条件 | 推移 | 減少率表示 | 中央値/扱い |
| --- | --- | --- | --- |
| 対象・既存普通判定 | 15時51個 → 17時44個 | 13.7％（普通） | 採用した17.1％ |
| 補正対象外 | 15時114個 → 17時102個 | 10.5％（補正対象外） | 中央値を新設しない、canUseはfalseのまま |
| 対象・履歴不足 | 有効な15/17残数 | 今回率は表示、分類は履歴不足 | 履歴中央値：履歴不足 |
| 比較元なし | 15時不明 → 17時の実数 | 算出不可/比較元なし | 0％として扱わない |
| 比較元0/不正 | 15時0個等 → 17時の実数 | 算出不可 | 0％として扱わない |
| 17時0・15時正 | 15時51個 → 17時0個 | 100.0％ | 分類は既存判定のまま |
| 残数増加 | 15時22個 → 17時29個 | −31.8％（増加） | 原比率は負のまま |

51→44はraw `7/51=0.1372549…`、履歴70→58のraw中央値 `12/70=0.1714285…`。画面の13.7/17.1から普通を再計算せず、既存direction=noneを表示する。±20pt直前/厳密境界/直後では表示丸めが同じ40.0％等になっても、未丸め値と既存EPSILONの境界処理を保つ。NaN/Infinity/−0.0は表示しない。微小負値が表示上0.0へ丸まる場合も原比率の負値と「増加」を保持し、0へclampした値で分類しない。

## データ選択と保存済み根拠

保存済みdecisionBasisまたは入力確定後の既存recommendationにあるpreviousCount/currentDecreaseRate/medianDecreaseRateを優先する。後から15時履歴が変わっても採用済みの比較元/率/中央値を置き換えない。取消/復元でもraw値は変更しない。

保存根拠がない場合だけ既存 `prepareAreaCountCalculationPopulation()` の正式観測mapを共有するreaderを使う。同じ業務日・同じarea・15時の観測を既存normalization/canonical merge/同日重複排除から選ぶ。normal/summer通年母集団を維持し、別日/別area/別時刻を参照しない。read側はcloneを返し、既存cacheを変更できない。hookの既存prepared populationを使うため、毎時計renderでhistory全件を再生成しない。

フライ/鶏惣菜等の対象外でも有効なpairから表示用ratioを出すが、対象area集合・canUse・中央値・最終採用評価・率には一切反映しない。補正対象の履歴だけ不足ならratioを表示し、分類/中央値は不足と明示。raw canUse=trueだが旧metadataに中央値がない場合は既存分類を保持し「履歴中央値：未保存」。履歴不足と欠損を混同しない。

比較元が0/不正、保存率しか残らず比較元がない旧状態では算出不可。保存済み比較元/率のfieldがある場合、矛盾を新しい15時観測で推測補完しない。保存比較元が正でrateが未保存なら、その保存pairから表示用だけを計算する。有効count判定と正式観測readerのnormalizationは既存ルールを維持する。

## 訂正・エリア移動・再開

AreaJudgeは入力確定前に現在progressのcount/basisを、確定後にその入力で得た既存recommendationを使う。session/areaのReact keyを付け、同じ画面のarea直接切替で前areaの提出済みcountが新areaの15時countへ一瞬結び付く経路を防いだ。既存calculator draftのkeyや正式確定処理は変えていない。

AutoSkipCountは編集中のparsed countをパネルへ渡す。保存countと異なる間は旧保存率を流用せず、そのcountと正式15時観測から表示する。空欄/無効入力では現在の数を捏造しない。RateDisplay/AutoSkipNoticeは保存済みcurrent count/basisを使う。Rate表示のどの指示段階でも同じパネルになる。

既存Back/undoのsnapshot復元方針は維持。たとえば15時22に対する17時20（9.1％）を18（18.2％）へ訂正後、既存の戻る操作が元snapshotを復元する場面では、20と9.1を一緒に復元する。18と9.1のような新旧混在にしない。追加製造取消中の残数修正を保持する既存例外も維持する。取消/復元はraw減少率と中央値を変えず、既存の正規評価/率反映だけを行う。

## 非変更領域

areaCountHistory.tsは正式観測readerと既存対象集合を参照する判定exportの2箇所追加だけ。挿入部分を除去すると57版ファイル全体とbyte-identicalであり、既存の分類±20pt、対象、必要件数3、中央値、履歴採用条件、最終判定、手動修正、抑制処理、normalizerは変更していない。

新しいcontextはderived/propsだけであり、AppStateやsession/snapshot/recordへ保存しない。新field/key/migrationなし。既存rateDecisionSnapshot、日次/AreaCount/Review19/export/同期、確定済み評価/率/履歴を再計算して書き換えない。57当日global、56/55進行、時計、遅延+5、天候・46快適補正、48/52参照、注意事項7項目、fixed READ ONLYを保持する。SQL/Supabase構造/schema3/AGENTSに変更なし。

## 変更ファイル一覧

- 新規 `src/domain/areaDecreaseDisplay.ts`: 表示用rate/transition/中央値/理由のpure helperと非永続context型。
- `src/domain/areaCountHistory.ts`: 既存正式観測mapの読取export、同じ対象集合を使う適用対象照会export。
- `src/hooks/useNebikiApp.ts`: 17時の4操作画面向けderived contextを既存prepared historyから作る。
- `src/domain/types.ts`: derived context型のみ。保存型/schemaは変更なし。
- `src/app/AppRouter.tsx`: 4consumerへcontextを接続、AreaJudgeへsession/area key。
- `src/components/common/AreaCountStatusPanel.tsx`: 数値/推移/中央値/理由の表示。既存取消UIを維持。
- `src/components/screens/AreaJudgeScreen.tsx` / `RateDisplayScreen.tsx` / `AutoSkipNoticeScreen.tsx`: 共通パネルへcontextを渡す。
- `src/components/screens/AutoSkipCountScreen.tsx`: contextと編集中countを渡し、古い保存率と混ぜない。
- 新規 `scripts/check-decrease-numbers58.ts`: 実domain/全hook/Router/TSX host treeの専用検証。
- `scripts/check-refactor-characterization.ts`: derived field1つを既存public契約へ追加。
- `package.json` / `package-lock.json`: versionと専用check1本。依存/既存コマンドは不変。
- `dist/*`、`CHATGPT_HANDOFF.md`、本変更報告。

src108=変更9+新規1+既存保護98。SQL9・AGENTS・過去CHANGE66・Vite/dataVersion/depsは57版とbyte-identical。

## 自動検証

- 全check **98/98 PASS**。57版既存97checkは検証を削らず維持し、public derived field1つの期待だけ更新。
- 58専用 **24/24 PASS**。対象全area、対象外、不足、比較不能/0/負/100、表示丸めとraw閾値、saved priority/欠損、canonical/localremote重複/他日他area他時刻、実keypad訂正/取消/復元/戻る/スキップ入力/area切替/再読込、保存非変更を確認。
- TypeScript / production build / PWA generateSW **PASS**（111 modules/precache10）。
- full ESLintは既存 **9 errors / 5 warnings**、focusedは既存 **1 error / 2 warnings**。57とのfile/rule/severity/message比較で新規0・削除0。focusedのerrorはAreaJudgeScreen既存set-state-in-effect、warningsはhookの既存exhaustive-depsで、full/focusedともlint自体はexit1。新規test/characterizationのlintは0件。bundle-size/Browserslistのbuild案内も既存由来。
- source audit finding0。check入力223/build入力123を凍結し、配信bundle/source/完成ZIPとの一致を照合する。

## 実ブラウザと未確認事項

installed Edgeのproduction previewを360/390×844で実行し、人工データ/時計による **20/20 PASS**。対象の13.7％/17.1％、対象外10.5％、履歴不足、比較元なし/15時0/17時0、増加−31.8％、実訂正/reload/エリア移動/再訪、追加製造取消/復元でのraw数値保持、15時非表示を確認。固定時計は既存remote-only方式のため、実Supabase未接続では比較元なしのfallback表示となり、production保存値を変更しないことを確認する。

文字欠け・document/modal横overflow、新規アプリconsole error/warning、不要な外部通信0。fixtureの起動環境/sandbox再試行やservice worker遮断通知はharness由来として別記録する。証跡はZIP外`work/decreaseNumbers58/browser-work`の結果JSON/画像。source/bundleに一時instrumentationを追加していない。

人工時計/孤立データを用いた実Edgeと、React host tree/domainの自動testを区別する。物理スマートフォン/店舗実機、installed PWAの長時間バックグラウンド復帰、実Supabase通信は未確認。保留中の曜日文言や夏17時案内の不一致は今回変更しない。

## 成果物

`nebiki-helper-2026.8.9-58.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-58.md`、`ZIP_VALIDATION_2026.8.9-58.json`。完成ZIPそのものを再openし、CRC、集合/全bytes、duplicate/casefold/path/symlink/除外物/credential、version/JST build/schema、dist/PWA参照/キャッシュrevision、SQL9/AGENTS同一性、SHA-256を検査する。自己参照を避け、ZIPのSHAはZIP外報告/検査JSONへ記録する。
