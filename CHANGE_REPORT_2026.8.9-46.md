# CHANGE REPORT 2026.8.9-46

完成JST: 2026-10-09T17:38:39.865579+09:00

- appVersion: `2026.8.9-46` / buildId: `build-20261009-121800-jst` / dataSchemaVersion: `3`
- 完成ZIP: `nebiki-helper-2026.8.9-46.zip`。SHA-256はZIP外の同名`.sha256` / RELEASE_REPORT / ZIP_VALIDATION参照。
- baseline: 完成9-45 ZIP `nebiki-helper-2026.8.9-45.zip`、SHA-256 `87114f0c1ed4ea1bdb49b8cbb2ac43c57a4c1e90349a45bd5ea5ecbe46de77ec`、build `build-20261008-110344-jst`。

## 比較と適用順

新pure helper `eveningComfortRelief.ts` は入力済み16時・21時の気温/風速/晴雨雪を、既存 `getFutureWeatherPoint()` の1時間評価から公開した `getHourlyForecastComfortScore()` で比較する。符号を反転し、大きいほど不快。未来時間帯の合計点、時刻・季節の負方向制限、暑さ加点抑制、GW/雨上がり補正、新緩和は比較に混ぜない。scoreは比較前にclampせず、同じ表示カテゴリ内での低下も拾う。

晴れ・同じ弱風23℃→18℃はscore **-2→-1**（超快適→快適）、絶対気温差5℃で成立。差が5℃未満、scoreが同じ/改善、片方の入力が欠損/不正なら不適用。気温はfinite -20..45℃、風速はfinite 0..20m/s、天候は既存enumを検証し、欠損を0℃へ変換しない。

適用対象はcontextへ明示した元session時刻15/17（normal/summer両方）。有効計算時刻と分離するため、15時の遅延+5、17時作業継続中の18:30先取り-5にも適用。独立18:30/19:30/20:30は対象外。既存の時刻/季節/雨雪の快適方向制限後の補正Bに、条件成立かつB<0の場合だけ **min(0, B+5)** を適用し、その後に降水補正を合算する。0/正方向は不変。基本率・エリア・商品・先取り/遅延・global・0..50%上限の順序は変更しない。

`weekdayBase.ts` が緩和済み天候補正と説明のsource of truth。hook通常/先取りと先行値引/冷惣菜ガイドへ同じcontextを渡す。Review19自身の19:30相当reference計算には追加contextを渡さず、20:30 final guideは既存のraw comfortを維持する。fixed時計のREAD ONLY、正式storeへ書込まない境界を維持。

## 具体的な表示率

晴れ・弱風、16〜20時23℃/21時18℃、エリア補正0/global0、通常商品の率と「多い商品」の率を順に記載。基本率は15時0%、17時10%。

| 元session | 快適補正B→新補正 | 通常商品 / 多い商品の表示率（旧→新） |
| --- | --- | --- |
| normal15 | -10→-5 | 0/0→0/5% |
| summer15 | -10→-5 | 0/0→0/5% |
| normal17 | -5→0 | 5/15→10/20% |
| summer17 | -10→-5 | 0/10→5/15% |
| normal15遅延+5 | -10→-5 | 0/5→0/10% |
| normal17先取り18:30基準-5 | -5→0 | 10/20→15/25% |

15時では0%下限で通常商品が同率になる場合があるが、快適補正の解決値は-10→-5。エリア+10ならnormal15の通常/多いは0/10→5/15%、normal17は15/25→20/30%、summer17は10/20→15/25%。

雨15時は既存快適制限-5→0、継続雨+10は維持。雨17時は既存快適制限0のため緩和なし。雪は既存どおり快適補正を使わず雪+15/+20を維持。

先行値引の「多い+10」・global・上限は不変で、同じ新天候Wを反映する。冷惣菜の独自規則も変更していないが、Wの変化に応じ既存条件の結果は変わる。翌日休日のsummer17/global0はW-10→-5によりガイド25→30%、global-5ではW-5かつG-5の既存条件で25%を維持。normal17/global-5はW-5→0により25→30%。個数境界/プラス補正/50%上限の式は不変。

## 入力・表示・保存・互換

