# 2026.8.9-29 変更報告

検証日: 2026-09-21〜22 JST

## 変更内容

4日以上続く土曜・日曜・祝日の連休ブロックの内部日について、17時の個別量referenceとエリア残数比較を金曜・土曜へ統一した。単独祝日、連休初日/最終日、ちょうど3日の連休、他の値引時刻は従来どおり。

休日判定は既存 `isJapaneseHolidayOrWeekend()` を再利用。当日・前日・翌日が休日で、前々日または翌々日も休日であることを確認する。これは4日以上の連続ブロックの内部日と同値で、独自の祝日一覧やObon休日を追加しない。

個別量の優先順位は、三連休中日（従来の時刻条件）→長期連休内部17時→Obon→非祝日の祝日前→祝日→実曜日。既存三連休判定はbyte/text一致で維持。

残数は当日のcomparison groupと採用basisを金土にし、同曜日履歴が十分でも金土groupを選択する。履歴record分類、normalizer、median/decreaseのアルゴリズムや率計算は変更しない。

## 2026-09-19〜09-24の17時

| 日付 | 個別量reference | 残数比較 | 新ルール |
| --- | --- | --- | --- |
| 9/19 土 | 土曜日 | 同土曜優先、不足時は金土 | 非適用（初日） |
| 9/20 日 | 金曜日・土曜日 | 金土固定 | 適用 |
| 9/21 月・祝 | 金曜日・土曜日 | 金土固定 | 適用 |
| 9/22 火・休日 | 金曜日・土曜日 | 金土固定 | 適用 |
| 9/23 水・祝 | 日曜日 | 火木日（既存の翌日平日祝日ルール） | 非適用（最終日） |
| 9/24 木 | 木曜日 | 同木曜優先、不足時は火木日 | 非適用 |

対象日は「金曜日・土曜日の17時を基準に考えて」。共通短縮labelは「金曜日・土曜日・17時」、夏モードは「夏・金曜日・土曜日・17時」。

## 保存・互換性

JSONのfield構造・schema 3は維持。既存kind/reasonに `long_holiday_middle` を追加し、既存 `weekday_group` と金土を使う。保存済みcontextは書き換えず、context欠損の旧snapshot復元では新ルールを無効にして9-28のreferenceを再現する。新規日次snapshotやAreaCountの既存metadata経路には採用referenceを保持する。

`getAreaCountFallbackWeekdayGroup()` は過去recordの分類にも使われるため変更せず、当日の比較先選択だけを変更した。Supabase/SQL/履歴保存/productionAnalysis、Review19の入力・評価・保存・download、値引率・夏17時快適補正・global/quick・15時・18:30・19:30・20:30のロジックは非変更。

## 変更ファイル

- `src/domain/japaneseHoliday.ts`: 長期連休内部日のpure predicate追加。
- `src/domain/weekdayBase.ts`: 17時の個別量reference分岐と既存kindの値追加。
- `src/domain/areaCountHistory.ts`: 当日の比較group/basis/強制group選択だけ更新。
- `src/domain/analysisMetadata.ts`: 新kindの正規化と旧snapshot復元の保護。
- `src/domain/review19.ts`: context欠損の旧snapshotを復元する既存経路に旧reference保護flagのみ追加。
- `scripts/check-long-holiday-reference.ts`: 専用テスト追加。
- `scripts/check-analysis-metadata-ui.ts`: 対象GW17時の期待更新、他時刻維持assert追加。
- `package.json`, `package-lock.json`: version更新、専用check追加。依存関係非変更。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

AGENTS.md、root SQL9本、version/build生成方法は9-28とbyte-identical。Git repositoryなし、baseline ZIPを比較基準とする。

## 検証

- 全 `check:*` **61/61 PASS**（既存60本＋専用1本）。専用checkは **17/17 PASS**。packageの全check名との集合一致を確認。旧GW中盤17時の期待1件を新仕様へ更新し、15/18:30/19:30/20:30の旧基準を同testで追加確認。
- TypeScript / production build / PWA generateSW PASS（100 modules、precache10）。chunk sizeとBrowserslist dataの既存build警告あり。
- changed-file focused ESLint **0 errors / 0 warnings**。full lint **既存9 errors / 7 warnings**、9-28とのfile/rule/severity/message比較で新規diagnostic 0。
- 専用checkは9/19〜24、単独祝日/祝日前/平日/3連休、翌日が非法定休日の日曜である長期連休土曜、同曜日3件以上から金土固定、normal/summer、旧保存context/欠損context復元/export/cloud用純粋JSON往復、新kind正規化、productionAnalysisを確認。非17時64条件・率/天候/先行率720条件も9-28の固定goldenと一致。
- 独立baseline比較は2025〜2030年の2,191日×全5時刻、normal/summer×6天候条件。基本率・天候関連解決131,460件、基準説明の非reference部分131,460件、global -5/0/+5を含む先行率394,380件が一致。合計762,514assert PASS、個別量reference差分は長期連休内部17時の18日だけ。
- 追加境界監査112assert PASS。2028-05-06/2029-05-05では、同土曜3件・中央値100が存在しても、対象17時は金土6件・中央値55を採用。旧record分類/normalizationは不変で、保存済みcontextと旧snapshot復元はbaseline一致。
- Edge production preview 390×844で10ケース・40画面表示・10履歴比較PASS。9/21・22の通常/夏17時は先行指示→AreaJudge→RateDisplay→次エリアの操作、および別完了fixtureのDoneで金土表示。9/23、15時、7/19三連休を対照確認。fixtureの採用中央値は対象金土60、最終日10、15時30、三連休中間35。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。隔離のService WorkerブロックによるPlaywright警告30件は別記録。スクリーンショット50枚保存、代表6枚を目視確認。
- src96本中5本だけ変更。他91本、root SQL9本、AGENTS.md、version/build/schema生成処理は9-28 ZIPとbyte-identical。三連休判定、履歴record分類/normalizer、率engine、Review19 operational flow、productionAnalysisは維持。保存済みreferenceを新ルールで遡及書換えするmigrationは追加しない。
- GPT-6 Astra / Ultraのみ使用。制限時に中断し、再開時に実行設定を確認した。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。実ブラウザは隔離fixtureを使用し外部通信を遮断した。cloud互換確認は純粋serializationの往復で、実際の送受信ではない。

証跡: `work/longHoliday29/checks.json`、`lint-comparison29.json`、`source-proof29.json`、`edge-proof29.json`、`baseline-integrity29.json`、`browser-work/browser-results29.json`、`browser-work/BROWSER_REPORT_29.md`。ZIP再openとSHAはZIP外のrelease報告/検査JSONに記録。


## Release

- appVersion: `2026.8.9-29`
- buildId: `build-20260921-202716-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260922-0132.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260920-0848.zip`
- baseline SHA-256: `6c425dc4cd28090cdc3b0943fb0ef944eadeff9f7d5cdc27960f8feb7592b9bf`
- ZIP再open検査とSHA-256はZIP外の `outputs/ZIP_VALIDATION_2026.8.9-29.json` / `RELEASE_REPORT_2026.8.9-29.md` / ZIP隣接`.sha256`に記録。
