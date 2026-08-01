# リリース識別情報修正報告（2026-08-01）

## 識別情報

- appVersion: `2026.8.1-1`
- buildId: `build-20260801-234913-jst`
- dataSchemaVersion: `3`（変更なし）

## 変更内容

- `package.json`のプロジェクトバージョンを更新
- `package-lock.json`のルートプロジェクト自身のバージョン2箇所だけを同期
- `README.md`と`CHATGPT_HANDOFF.md`の現行リリース識別情報を同期
- buildIdの自動生成をOSのローカルタイムに依存しない`Asia/Tokyo`基準へ変更
- buildIdを`build-YYYYMMDD-HHMMSS-jst`形式へ統一
- appVersionを検証する既存テストの旧日付期待値だけを更新
- 新しい識別情報を指定して本番ビルドとPWAを再生成

## 変更していないもの

- 気温区分および気温低下中ロジック
- 値引率、天候、曜日、祝日、エリア判定、19時チェック、20時30分最終値引
- UI、CSS、保存仕様、Supabaseスキーマ・SQL
- 依存関係

## 検証結果

- 気温専用回帰テスト: 成功（12/12）
- 全テスト: 成功（18/18スクリプト）
- TypeScript型チェック: 成功
- 変更対象ESLint: 成功
- 本番ビルド: 成功（72 modules transformed）
- PWA生成: 成功（10 precache entries）
- `dist`内のappVersion/buildId: 確認済み
- Supabase SQL: 差分なし
- package-lock依存関係: 差分なし

`dist`では埋め込み識別情報が変わるため、JavaScriptアセット名・内容、`index.html`の参照先、Service Workerのprecache情報だけが再生成されています。
