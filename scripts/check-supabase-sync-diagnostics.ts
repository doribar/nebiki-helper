import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPendingSupabaseSyncErrorDetails,
  buildSupabaseSyncErrorCopyText,
  formatSupabaseHttpError,
  getPendingSupabaseSyncDemandCycle,
  sanitizeSupabaseDiagnosticText,
} from "../src/domain/supabaseSyncDiagnostics.ts";
import type { PendingSupabaseSyncItem } from "../src/domain/supabaseSyncQueue.ts";

let passed = 0;
let failed = 0;

async function test(
  name: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`PASS: ${String(passed + failed).padStart(2, "0")}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${String(passed + failed).padStart(2, "0")}. ${name}`);
    console.error(error);
  }
}

function makePendingItem(
  overrides: Partial<PendingSupabaseSyncItem> = {},
): PendingSupabaseSyncItem {
  return {
    type: "area_count",
    identity: "area-count-1",
    payload: {
      demandCycle: "summer",
      date: "2026-08-10",
      discountTime: "17",
      areaId: "bento_men",
    },
    firstFailedAt: "2026-08-10T08:00:00.000Z",
    lastAttemptAt: "2026-08-10T09:00:00.000Z",
    attemptCount: 1,
    enqueuedAt: "2026-08-10T07:00:00.000Z",
    lastError: "HTTP 400\ncode: 23505\nmessage: duplicate key",
    ...overrides,
  };
}

await test("pending 0 produces no diagnostic groups", () => {
  const details = buildPendingSupabaseSyncErrorDetails([]);
  assert.deepEqual(details, {
    pendingCount: 0,
    groupedItemCount: 0,
    groups: [],
  });
});

await test("one pending item produces one detail group", () => {
  const details = buildPendingSupabaseSyncErrorDetails([makePendingItem()]);
  assert.equal(details.pendingCount, 1);
  assert.equal(details.groups.length, 1);
  assert.equal(details.groups[0]?.count, 1);
  assert.equal(details.groups[0]?.demandCycle, "summer");
});

await test("165 identical type/cycle/errors aggregate into one group", () => {
  const items = Array.from({ length: 165 }, (_, index) =>
    makePendingItem({ identity: `area-count-${index}` }),
  );
  const details = buildPendingSupabaseSyncErrorDetails(items);
  assert.equal(details.pendingCount, 165);
  assert.equal(details.groups.length, 1);
  assert.equal(details.groups[0]?.count, 165);
});

await test("same error in normal and summer stays in separate groups", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ payload: { demandCycle: "normal" } }),
    makePendingItem({
      identity: "summer",
      payload: { demandCycle: "summer" },
    }),
  ]);
  assert.equal(details.groups.length, 2);
  assert.deepEqual(
    details.groups.map((group) => group.demandCycle),
    ["normal", "summer"],
  );
});

await test("AreaCount and Review19 stay in separate groups", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem(),
    makePendingItem({
      type: "review19",
      identity: "review19-1",
    }),
  ]);
  assert.equal(details.groups.length, 2);
  assert.deepEqual(
    details.groups.map((group) => group.type),
    ["area_count", "review19"],
  );
});

await test("different errors stay in separate groups", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ lastError: "HTTP 400" }),
    makePendingItem({ identity: "conflict", lastError: "HTTP 409" }),
  ]);
  assert.equal(details.groups.length, 2);
  assert.deepEqual(
    details.groups.map((group) => group.errorText),
    ["HTTP 400", "HTTP 409"],
  );
});

await test("missing and blank lastError share an unrecorded group", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ lastError: null }),
    makePendingItem({ identity: "blank", lastError: "  \r\n " }),
  ]);
  assert.equal(details.groups.length, 1);
  assert.equal(details.groups[0]?.count, 2);
  assert.equal(details.groups[0]?.errorText, null);
  assert.equal(details.groups[0]?.errorPreview, "エラー未記録");
});

await test("group counts always add up to the pending count", () => {
  const items = [
    makePendingItem(),
    makePendingItem({ identity: "second" }),
    makePendingItem({ identity: "third", lastError: null }),
    makePendingItem({
      identity: "fourth",
      type: "review19",
      payload: { demandCycle: "normal" },
    }),
  ];
  const details = buildPendingSupabaseSyncErrorDetails(items);
  assert.equal(details.pendingCount, items.length);
  assert.equal(details.groupedItemCount, items.length);
  assert.equal(
    details.groups.reduce((sum, group) => sum + group.count, 0),
    items.length,
  );
});

