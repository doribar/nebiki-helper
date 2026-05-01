# nebiki-photo-judge 引き継ぎメモ

このフォルダは、値引きヘルパー本体 ZIP に同梱されている写真判定サーバーです。
次の ChatGPT セッションでは、値引きヘルパー本体の `CHATGPT_HANDOFF.md` を先に読み、このファイルも必要に応じて確認してください。

## 役割
- 本体から写真を受け取り、写真セットとして保存する。
- OpenAI API で `多い / どちらでもない / 少ない` の参考判定を返す。
- 値引完了時に本体から送られる人間判定を保存する。
- 次回の同じエリア判定を使い、前回のエリア判定が弱かった / ちょうどよかった / 強かった可能性を付ける。

## 2026-05-01 の重要修正
前回フィードバック対象を、単なる「同じエリアの過去データ」ではなく、以下に限定した。

- 同じ `sessionDate`
- 同じ曜日基準
- 同じエリア
- 現在の値引時刻の直前時刻
- 人間判定済み
- 未フィードバック
- 現在より古い写真セット

これにより、`5月1日15時` の写真セットへ、別日や別時刻の判定で誤ってフィードバックが付く問題を避ける。

## 秘密情報の扱い
- `.env` は ZIP に含めない。
- 実写真や `data/photo-groups.jsonl` も ZIP に含めない。
- APIキーを含む ZIP を共有しない。

## 起動
PowerShell:

```powershell
cd C:\nebiki-helper\nebiki-helper\nebiki-photo-judge
copy .env.example .env
notepad .env
npm install
npm run dev
```

構文チェック:

```powershell
node --check .\src\server.js
node --check .\src\storage.js
node --check .\src\selectExamples.js
node --check .\src\openaiJudge.js
```

## 2026-05-01 追加修正: 元写真アップロード時の上限調整
本体側で端末内圧縮に失敗した場合、撮影フローを止めず元写真を写真判定サーバーへ送る方針に変更した。
そのため、写真判定サーバー側も以下を変更した。

- `MAX_PHOTO_MB` を `.env` で設定可能にした。
- 既定値は `25MB`。
- `.env.example` に `MAX_PHOTO_MB=25` を追加。
- Multer の `LIMIT_FILE_SIZE` / `LIMIT_FILE_COUNT` を日本語エラーで返すようにした。

確認結果: `npm run check` PASS。
