# Supabase同期エラー診断UI・verify artifact修正

## リリース情報

- 基準ZIP: `nebiki-helper-20260811-1042.zip`
- appVersion: `2026.8.9-3`
- buildId: `build-20260811-130021-jst`
- dataSchemaVersion: `3`

## 1. 実装概要

管理設定のSupabase同期欄に、pendingが存在する場合だけ「エラー詳細」を追加しました。現在の実使用端末に残る165件を含め、既存の `nebiki-helper/pending-supabase-sync-v1` に保存済みの `lastError` を原因別に確認・コピーできます。

この変更は同期失敗の原因を推測して直すものではありません。165件の原因は未解決であり、新版を実端末へdeployしてコピーしたerror本文を確認した後に判断します。

同時に、実DBで判明した `supabase_area_count_records_cloud_sync_verify.sql` の改行依存による誤失敗を修正しました。実DBの `guard_review19_records_update()` 自体は正常であり、DB schema、migration、guard runtime、RLS、unique keyは変更していません。

## 2. 変更ファイル

### アプリ／domain

- `src/domain/supabaseSyncDiagnostics.ts`（新規）
- `src/components/common/AdminSettingsDialog.tsx`
- `src/domain/types.ts`
- `src/hooks/useNebikiApp.ts`
- `src/domain/areaCountRemoteStorage.ts`
- `src/domain/review19RemoteStorage.ts`

### SQL／テスト

- `supabase_area_count_records_cloud_sync_verify.sql`
- `scripts/check-supabase-sync-diagnostics.ts`（新規）
- `scripts/check-supabase-cloud-sync-sql.ts`
- `scripts/check-review19-remote-storage.ts`
- `scripts/check-refactor-characterization.ts`
- `package.json`
- `package-lock.json`（project versionのみ）

### 文書／生成物

- `README.md`
- `CHATGPT_HANDOFF.md`
- 本変更報告
- `dist/**`（appVersion/buildIdを埋め込んだ本番build／PWA生成物）

## 3. pending group方式

診断は既存queueを変更しない純粋な読取モデルです。group keyは次です。

```text
record type × demandCycle × sanitized lastError
```

- type: `area_count` / `review19`
- cycle: payload直下の正式な `demandCycle` が `normal` / `summer` の場合だけ採用
- cycle欠損・legacy・不正値: `unknown`（UIは「不明」）
- `lastError`なし／空欄: 「エラー未記録」group

各groupは件数、試行回数の最小〜最大、最初の失敗時刻、最後の試行時刻、error本文を持ちます。group件数の合計はpending総数と一致し、165件が同じ原因なら1 groupとして表示します。

長いerrorは画面上でpreviewと「全文を表示」に分けますが、コピー時はsanitization後の全文を保持します。payload全体や165件分のrecord JSONは表示・コピーしません。

## 4. コピー内容とsecret sanitization

「エラー内容をコピー」は次を出力します。

- appVersion / buildId / pending総数
- group番号
- type / demandCycle / 件数
- 試行回数または範囲
- 最初の失敗 / 最後の試行
- error全文

表示・コピー前に次を除去します。

- Authorization / Bearer / Basic
- Cookie / Set-Cookie
- API key / anon key / service role key
- access token / refresh token / JWT
- Supabase key形式
- URL userinfo、Supabase project URL、`.env`名

HTTP status、PostgRESTのcode／message／details／hint、constraint、column、schema、tableは原因調査に必要なため保持します。Clipboard API非対応・権限拒否時は例外をアプリ外へ出さず、画面に「コピーできませんでした」と表示します。

## 5. 既存pendingとlastError

queue key、item schema、identity、CAS、in-flight guard、retry回数・時機は変更していません。したがって新版起動前に保存済みの165件も破壊的migrationなしでそのまま表示対象です。

新規のHTTP失敗についてだけ、Supabase／PostgREST response bodyから安全な `code`、`message`、`details`、`hint`、`constraint`、`column` 等を `lastError` へ保持できるようにしました。非JSON本文もcredentialを除去して保持します。これにより単なる `HTTP 400` より詳しい診断が可能です。送信payload、retry判定、成功／失敗判定は変更していません。

## 6. UIと更新

- pending 0: エラー詳細を表示しない
- pending 1件以上: 折りたたみの「エラー詳細（N件）」を表示
- group単位のcardだけを生成し、item数分のcardは生成しない
- 長文は `pre-wrap`、`overflow-wrap:anywhere`、`word-break:break-word`、横方向hidden
- 再同期後は既存のcloud-sync version更新でqueueを読み直し、165→20→0へ即時追従
- fixed-time modeではqueueを読まず、pending／groupを0にして本番情報を表示・変更しない

