# 値引ヘルパー 起動直後の天候入力autofocus変更 変更報告

## リリース識別情報

- 基準版: `nebiki-helper-20260822-0318.zip`
- 基準appVersion: `2026.8.9-9`
- appVersion: `2026.8.9-10`
- buildId: `build-20260822-173017-jst`
- dataSchemaVersion: `3`

今回の変更範囲は、トップ画面を新規表示した直後の最初の天候入力欄に対する自動scrollの抑止だけです。最初の天候入力をユーザーが確定した後の連続入力、条件編集resume、自動時刻遷移、fixed-time、値引率、AreaCount中央値、normal / summer、Obon、weather計算、productionAnalysis、storage safety、Supabase同期の意味は変更していません。

## 1. 旧autofocus挙動

基準版では、トップ画面の天候入力表がmountされると、最初の未確認fieldを探して、そのfieldを画面中央へ移動していました。15時値引の準備画面では天候入力対象が16時から始まるため、最初のtargetは`weather-16`でした。

この処理はユーザー操作前にも実行されたため、アプリを新規に開いた直後から画面が16時の天気欄まで下へ移動していました。その結果、トップ最上部にあるタイトル、appVersion、summer / normal状態などを最初に確認しづらい状態でした。

## 2. 起動直後に16時inputへfocusしていた原因

直接原因はHTMLの`autoFocus`属性やDOMの`.focus()`ではありません。`StartScreen`のmount時点で、初期の`confirmedInputs`が全field未確認であることから`currentUnlockTarget`が最初の天候fieldになり、80ms後に次が無条件実行されていたことです。

```ts
target.scrollIntoView({
  behavior: "smooth",
  block: "center",
  inline: "center",
});
```

`AppRouter`は画面切替時に一度ページ上端へ戻しますが、その後に80ms遅延の`scrollIntoView()`が実行されるため、上端表示が天候入力位置へのscrollで上書きされていました。したがって旧挙動は厳密にはinput focusではなく、最初の天候field wrapperへの自動scrollです。

## 3. 新しい初回focus仕様

freshなトップ画面を新規表示した直後だけ、mount時の最初の未確認天候targetへの自動scrollを抑止します。

```text
新規起動
→ focus対象なし
→ scroll位置は画面上端
→ 16時の天気欄へ自動移動しない
```

特定の文字列`16`へ例外を埋め込まず、「fresh top entryにおけるinitial weather target」として扱っています。将来、開始値引時刻に応じて最初の天候時刻が変わっても、初回targetである限り同じルールが適用されます。

実装は初期target keyとtargetの進行状態を区別し、React StrictModeでeffectが再実行されても2回目のeffectから初回scrollが復活しない構造にしています。

## 4. 16時入力後の17時focus

16時の天候をユーザーが確定すると、既存どおり16時のweather fieldを確認済みに更新します。次の未確認targetが`weather-17`へ進むため、17時欄への自動scrollが実行されます。

```text
起動直後: 自動scrollなし
16時確定: 17時へ自動scroll
```

天候値を変更するだけの操作と、その値を確定して次へ進む操作の既存区別も維持しています。初回scroll抑止を、16時入力後のtarget進行へ再適用していません。

## 5. 17時以降の連続focus維持

17時を確定すると18時へ、その後も既存のfield orderに従って次の未確認欄へ連続してscrollします。

```text
17時確定 → 18時
18時確定 → 19時
19時確定 → 20時
20時確定 → 21時
```

weather入力完了後のtemperature、windを含む既存順序や、全必須入力完了後の天候確認画面への遷移も変更していません。今回抑止するのはfresh mount時の最初の1回だけです。

## 6. initial scrollへの影響

freshな通常モードおよびfreshなfixed-timeのトップ画面では、起動完了後も`scrollY = 0`を維持します。DOMのactive elementは`BODY`であり、いずれの天候fieldも起動直後にactiveになりません。

トップ画面の縦scrollだけを対象にしており、天候表内の横方向scrollや、ユーザー入力後に次fieldを見せるための既存`scrollIntoView()`は残しています。document-levelの横幅、レイアウト、タイトル行の構造は変更していません。

## 7. resume時の挙動

fresh top、条件編集resume、自動時刻遷移の開始画面は、既存の`startButtonLabel`で区別します。

- fresh top: `startButtonLabel`なし。initial weather targetへのscrollを抑止
- 条件編集resume: `startButtonLabel = 再開`。従来どおり最初の未確認targetへscroll
- 自動時刻遷移: `startButtonLabel = ○時の値引へ進む`。従来どおり最初の未確認targetへscroll

そのため、途中sessionから条件編集へ戻る場合や、15→17等の業務時刻遷移で次sessionの準備画面へ入る場合の既存入力誘導は維持されています。天候修正要求によって同じ`StartScreen`内の確認状態を組み直す既存経路も、修正対象fieldへのscrollを継続します。

current-session、draft、session resumeの保存・復元形式は変更していません。

## 8. fixed-timeへの影響

