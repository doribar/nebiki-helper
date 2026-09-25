# 2026.8.9-30 変更報告

検証日: 2026-09-24〜25 JST

## 変更内容

現場で適用する商品policyとして「やや不人気」を追加した。実際に10個以上（10を含む）ある商品だけ、表示値引率へ10 percentage pointsを加える。9個以下は補正しない。大パックと小パックに分かれる場合は、条件を満たす大パックだけが対象で、小パックは補正しない。

商品属性・個数をアプリへ入力する仕組みは既存にもないため、新しい商品入力UI・商品別保存・自動値引計算は作っていない。ユーザーが値引作業中に確認する既存の注意事項へ、次の一項目を追加した。

> やや不人気な商品は、実際に10個以上ある場合のみ表示値引率に+10%。大パックと小パックに分かれている場合は大パックのみ+10%（小パックは補正なし）

商品区分・10個以上・+10%・大パックのみを、既存segment方式の太字で強調する。不人気・見た目が悪い商品の常時+10%、定番・夜によく売れる・広告商品の-10%は文言もpolicyも維持した。20:30で注意事項を表示しない既存UIも変更しない。

## 保存と互換性

`ProductAdjustmentPolicySnapshot` にoptional field `slightlyUnpopular` を追加した。新規 `rateDecisionSnapshot.otherAdjustments.productPolicy` の内容は次のとおり。

```json
"slightlyUnpopular": {
  "adjustmentPercent": 10,
  "minimumActualCount": 10,
  "splitPackTarget": "large_only"
}
```

`minimumActualCount` は実際の商品数の条件であり、エリア残数を集計する際の同一商品10個上限とは別である。このmetadataは当時のpolicyを示し、商品に補正を適用した実績や表示率への自動加算を意味しない。

通常・遅延・先取り・最終の新規snapshot builderは、既存の保存位置へ独立cloneしたpolicyを記録してfreezeする。normalizerは保存されていた内容を検証・複製し、旧snapshotに新fieldがない場合は欠損を保持する。過去recordの書換え・migrationはない。既存state/session/daySnapshot/Review19/archive/finalized/exportのsnapshot伝播を維持する。

## 非変更領域

全96 source中、変更は下記3本だけ。他93本は9-29 ZIPとbyte-identical。値引率計算、天候・夏17時快適補正、曜日reference、global補正、エリア5段階評価・同一商品10個上限、先行値引、Review19、人間評価、productionAnalysis、fixed-time、20:30最終値引、保存責務は変更していない。

root SQL9本、Supabase/schema/RLS、`vite.config.ts`、`dataVersion.ts` は非変更。dataSchemaVersionは3。AGENTS.mdは直前にレビュー・修正した添付版とbyte-identicalで、Supabase新規table/Data APIの最小権限ルールを保持している。

## 変更ファイル

- `src/domain/fullMode.ts`: 注意事項を1項目追加。
- `src/domain/types.ts`: optional policy型。
- `src/domain/rateDecisionSnapshot.ts`: 新規policy・検証clone・旧snapshot欠損保持。
- `scripts/check-slightly-unpopular-policy.ts`: 専用回帰テスト。
- `scripts/check-logic.ts`, `check-full-mode.ts`, `check-feature-20260728.ts`: 注意事項の期待更新。
- `scripts/check-refactor-characterization.ts`: 新metadata2箇所だけの追加を検証し、それ以外は旧exportの文字数・SHA goldenと完全一致させる。
- `package.json`, `package-lock.json`: 9-30へ更新、専用check登録。依存関係は非変更。
- `AGENTS.md`: 直前に修正した添付版を採用。その後の編集なし。
- `CHATGPT_HANDOFF.md`, 本報告、`dist/*`。

## 検証

- 全 `check:*` **62/62 PASS**。package.jsonの全check名と実行結果の集合一致を確認。専用テスト **10/10 PASS**。
- 専用テストはpolicyの条件/値/大小パック、旧5商品補正、4モードの新旧snapshot、厳密な不正値拒否、独立clone/freeze、state復元、実Review19 export、schema 3、同一商品上限と先行率、実TSXの注意事項表示を確認。
- 9-29との独立比較 **6,480条件・19,440 assertions PASS**。新規snapshotは新policy以外一致、旧snapshot正規化は完全一致、新snapshotはJSON往復一致。
- TypeScript / production build / PWA generateSW PASS。100 modules、precache10。chunk sizeとBrowserslist dataの既存build警告あり。
- focused ESLint **0 errors / 0 warnings**。全体lintはbaselineと同じ **9 errors / 7 warnings**。file/rule/severity/messageで新規diagnostic **0**。message内の作業root絶対pathだけを統一し、本文・行番号・source抜粋は変更せず比較。
- Microsoft Edge production previewの自動操作（headless、390×844）で通常15時・夏17時の初回注意事項/通常表示/次エリア表示を確認。OKと「終わった」の操作、新規確定snapshotへのpolicy保存、既存注意事項の維持を確認。代表スクリーンショットも目視確認。
- 横overflow、アプリconsole error/warning、pageerror、外部通信、予期しないdialog/download/popupは0。隔離用Service Workerブロックに伴うPlaywright警告2件は別記録。
- GPT-6 Astra / Ultraのみ使用。利用制限で中断後、再開時も実行設定を確認。

未確認: 実店舗端末、インストール済みPWA、実Supabase通信、長時間background復帰。ブラウザは隔離fixtureと固定時計を使った自動確認で、実店舗データの操作ではない。

証跡: `work/productPolicy30/checks.json`, `baseline-comparison30.json`, `lint-comparison30.json`, `browser-work/browser-results30.json`。ZIP再open検査とSHA-256はZIP外のrelease報告・検査JSONに記録する。

## Release

- appVersion: `2026.8.9-30`
- buildId: `build-20260924-202114-jst`
- dataSchemaVersion: `3`
- ZIP: `nebiki-helper-20260925-0128.zip`（JST生成時刻）
- baseline: `nebiki-helper-20260922-0132.zip`
- baseline SHA-256: `957ce75ba9b46af4de2d0b4eac0eee266fb4d08831f1bfb95922e5f5c8bb3667`
