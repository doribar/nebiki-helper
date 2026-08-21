# 通常session完了／自動時刻遷移 storage安全化 変更報告

作成日: 2026-08-21（JST）

## リリース識別情報

- 基準ZIP: `nebiki-helper-20260815-1755.zip`
- 基準appVersion: `2026.8.9-7`
- appVersion: `2026.8.9-8`
- buildId: `build-20260821-091629-jst`
- dataSchemaVersion: `3`

## 1. 15時白画面の再現結果

基準版の通常session完了flowを追跡すると、全エリア完了後のReact effectが `upsertDailySessionSnapshot()` を呼び、`saveDailySessionSnapshots()` 内のraw `localStorage.setItem()` へ到達していました。このwriteへ人工的な `QuotaExceededError` を発生させるfixtureでは、例外がsafe boundaryを通らず上位へthrowされることを再現しました。

実端末では15時全エリア完了直後に白画面となりましたが、その時のconsole例外名、localStorage使用量、端末quota上限は採取できていません。したがって、「基準版に未処理storage例外経路があり、人工Quotaで再現できたこと」は確認済み事実、「実端末事故も同じ `QuotaExceededError` だったこと」は症状と高く整合する推定として分離します。

## 2. 根本原因

確認できたコード上の根本原因は、Review19以外の業務flowに未監査のraw storage writeが残り、通常doneのpassive effectからstorage例外をReactへ漏らせたことです。app-level Error Boundaryはなく、effectの未処理例外はReact rootを正常描画できない状態にし、白画面へ至る危険がありました。

表示component、done state shape、値引率計算自体に15時完了時だけrenderを壊す異常は確認されませんでした。今回の修正はError Boundaryで症状を隠すのではなく、storage writeの発生源を安全なboundaryへ通します。

## 3. 17時自動遷移不発との関係

関係する経路は2つありました。

1. 15時done effectの未処理例外でReact rootが停止すると、30秒timer、focus／visibility監視、時刻遷移effectも動作しなくなります。
2. rootが動作していても、自動遷移の `startNextDoneSession({ autoTransition: true })` は時刻到達alertと次session開始より先にinterrupted daily snapshotをraw保存していました。このwriteがthrowすると、17時ダイアログ自体を中断できました。

新版では自動遷移時のsnapshotを構造化結果で保存し、その補助writeの失敗だけを理由に時刻到達通知と次session開始を中止しません。15→17に加え、17→18:30、18:30→19:30、19:30→20:30の共通経路を同じ方針で扱います。

実ブラウザ確認では、React StrictModeのmount effect再実行により、復元時点ですでに次時刻へ到達している場合に同一の自動遷移alertが2回出る競合も再現しました。`date × startedAt × 遷移元 × 遷移先` のin-flight keyで自動遷移だけを1回へ固定し、次session開始に失敗した場合はkeyを解放して再試行可能にしました。手動遷移はこのguardの対象外です。

## 4. `upsertDailySessionSnapshot` 調査結果

基準版の `upsertDailySessionSnapshot()` は、同一 `date × discountTime × startedAt` をupsertして最大120件へsliceした後、例外境界のない `localStorage.setItem()` を行っていました。通常done、20時30分final、auto transitionの3箇所が同じ危険を共有していました。

新版は `upsertDailySessionSnapshotSafely()` を正規の業務flowから使用します。retention、write結果、quota該当、retry有無、保持件数・概算byte、失敗metadataを返し、例外をReactへthrowしません。互換wrapperも内部でsafe APIを使います。

## 5. daily-session-snapshotsの役割

調査の結果、daily snapshotは単なるnavigation/debug cacheではありません。次の用途を持つ中間業務証跡です。

- 当日session間のtemperature continuity
- Review19 `daySnapshot` とproductionAnalysisの構築
- finalized-day recordの構築
- 旧形式を含む日次export
- AreaCount／cloud backfillのfallback
- demand cycle、calendarContext、analysisWeatherContext等のsession evidence

