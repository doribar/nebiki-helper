# localStorage write audit (2026.8.9-7 baseline)

Scope: `nebiki-helper-20260815-1755.zip`, before the 2026.8.9-8 storage-safety refactor.
The inventory was produced from every `setItem` / `removeItem` call in `src/`, followed through its application callers. Test fixtures under `scripts/` are not production write paths.

## Confirmed incident path

The normal-session `done` effect calls `upsertDailySessionSnapshot()`. In the baseline, that function reaches a raw `localStorage.setItem()` without an exception boundary. A quota failure can therefore escape a React passive effect. There is no application Error Boundary, so React can unmount the application root and leave a blank page.

Automatic time transition has the same independent defect: `startNextDoneSession({ autoTransition: true })` saves an interrupted daily snapshot before showing the time-transition alert. If that write throws, the alert and transition do not run. This means the observed “15:00 blank page, then no 17:00 transition” is consistent with both (a) the 15:00 effect crashing the root and stopping the timer/effects, and (b) a later transition-time snapshot write aborting the alert path.

The exact exception on the production handset was not captured. `QuotaExceededError` is a high-confidence explanation, not a confirmed handset log.

## Production write inventory

Classification:

- **authoritative**: loss can destroy a locally accepted business observation or unsynced cloud outbox.
- **operational**: required to resume or continue the current/next workflow.
- **intermediate**: completed-session evidence needed until it is sealed into a Review19/day record.
- **derived/duplicate**: can be regenerated from a stronger record or only supports navigation/UI convenience.