## 7. verify SQL誤失敗の修正

旧verifyは `pg_get_functiondef()` に次の連続1行文字列があることを要求していました。

```sql
old.recorded_at is null and new.recorded_at is not null
```

実DBのPL/pgSQL定義は `old.recorded_at is null` と `and new.recorded_at is not null` の間に改行があるため、意味的に正しいguardを誤って失敗扱いしました。

現行verifyは `lower(pg_get_functiondef(...))` に対して、

```sql
regexp_replace(..., '[[:space:]]+', ' ', 'g')
```

で空白・改行・インデントを正規化した後に検証します。次の4条件は弱めず維持しています。

1. final → partial禁止
2. older `source_updated_at`禁止
3. equal source revision guard
4. 同時刻のpartial → final例外許可

静的testはmigration内の実際の複数行関数をfixtureとして使い、生の関数定義へ1行完全一致していないことと、4条件がすべて残っていることを確認します。

## 8. DB／migration

- 新規migration: なし
- schema変更: なし
- `area_count_records`: 変更なし
- `review19_records`: 変更なし
- guard関数runtime: 変更なし
- unique／index／RLS／policy: 変更なし
- backup／rollback SQL: 変更なし

利用者報告では、cloud-sync migrationは実DBへ適用済みで、手動修正した旧verifyは全体完走済みです。この開発環境には実DB接続情報がないため、修正版verifyを実DBで再実行済みとは報告しません。

## 9. 既存仕様への影響

normal／summer同期、pending enqueue／retry、CAS、in-flight lock、backfill、rich merge、local／remote dedupe、9段階detail、legacy scale 5、Review19 partial／final／median、fixed-time隔離、20:30最終値引、夏季モード、気温快適度、完了画面動的率、JSON exportは変更していません。

`dataSchemaVersion`は業務JSON schemaのversionです。今回の変更は管理UI、既存pendingの読取診断、安全な任意error本文、verify artifactであり、業務JSONの破壊的変更がないため `3` を維持します。

## 10. 検証結果

- 全 `check:*`: **27 / 27 script PASS**
  - `check:supabase-sync-diagnostics`: **20 / 20 PASS**
  - `check:supabase-sync-domain`: **19 / 19 PASS**
  - `check:review19-remote-storage`: **12 / 12 PASS**
  - `check:supabase-cloud-sync-sql`: **5 SQL artifact PASS**
  - `check:human-evaluation-9scale`: **14 / 14 PASS**
  - `check:review19-human-auto`: **24 / 24 PASS**
  - summer-mode、demand-cycle、temperature-comfort、done-summary-current-rate、20:30／schema-v3、exportを含む既存checkもPASS
- TypeScript: `npx tsc -b` **PASS**
- 変更対象ESLint: **error 0、warning 4**
  - 4件は `useNebikiApp.ts` に従来からあるHook依存配列warningで、今回変更行ではありません。
- 本番build: `npm run build` **PASS**
- PWA generateSW: **PASS**
  - `dist/manifest.webmanifest`
  - `dist/registerSW.js`
  - `dist/sw.js`
  - `dist/workbox-9c191d2f.js`
- `dist`識別情報: `2026.8.9-3` / `build-20260811-130021-jst`を確認
- 390×844実画面:
  - 設定ダイアログの横スクロールなし
  - pending 0でエラー詳細非表示
  - appVersion／buildId／schema表示を確認
  - console error／warningなし
- pendingありの本番queueは検証用に改変していません。165件集約、複数group、長文、コピー、secret除去、retry後の再生成、fixed-time隔離はpure domain／source接続テストで確認しました。
- 実DB: この開発環境には接続情報がなく、修正版verifyの実DB再実行は未確認です。利用者報告のmigration適用・guard正常・手動修正版verify完走を前提情報として記録しています。

## 11. 実端末での次の確認

1. 新版を実使用端末へdeploy
2. 管理設定を開く
3. 「端末内データをSupabaseへ同期」を実行
4. 「エラー詳細」を開く
5. 「エラー内容をコピー」を押す
6. コピー結果をChatGPT／Codexへ提示して165件の原因を特定

## 12. 成果物

- ZIP: `nebiki-helper-20260811-1306.zip`
- ZIP直下: `nebiki-helper/` の1フォルダ
- `dist`収録済み
- `node_modules`、`.env`、API key、元ZIP／中間ZIPは除外
