# CHANGE REPORT 2026.8.9-47

完成JST: 2026-10-09T22:35:00.271207+09:00

- appVersion: `2026.8.9-47` / buildId: `build-20261009-214347-jst` / dataSchemaVersion: `3`
- 完成ZIP: `nebiki-helper-2026.8.9-47.zip`。SHA-256はZIP外の同名`.sha256` / RELEASE_REPORT / ZIP_VALIDATIONを参照。
- baseline: 完成9-46 ZIP `nebiki-helper-2026.8.9-46.zip`、SHA-256 `37a8838570d7b9a6bad485391501e8227b4025cb2a0accd2eb138052caaa39e1`、build `build-20261009-121800-jst`。

## 開始画面の配置変更

`StartScreen.tsx` の既存「曜日」と「時刻」の表示を、同じ親gridへ配置した。左に曜日、右に時刻。各列はラベルを上、既存表示欄を下に置く。gridは `repeat(2, minmax(0, 1fr))`、左右gap12px、子列はminWidth0で、左右を同幅にし間隔込みで画面幅へ収める。既存の文字サイズ・padding12・枠・背景色・fontWeightとラベル下の8px間隔を維持する。

表示順は **全体値引補正→曜日・時刻の2列→天候**。既存の `getWeekdayLabel(sessionDraft.weekday)` / `getDiscountTimeLabel(sessionDraft.discountTime)` をそのまま使い、manual button/select/wheelや新しい入力を追加していない。

production103本のうち変更はStartScreen1本、残り102本は完成46ZIPとbyte-identical。StartScreenも表示JSXの該当ブロック以外は同一。曜日・時刻の自動判定、天候入力中の時刻保持、開始時確定、46版の夕方快適緩和、値引計算、保存・履歴・Review19、注意7項目は不変。

## 変更ファイル

- `src/components/screens/StartScreen.tsx`
- `scripts/check-automatic-weekday-operation.ts`（実TSXの配置/順序/表示35組と既存callback保持を追加）
- `package.json` / `package-lock.json`（versionのみ。check登録・依存関係は不変）
- `CHATGPT_HANDOFF.md`
- `CHANGE_REPORT_2026.8.9-47.md`
- `dist/*`（既存のJST buildId生成方式でproduction/PWAを更新）

SQL9本、AGENTS.md、vite.config.ts、schema定義、過去CHANGE_REPORTは46ZIPとbyte-identical。schema3、新storage field/key、migration、SQL/Supabase変更なし。

## 検証結果

- 全 `check:*` **83/83 PASS**。
- 関連 `check:automatic-weekday-operation` **13/13 PASS**。実StartScreen TSXを展開し、normal/fixedと旧override true/falseでも2列、左曜日/右時刻、label→value、全体補正→2列→天候順を確認。7曜日×5時刻の35組の表示を確認。補正3button callbackと天候入力の時刻lock/次hour copy、表示で追加storage writeがないことを実handlerで確認。
- `check:automatic-time-operation`、天候入力/保持、46快適緩和/フロー、fixed-time、Review19、archive/storage、rate/export等を全checkに含める。
- TypeScript（`tsc -b`）/production build/PWA generateSW **PASS**。107 modules、precache10、最終asset `/assets/index-BAnXC3CL.js`。bundle SHA-256 `670191f2ef3191e607a24e5e5270f61373e8a2a3c8c6b5a23b7ef553336b9fa5`。
- changed-file focused ESLint **0 errors / 0 warnings**。full **9 existing errors / 6 existing warnings**。46版とのfile/rule/severity/message比較で新規diagnostic0。診断内のapplication rootと座標だけ正規化し、本文とcode tokenは保持。eslint例外は追加していない。
- buildのlarge-chunk/caniuse-lite旧データ警告は46版から継続する既存警告。
- 実Microsoft Edge production preview、360×844・390×844、**76ケース PASS**。7曜日×5自動時刻×2幅の配置70ケースと、各幅の15/17天候入力→確定→先行値引→エリア開始および17時入力中の18:25境界を跨ぐ時刻保持6ケース。左右表示欄は360pxで158pxずつ、390pxで173pxずつ、gap12px。ラベルと表示欄の同Y・2行、文字欠け/不要な折返し/横overflowなし。自動表示へのtap/wheelで値が変わらず、manualボタン/selectがないことも実操作確認。console error/warning・不要外部通信0、preview停止。SSR/イベントfixtureだけでブラウザ確認済みとしていない。代表画像は親が別途目視確認。
- 全確認は最終production sourceとbundleのhashを保持して実施。隔離profile・人工予報fixtureを使い、実店舗の保存dataへ書込まない。不要な外部通信を遮断。

## 未確認事項・既存課題

実店舗の物理端末・実タッチ機器、インストール済みPWA、実Supabase通信、長時間background復帰は未確認。ブラウザのtouchはemulation。固定時計のfixtureは実運用のtimer/focus/入力handlerを使い、fixed-time READ ONLYとの区別を維持する。

46版の既存lint診断・build警告、旧summer18:30 sessionを18時前に復元する場合の静的hint不一致は今回の対象外で、既存のまま。配置変更で解決したとはしない。
