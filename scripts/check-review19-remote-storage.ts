import assert from "node:assert/strict";
import { NORMAL_ROUTE } from "../src/domain/area.ts";
import {
  buildRemoteReview19Row,
  buildRemoteReview19Rows,
  getReview19SourceUpdatedAt,
  isCompleteFinalReview19Record,
  loadRemoteReview19Records,
  mergeReview19MedianHistory,
  normalizeRemoteReview19Row,
  normalizeRemoteReview19Rows,
  upsertRemoteReview19Record,
  upsertRemoteReview19Records,
  type RemoteReview19Row,
  type Review19Fetch,
} from "../src/domain/review19RemoteStorage.ts";
import {
  advanceReview19SourceUpdatedAt,
  createInitialReview19Result,
} from "../src/domain/review19.ts";
import type {
  AreaId,
  DemandCycle,
  Review19Result,
} from "../src/domain/types.ts";

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as Response;
}

function buildRecord(params: {
  date: string;
  demandCycle?: DemandCycle;
  sessionStartedAt?: string;
  recordedAt?: string;
  complete?: boolean;
}): Review19Result {
  const sessionStartedAt =
    params.sessionStartedAt ?? `${params.date}T09:00:00.000Z`;
  const record = createInitialReview19Result({
    date: params.date,
    demandCycle: params.demandCycle ?? "normal",
    sessionStartedAt,
    reviewStartedAt: sessionStartedAt,
    excludedAreaIds: params.complete === false ? [] : [...NORMAL_ROUTE],
  });

  return params.recordedAt
    ? {
        ...record,
        reviewCompletedAt: params.recordedAt,
        recordedAt: params.recordedAt,
      }
    : record;
}

function buildLegacyFiveScaleRecord(params: {
  date: string;
  recordedAt: string;
}): Review19Result {
  const targetAreaId = NORMAL_ROUTE[0] as AreaId;
  const excludedAreaIds = NORMAL_ROUTE.filter((areaId) => areaId !== targetAreaId);
  const record = createInitialReview19Result({
    date: params.date,
    demandCycle: "normal",
    sessionStartedAt: `${params.date}T09:00:00.000Z`,
    reviewStartedAt: `${params.date}T09:01:00.000Z`,
    excludedAreaIds,
  });

  return {
    ...record,
    areaCounts: { [targetAreaId]: 12 },
    areaEvaluations: {
      [targetAreaId]: {
        humanEvaluation: "normal",
        autoEvaluation: null,
        autoEvaluationStatus: "insufficient",
      },
    },
    areaCountRecordedAt: { [targetAreaId]: params.recordedAt },
    reviewCompletedAt: params.recordedAt,
    recordedAt: params.recordedAt,
  };
}

await test("partial/final rowはnullable recorded_atとis_completeを独立保持する", () => {
  const incompletePartial = buildRemoteReview19Row(
    buildRecord({ date: "2026-08-01", complete: false }),
  );
  assert.equal(incompletePartial.recorded_at, null);
  assert.equal(incompletePartial.is_complete, false);
  assert.equal(
    incompletePartial.source_updated_at,
    incompletePartial.payload.sessionStartedAt,
  );

  const completePartial = buildRemoteReview19Row(
    buildRecord({ date: "2026-08-02" }),
  );
  assert.equal(completePartial.recorded_at, null);
  assert.equal(completePartial.is_complete, true);
  assert.equal(
    completePartial.source_updated_at,
    completePartial.payload.sessionStartedAt,
  );

  const final = buildRemoteReview19Row(
    buildRecord({
      date: "2026-08-03",
      recordedAt: "2026-08-03T10:00:00.000Z",
    }),
  );
  assert.equal(final.recorded_at, "2026-08-03T10:00:00.000Z");
  assert.equal(final.source_updated_at, "2026-08-03T10:00:00.000Z");
  assert.equal(final.payload.sourceUpdatedAt, final.source_updated_at);
  assert.equal(final.is_complete, true);
  assert.equal(final.payload.date, final.date);
  assert.equal(final.payload.sessionStartedAt, final.session_started_at);
  assert.equal(final.payload.demandCycle, final.demand_cycle);
});

