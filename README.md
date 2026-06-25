# 値引きヘルパー

惣菜・弁当売場向けの値引き判断補助アプリです。
React + TypeScript + Vite で動きます。

## 起動方法（Windows 11 / PowerShell）

```powershell
npm install
npm run dev
```

表示された URL をブラウザで開きます。
通常は以下です。

```text
http://localhost:5173
```

スマホから Tailscale 等で開く場合は、PC側で以下のように起動します。

```powershell
npm run dev -- --host 0.0.0.0
```

## 確認コマンド

```powershell
npm run check:logic
npm run build
```

## 現在の方針

AI写真判定は廃止済みです。写真判定サーバー、写真撮影画面、AI参考判定表示は含めていません。

祝日ルールを含む曜日基準補正は `src/domain/weekdayBase.ts` と `src/domain/japaneseHoliday.ts` を確認してください。


## エリア残数判定

通常値引の全時刻（15時 / 17時 / 18時30分 / 19時30分）で、エリア全体の商品数を入力できます。
同じエリア・同じ時刻・同じ実際の曜日の過去データを優先して比較し、足りない場合だけ暫定曜日グループ（月水 / 火木 / 金土日）にfallbackして、5段階でエリア評価を出します。

- 多い: 表示値引率 +10%
- やや多い: 表示値引率 +5%
- 普通: 補正なし
- やや少ない: 表示値引率 -5%
- 少ない: 表示値引率 -10%

過去データが3件未満の間は、従来通り手動でエリア判断します。

## エリア残数履歴のサーバー保存

この版では、Supabase設定がある場合だけエリア残数履歴をサーバー保存します。設定がない場合は従来通りlocalStorageだけで動きます。

### 1. Supabase側の準備

SupabaseのSQL editorで `supabase_area_count_records.sql` を実行してください。

### 2. Vercel環境変数

Vercelに以下を設定して再デプロイしてください。

```text
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=Supabaseのanon public key
```

### 3. 保存・読み込みの挙動

- 起動時にサーバーの `area_count_records` を読み込み、端末内のlocalStorage履歴とマージします。
- エリア残数判定を確定して次へ進むと、localStorageとSupabaseの両方へ保存します。
- Supabase未設定、または通信失敗時はlocalStorageだけで継続します。
- ステップURLは残しますが、エリア残数履歴はstep1〜step5・通常版で共通です。


### 4. ローカル履歴のサーバー送信

Supabase設定前にlocalStorageへ保存したエリア残数履歴がある場合は、トップ画面の「ローカル履歴をサーバーへ送信」からSupabaseへ送信できます。

- 同じ記録がSupabaseにある場合は上書きされます。
- localStorageは作業中データ・キャッシュとして残ります。
- 判定に使う履歴は、起動時にサーバー履歴と端末内履歴をマージしたものです。

## 自動遷移

各値引の天候入力・値引準備開始時刻になると、完了画面以外にいても次の値引へ自動遷移します。

- 15時値引: 14:40から15時値引扱い
- 17時値引: 16:40から17時値引扱い
- 18時30分値引: 18:25から18時30分値引扱い
- 19時30分値引: 19:25から19時30分値引扱い
- 20時30分最終値引: 20:25から20時30分最終値引扱い。天候入力なしで最終値引画面へ進みます。

開始ボタン自体は時刻でロックしません。15時値引などの値引率表示を確認したい場合、必要な天候入力が済んでいれば開始時刻前でも進めます。
