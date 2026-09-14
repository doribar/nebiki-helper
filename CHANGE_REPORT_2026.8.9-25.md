# 2026.8.9-25 変更報告

検証日: 2026-09-13〜14 JST

## 実装内容

乾燥した夏モード17時だけ、快適方向の天候補正上限を-5%から-10%へ変更した。UI専用計算や夏判定の重複は作らず、`weekdayBase.ts` の `applyComfortNegativeLimit()` を共用する。

既存raw comfortを-2〜+2へ制限し、15時・雨ありの従来分岐の後で `demandCycle === "summer" && discountTime === "17"` の場合だけrawの負値をそのまま採用する。raw -1なら-5%、0なら0%、正方向も従来どおり。夏17時を常に-10%へ固定する変更ではない。

| dry時の負方向上限 | normal | summer |
| --- | --- | --- |
| 15時 | -10%（不変） | -10%（不変） |
| 17時 | -5%（不変） | **-10%** |
| 18:30 | -5%（不変） | -5%（不変） |
| 19:30 | -5%（不変） | -5%（不変） |

雨あり15時は快適方向最大-5%、17時以降の雨ありは快適方向0%、雪は快適度補正を使わない。雨雪の加点・起点判定・later precipitation・future weather point・気温低下抑制・風・after-rain recoveryの計算は変更しない。20:30の固定ルールも非変更。

ここで「乾燥条件」は既存の解決済み降水補正が0となる条件を指す。後続枠に雨雪があっても既存の起点判定で降水補正0となる場合は含む。雨・雪による快適方向制限は従来どおり降水補正から判定し、後続天候は既存future weather pointで扱う。全予報枠の降水有無による新しい判定は追加しない。

## 計算・表示への伝播

- `applyComfortNegativeLimit()`、`getComfortRateBonusTerm()`、`resolveWeatherEffect()` にoptional demandCycleを渡す。
- `getWeekdayBaseInfo()` の第5optional引数にdemandCycleを追加。省略時は従来のnormal相当の結果を保つ。
- `getBasisGuideDisplay()` が既に持つdemandCycleを同じweather source of truthへ通す。bonusSummaryText / bonusCalcText / bonusResultText、快適度の説明と実値が一致する。
- `useNebikiApp.ts` の通常計算、early-next対象時刻の計算、明示的な18:30開始snapshotへcycleを渡す。通常useMemoの依存にもcycleを含める。
- `advanceDiscount.ts` のsession入力へdemandCycleを追加し、同じ `getWeekdayBaseInfo()` へ渡す。先行率は既存の基本率 + weather + 多い固定10 + global、共通0〜50%制限のまま。
- `sessionSnapshots.ts` のReview19 referenceにもcycleを明示する。計算時刻は従来どおり19時なので、夏17時の特例は適用されない。
- RateDisplayの率、詳細表示、確定時の `rateDecisionSnapshot.weatherComfortAdjustmentPercent` は同じweather bonusを受け取る。snapshot schemaや計算builder本体は変更しない。

夏17時には「17時以降のため快適方向は-5%まで」を表示しない。normal17では既存文言・-5%制限を維持する。不要な新説明は追加していない。

## 9/13相当fixtureと先行率

晴れ・弱風2m/s・25℃、19〜21時に降水なし、`appliedTemperaturePoint = -2`、`weatherPointScore = 6`、`weatherPointShift = -1`を実天候処理で再現した。raw合計-3は既存clampで-2となり、夏17時の天候補正は-10%、normal17は-5%。

| 条件 | 先行率 |
| --- | --- |
| 夏17時、基本10・weather-10・多い+10・global-5 | **5%** |
| 同条件global0 | 10% |
| 同条件global+5 | 15% |
| normal17、基本10・weather-5・多い+10・global-5 | 10% |

先行率はAreaCount、area補正、quick、decrease、median、商品個別policyを参照しない。禁止fieldにgetterを置いたtestで参照がないことを確認。0以下を「0％で引いてください」と表示する9-24仕様と上限50%も維持する。

## 保存済み判断の保護

保存schemaは3のまま、migrationなし。旧record・snapshot・Review19・finalized dayを走査して再計算・書換えする処理は追加していない。

新規確定snapshotの-10は既存session / daily / day / finalized / direct・全件export経路で保持される。旧summer17の-5はrate/state normalization、daily読込、finalized normalization、exportを通して保持される。

完了画面の再renderにより新候補が作られても、同identity・同完了signatureなら既存のlocalStorage snapshot upsertとIndexedDB archive mergeが保存済みbasis / areasを保持する。旧-5に対して新-10候補を渡す専用testで不改変を確認した。既存保存処理自体は非変更。

## 変更ファイル