ただし、同日のsession群が正式なfinalized-day recordへ封印された後のsnapshotは、その正本から再構築可能な重複copyです。current／未確定日とsealed済み過去日を同じ優先度では扱いません。

進行中sessionのresume正本は `current-session`／`work-session-checkpoint` であり、daily snapshot自体をresume正本とは扱いません。

## 6. 現在の件数上限

既存の最大120件は維持します。今回は件数だけでなく、localStorageのUTF-16 key＋value概算で1 MiBのsoft budgetを追加しました。

current business dateとfinalized-day recordへ未封印の日付は、業務証跡を守るため件数・byte両limitのsoft exceptionです。120件または1 MiBを超えたという理由だけでcurrent／unfinalized recordを捨てません。

## 7. 容量実測

anonymous rich fixtureで測定したdaily snapshot JSONの概算は次のとおりです。UTF-16列が実装のretention判断に使うlocalStorage概算です。

| snapshots | UTF-8概算 | UTF-16 key＋value概算 |
|---:|---:|---:|
| 1 | 33.5 KiB | 66.1 KiB |
| 5 | 167.7 KiB | 330.5 KiB |
| 30 | 1006.1 KiB | 1983 KiB |
| 60 | 2012.2 KiB | 3966 KiB |
| 120 | 4024.3 KiB | 7932 KiB |

長期運用fixtureでは、AreaCount 950件、Review19 6件、pending 165件、daily snapshot 80件、current-session、checkpoint、runtime、finalized-dayを同時に保持し、初期合計約2350.3 KiBでした。このうちdaily snapshotは641.6 KiB、runtime＋checkpointは449.5 KiBでした。finalized済みduplicateを整理した後もcurrent-day snapshot 160.1 KiBを保持しました。

いずれも匿名fixtureの測定値であり、実使用端末の正確な容量ではありません。

## 8. 全localStorage write監査結果

基準版の `src` をAST／static searchで監査し、28個のproduction-source `setItem`／`removeItem` call expression、20個のlocalStorage keyを確認しました。加えてcalculator draftのsessionStorage 3操作は既に各操作内で例外を捕捉していました。詳細なkey別分類は `STORAGE_WRITE_AUDIT_20260816.md` に記録しています。

通常完了、auto transition、20時30分、AreaCount、Review19、pending、current-session、checkpoint、runtime、finalized day、review19 source、remote merge、manual backfill、demand cycle、legacy app-mode cleanupまでbusiness call siteを追跡しました。

新版の静的checkでは、追加したsafe adapterを含む30 call siteをレビュー済みallowlistへ固定し、App／hook／component層のraw callは0件です。新しいraw call、key、adapter siteを追加するとcheckが失敗します。

## 9. raw write残存箇所

raw primitiveは、実際にWeb Storage APIを呼ぶ必要がある低レベルmoduleだけに残します。

- `areaCountLocalStorage.ts`
- `demandCycleStorage.ts`
- `fixedTimeTemperatureMemory.ts`
- `finalizedDayData.ts`
- `storage.ts`
- `supabaseSyncQueue.ts`
- `calculatorDraft.ts`（sessionStorage、各操作をtry/catch済み）

これらは高レベルの業務flowからsafe operation／structured resultを介して呼びます。App、hook、componentからのraw `setItem()`／`removeItem()` は残していません。

## 10. authoritative / derived分類

保存優先順位を次のように整理しました。

1. AreaCount正式履歴、完成Review19、finalized day
2. Supabase未同期pending
3. 進行中current-sessionと、正式記録へ未封印のdaily snapshot／Review19 source
4. export／backfillに必要な完成session evidence
5. navigation/debug runtime、重複checkpoint、正式recordへ封印済みdaily snapshot

AreaCount、Review19、pending、current-session、未確定日snapshotはcleanup対象にしません。値引判断へ採用したrate snapshot、normal／summer、Obon、calendar／weather／production metadataも書き換えません。