await test("a successful retry is reflected by rebuilding from the reduced queue", () => {
  const before = [
    makePendingItem({ identity: "retry-succeeds" }),
    makePendingItem({ identity: "still-failing" }),
  ];
  assert.equal(buildPendingSupabaseSyncErrorDetails(before).groups[0]?.count, 2);
  const after = before.filter((item) => item.identity === "still-failing");
  const details = buildPendingSupabaseSyncErrorDetails(after);
  assert.equal(details.pendingCount, 1);
  assert.equal(details.groups[0]?.count, 1);
});

await test("when all retries succeed the detail model becomes empty", () => {
  const details = buildPendingSupabaseSyncErrorDetails([]);
  assert.equal(details.pendingCount > 0, false);
  assert.equal(details.groups.length, 0);
});

await test("long errors have a bounded preview and retain the full safe text", () => {
  const longError = `HTTP 400\nmessage: ${"x".repeat(2_000)}`;
  const group = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ lastError: longError }),
  ]).groups[0];
  assert.ok(group);
  assert.equal(group.isErrorTruncated, true);
  assert.ok(group.errorPreview.length <= 321);
  assert.equal(group.errorText, longError);
  const copy = buildSupabaseSyncErrorCopyText(
    buildPendingSupabaseSyncErrorDetails([makePendingItem({ lastError: longError })]),
    { appVersion: "2026.8.9-3", buildId: "build-test" },
  );
  assert.ok(copy.includes("x".repeat(2_000)));
});

await test("copy text contains grouped attempts and time bounds", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({
      attemptCount: 1,
      firstFailedAt: "2026-08-10T08:30:00.000Z",
      lastAttemptAt: "2026-08-10T08:45:00.000Z",
    }),
    makePendingItem({
      identity: "later",
      attemptCount: 3,
      firstFailedAt: "2026-08-10T08:00:00.000Z",
      lastAttemptAt: "2026-08-10T10:00:00.000Z",
    }),
  ]);
  const group = details.groups[0];
  assert.equal(group?.attemptCountMin, 1);
  assert.equal(group?.attemptCountMax, 3);
  assert.equal(group?.firstFailedAt, "2026-08-10T08:00:00.000Z");
  assert.equal(group?.lastAttemptAt, "2026-08-10T10:00:00.000Z");

  const copy = buildSupabaseSyncErrorCopyText(details, {
    appVersion: "2026.8.9-3",
    buildId: "build-20260811-test-jst",
  });
  assert.ok(copy.startsWith("値引ヘルパー Supabase同期エラー\n"));
  assert.ok(copy.includes("appVersion: 2026.8.9-3"));
  assert.ok(copy.includes("buildId: build-20260811-test-jst"));
  assert.ok(copy.includes("pendingCount: 2"));
  assert.ok(copy.includes("attemptCountRange: 1-3"));
  assert.ok(copy.includes("firstFailedAt: 2026-08-10T08:00:00.000Z"));
  assert.ok(copy.includes("lastAttemptAt: 2026-08-10T10:00:00.000Z"));
});

await test("display/copy sanitization removes credentials but preserves diagnostics", () => {
  const secrets = [
    "anon-secret-value",
    "service-secret-value",
    "access-secret-value",
    "refresh-secret-value",
    "cookie-secret-value",
    "second-cookie-secret",
    "authorization-secret-value",
    "client-secret-value",
    "id-token-value",
    "database-password",
    "sb_secret_project-secret-value",
    "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk",
    "project-ref.supabase.co",
    ".env.local",
  ];
  const unsafeError = [
    "HTTP 400",
    "code: 23505",
    "constraint: area_count_records_identity_key",
    "message: duplicate key value violates unique constraint",
    "apikey=anon-secret-value",
    "service_role_key: service-secret-value",
    '"access_token":"access-secret-value"',
    "refresh-token=refresh-secret-value",
    "Cookie: session=cookie-secret-value; refresh=second-cookie-secret",
    "Authorization: Bearer authorization-secret-value",
    "client_secret=client-secret-value",
    'id_token: "id-token-value"',
    "DATABASE_URL=postgresql://db-user:database-password@db.example.test/postgres",
    "sb_secret_project-secret-value",
    "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk",
    "https://project-ref.supabase.co/rest/v1/area_count_records",
    ".env.local",
  ].join("\n");
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ lastError: unsafeError }),
  ]);
  const display = details.groups[0]?.errorText ?? "";
  const copy = buildSupabaseSyncErrorCopyText(details, {
    appVersion: "2026.8.9-3",
    buildId: "build-test",
  });
  for (const secret of secrets) {
    assert.equal(display.includes(secret), false, `display leaked ${secret}`);
    assert.equal(copy.includes(secret), false, `copy leaked ${secret}`);
  }
  assert.ok(copy.includes("HTTP 400"));
  assert.ok(copy.includes("code: 23505"));
  assert.ok(copy.includes("constraint: area_count_records_identity_key"));
  assert.ok(copy.includes("message: duplicate key value"));
});