| Key | Payload and classification | Business call sites | 2026.8.9-7 boundary/recovery | Audit result |
|---|---|---|---|---|
| `nebiki-helper/area-count-records-v2` | Unified AreaCount history; **authoritative local-first record/cache** and backfill/median input | Each 15/17/19/20 observation, remote merge, manual backfill | Raw writer in `areaCountLocalStorage.ts`; no quota recovery in the area-record path | **blocker**: a failure can abort the input handler. The local write and outbox write are not one structured result. |
| `nebiki-helper/summer-area-count-records-v1` | Legacy summer compatibility mirror; **duplicate/cache** of unified summer records | Written immediately after the unified AreaCount key | Raw writer; no recovery | **blocker**: failure after the unified write can throw even though the canonical local record already succeeded. It is a first cleanup candidate, but old-reader/backfill compatibility must remain. |
| `nebiki-helper/pending-supabase-sync-v1` | AreaCount/Review19 cloud outbox; **authoritative while unsynced** | Input enqueue, Review19 enqueue, retry attempt/result CAS updates, backfill | Review19 completion/effect wraps it; async retry has an outer catch. AreaCount local-first and backfill enqueue remain raw. Queue module itself has raw set/remove. | **blocker** outside Review19: never prune as quota cleanup; return an explicit failure so the authoritative local record remains and UI can continue/notify. |
| `nebiki-helper/review19-records` | Completed Review19 history; **authoritative** | Final Review19 save and remote-rich merge | Final completion has one quota cleanup/retry. Remote merge at app startup calls raw save inside a Promise continuation. | Completion is protected; remote merge is still an unhandled rejection risk. Never prune. |
| `nebiki-helper/finalized-day-data` | Finalized full-day record/export/backfill source; **authoritative** | 20:30 finalization, memo/discard metadata edits | Raw writer in `finalizedDayData.ts`; no recovery | **blocker**: a failure occurs before final state commit. Must report failure explicitly and never show a false completed finalization. Never prune. |
| `nebiki-helper/current-session` | Current AppState; **operational/authoritative for in-progress resume** | React persistence effect on every relevant state update | Set/remove normally use `attemptStorageOperation`; quota releases runtime + checkpoint and retries once. Stale-session cleanup can still call raw remove. | Main set is protected. Generalize the Review19-named cleanup and wrap direct clears. Never prune during current work. |
| `nebiki-helper/work-session-checkpoint` | Full duplicate AppState recovery checkpoint; **derived duplicate** | React state effect after current-session write; resets/transitions | Set uses safe result but has no self-retry. Several direct raw clears remain. | Safe to release before retrying higher-priority data; removal must itself be caught. |
| `nebiki-helper/runtime-state` | Area selection, undo, full navigation screen history; **derived/navigation** | React runtime effect on state/navigation changes | Set is caught, no retry. Several direct raw clears remain. | First quota-cleanup target. Large because navigation snapshots clone AppState. Bound/prune history before serialization. |
| `nebiki-helper/daily-session-snapshots` | Full completed/interrupted session snapshots; **intermediate business evidence** until sealed, then duplicate | Normal `done` effect; 20:30 finalization; auto-transition interruption; temperature/Review19/production/export/backfill reads | Raw set; count limit only (`slice(-120)`); no byte budget, no recovery | **primary blocker and likely pressure source**. Keep current/unsealed date; prune only old snapshots already represented by an authoritative Review19/day record; apply count + serialized-byte bounds. |
| `nebiki-helper/review19-source-state` | 17:00 source AppState used to start/recover Review19; **operational intermediate** | Moving from 17:00, reset preservation, Review19 cleanup | Raw set. Final cleanup remove is wrapped; reset/start clears are otherwise raw through shared helpers. | Protect while Review19 is not durably complete. May be removed only after completed Review19 is saved. |
| `nebiki-helper/next-session-skip-records` | Next-session deferred areas; **operational** | Main React persistence effect; legacy exported append/consume helpers | Main effect is caught; public raw helpers remain callable | Small but workflow-significant. Keep; route all calls through boundary and catch direct exported helpers. |
| `nebiki-helper/last-session-weather` | Previous session weather/temperature context; **small operational/derived input** | Main React persistence effect | Caught in effect; public raw set/remove remain | Keep if possible; a failed write must not crash. |
| `nebiki-helper/last-used-session-draft` | Start-screen defaults; **small preference/cache** | Main React persistence effect | Caught in effect; public raw set/remove remain | Low-priority, safe to lose only with explicit fallback; never block session completion. |
| `nebiki-helper/daily-message-state` | UI notice shown dates; **derived UI flag** | Main React persistence effect | Caught in effect; raw underlying writer | Low priority; failed write must not block business flow. |
| `nebiki-helper/demand-cycle-state-v1` | Production normal/summer selection and daily lock; **small operational setting** | Cycle toggle and session start/lock | Raw set at event handlers; no boundary | **blocker**: catch and report. Session record retains adopted cycle, so storage failure must not rewrite historical cycle facts. |
| `nebiki-helper/fixed-time-demand-cycle-state-v1` | Fixed-time-only cycle state; **isolated test-mode setting** | Fixed-time toggle/start | Raw set; no boundary | Does not touch production history, but must not throw into UI. Do not mix with production cleanup. |
| `nebiki-helper/fixed-time-temperature-by-date-v1` | Fixed-time entered temperature memory; **isolated cache** | Fixed StartScreen input | Internal try/catch returns boolean | Already non-throwing. It silently returns false; remain isolated from production storage priorities. |
| `nebiki-helper/final-day-auto-export-dates` | 120 date markers; **derived UI marker** | No production caller in this baseline | Raw set, exported dead path | Remove dead API or put behind boundary before future use. It is a cleanup candidate if ever populated. |
| `nebiki-helper/app-mode-v1` | Obsolete app-mode flag; **legacy/derived** | Mount-only cleanup effect | Raw remove | Wrap removal; `removeItem` is not a quota risk but can throw `SecurityError` and fail an effect. |
| `nebiki-helper/simple-mode-state-v1` | Obsolete simple-mode state; **legacy/derived** | Mount-only cleanup effect | Raw remove | Same as above. |

Read-only compatibility key `nebiki-helper/area-count-records` is loaded but not written by this version.

`calculatorDraft.ts` uses **sessionStorage**, not localStorage. All of its get/set/remove operations already have try/catch and are excluded from the localStorage allowlist.

## Raw primitive count in the baseline

- 28 production-source `setItem` / `removeItem` call expressions across localStorage writers.
- 20 unique localStorage keys written or removed.
- 3 additional sessionStorage draft operations, all locally caught.
- The presence of a raw primitive in a low-level module is not by itself the runtime defect; the blocker is any application path that invokes it without converting failure into an explicit result before React/event control flow continues.

## daily-session-snapshots role and retention constraints