- `src/domain/weekdayBase.ts`: 唯一の夏17時limit分岐とcycle引数伝播。
- `src/domain/advanceDiscount.ts`: sessionのdemandCycleを共通weather計算へ伝播。
- `src/hooks/useNebikiApp.ts`: 通常・early-next・手動18開始の3call siteとuseMemo依存。
- `src/hooks/nebikiApp/sessionSnapshots.ts`: Review19 referenceへcycleを明示。
- `scripts/check-summer17-comfort.ts`: 天候・cycle・時刻・雨雪・説明の専用test。
- `scripts/check-summer17-comfort-integration.ts`: 先行率・実hook/TSX・snapshot/保存/export・過去値保持。
- `scripts/check-advance-discount.ts`: 既存neutral条件test名を「快適度0」と明確化。期待値は非変更。
- `package.json` / `package-lock.json`: version25、専用check2本追加。依存関係は不変。
- `CHATGPT_HANDOFF.md` / `CHANGE_REPORT_2026.8.9-25.md`: 現行状態と今回の記録。
- `dist/index.html` / `dist/sw.js` / `dist/assets/index-*.js`: production成果物。

quickのhigher→lower順・metadata、Review19優先遷移、18:30 manual onlyとReview19抑止、Review19 download、先行画面flow/reload、Done reference、global±5、AreaCount、商品policy、fixed-time READ ONLY、20:30、storage architectureを維持する。SQL / Supabase / RLS / grant / trigger / AGENTS.mdは変更しない。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| summer17 weather専用 | 46/46 PASS（200組の時刻・cycle・雨雪・raw matrixを含む） |
| summer17 integration専用 | 11/11 PASS |
| 全check:* | **59/59 PASS** |
| 既存先行率 / UI / flow | 15/15・35/35・30/30 PASS |
| Review19 priority / quick | 70/70・40/40 PASS |
| TypeScript | PASS |
| production build | PASS、101 modules |
| PWA generateSW | PASS、precache10 |
| focused ESLint | 0 errors / 4 existing warnings |
| full lint | 既存9 errors / 7 warnings |
| 9-24 lint比較 | 新規diagnostic 0、削除0 |

full lint比較はfile / rule / severity / messageを使用し、messageに埋め込まれた作業root絶対pathだけ揃えた。既存hook依存warning、buildのchunk size・Browserslist data警告は維持。full lintをPASSとは扱わない。

独立担当が旧新の実TypeScript関数を直接importして22,020 scenarios / 297,765 assertionsを比較。21,908件不変、112件は想定した夏17時・dry・raw<-1だけの変更。未来天候5,280組、温度解析720組、先行率66,060組、fixed-time先行画面除外66,060組を含む。予期しない差分0。

比較に使った旧source98件を9-24 ZIPと照合。production `getWeekdayBaseInfo` 全5か所・`getBasisGuideDisplay` 全4か所のcycle伝播をAST監査した。schema・SQL・storageの実装は非変更。

## 実ブラウザ

headless Microsoft Edge、production preview、390×844、Asia/Tokyo、隔離fixtureで4条件を実操作した。

- 夏17時global -5/0/+5、normal17 global-5。
- 天候stepperで24→25℃へ変更し、既存仕様による後続時刻への反映を確認。晴れ・弱風を確認して天候確定。
- 先行値引5/10/15%とnormal10%、指示画面reload維持、「エリア別値引へ進む」を確認。
- エリア残数20を実入力、普通を手動選択。RateDisplayの内訳を開いてweather値と説明を確認。
- 「終わった」を操作し、確定snapshotのweatherComfortAdjustmentPercentと表示率、気温解析、未来6pt/-1を確認。
- 夏17時には旧-5%limit文なし。normal17では旧文言と-5%を維持。
- 横overflowなし。console error/warning、外部通信、dialog/download/popupなど予期しない操作0件。

最終4条件は全てPASS。Done、15時、Review19、manual18、quick、fixed-time、20:30、storage/archive等の今回の回帰は自動testで確認し、全フローをブラウザ再実行したわけではない。

## baseline / release

| 項目 | 値 |
| --- | --- |
| baseline ZIP | nebiki-helper-20260912-2229.zip |
| baseline SHA-256 | b1f5ecafd3dfe1b322b9936588f389c3646d50ad82933913025754222301c42f |
| baseline buildId | build-20260912-171652-jst |
| appVersion | 2026.8.9-25 |
| buildId | build-20260913-201951-jst |
| dataSchemaVersion | 3 |
| release ZIP | nebiki-helper-20260914-0129.zip |

ZIPを新working copyへ展開して比較した。Git repositoryは存在しない。実運用の別buildを比較基準にしていない。親・担当agentは実行記録でGPT-6 Astra / Ultraを確認し、利用制限後の再開時にも同設定を再確認した。

root SQL9本とAGENTS.mdは9-24 baseline ZIPとbyte-identical。完成ZIPを再openし、testzip、重複/case-insensitive重複、不正path/backslash/traversal、single root、symlink、nested ZIP/node_modules/cache/.env/credentials、dist/PWA、version/build/schema、working treeの配布対象file集合・bytes一致を検査する。

最終ZIP検査結果とSHA-256は自己参照回避のためZIP外 `outputs/ZIP_VALIDATION_2026.8.9-25.json`、`outputs/RELEASE_REPORT_2026.8.9-25.md`、`outputs/nebiki-helper-20260914-0129.zip.sha256`に記録する。test・lint・独立比較・ブラウザの証跡はapplication root外の `work/comfort25` に置く。

未確認: 実Supabase mutation・全量cloud同期、インストール済みPWA実機、実店舗端末・長時間background復帰。実ブラウザ検証は隔離fixtureのproduction preview。
