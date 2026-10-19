# 変更報告 2026.8.9-55

完成54 ZIP（SHA-256 `23daa050f822e25328b5e0ec7e7274e4ebb83fe0fa5b77885e0d9e30a6e2ee11`）を比較基準に、秋商品の一時無効化と多い側の明示スキップへの優先復帰を追加した。appVersion `2026.8.9-55`、buildId `build-20261019-160904-jst`、dataSchemaVersion `3`。Git repositoryはなく、差分は完成ZIPとのfile/byte/hash比較による。

## 秋商品・履歴互換

`area.ts`の単一disabled setでautumnを操作対象から外す。新10月作業は11、天ぷら→コロッケ系。6〜9月のryomi12、12〜5月11は維持。入力/判定/指示/Done/後回し/訂正/Review19の候補と件数を揃える。解除日・自動復活・toggleは作らない。

autumnのID/name/type/履歴/AreaCount/同期/旧確定評価・率・snapshot・productionAnalysisを保持する。旧進行中のmapの原観測を消さず、現在の作業先と候補だけをactive routeへ退避。戻る/Undo/訂正returnを同じ境界で確認する。旧未記録Review19の対象を11へ変更した際はqualityも11で再解決し、記録済み12のqualityは変更しない。

`DailySessionSnapshot.expectedAreaIds`をoptional追加。新規作業の分母11と、保持した旧autumn観測を区別する。未観測autumnから0/少ない/skip/完了/欠測/製造不足を作らない。旧Done12の対象数、旧snapshotのfield欠損、秋導入前11を保存。新Review19は11対象のまま旧17source12を保持でき、日次exportは各session自身の分母を尊重する。既存productionAnalysisの計算定義は不変で、過去のautumn分析をmergeで落とさない。

## 優先復帰・通常の続き

active route内、status `skipped_manual`、最新の採用済み5段階がmany/slightly_manyだけを候補にする。元auto/補正前/areaJudgeから推測せず、保存済み中間評価も再解決しない。多い/やや多いは同順位、現在完遂areaからgetAreaOrderの絶対差が小さい順、同距離は既存順の昇順。候補をqueueに複製せず、全手順完遂後にlive mapから選び直す。

例①はフライskip→焼鳥完遂→フライ完遂→中華。例②はフライskip→焼鳥skip→中華完遂→近い焼鳥完遂→フライ完遂→おにぎり。normal/summer・15/17の両方を実hook/TSX操作で確認した。

`priorityReturnContext`はsessionStartedAt/date/timeとnormalResumeAreaIdだけ。優先復帰に入る直前の通常の続き（例②おにぎり）を保持し、候補が尽きたらそこへ戻す。通常終了後は従来一般pending/Doneへ接続。普通以下・未判定・few後回し・auto-skip・completed・autumnは新優先群へ混ぜない。残数訂正は既存returnを優先し、復帰先が無効autumnなら原観測を残してactiveへ退避する。

skip直後/残数/判定/1段階目/auto-skip確認はpriority triggerにしない。優先先の再skipは即自身へ戻らず通常続きへ進み、別area完遂後に再候補となる。最後1areaのskip拒否、未完了優先15→17、Back/Undo/reload/top再開、古いevent拒否を維持。session/date/time不一致のcontextは引き継がず、新session開始でもclear。移動のみでは完了snapshotを作らない。

54のlate15一段階/late17二段階・18時reference・Done取消線・fresh完了時計/重複guardは保持。skipも最新area/progress/sessionとの照合を追加し、古いskipが優先先を変更しないようにした。保存失敗・再試行の責務、fixed READ ONLYは既存どおり。

## 変更ファイル

- domain: `area.ts`（active/保存route分離）、`pending.ts`（priority/active候補）、`types.ts`（optional context/expected）、`review19.ts` / `finalizedDayData.ts`（旧analysis保持）、`dayExport.ts`（sessionごとの保存分母）、`storage.ts`（既存snapshot分母/欠損維持）。
- hook: `useNebikiApp.ts`（完遂→priority/通常続き/skipguard/訂正戻り/旧復元）、`normalFlow.ts`（activeと続き）、新 `priorityFlow.ts`（session限定context）、新 `operationalAreas.ts`（旧inactive退避/liveReviewquality）、`stateNormalization.ts`（optional context互換）、`timeTransitions.ts`（active対象のみ/旧map保全）、`review19Flow.ts`（新11/旧source保全）、`sessionSnapshots.ts`（分母と観測の分離）。
- 新test: `check-disabled-autumn55.ts`、`check-priority-pending55.ts`、`check-priority-flow55.ts`。既存test更新: `check-seasonal-areas.ts`、`check-advance-discount-flow.ts`、`check-early-next-17-continuity.ts`、`check-review19-all-export.ts`。新規11の期待値と旧12fixtureを分離し、実production依存をVMへ供給する。既存保証を省略しない。
- `package.json` / lockはversionとcheck3登録のみ、依存/build方式不変。`dist/*`、引継ぎ、本変更報告。過去CHANGE63、AGENTS、SQL9は変更なし。

src107のうち既存13変更+2追加、保護92は完成54ZIPとbyte-identical。rate/median/weekday/weather/comfort/global/product/human解決/clock/SQL/Supabase構造は不変。schema3、storage key/migration追加なし。

## 検証

- 全check **95/95 PASS**。専用: 秋19/19、priority pure13/13、実hook/TSX flow **45/45**。54専用54/54・Done39/39、46/48/50/51/52、保存/Review19/archive/outbox/export/fixed等を含む。
- TypeScript、production build、PWA generateSW **PASS**（110 modules、precache10）。check入力219/build入力122をfreezeし最終bytesと照合。
- focused ESLint **0 errors / 2 existing warnings**、full **9 existing errors / 5 existing warnings**。54baselineとのfile/rule/severity/message比較で新規0・削除0。full lint exit1は既存診断による。chunk-size/Browserslist案内も既存由来。
- 独立source reviewで旧liveReviewqualityと旧訂正returnのinactive復活経路を発見・修正し、実hook回帰testを追加。最終source hashをbuild入力と照合する。
- 実Edge production preview **32/32 PASS**、360/390×844の人工fixture/時計。実UI操作1006回、幅測定1038回。両受入例、通常の続き、再スキップ/訂正/復元、15/17境界、新11全完遂/Review19 JSON、過去12/旧11、夏商品、fixed READ ONLYを確認。横overflow、新規アプリconsole error/warning、不要な外部通信0。harnessのSW遮断通知38件は別集計。harnessのsnapshot保持・Backの入力状態・Review19保存async待ちの3前提を修正した失敗attemptもZIP外へ保存し、最終32件を一括再実行した。production source/bundleのinstrumentation変更なし。

## 未確認・保留

Undo・条件編集/トップ再開のhook actionは現在UIから直接呼べる入口がなく自動testのみ。詳細な古いhandler/二重click/同batch判定変更race、保存失敗・retry、各除外候補、業務日/session跨ぎ・同距離分岐等も自動testの範囲。物理タッチ端末、実店舗正本の直接更新、実Supabase mutation、インストール済PWAのSW更新/offline、実端末長時間backgroundは未確認。人工fixtureと実ブラウザ操作の確認であり、実店舗障害の直接再現とは区別する。保留中の曜日文言・夏17の静的hint不一致は変更していない。

完成ZIP `nebiki-helper-2026.8.9-55.zip`、同名`.zip.sha256`、`RELEASE_REPORT_2026.8.9-55.md`、`ZIP_VALIDATION_2026.8.9-55.json`はZIP外 `outputs` を参照。ZIP自身のSHAを内包文書へ書き込む自己参照はしない。