- 新規default16/21は未入力marker。既存weather objectへのoptional `eveningComfortUnavailableForecastHours` だけを使い、新storage key/DB/migrationを追加しない。旧完全な予報mapは利用可能、欠損や旧集約予報をnormalizeした補完値は判定不可とする。
- markerはcurrent/draft/checkpoint/reloadで維持。weather/temp/windの3項目を同hourで明示確認した時だけ解除し、自動copy/部分編集/修正画面の自動確認では解除しない。最後の解除は空配列をpatchして親のshallow mergeによる旧marker復活を防ぐ。
- 新日未開始draftへの引継ぎでは数値defaultを消さず、16/21を再び未確認にする。起動default、旧override解除の日付更新、timer/focus同期、datepatch、開始時currentDate確定の各境界を確認。元業務日を保持する進行中sessionや保存済み履歴は変更しない。
- 再表示/復元/予報変更は毎回既存制限後Bから計算する。保存された適用後値へ再加算しない。
- 快適度のカテゴリは元raw scoreによる超快適等を保持。既存内訳を開くと「16時→21時の快適度低下・気温差5℃のため快適補正を5ポイント緩和：-10%→-5%」等、実際の前後値を表示する。値引率補正summary/calc/resultと採用率が一致する。
- optional `eveningComfortRelief` に元/effective時刻、比較16/21の気温・風・天候・raw score、絶対差、成立結果/理由、B/適用後/適用有無を保存。WeekdayBaseInfo/BasisGuideDisplay→確定RateDecisionSnapshot→AreaProgress/daily/source snapshot→daySnapshot/finalized/分析exportの既存clone経路へ伝播する。
- 既存 `rateDecisionSnapshot.weatherComfortAdjustmentPercent` はこれまでどおり合計天候補正を表す。新metadataのcomfortAdjustmentBefore/AfterPercentは降水を含めない快適項目のみを表し、意味を混同しない。
- snapshot normalizerは旧metadata欠損を補完せず、保存済みの率・raw9・採用評価・完了時刻を保持。壊れたoptional新metadataだけを除外して、既存率を読めるようにする。archiveの同じ完了実績を現在予報で置換しない。

## 変更ファイル

- `CHANGE_REPORT_2026.8.9-46.md`
- `CHATGPT_HANDOFF.md`
- `dist/*`
- `package-lock.json`
- `package.json`
- `scripts/check-advance-discount-flow.ts`
- `scripts/check-advance-discount.ts`
- `scripts/check-cold-deli-guide.ts`
- `scripts/check-early-next-17-continuity.ts`
- `scripts/check-evening-comfort-flow.ts`
- `scripts/check-evening-comfort-relief.ts`
- `scripts/check-review19-priority-transition.ts`
- `scripts/check-summer17-comfort-integration.ts`
- `scripts/check-weather-confirmation.ts`
- `src/components/screens/StartScreen.tsx`
- `src/domain/advanceDiscount.ts`
- `src/domain/coldDeliGuide.ts`
- `src/domain/eveningComfortRelief.ts`
- `src/domain/hourlyWeather.ts`
- `src/domain/rateDecisionSnapshot.ts`
- `src/domain/types.ts`
- `src/domain/weekdayBase.ts`
- `src/hooks/nebikiApp/sessionSnapshots.ts`
- `src/hooks/nebikiApp/stateNormalization.ts`
- `src/hooks/useNebikiApp.ts`

production103本のうち92本byte-identical。既存10本変更/helper1追加。rate engine、AreaCount/quick/human/selector、calendar、温度低下抑制、productionAnalysis、Review19生成・確定、storage/archive/export/cloud、注意7項目とhint、曜日・時刻manual廃止処理本体は不変。SQL9本・AGENTS.md・version/buildId生成方式・schema3・全過去CHANGE_REPORTは9-45 ZIPとbyte-identical。

## 検証

- 全 `check:*` **83/83 PASS**。専用計算/TSX表示/保存/export **17/17**、実hook/実Start入力/確定/復元 **10/10**。差5/sub5/同一/改善/超快適→快適、raw同カテゴリscore差、B全方向、normal/summer/雨雪、原時刻とeffective時刻、全体/エリア補正・clamp、再表示/予報変更/欠損/新日、旧履歴bytes、metadata破損互換を実率まで照合。
- 完成45版の実moduleとの独立比較 **4,536条件**（非適用4,438不変/適用98は天候+5のみ）、表示率 **11,664照合**。期待式の再実装だけでbaseline一致と判断していない。
- TypeScript/production build/PWA generateSW PASS。107 modules、precache10、asset `/assets/index-DjexAsXj.js`。既存large-chunk/caniuse-lite更新警告は継続。
- focused ESLint **0 errors / 3 existing warnings**。full **9 existing errors / 6 existing warnings**。45版file/rule/severity/message比較で新規diagnostic0。rootとコード枠の座標だけ正規化し、診断本文とcode tokenは保持。新eslint例外は追加しない。
- Edge production 390×844、**51ケース**。同一最終source/bundleで旧26ケースと新条件・入力・補正内訳・表示率・再読込・確定保存を確認。console error/warning・不要外部通信・横overflow0。isolated profile/fixtureを使用し実店舗データに書込まない。preview停止済み。
- normal17は実Edgeで12エリアすべてを残数入力・完了し、通常20%/多い30%と快適補正-5→0が確定snapshot・日次保存に一致。取得した実保存データを既存pure export builderへ通し、率・比較metadata・basisが一致することを確認した。この追加export照合はUIのdownloadボタン操作ではない。
- SSR/pure/React dispatcher fixtureと実Edge操作を区別。daily/finalized/exportの詳細伝播は実builder/保存fixtureで検証し、全境界の実店舗端末確認を行ったとはしない。

## 未確認・既知課題

- 実Supabase mutation、installed PWA、物理店舗端末/実タッチ機器、長時間background復帰は未確認。Edgeのタッチはemulation。
- 旧summer18:30 sessionを18時前に復元した場合の静的18時以降hintと実時計lowerの差は45版既知課題として維持。今回のweather緩和で解決したとはしない。
- 全体lint既存9 errors/6 warningsとbuild既存警告は別課題。今回の新規diagnostic0。
