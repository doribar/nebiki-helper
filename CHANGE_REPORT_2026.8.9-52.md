# CHANGE REPORT 2026.8.9-52

- appVersion: `2026.8.9-52` / buildId: `build-20261012-115730-jst` / dataSchemaVersion: `3`。
- 完成ZIP: `nebiki-helper-2026.8.9-52.zip`。SHA-256はZIP外の`.zip.sha256` / RELEASE_REPORT / ZIP_VALIDATIONを参照。
- baseline: 完成51 ZIP `nebiki-helper-2026.8.9-51.zip`、SHA-256 `f310bffe230fc33c5ee45ba46e683b3b3aca5f5e65b42f5bad17aff6a2177fc4`、build `build-20261012-040025-jst`。Git repositoryなし、完成ZIPとのbytes/hashで比較。

## 対象と採用ルール

15時・17時の新規判定/明示再判定で既存`isHolidayBeforeNormalWeekday(date)`を使用。法定祝日/振替休日かつ翌通常平日（2026-10-12）のみ、同エリア・同時刻の通常日曜が3件以上なら日曜単体を採用する。0〜2件だけ既存15金土日/17火木日を代替とし、代替も3件未満なら従来insufficient/manual。

実曜日「月」と新規履歴分類「翌日平日祝日」は保持する。comparisonMode=`holiday_before_normal_weekday`も暦条件として維持し、実際の採用元は新optional根拠で区別する。祝日の記録を通常日曜へ読み替えない。Obon-onlyの同labelや旧夜時刻には新処理を適用しない。個別量reference・一般曜日文言は変更しない。

## 抽出・中央値・減り方

48の通常日曜抽出を共用し、15時の日曜が既存金土日分類でも抽出できるよう時刻から通常日曜groupを取得する。実曜日と実日付が日曜で、法定祝日/振替、祝前日、三連休中日、長期連休内部、captured特殊暦、version/capturedに応じたObonを除外する。入力record自体を再分類しない。

既存canonical merge・同日area/time1観測・date<today・通年normal/summer母集団を使用する。short16/long52、整数中央値、必要3、単独weekdayの`max(short,long-2)`中央値ガードは既存helperを使用。代替groupは従来のshort中央値/guardなし。減り方は採用したmatchedRecordsと既存前時刻lookupから計算し、別母集団を混ぜない。閾値・減り方式・エリア補正・値引率式は変更しない。

48三連休中日は17時以降の通常日曜優先/不足時火木日/金土との50:50・片側採用を維持。共用した抽出以外の合成処理は不変、3連休で使う17時以降のgroupは従来通り火木日。15時三連休/通常曜日/4日以上連休/その他祝日/旧夜枠の計算は非変更。

## 保存根拠と表示

`HolidayBeforeNormalWeekdayReference`と`holidayBeforeNormalWeekdayReference?`を追加。source、adopted、通常日曜有効件数/required3、代替group/件数/不足理由、採用母集団全件/short/long件数、各中央値/最終中央値/guardを保存する。両不足はadopted=false、中央値/guardを捏造しない。

recommendation→decisionBasis→progress/current/checkpoint、AreaCount record、calendar.areaCountReference→確定area snapshot/daily snapshot→Review19 daySnapshot/finalized/分析export、既存AreaCount Supabase record_detailsへ保持する。日曜採用時のcalendarはreferenceWeekday=日、type=weekday、代替は従来weekday_group。実曜日/month/calendarConditionは別概念として保持する。

確定area snapshotでは`areaCountDecisionBasis`と`rateDecisionSnapshot`を同じarea内の隣接fieldとして保存する。今回の参照metadataをrateDecisionSnapshot内部に追加しない。選ばれた評価/補正から既存rate builderが率を確定し、後の時計tickや履歴取得で保存済み率・根拠を再解決しない。

AreaJudgeのnotice/内訳を実採用元へ合わせ、RateDisplayに保存根拠だけの折畳みdetails「祝日翌日平日の履歴基準」を追加。日曜採用、日曜不足時の金土日/火木日、両不足、実件数/中央値/guardを確認できる。開閉は保存・判定・再計算をしない。

旧根拠のoptional field欠損は欠損のまま読み込み/exportする。現在の履歴から日曜採用を推測して補完しない。51由来の保存済みgroup中央値・確定率・snapshotを新履歴があっても保持する。schema3、新storage key/migrationなし。

## 実数での51→52比較

2026-10-12、弁当・麺、残数10個、通常日曜3件は各6個、代替曜日80件は各30個、global0、fixture天候補正0、遅延なし。両cycleで確認した。基本率や商品別計算は同じで、参照母集団の変更だけがエリア評価へ伝わる。

| 元session | 51採用中央値→52 | 51採用評価→52 | エリア補正 | 通常商品指示率 | 多い商品指示率 |
| --- | --- | --- | --- | --- | --- |
| 15時 | 30個→6個 | 少ない→多い | −10→+10pt | 0→10% | 0→20% |
| 17時 | 30個→6個 | 少ない→多い | −10→+10pt | 0→20% | 10→30% |

