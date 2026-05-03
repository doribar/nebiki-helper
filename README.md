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
