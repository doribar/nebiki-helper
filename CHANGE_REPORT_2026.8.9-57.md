# 変更報告 2026.8.9-57

完成56 ZIP（SHA-256 `92edae56dcf8d1ee6666704a8236f58c14d20540b34fc60e19dde662515dfc12`、build `build-20261020-211241-jst`）を比較基準に、全体値引補正の操作場所・状態表示・当日失効を変更した。appVersion `2026.8.9-57`、buildId `build-20261021-170010-jst`、dataSchemaVersion `3`。Git repositoryはなく、差分は完成ZIPとの集合/bytes/hash比較による。

## 操作と表示

トップの常設選択欄を削除し、既存AdminSettingsDialogへ−5％/なし/＋5％を移した。現在の当日設定をaria-pressedで表示し、開き直し/同日reloadでも維持する。対象日（日本時間）と「新しく始める作業に適用し、日本時間の日付が変わると『なし』に戻ります」を表示。Review19全件/最新JSON、同期、容量確認等は保持する。

トップには、実際に開始/再開する作業の補正が非0の時だけ「全体値引補正：＋5％適用中」または「全体値引補正：−5％適用中」。0では要素/見出し/枠/余白を生成しない。非0の再開時は「再開する作業の補正です」と添える。設定と再開値が異なる場合は、設定画面に再開が保持する開始時補正を併記する。

## 採用タイミングの維持

新規開始/15→17は当日設定、同日・同じ値引時刻・timeSwitchTargetなしの再開はsessionが採用済みの値を保持する。旧欠損値は既存どおり0。共有pure helperをトップとstartSessionで使う。

例: 15時を＋5で開始した後、設定を−5へ変更しても、その15時の再開は＋5。設定は−5選択、トップは「＋5％適用中/再開する作業の補正です」、設定内には「再開する作業は開始時の補正（＋5％）を保持します」。その後に新しい17時を始める時は−5。過去に保存した15時の補正/率/snapshotを変更しない。採用済み0・当日＋5の再開ならトップに補正枠は出ず、設定内の説明で再開0を確認できる。

成功した設定値はstateとrefへ同時反映し、同一React batchで設定直前の開始handlerを呼んでも最新の保存成功値を採用する。保存失敗はfalseを返し、選択/トップ/開始値を変えずアプリ内エラーを表示する。

## 既存の日付保存の再利用と補強

既存version1/date/adjustment state、production/fixed別の2key、load/normalize/select、結果を返す安全なsaveをそのまま使用する。新しいkey/永続field/migrationは作らない。従来は選択/更新/再loadがsessionDraft.dateを使い、前日のdraft復元で古い日付の設定を読み直す余地があった。これをruntime時計から得るJST現在日付へ限定する。業務日の保存値を設定日へ転用しない。

`getGlobalDiscountAdjustmentDate()` はUTC時刻をJSTへ変換するpure helper。起動/描画/操作の日付照合と既存00/30の時計/focus/visible更新を使う。専用timer・毎秒pollは追加しない。日付不一致は即0で、hookの当日stateとAppの日付observerが既存saveでcanonicalな当日設定へ戻す。App側はDateChangedBlockerがAppRootをunmountする前に処理し、設定を開いたままの日付跨ぎも扱う。同日refreshでreset書込を反復しない。

保存失敗で物理keyが前日値のままでも、旧dateは有効でなく、メモリ/表示/新規開始は0。翌日起動/reload/旧draft/checkpoint/current復元でも現在日付に対するload/selectから0になる。古い前日設定handlerは操作時の日付不一致を拒否し、現在日の状態を読み直す。その拒否操作自体では旧選択を新日に保存しない。既存の次回時計/復帰observerが物理保存を正規化するため、即時のlogical失効と物理key書換えを区別する。新日へ更新後、明示的に選び直した値はその日の選択となる。

前日の開始handlerも日付が変わっていれば開始せず時計を更新する。JST端末では既存DateChangedBlockerが前日の作業継続を止める。既存sessionの業務日・履歴を今日へ付け替えない。端末timezoneがJST以外でも補正はJSTで失効するが、既存の端末ローカル日付による業務日ブロック自体の仕様は今回変更していない。

固定時計では既存runtime overrideとfixed専用設定keyを利用し、外側Appの日付observerからproduction設定を書かない。既存READ ONLY・production履歴/queue保護を維持する。

## 計算・保存への影響

補正の加算位置、0〜50 clamp、二重適用防止、作業中の内訳/補正前後表示は変更しない。session/AreaCount/rateDecisionSnapshot/daySnapshot/finalized/Review19/exportに採用済みの補正をreset対象にしない。設定変更/日付変更だけで確定済み評価や率を再計算しない。

56の最終many late15二段階、他判定の一段階、17時二段階/18時基準、55秋除外/priority復帰、Done取消線/色、遅延+5/lower期限/higher、46快適補正/48三連休/52祝日日曜優先を維持する。RateDisplayScreen/DoneScreen/計算core/歴史export builderは56とbyte-identical。SQL/Supabase構造/schema3/AGENTSは変更なし。

