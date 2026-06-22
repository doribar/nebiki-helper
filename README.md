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
同じエリア・同じ時刻・同じ実際の曜日グループ（月水 / 火木 / 金土日）の過去データと比較し、5段階でエリア評価を出します。

- 多い: 表示値引率 +10%
- やや多い: 表示値引率 +5%
- 普通: 補正なし
- やや少ない: 表示値引率 -5%
- 少ない: 表示値引率 -10%

過去データが3件未満の間は、従来通り手動でエリア判断します。