await test("source_updated_atは有効なpayload時刻の最大値となり新partialを選ぶ", () => {
  const older = buildRecord({
    date: "2026-08-03",
    complete: false,
    sessionStartedAt: "2026-08-03T09:00:00.000Z",
  });
  older.reviewStartedAt = "invalid-timestamp";
  older.areaCountRecordedAt = {
    [NORMAL_ROUTE[0] as AreaId]: "2026-08-03T10:00:00.000Z",
  };

  const newer = clone(older);
  newer.areaCountRecordedAt = {
    ...newer.areaCountRecordedAt,
    [NORMAL_ROUTE[1] as AreaId]: "2026-08-03T11:00:00.000Z",
  };

  assert.equal(
    getReview19SourceUpdatedAt(newer),
    "2026-08-03T11:00:00.000Z",
  );
  const [canonical] = buildRemoteReview19Rows([newer, older]);
  assert.equal(canonical?.recorded_at, null);
  assert.equal(canonical?.source_updated_at, "2026-08-03T11:00:00.000Z");
});

await test("count後のskip削除は同一msでも新しいpartial revisionになる", () => {
  const targetAreaId = NORMAL_ROUTE[0] as AreaId;
  const withCount = buildRecord({
    date: "2026-08-03",
    complete: false,
    sessionStartedAt: "2026-08-03T09:00:00.000Z",
  });
  withCount.areaCounts[targetAreaId] = 12;
  withCount.areaCountRecordedAt[targetAreaId] =
    "2026-08-03T10:00:00.000Z";
  withCount.sourceUpdatedAt = getReview19SourceUpdatedAt(withCount);

  const skipped = clone(withCount);
  delete skipped.areaCounts[targetAreaId];
  delete skipped.areaCountRecordedAt[targetAreaId];
  skipped.excludedAreaIds = [targetAreaId];
  skipped.excludeReasons[targetAreaId] = "manual";
  skipped.sourceUpdatedAt = advanceReview19SourceUpdatedAt(
    withCount,
    "2026-08-03T10:00:00.000Z",
  );

  const countRow = buildRemoteReview19Row(withCount);
  const skipRow = buildRemoteReview19Row(skipped);
  assert.equal(countRow.source_updated_at, "2026-08-03T10:00:00.000Z");
  assert.equal(skipRow.source_updated_at, "2026-08-03T10:00:00.001Z");
  assert.equal(skipRow.payload.areaCounts[targetAreaId], undefined);
  assert.equal(skipRow.payload.areaCountRecordedAt[targetAreaId], undefined);
  assert.equal(skipRow.payload.excludeReasons[targetAreaId], "manual");

  const [canonical] = buildRemoteReview19Rows([withCount, skipped]);
  assert.equal(canonical?.source_updated_at, skipRow.source_updated_at);
  assert.equal(canonical?.payload.areaCounts[targetAreaId], undefined);
});

await test("旧5段階humanEvaluationはremote buildでも物理details化しない", () => {
  const legacy = buildLegacyFiveScaleRecord({
    date: "2026-08-04",
    recordedAt: "2026-08-04T10:00:00.000Z",
  });
  delete legacy.sourceUpdatedAt;
  const row = buildRemoteReview19Row(legacy);
  const targetAreaId = NORMAL_ROUTE[0] as AreaId;
  const evaluation = row.payload.areaEvaluations?.[targetAreaId];

  assert.equal(row.is_complete, true);
  assert.equal(evaluation?.humanEvaluation, "normal");
  assert.equal(evaluation?.humanEvaluationDetails, undefined);
  assert.equal(row.payload.sourceUpdatedAt, legacy.recordedAt);

  const legacyPayload = clone<RemoteReview19Row<Review19Result>>(row);
  delete legacyPayload.payload.sourceUpdatedAt;
  assert.notEqual(normalizeRemoteReview19Row(legacyPayload, "normal"), null);
});