## 11. quota recovery設計

storage operationは、成功可否、key、set/remove、error name、quota該当を返します。quota failure時は次の順です。

1. navigation/debug用runtimeと重複checkpointだけを解放
2. daily snapshotなら、finalized dayへ封印済みの古い日付groupだけをretention対象として整理
3. 対象writeを1回だけretry
4. なお失敗した場合はauthoritative／derivedの性質に応じて、偽の完了を止めるか、正式データを保持したまま補助失敗を通知

non-quota errorは無意味なcleanup／retryを行いません。diagnosticはstorage metadataだけで、record本文、商品payload、Supabase credentialを出しません。

## 12. daily snapshots保持方式の変更

変更しました。従来の `slice(-120)` だけの個別record retentionから、次へ変更しています。

- 最大120件
- UTF-16 key＋value概算1 MiB soft budget
- 日付group単位で保持し、groupの途中だけを削除しない
- current／protected dateを必ず保持
- finalized dayへ未封印の日付を必ず保持
- finalized-day正本へ封印済みの古いduplicate date groupだけを整理
- 新しいsealed groupを優先

quota retry時もcurrent／unfinalized dateを維持します。

## 13. retention変更の根拠

rich fixtureでは120件がUTF-16概算約7.75 MiBとなり、件数上限だけでは一般的なlocalStorage quotaへ強い圧力をかけ得ました。一方、未確定日のdaily snapshotはReview19、finalized day、productionAnalysis、legacy export／backfillの唯一の統合evidenceになり得ます。

したがって、任意の古い順削除やcurrent dayの圧縮ではなく、強い正本へ封印されたことを確認できるdate groupだけを再構築可能なcopyとして整理します。1 MiBはcacheのsoft budgetであり、authoritative business evidenceの破棄上限ではありません。

## 14. Review19 2026.8.9-7修正への影響

2026.8.9-7で導入した次の仕様を維持します。

- 完成Review19正本を最優先
- 正本保存とpending準備を別段階で扱う
- local正本を保存できない場合は `review19_done` へ進まない
- pendingだけ失敗した場合は正本を維持してmanual backfillを案内
- 12/12、raw9、complete、productionAnalysis、calendarContext、analysisWeatherContext、daySnapshotを維持
- 同一identity duplicate防止とreload後complete維持

今回の共通boundaryとretentionはReview19の保存順序を弱体化しません。

## 15. 正式データ保全

通常sessionではAreaCount正式履歴のlocal保存とcloud outboxを別々の結果として確定します。local正本が保存できなければその入力を完了扱いにせず、pendingへも積みません。local正本成功後にpendingだけ失敗した場合はlocal recordを保持し、backfill可能であることを案内します。

20時30分を含むfinalized-day正本の保存に失敗した場合も、偽のdoneへ進みません。一方、補助daily snapshotだけ失敗し、必要な正式データが既に保持されている場合はReactを停止させずdone／時刻通知を継続できます。

## 16. fixed-timeへの影響

fixed-timeの保存は例外をUIへ漏らさない一方、本番のquota cleanupを呼びません。本番AreaCount、Review19、pending、learning populationを読み書きしない隔離仕様、固定したJST clock、normal／summer選択の別keyを維持します。事故日のfixed-time recordを推測補完・通常record化しません。

## 17. Supabase / DB

- local-first、pending queue、retry、CAS、in-flight guard、rich merge、backfillを維持
- AreaCount／Review19、normal／summer、partial／final identityを維持
- DB migration追加なし
- SQL変更なし
- table／column／unique key／index／trigger変更なし
- RLS／policy変更なし

storage failureの構造化は端末側だけです。既存JSONB payloadとSupabase上のrecord schemaを変更しません。

## 18. backward compatibility