通常日曜が2件なら旧group中央値30個、少ない/−10ptを維持し、15時通常0・多い0%、17時通常0・多い10%で51と同じ。日曜2→3件で採用元が切り替わる。両不足は評価・率を自動生成しない。

ガードfixtureは日曜60件の直近16件6個/長期52件中央値30個で最終28個、groupはshort6/long30でも6個。減り方fixture（本日15残数20→17残数10）では旧groupの過去減少中央値80%に対し現在50%でmore_many/最終やや少ない/−5pt/通常5・多い15%、52は日曜減少中央値50%でnone/最終多い/+10pt/通常20・多い30%。値引率の平均は行わない。

数値証拠はZIP外`work/holidaySunday52/numeric-comparison52.json`。実51ソースはbaseline ZIPと105srcすべてbytes照合済み。48三連休fixtureは双方中央値8個、既存指示率も同一。

## 変更ファイル

- `src/domain/areaCountHistory.ts`: 通常日曜抽出共用、対象祝日15/17採用、根拠/normalizer/builder/pure詳細formatter。
- `src/domain/types.ts`: optional根拠型。
- `src/domain/analysisMetadata.ts`: 根拠の検証・保存、calendar採用元。
- `src/components/screens/AreaJudgeScreen.tsx`: 採用元/不足notice。
- `src/components/screens/RateDisplayScreen.tsx`: captured根拠details。
- `scripts/check-holiday-sunday-reference52.ts`（新規）: domain/本番hook・TSX/確定・復元/export/remote payload。
- `scripts/check-long-holiday-reference.ts`: 新optional根拠だけ旧golden projectionから除外し、旧hash・既存計算保証を維持。
- `package.json`/`package-lock.json`: versionと専用check登録。依存不変。
- `dist/*`、`CHATGPT_HANDOFF.md`、本変更報告。

src105の差分は上記5本だけ、残る100本は51ZIPとbyte-identical。既存重要22関数はAST本文同一。SQL9本・AGENTS・過去CHANGE60・dataVersion/Vite/依存を保持。check入力212件/build入力120件をhash凍結し、実行/build後の不一致がないことを確認する。

## 検証結果

- 全`check:*`: **90/90 PASS**。旧89commandは不変、52専用だけ追加。
- 専用check: **63/63 PASS**。日曜0/1/2/3、15分類、月履歴除外、canonical local/remote/cycle/同日重複、area/time/today/future、特殊日/captured/version Obon、16/52/guard、decrease、normal/summer実hook8条件、確定/current/checkpoint/remote record_details、calendar/daily/finalized/Review19 export、legacy欠損/確定値保持、実TSX表示を確認。
- 実51/52 domain/rate比較 **48/48 PASS**。独立scope/gate/legacy補足 **1,922/1,922 PASS**。三連休28、長期連休17、翌日平日祝日37、通年44、減り方35等の既存checkもPASS。
- TypeScript `tsc -b --force` / production build / PWA `generateSW`: **PASS**、108 modules/precache10。buildのchunk-size/Browserslist案内はbaseline由来。
- focused ESLint: **1 existing error / 0 warnings、新規0**。full: **9 errors / 5 warnings**、51とのfile/rule/severity/message比較で新規0・削除0。新規testの初回hooks lint1件はcallを専用functionへ整理して解消し、再実行済み。既存診断が残るためfocused/full lint自体はexit1。

## 実ブラウザ確認

インストール済Edge155 production preview、人工fixture/時計・独立local profile、360×844/390×844、**28/28 PASS**。15/17の日曜3件、0/1/2件fallback、双方不足/manual、保存根拠details・閉開・確定/reload、51APIで作成した旧根拠/保存率/fixed READ ONLYを実操作した。通常日曜と異なるgroup/月曜履歴を用意し、recordのactualWeekday=月・group=翌日平日祝日、new evidence/calendarを照合した。

日曜採用の15/17は各幅で12エリアを実入力し通常完了/daily snapshotを確認。横overflow0、unexpected console error/warning0、外部通信0。SW登録をテスト環境でblockした通知はharness警告として別計上。製品bundleへのinstrumentation追加はなく、source105/bundleの検証前後SHAは一致。生証拠はZIP外`work/holidaySunday52/browser-work/browser-results52.json`、summary、PNG。

## 未確認事項・保持した既存課題

物理タッチ端末、実店舗保存データの直接更新、実Supabase mutation、インストール済PWAのSW更新/offline、実端末の長時間backgroundは未確認。大規模guard/dedupe/version組合せ・StrictMode/clock詳細は自動fixtureと独立auditで確認し、実ブラウザとの区別を維持する。

今回の対象祝日15/17の採用・保存根拠に未解決不一致は見つからなかった。一般曜日基準文言と、夏17時を18時以降まで続けて新規中間評価を確定する場合の静的hint/lowerと実時計解決/higherの既存不一致は指定どおり変更せず、引継ぎに保持する。
