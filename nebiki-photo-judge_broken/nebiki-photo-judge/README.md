# nebiki-photo-judge

値引ヘルパー本体に組み込む前の、写真判定テスト用ローカルアプリです。

## できること

- エリア・曜日・時刻を選ぶ
- 写真を1枚または複数枚アップロードする
- OpenAI APIで「多い / 少ない / どちらでもない」の参考判定を出す
- 人間の最終判定を保存する
- 写真セット単位で `data/photo-groups.jsonl` に履歴を残す

## Windows 11 / PowerShell での起動

```powershell
Expand-Archive .\nebiki-photo-judge.zip -DestinationPath C:\nebiki-photo-judge -Force
cd C:\nebiki-photo-judge\nebiki-photo-judge

copy .env.example .env
notepad .env
npm install
npm run check
npm run dev
```

ブラウザで開きます。

```text
http://localhost:3000
```

## OpenAI APIキー

`.env` の `OPENAI_API_KEY=` にAPIキーを入れてください。

未設定でも写真保存と最終判定保存は試せますが、AI参考判定は「APIキー未設定」と表示されます。

## 写真の保存場所

```text
data/photos/<photoGroupId>/
```

に保存されます。

## 履歴データ

```text
data/photo-groups.jsonl
```

に1行JSONで保存されます。

## 注意

- 店内写真に人・顔・レジ画面・内部掲示などが写らないようにしてください。
- AI判定は参考です。最終判断は人間が行う前提です。
- 最初は値引ヘルパー本体と連携せず、単体で判定の使い心地を確認してください。