await test("credential redaction also lets identical causes aggregate", () => {
  const details = buildPendingSupabaseSyncErrorDetails([
    makePendingItem({ lastError: "HTTP 401\napikey=first-secret" }),
    makePendingItem({
      identity: "second-secret",
      lastError: "HTTP 401\napikey=second-secret",
    }),
  ]);
  assert.equal(details.groups.length, 1);
  assert.equal(details.groups[0]?.count, 2);
});

await test("fixed-time isolation remains outside this pure read-only domain", () => {
  const source = readFileSync(
    new URL("../src/domain/supabaseSyncDiagnostics.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("pending-supabase-sync-v1"), false);
  assert.deepEqual(buildPendingSupabaseSyncErrorDetails([]).groups, []);
});

await test("legacy/malformed cycle stays unknown and input is not mutated", () => {
  const legacy = makePendingItem({
    payload: {
      demand_cycle: "summer",
      date: "2026-08-09",
      areaId: "bento_men",
    },
  });
  const before = JSON.stringify(legacy);
  assert.equal(getPendingSupabaseSyncDemandCycle(legacy), "unknown");
  const details = buildPendingSupabaseSyncErrorDetails([legacy]);
  assert.equal(details.groups[0]?.demandCycle, "unknown");
  assert.equal(JSON.stringify(legacy), before);
});

await test("PostgREST body formatter retains only useful safe fields", () => {
  const formatted = formatSupabaseHttpError(
    400,
    JSON.stringify({
      code: "23505",
      message: "duplicate key",
      details: "Key already exists",
      hint: "Use a different identity",
      constraint: "area_count_records_identity_key",
      column: "demand_cycle",
      access_token: "must-not-appear",
      payload: { count: 926 },
    }),
  );
  assert.equal(
    formatted,
    [
      "HTTP 400",
      "code: 23505",
      "message: duplicate key",
      "details: Key already exists",
      "hint: Use a different identity",
      "constraint: area_count_records_identity_key",
      "column: demand_cycle",
    ].join("\n"),
  );
  assert.equal(formatted.includes("must-not-appear"), false);
  assert.equal(formatted.includes("926"), false);
});

await test("admin UI uses grouped details, safe copy, wrapping, and fixed-time isolation", () => {
  const adminSource = readFileSync(
    new URL("../src/components/common/AdminSettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const hookSource = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );

  assert.ok(adminSource.includes("cloudSync.errorDetails.pendingCount > 0"));
  assert.ok(adminSource.includes("エラー詳細（"));
  assert.ok(adminSource.includes("エラー内容をコピー"));
  assert.ok(adminSource.includes("navigator.clipboard.writeText"));
  assert.ok(adminSource.includes('overflowWrap: "anywhere"'));
  assert.ok(adminSource.includes('overflowX: "hidden"'));
  assert.equal(adminSource.includes("JSON.stringify(group"), false);
  assert.match(
    hookSource,
    /isTestMode\s*\?\s*\[\]\s*:\s*loadPendingSupabaseSyncQueue\(\)/,
  );
  assert.ok(hookSource.includes("buildPendingSupabaseSyncErrorDetails"));
});

await test("non-JSON HTTP bodies are retained after sanitization", () => {
  const formatted = formatSupabaseHttpError(
    503,
    "upstream unavailable; Authorization: Bearer do-not-copy",
  );
  assert.ok(formatted.startsWith("HTTP 503\nbody: upstream unavailable"));
  assert.equal(formatted.includes("do-not-copy"), false);
});

await test("sanitizer preserves PostgreSQL diagnosis metadata", () => {
  const sanitized = sanitizeSupabaseDiagnosticText(
    "HTTP 409\ncode: 23503\ncolumn: area_id\nconstraint: fk_area\nmessage: violation",
  );
  assert.ok(sanitized.includes("HTTP 409"));
  assert.ok(sanitized.includes("code: 23503"));
  assert.ok(sanitized.includes("column: area_id"));
  assert.ok(sanitized.includes("constraint: fk_area"));
  assert.ok(sanitized.includes("message: violation"));
});

console.log(`\n${passed}/${passed + failed} tests passed.`);
if (failed > 0) process.exitCode = 1;
