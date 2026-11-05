# 変更報告 2026.8.9-60

完成59ZIPを基準に、全体補正前の下限0処理で負の計算値が失われる部分を修正した。appVersion `2026.8.9-60` / buildId `build-20261105-203915-jst` / dataSchemaVersion `3`。

## 計算と表示

`discount.ts`の共通数値coreへ元のnormal/manyを渡し、負値を保持する。既存の上限50処理→旧先取りoffset→上限50は維持し、その後global±5を1回加算して0〜50へ整える。現行15/17は先取りなし。天候・快適・エリア・遅延+5は従来の解決結果を入力とし、判断や業務条件は変更していない。

| global+5の直前の実計算値 | 59の最終率 | 60の最終率 |
| --- | --- | --- |
| -10% | 5% | 0% |
| -5% | 5% | 0% |
| 0% | 5% | 5% |
| 5% | 10% | 10% |

多い5%・どちらでもない-5%の例は、59の10%/5%から60の10%/0%へ修正。両方が負の場合（多い-5%/通常-15%）も5%/5%→0%/0%。実際のraw0を、負値を0表示したケースと混同しない。

15/17の境界前の多い5%/通常-5%、global+5は10%/0%。既存の16:00/18:00以降のlate+5後は元計算が10%/0%となり15%/5%。クリック時のfresh時計も同じcoreへ渡る。全体0/−5の表示率、通常/夏季、上限付近を59の実計算と比較して維持した。上限例は多い55%→50%→global−5=45%（55−5=50へは変更しない）。

作業中指示、Done現在推奨率、新規確定率・snapshotは同じ数値coreを使用する。内訳は-5%→global+5→0%と表示し、失った負値を文字列から推測しない。通常display APIのキー順many/few/normalも従来どおり。先行値引・冷惣菜独自式、引かない、商品policy、8注意事項、rate上限、画面進行、時計・lower制限は変更なし。

## 保存互換

新規通常/late/互換early snapshotにoptional3項目：`calculationOrder: "global_before_lower_limit_v1"`、`normalRateBeforeGlobalAdjustmentPercent`、`manyRateBeforeGlobalAdjustmentPercent`。前者で計算順を明示し、後者が符号付きのglobal入力を保持する。既存`normalRatePercent`/`displayed*BeforeGlobalAdjustmentPercent`はglobalなしの0〜50表示値の意味を保持する。`displayed*`最終率と新signed値・各補正量を照合できる。

markerがない旧snapshotは旧式と旧limitsで検証し、新方式をversionや現在履歴から推測しない。真正59snapshot9本を使い、旧5%・metadata欠損・旧先取り・上限を、normalize/state復元/daily/daySnapshot/分析/Review19JSON export後も保持することを確認。旧snapshotは新しい式で無効化・再計算・補完しない。

Doneは既存の現在推奨率表示なので、旧確定5%に対し現在推奨0%となる場合がある。原本snapshotとcompleted textは5%のまま。新しく明示確定したsnapshotだけ0%になる。新limitsは実際の最終下限処理を記録するため、旧互換earlyのraw0/offset-5/global0では新lower flag=true（旧falseは過去データのまま）。率はいずれも0%。schema3、新storage key/migrationなし、SQL9本・Supabase構造・AGENTS.md変更なし。

## 変更ファイル

- `src/domain/discount.ts`、`globalDiscountAdjustment.ts`：共通数値stagesと明示signed入力。
- `src/hooks/nebikiApp/ratePresentation.ts`：指示・Done数値・完了fallback・補正内訳の共用。
- `src/domain/rateDecisionSnapshot.ts`、`types.ts`：新方式識別と旧snapshot互換。
- `scripts/check-global-negative60.ts`、`scripts/fixtures/global-negative60-v59.json`：専用検証/真正59oracle。
- 既存`check-daytime-time49.ts`、`check-refactor-characterization.ts`、`check-slightly-unpopular-policy.ts`、`check-evening-comfort-relief.ts`：境界追加と新metadata/計算順を検証。旧JSONgolden・旧fixtureは保持し、追加fieldだけ検証後に除いて旧goldenを照合する。
- `package.json`/`package-lock.json`：version更新、checkを1本追加。依存/build手順は不変。
- `dist/index.html`、`dist/assets/index-*.js`、`dist/sw.js`、`CHATGPT_HANDOFF.md`、本報告。過去報告は不変。

## 検証

- 全check **99/99 PASS**。専用 **23/23**：59の4224件の率/表示比較、4032件のsigned計算、3780件の先行/冷惣菜比較、真正旧snapshot9本、new/oldの保存/復元/分析・Review19 exportを確認。
- 既存hook境界チェック **33/33**（元17を保持＋16追加）。15/17×通常/夏季の境界-1ms/ちょうど/+1ms、古い境界前クリックで操作時点の率を新規確定することを確認。
- TypeScript / production build / PWA generateSW **PASS**（111modules / precache10）。既存のchunk500kB超、Browserslist更新案内が残る。依存更新は今回行っていない。
- full lint **7 existing errors / 5 existing warnings**、focused **1 existing error / 0 warnings**。59の9 errors/5 warningsとfile/rule/severity/messageで比較、新規診断0。旧helper削除に伴う未使用引数2件のみ減少。新規/変更testは0/0。
- Edge **32/32 PASS**（60の16＋59比較16、360/390×844、headless/touch人工データ）。入力→評価→両指示→確定→Done、G0/−5/真の0、15/17遅延境界、上限、旧5%のreload/daily保持を実操作。取得bundle hashも最終buildと照合。横overflow/文字欠け/アプリconsole error・warning/外部通信なし。SW遮断のハーネス通知は別計上。
- 独立source audit PASS。src108本中5本のみ変更、残り103・注意事項・SQL9・AGENTS・過去CHANGE68は59ZIPとbyte-identical。真正oracleは完成59ZIPから独立再生成してbytes一致を確認した。

## 未確認事項

実店舗物理端末、インストール済みPWAのSW更新/長時間運用、実Supabase通信は未確認。固定時計・旧exportの網羅は自動testであり、物理端末での実操作ではない。保留中の曜日文言と夏17時の中間評価案内の不一致は既知のまま維持する。

## 成果物

`nebiki-helper-2026.8.9-60.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-60.md`、`ZIP_VALIDATION_2026.8.9-60.json`。完成ZIPを再openしCRC・file集合/bytes・除外物・version/build/schema・dist/PWA・SQL/AGENTS同一性・SHA-256を検査する。
