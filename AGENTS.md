# 値引ヘルパー 開発ルール

このファイルは、このディレクトリ以下の全作業に適用する恒久的なガードレールである。現在のversion、release、既知課題、未実装事項は `CHATGPT_HANDOFF.md` を読む。

## 基本姿勢

- このprojectは、スーパー惣菜の現場運用を支援するWebアプリ「値引ヘルパー」である。現場仕様を推測で変更しない。
- 実装前に、関連する実コード、型、既存test、保存形式、最新CHANGE REPORTを確認する。
- ユーザーの依頼範囲を超える変更、無関係なrefactor、ついでの仕様変更を避ける。
- `AGENTS.md` / `CHATGPT_HANDOFF.md` と実コード・test・Git状態が矛盾する場合は、実コード・test・Git状態を優先し、矛盾を報告する。

## データと業務仕様

- 保存済みデータとの後方互換を優先し、過去recordを現在ロジックで遡及書換えしない。
- `dataSchemaVersion` を必要なく上げない。optional fieldで安全に拡張できる場合は既存schemaを維持する。
- Supabase / DB schema / SQL / RLS / grant / trigger / unique keyを必要なく変更しない。SQLを変更しないreleaseでは既存SQL artifactの同一性を確認する。
- IndexedDB historical archiveとlocalStorage operational headroomの責務分離を壊さない。richなremote/historical dataをlocalStorageへ大量再展開しない。
- current、unsynced、remote未確認、または唯一のauthoritative dataを容量都合で削除しない。App/hook/componentへraw localStorage writeを追加しない。
- Review19のauthoritative archive、lightweight outbox、pendingなし正本のdirect rescue、legacy pending互換を維持する。
- AreaCountのidentity/canonical merge、manual direct backfill、bounded batch、legacy pending互換を維持し、大量rich pendingを復活させない。
- fixed-timeは業務fallbackであり、production Supabase AreaCount READ ONLYを維持する。fixed-timeからproduction record、pending、Review19、finalized day、learning populationへ書き込まない。
- summer / normal分離、曜日reference、曜日group fallback、中央値判定、human raw9、既存5段階手動判定、`globalDiscountAdjustmentPercent`、20:30 forced rule、weather / temperature / Obon / productionAnalysisを、無関係な変更で変えない。
- auto、human observation、manual/quick adjustment、final adopted evaluation、表示値引率を別概念として保存・計算する。
- 当日17時sessionの自動遷移を逃した場合は18:55以降、未実施のReview19を優先する。19:25以降も優先を解除せず、17時snapshot/source保存、既存手動開始との生成処理共用、通知/開始の重複防止を維持し、架空の18:30sessionや測定値を作らない。

## 検証とリリース

- 実装後は関連する既存 `check:*` と新規testを実行し、回帰範囲に応じて `package.json` の全 `check:*` を通す。
- TypeScript、production build、PWA generateSWを確認する。既知baselineと新規lint問題を区別する。
- 実ブラウザ確認と自動testだけの確認を区別し、未確認事項を「確認済み」と書かない。
- 完了報告だけで済ませず、依頼されたコード、build、文書、ZIP等の実成果物を生成して検査する。
- release ZIP名はJSTで必ず `nebiki-helper-YYYYMMDD-HHMM.zip` とし、`fixed`、`final`、`repacked` 等を付けない。
- ZIPへ `node_modules`、`.env`、cache、nested ZIP、credential、不要なtest artifactを含めない。全entry pathは `/` を使い、Windows backslashを入れない。
- ZIP生成後は完成ZIPそのものを再openし、`ZipFile.testzip()`、duplicate、invalid/traversal、single root、backslash、秘密情報、除外物、dist/PWA成果物、version/build metadata、SHA-256を確認する。