freshなfixed-time画面でも、通常のfresh起動と同じくinitial weather targetへのscrollを抑止し、トップ情報を先に確認できます。最初の天候入力を確定した後は、通常モードと同じ連続scrollを使用します。

focus / scroll以外のfixed-time処理は変更していません。2026.8.9-9で追加した本番Supabase AreaCount履歴のREAD ONLY利用を維持し、fixed-timeから次のproduction WRITEは発生しません。

- Supabase mutation
- production pending
- production AreaCount local history
- production Review19
- production finalized day
- production learning population

fixed-timeのdemand cycle、temperature memory、fixed clock、本番データ隔離にも変更はありません。

## 9. version / summer表示との関係

初回scrollを抑止したことで、390×844のfresh起動直後に次を画面上部で確認できるようになりました。

```text
値引ヘルパー    2026.8.9-10
夏季モード ON / OFF
```

appVersion表示は2026.8.9-9で導入した既存の正規`APP_VERSION` sourceを引き続き使用します。UIへversionを個別にハードコードしていません。summer / normalの判定、demandCycle、lock、履歴母集団、cloud identityは変更していません。

## 10. 値引ロジック変更有無

値引率および業務判断ロジックの変更はありません。変更したのは`StartScreen`の初回自動scroll条件だけです。

以下の計算・保存・判断仕様を維持しています。

- AreaCount中央値と`中央値判定`表示
- auto / human / final evaluationの区別
- 5段階評価と9段階human evaluation
- raw9、even score、resolutionDirection
- areaRateAdjustmentと最終値引率
- weather、temperature comfort、precipitation bonus
- normal / summer、holiday、day-before-holiday、三連休中日、Obon
- productionAnalysis
- last-area skipと自己ループ防止
- Review19、export、backfill

同じ業務入力に対する値引率は基準版から変わりません。

## 11. storage safety回帰

2026.8.9-8で追加したstorage safetyを変更していません。

- App / hook / component層にraw `localStorage.setItem/removeItem`を追加しない
- structured storage result
- quota recoveryは最大1回
- daily snapshot soft byte budget
- current / unfinalized dateの保護
- finalized duplicateだけをprune
- Review19 completion safety
- StrictMode auto-transition in-flight guard

今回のfocus制御のためのstorage keyや永続状態は追加していません。fresh判定とtarget進行は既存UI stateから導出するため、schemaや復元データも増やしていません。

## 12. Supabase / DB変更有無

SupabaseのREAD / WRITE、local-first、pending、retry、CAS、in-flight guard、rich merge、backfillには変更がありません。

DB migration、SQL、table、column、index、unique key、trigger、RLS、tenancyも変更していません。focus / scrollだけの変更であり、Supabase payloadやlocal record schemaへの追加はありません。

## 13. tests

最終検証結果は次のとおりです。

- 専用initial weather focus check: **8 / 8 PASS**
- `check:weather-confirmation`: **19 / 19 PASS**
- 全`check:*`: **40 / 40 PASS**
- TypeScript (`tsc`): **PASS**
- changed-file ESLint: **0 errors**
- production build: **PASS**
- PWA `generateSW`: **PASS**

専用checkでは、fresh initial targetの抑止、16→17、17→18以降の連続scroll、resume初回scroll、自動時刻遷移初回scroll、fixed fresh抑止、StrictMode再実行時の初回抑止、weather correctionの既存誘導を確認しています。

全checkには15:00、17:00、18:30、19:30、20:30、done、自動時刻遷移、weather入力、storage safety、Review19、Supabase sync、fixed-time READ ONLY / WRITE isolation、中央値表示、last-area skip、normal / summer、Obon、holiday、productionAnalysisの既存回帰を含みます。

## 14. browser確認

Codex in-app Browserを390×844に設定し、development buildとproduction buildで確認しました。

### fresh起動

- development / productionとも`scrollY = 0`
- active elementは`BODY`
- `値引ヘルパー`を表示
- `2026.8.9-10`をタイトル右側に表示
- summer / normal状態を表示
- 16時天候欄へ自動scrollしない
- document-level横overflowなし

### 連続入力

- 16時確定後、17時fieldがenabledになり対象位置へscroll
- 17時確定後、18時fieldがenabledになり対象位置へscroll
- 横方向のfield追従では`scrollLeft = 40`を確認
- 以降も既存field orderで連続入力可能

### 業務継続

- 通常モードで天候入力・確認後、残数入力画面まで到達
- fixed-timeでも天候入力・確認後、残数入力画面まで到達
- console error: **0件**
- console warning: **0件**

ブラウザ確認で使用したのは入力フローを制御できるfixtureであり、実DBやproduction recordへmutationを送っていません。

## 15. appVersion / buildId / schema

- appVersion: `2026.8.9-10`
- buildId: `build-20260822-173017-jst`
- dataSchemaVersion: `3`

今回の変更はUIの一時的なfocus / scroll状態だけで、保存JSON、export、Supabase payload、DB schemaに変更がないため、dataSchemaVersionを`3`のまま維持しました。