await test("remote rowはdate/cycle/session/recordedAt/complete/metadata一致時だけ受理する", () => {
  const row = buildRemoteReview19Row(
    buildRecord({
      date: "2026-08-05",
      demandCycle: "summer",
      recordedAt: "2026-08-05T10:00:00.000Z",
    }),
  );

  assert.deepEqual(
    normalizeRemoteReview19Row(row, "summer"),
    row.payload,
  );

  const postgresTimestampFormatting = clone<RemoteReview19Row>(row);
  postgresTimestampFormatting.session_started_at =
    "2026-08-05T09:00:00+00:00";
  postgresTimestampFormatting.recorded_at = "2026-08-05T10:00:00+00:00";
  postgresTimestampFormatting.source_updated_at =
    "2026-08-05T10:00:00+00:00";
  assert.deepEqual(
    normalizeRemoteReview19Row(postgresTimestampFormatting, "summer"),
    row.payload,
  );

  const mutations: Array<(candidate: RemoteReview19Row) => void> = [
    (candidate) => {
      candidate.date = "2026-08-06";
    },
    (candidate) => {
      candidate.demand_cycle = "normal";
    },
    (candidate) => {
      candidate.session_started_at = "2026-08-05T09:30:00.000Z";
    },
    (candidate) => {
      candidate.recorded_at = null;
    },
    (candidate) => {
      candidate.is_complete = false;
    },
    (candidate) => {
      candidate.build_id = "mismatch";
    },
    (candidate) => {
      candidate.source_updated_at = "invalid";
    },
    (candidate) => {
      candidate.source_updated_at = "2026-08-05T08:59:59.000Z";
    },
    (candidate) => {
      candidate.source_updated_at = "2026-08-05T11:00:00.000Z";
    },
  ];

  for (const mutate of mutations) {
    const candidate = clone<RemoteReview19Row>(row);
    mutate(candidate);
    assert.equal(normalizeRemoteReview19Row(candidate, "summer"), null);
  }

  const stalePayloadSource = clone<RemoteReview19Row<Review19Result>>(row);
  stalePayloadSource.payload.sourceUpdatedAt =
    "2026-08-05T09:30:00.000Z";
  assert.equal(normalizeRemoteReview19Row(stalePayloadSource, "summer"), null);
});

await test("load normalizationは不正1行や同一business key重複を全体error候補にする", () => {
  const row = buildRemoteReview19Row(
    buildRecord({ date: "2026-08-06", demandCycle: "normal" }),
  );
  assert.equal(normalizeRemoteReview19Rows({}, "normal"), null);
  assert.equal(
    normalizeRemoteReview19Rows([row, { ...clone(row), date: "bad" }], "normal"),
    null,
  );
  assert.equal(normalizeRemoteReview19Rows([row, clone(row)], "normal"), null);
  assert.equal(normalizeRemoteReview19Rows([row], "summer"), null);
});

await test("loadはdemand_cycle filter付き単一table readを行う", async () => {
  const row = buildRemoteReview19Row(
    buildRecord({ date: "2026-08-07", demandCycle: "summer" }),
  );
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: Review19Fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse([row]);
  };

  const result = await loadRemoteReview19Records("summer", {
    config: { url: "https://example.supabase.co/", anonKey: "anon-key" },
    fetchImpl,
  });

  assert.equal(result.status, "ready");
  assert.match(capturedUrl, /\/rest\/v1\/review19_records\?/);
  assert.match(capturedUrl, /demand_cycle=eq\.summer/);
  assert.match(capturedUrl, /select=.*payload/);
  assert.match(capturedUrl, /source_updated_at/);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(
    (capturedInit?.headers as Record<string, string>).Authorization,
    "Bearer anon-key",
  );
});

await test("config欠損はdisabledでfetchしない", async () => {
  let called = false;
  const fetchImpl: Review19Fetch = async () => {
    called = true;
    return jsonResponse([]);
  };

  assert.deepEqual(
    await loadRemoteReview19Records("normal", { config: null, fetchImpl }),
    { status: "disabled" },
  );
  assert.deepEqual(
    await upsertRemoteReview19Record(
      buildRecord({ date: "2026-08-08" }),
      { config: null, fetchImpl },
    ),
    { status: "disabled" },
  );
  assert.equal(called, false);
});

await test("schema/table HTTP errorは旧fallbackせず1回でerrorにする", async () => {
  let called = 0;
  const fetchImpl: Review19Fetch = async () => {
    called += 1;
    return jsonResponse({ message: "missing relation" }, 404);
  };
  const options = {
    config: { url: "https://example.supabase.co", anonKey: "anon-key" },
    fetchImpl,
  };

  assert.deepEqual(await loadRemoteReview19Records("normal", options), {
    status: "error",
    message: "HTTP 404\nmessage: missing relation",
  });
  assert.equal(called, 1);

  assert.deepEqual(
    await upsertRemoteReview19Record(
      buildRecord({ date: "2026-08-09" }),
      options,
    ),
    { status: "error", message: "HTTP 404\nmessage: missing relation" },
  );
  assert.equal(called, 2);
});