The baseline keeps the newest **120 snapshots**, independent of serialized size. A snapshot contains a cloned session plus twelve-area progress/decision data, rate decision snapshots, calendar/weather analysis, and done summary. It is read for:

1. temperature-comfort continuity between sessions;
2. Review19 daySnapshot and production analysis;
3. 20:30 finalized-day construction;
4. historical/legacy daily export;
5. demand-cycle evidence;
6. AreaCount backfill fallback.

Therefore the current business date’s 15/17/18:30/19:30/20:30 snapshots are not disposable merely because they are “derived”. They are the only consolidated completed-session evidence before a stronger Review19/finalized-day record exists.

Safe pruning order:

1. runtime navigation history and duplicate work checkpoint;
2. obsolete flags/unused export-date markers;
3. old daily snapshots whose date and demand cycle are demonstrably sealed into a valid completed Review19 `daySnapshot` or finalized-day record;
4. never delete the current business date, an unsealed date, AreaCount, Review19, finalized day, pending queue, or current session.

Retention should satisfy both a record count and an estimated localStorage UTF-16 key-plus-value byte budget. Construct the candidate array newest-first, preserve the current/unsealed protected set, then admit removable older items while within budget. If protected current-day evidence alone exceeds the budget, do not delete it; surface the write failure.

The previous anonymous rich fixture measured roughly 138 KiB for one completed Review19, 144 KiB for one completed AppState, 138 KiB for one Review19 pending item, 562 KiB for 20 runtime navigation snapshots, and about 1.69 MiB for 950 unified AreaCount records plus the summer compatibility mirror. Those are fixture estimates, not handset measurements.

## Minimal common boundary recommendation

1. Keep a single low-level operation API returning `{ ok, key, operation, errorName, quotaExceeded }`; allow it to accept an injected `Storage` for tests.
2. Add one quota-recovery coordinator with explicit protected keys and ordered cleanup actions. Rename the Review19-specific release helper so normal session completion, daily snapshots, finalized data, AreaCount, pending, and Review19 share the same semantics.
3. Provide typed high-level results for authoritative writes (`saved`, `outboxPrepared`, `recovered`, `failures`) instead of relying on thrown exceptions.
4. For auxiliary writes, log only key/operation/error name/quota flag and continue. For authoritative writes, stop the corresponding completion and show a concise warning if the one retry fails.
5. Daily-snapshot save must return a result. Both the `done` effect and auto-transition must consume that result; an auxiliary snapshot failure must never suppress the time-transition alert.
6. Keep retry count at one. Never prune authoritative keys or use recursive cleanup/retry.

## Static allowlist check design

Add `check:storage-write-boundary` that scans `src/**/*.{ts,tsx}` for call expressions matching `.setItem(` / `.removeItem(`.

- Allow raw localStorage primitives only in the nominated low-level boundary module(s), with an exact file allowlist.
- Separately allow `calculatorDraft.ts` because it resolves `window.sessionStorage` and catches every operation.
- Reject direct primitive calls in hooks, components, app effects, and newly added domain modules.
- Assert the obsolete app-mode cleanup imports the boundary rather than calling `window.localStorage.removeItem`.
- Assert `upsertDailySessionSnapshot` exposes/uses a safe result or is internally bounded, and that the hook has no direct unguarded daily-snapshot call.
- Assert all allowlisted files still import/call the common attempt/recovery primitive; do not allow a broad `src/domain/**` exception.
- Print every discovered file/line in failure output so the next release cannot silently add a new write path.

## Implemented boundary state (2026.8.9-8)

- Current source contains 27 reviewed localStorage primitive calls plus the 3 pre-existing caught sessionStorage draft calls, for 30 reviewed storage call sites.
- App, hook, and component layers contain 0 raw `setItem()` / `removeItem()` calls. Exact low-level sites are fixed by `check:storage-write-boundary`.
- Normal done, 20:30 finalization, and automatic transition use `upsertDailySessionSnapshotSafely()`; read/preparation failures and writes return structured results instead of escaping into React.
- Daily snapshots retain the existing 120-record limit and add a 1 MiB soft budget estimated from UTF-16 key plus value size.
- The current/protected business date and every unfinalized date remain protected even above the soft limits. Only old date groups already sealed into finalized-day authoritative records are pruned.