## 変更ファイル

- `src/components/screens/StartScreen.tsx`: picker削除、開始/再開用の非0状態だけ表示。
- `src/components/common/AdminSettingsDialog.tsx`: controlled picker、当日説明/再開値差/保存失敗表示。
- `src/app/App.tsx`: props接続、既存aligned日付observerからunmount前の当日設定正規化。
- `src/app/AppRouter.tsx`: トップへ開始/再開用の採用値と再開状態を渡す。
- `src/domain/globalDiscountAdjustment.ts`: JST設定日と開始時採用のpure helper。既存state/key/load/save/rate関数は維持。
- `src/hooks/useNebikiApp.ts`: 現在JST日付でのselect/load/更新、日付変更、stale設定/開始操作の拒否、成功ref、共有採用処理。
- `src/domain/types.ts`: 当日/開始用derivedとboolean設定結果の型。保存schema変更なし。
- `scripts/check-global-settings57.ts`: 実hook/Router/Start/Adminイベントを使う専用検証。
- `scripts/check-global-discount-adjustment.ts`: 既存計算/保存/snapshotを残し、UI配置期待を設定へ更新。
- `scripts/check-advance-discount-flow.ts`: 実startSession依存の更新と既存採用保証の維持。
- `scripts/check-automatic-weekday-operation.ts`: 非0トップ状態を使い既存2列/曜日操作廃止保証を維持。
- `scripts/check-refactor-characterization.ts`: public derived追加分を契約へ明示。
- `package.json` / `package-lock.json`: 版更新と専用check1本。依存/既存checkコマンドは不変。
- `dist/*`、`CHATGPT_HANDOFF.md`、本報告。

src107中7本変更/100本保護、SQL9・AGENTS・過去CHANGE65・Vite/dataVersion/depsは56ZIPとbyte-identical。

## 自動検証

- 全check **97/97 PASS**。57専用 **35/35 PASS**。既存global10件、advance flow51件、weekday13件を含み、従来保証を削らず操作場所を更新。
- 専用テストはJST±1ms/offset、−5/0/＋5、保存失敗/retry、開閉/reload、当日設定と再開値/legacy欠損、同一batchの成功/失敗値、midnight/focus/visible/hidden、reset保存失敗、stale設定/開始、旧current/checkpoint/draft、15→17、fixed分離、snapshot/export不変を実行。実TSX host tree/hook dispatcherによるテストでありブラウザpaint/実DB通信とは区別する。
- TypeScript / production build / PWA generateSW **PASS**（110 modules/precache10）。
- focused ESLint **0 errors / 2 existing warnings**、full **9 existing errors / 5 existing warnings**。56とのfile/rule/severity/message比較で新規0・削除0。full lintそのものはexit1でありcleanとは報告しない。bundle-size/Browserslist案内は既存。
- 独立source audit finding0、check入力221/build入力122を凍結してsource/buildとの一致を照合。

## 実ブラウザ

installed Edgeのproduction previewで360/390×844、人工データ/時計による **32/32 PASS**。トップ0時の要素不存在、設定±5/なし/開閉/選択/reload、前日setting0、当日settingと復元session採用値の表示/開始、既存設定操作、JST境界のtimer/focus/visible/設定中/古いイベント、保存失敗、fixed分離を確認。JST以外のtimezoneでも補正のJST日付と失効を確認した。通常のApp日付ブロックとnon-JST環境の業務日挙動は区別する。

横overflow、新規アプリconsole error/warning、不要な外部通信0。service workerをテストprofileで遮断したharness通知、保存失敗fixtureの意図したdiagnosticは別計上し、アプリ不具合としても確認漏れとしても隠さない。詳細はZIP外`work/globalSettings57/browser-work/browser-summary57.json`/ケース証跡/画像。Sourceと配信bundleのhashを一致させ、appへ一時instrumentationを入れていない。

## 未確認事項と完成物

物理スマートフォン/店舗実機、installed PWAでの実日付を跨ぐ長時間バックグラウンド、実Supabaseへの送受信は未実施。日付境界は人工時計・isolated storageを用いた実Edge/自動testで確認した。既存保留の曜日基準文言・夏17時の案内と中間評価の不一致は変更していない。

完成物は`nebiki-helper-2026.8.9-57.zip`、`.zip.sha256`、`RELEASE_REPORT_2026.8.9-57.md`、`ZIP_VALIDATION_2026.8.9-57.json`。完成ZIPを再openしCRC・path/case重複/除外物/credential/symlink、対象file集合/全bytes、version/JSTbuild/schema、dist/PWA/cache参照、SQL9/AGENTS同一性とSHAを検査する。ZIP内に自己参照SHAは埋め込まず、完成ZIPのSHAはZIP外報告/検査JSONへ記録する。