旧AreaCount、Review19、daily snapshot、finalized day、current-session、pendingを物理migrationしません。既存keyとJSON shapeを維持し、load／normalize／merge／exportを継続します。retentionは保存済みcalendarContextや値引referenceを再計算せず、date groupをそのまま残すか、finalized-day正本へ封印済みのduplicate groupを除くかだけです。

optional schema追加はなく、`dataSchemaVersion = 3` を維持します。

## 19. Obon回帰

毎年8月13日〜16日の `isObon: true`／`calendarCondition: "obon"` とholiday-equivalent需要判断、導入前ordinary recordの遡及書換え防止を変更しません。normal／summer、祝日／祝日前日／三連休中日、productionAnalysisの `history / manual / human_review19`、weather／temperature、9段階raw、20時30分ルールも変更対象外です。

## 20. tests

- 全 `check:*`: **36/36 PASS**
- `check:session-completion-storage-safety`: **10/10 PASS**
- `check:daily-session-snapshot-storage`: **15/15 PASS**
- `check:long-run-storage-safety`: **4/4 PASS**
- `check:storage-write-boundary`: **PASS**（レビュー済み低レベル30 call site、App／hook／component raw call 0）
- `check:review19-completion-safety`: **16/16 PASS**
- `check:supabase-sync-domain`: **23/23 PASS**
- TypeScript `tsc -b`: **PASS**
- changed-file ESLint: **0 errors / 6 warnings**。warningsは基準版から存在する `react-hooks/exhaustive-deps` のみで、新規errorはありません。
- production build: **PASS**（Vite 8、87 modules）
- PWA: **generateSW PASS**、precache 10 entries、`dist/sw.js` と `dist/workbox-9c191d2f.js` を生成

## 21. browser 15→17完走

- 通常のqueryなしタブを390×844で開き、15時の天候18入力、12エリアの残数・人間評価・商品確認を実際に完走しました。`値引作業は完了です。` を表示し、console warn/error 0、document-level horizontal overflow 0を確認しました。
- 別の時刻制御タブでは、dev-only変換でclockだけを固定し、hookのproduction storage semanticsを有効にしました。新しい隔離originで15時18入力・12エリア完了 → done → 同じ保存状態のまま17時到達まで完走し、自動遷移ダイアログが**1回だけ**表示され、17時入力画面へ進むことを確認しました。
- 同じ修正後コードで17時完了 → 18時30分到達も単一ダイアログと遷移先画面を確認しました。
- いずれも390×844、console warn/error 0、document-level horizontal overflow 0でした。天候表内部の横スクロールは既存の意図したUIです。
- 時刻制御タブは固定時計用表示を残すため、実時間で2時間待機した確認とは区別します。また、ブラウザでは人工Quotaを注入していません。Quota／SecurityErrorは自動testのStorage mockで確認しました。

## 22. appVersion / buildId / schema

- appVersion: `2026.8.9-8`
- buildId: `build-20260821-091629-jst`
- dataSchemaVersion: `3`

## 変更ファイル

- `src/domain/storage.ts`
- `src/domain/cloudSync.ts`
- `src/domain/areaCountLocalStorage.ts`
- `src/hooks/useNebikiApp.ts`
- `src/app/App.tsx`
- `scripts/check-daily-session-snapshot-storage.ts`
- `scripts/check-session-completion-storage-safety.ts`
- `scripts/check-storage-write-boundary.ts`
- `scripts/check-long-run-storage-safety.ts`
- `scripts/check-supabase-sync-domain.ts`
- `scripts/check-refactor-characterization.ts`
- `scripts/check-full-mode.ts`
- `scripts/check-workflow-20260728.ts`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHATGPT_HANDOFF.md`
- `STORAGE_WRITE_AUDIT_20260816.md`
- `CHANGE_REPORT_20260816_STORAGE_SAFETY.md`
- `dist/**`（最終build後）

## リリース成果物

- ZIP: `nebiki-helper-20260821-0918.zip`
- SHA-256: ZIP作成後の外部検証値を最終報告に記載