await test("bulk upsertはdate+cycleをcanonical化し指定conflict keyを使う", async () => {
  const partial = buildRecord({
    date: "2026-08-10",
    demandCycle: "normal",
    complete: false,
  });
  const final = buildRecord({
    date: "2026-08-10",
    demandCycle: "normal",
    recordedAt: "2026-08-10T11:00:00.000Z",
  });
  const summerFinal = buildRecord({
    date: "2026-08-10",
    demandCycle: "summer",
    recordedAt: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(buildRemoteReview19Rows([partial, final, summerFinal]).length, 2);

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await upsertRemoteReview19Records(
    [partial, final, summerFinal],
    {
      config: { url: "https://example.supabase.co", anonKey: "anon-key" },
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse(null, 201);
      },
    },
  );

  assert.deepEqual(result, { status: "saved", savedCount: 2 });
  assert.match(capturedUrl, /on_conflict=date,demand_cycle$/);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    (capturedInit?.headers as Record<string, string>).Prefer,
    "resolution=merge-duplicates,return=minimal",
  );
  const body = JSON.parse(String(capturedInit?.body)) as RemoteReview19Row[];
  assert.equal(body.length, 2);
  assert.equal(
    body.find((row) => row.demand_cycle === "normal")?.recorded_at,
    final.recordedAt,
  );
});

await test("median mergeはcomplete finalだけをdate+cycle単位で重複排除する", () => {
  const localOlder = buildRecord({
    date: "2026-08-11",
    demandCycle: "normal",
    recordedAt: "2026-08-11T10:00:00.000Z",
  });
  const remoteNewer = buildRecord({
    date: "2026-08-11",
    demandCycle: "normal",
    sessionStartedAt: "2026-08-11T09:30:00.000Z",
    recordedAt: "2026-08-11T11:00:00.000Z",
  });
  const summerSameDate = buildRecord({
    date: "2026-08-11",
    demandCycle: "summer",
    recordedAt: "2026-08-11T12:00:00.000Z",
  });
  const partial = buildRecord({ date: "2026-08-12" });
  const incompleteFinal = buildRecord({
    date: "2026-08-13",
    complete: false,
    recordedAt: "2026-08-13T10:00:00.000Z",
  });
  const legacy = buildLegacyFiveScaleRecord({
    date: "2026-08-14",
    recordedAt: "2026-08-14T10:00:00.000Z",
  });

  assert.equal(isCompleteFinalReview19Record(partial), false);
  assert.equal(isCompleteFinalReview19Record(incompleteFinal), false);
  assert.equal(isCompleteFinalReview19Record(legacy), true);

  const merged = mergeReview19MedianHistory({
    localRecords: [localOlder, partial, incompleteFinal, legacy],
    remoteRecords: [remoteNewer, summerSameDate],
  });
  assert.equal(merged.length, 3);
  assert.equal(
    merged.find(
      (record) =>
        record.date === "2026-08-11" && record.demandCycle === "normal",
    )?.sessionStartedAt,
    remoteNewer.sessionStartedAt,
  );
  assert.ok(
    merged.some(
      (record) =>
        record.date === "2026-08-11" && record.demandCycle === "summer",
    ),
  );

  const targetAreaId = NORMAL_ROUTE[0] as AreaId;
  const mergedLegacy = merged.find((record) => record.date === "2026-08-14");
  assert.equal(
    mergedLegacy?.areaEvaluations?.[targetAreaId]?.humanEvaluationDetails,
    undefined,
  );

  const normalOnly = mergeReview19MedianHistory({
    localRecords: [localOlder, legacy],
    remoteRecords: [remoteNewer, summerSameDate],
    demandCycle: "normal",
  });
  assert.equal(normalOnly.length, 2);
  assert.ok(normalOnly.every((record) => record.demandCycle === "normal"));
});

await test("loadはvalid HTTPでも不正payloadをerrorにし欠落扱いしない", async () => {
  const row = buildRemoteReview19Row(
    buildRecord({ date: "2026-08-15", demandCycle: "normal" }),
  );
  const invalid = clone<RemoteReview19Row>(row);
  invalid.payload = { ...clone(row.payload), date: "2026-08-16" };

  const result = await loadRemoteReview19Records("normal", {
    config: { url: "https://example.supabase.co", anonKey: "anon-key" },
    fetchImpl: async () => jsonResponse([row, invalid]),
  });
  assert.deepEqual(result, {
    status: "error",
    message: "Invalid review19_records response",
  });
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${passed} Review19 remote-storage checks passed.`);
}
