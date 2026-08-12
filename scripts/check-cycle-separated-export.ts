import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildAllFinalizedDayDataExportPayloadsByDemandCycle,
  buildAllReview19DataExportPayloadsByDemandCycle,
  buildLatestFinalizedDayDataExportPayload,
  buildLatestReview19DataExportPayload,
  getDemandCycleAllExportFilename,
} from "../src/domain/separateDataExport.ts";
import {
  downloadJsonFiles,
  type JsonDownloadRuntime,
} from "../src/domain/jsonDownload.ts";
import type {
  DemandCycle,
  Review19DaySnapshot,
  Review19Result,
} from "../src/domain/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const hookSource = readFileSync(
  `${projectRoot}/src/hooks/useNebikiApp.ts`,
  "utf8",
);
const settingsSource = readFileSync(
  `${projectRoot}/src/components/common/AdminSettingsDialog.tsx`,
  "utf8",
);

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`OK: ${name}`);
}

function makeReview(
  date: string,
  demandCycle?: DemandCycle,
): Review19Result {
  return {
    dataSchemaVersion: 3,
    appVersion: `source-${date}`,
    buildId: `build-${date}`,
    review19Status: "recorded",
    date,
    demandCycle,
    sessionStartedAt: `${date}T18:30:00+09:00`,
    reviewCompletedAt: `${date}T19:10:00+09:00`,
    recordedAt: `${date}T19:11:00+09:00`,
    areaCountRecordedAt: {},
    ratingStatus: "not_collected",
    ratings: null,
    ratingScores: null,
    areaCounts: {},
    areaEvaluations: {},
    excludedAreaIds: [],
    excludeReasons: {},
    dataQuality: {
      expectedAreaCount: 0,
      recordedAreaCount: 0,
      excludedAreaCount: 0,
      missingAreaIds: [],
      duplicateAreaIds: [],
      complete: true,
      processComplete: true,
      measurementComplete: true,
      notMeasuredAreaIds: [],
      missingReasons: {},
      humanEvaluationComplete: true,
      humanEvaluationRecordedAreaCount: 0,
      missingHumanEvaluationAreaIds: [],
    },
  };
}

function makeDay(
  date: string,
  demandCycle?: DemandCycle,
): Review19DaySnapshot {
  return {
    version: 1,
    dataSchemaVersion: 3,
    appVersion: `source-${date}`,
    buildId: `build-${date}`,
    capturedAt: `${date}T20:35:00+09:00`,
    date,
    demandCycle,
    review19Status: "not_performed",
    sessions: [],
    areaCountRecords: [],
  };
}

test("Review19 all export splits normal/summer without an empty file", () => {
  const exportedAt = "2026-08-11T15:23:45.000Z";
  const both = buildAllReview19DataExportPayloadsByDemandCycle({
    records: [
      makeReview("2026-08-09"),
      makeReview("2026-08-10", "summer"),
    ],
    exportedAt,
  });
  assert.deepEqual(
    both.map(({ demandCycle }) => demandCycle),
    ["normal", "summer"],
  );
  assert.equal(both[0]?.payload.count, 1);
  assert.equal(both[1]?.payload.count, 1);
  assert.deepEqual(both[0]?.payload.exportFilter, { demandCycle: "normal" });
  assert.deepEqual(both[1]?.payload.exportFilter, { demandCycle: "summer" });
  assert.deepEqual(
    Object.keys(both[0]?.payload ?? {}).sort(),
    Object.keys(both[1]?.payload ?? {}).sort(),
  );
  assert.equal(both[0]?.payload.records[0]?.demandCycle, "normal");
  assert.equal(both[0]?.payload.records[0]?.appVersion, "source-2026-08-09");
  assert.equal(both[1]?.payload.records[0]?.demandCycle, "summer");

  const summerOnly = buildAllReview19DataExportPayloadsByDemandCycle({
    records: [makeReview("2026-08-10", "summer")],
    exportedAt,
  });
  assert.equal(summerOnly.length, 1);
  assert.equal(summerOnly[0]?.demandCycle, "summer");
});

test("daily all export splits cycles and keeps complete record metadata", () => {
  const exportedAt = "2026-08-11T15:23:45.000Z";
  const exports = buildAllFinalizedDayDataExportPayloadsByDemandCycle({
    records: [
      { ...makeDay("2026-08-09"), memo: "normal memo" },
      { ...makeDay("2026-08-10", "summer"), discardCount: 3 },
    ],
    exportedAt,
  });
  assert.deepEqual(
    exports.map(({ demandCycle }) => demandCycle),
    ["normal", "summer"],
  );
  assert.deepEqual(
    Object.keys(exports[0]?.payload ?? {}).sort(),
    Object.keys(exports[1]?.payload ?? {}).sort(),
  );
  assert.equal(exports[0]?.payload.records[0]?.demandCycle, "normal");
  assert.equal(exports[0]?.payload.records[0]?.memo, "normal memo");
  assert.equal(exports[1]?.payload.records[0]?.demandCycle, "summer");
  assert.equal(exports[1]?.payload.records[0]?.discardCount, 3);
});

test("latest exports remain one unfiltered payload", () => {
  const review = buildLatestReview19DataExportPayload({
    records: [
      makeReview("2026-08-09", "normal"),
      makeReview("2026-08-10", "summer"),
    ],
    exportedAt: "2026-08-11T00:00:00Z",
  });
  const daily = buildLatestFinalizedDayDataExportPayload({
    records: [
      makeDay("2026-08-09", "normal"),
      makeDay("2026-08-10", "summer"),
    ],
    exportedAt: "2026-08-11T00:00:00Z",
  });
  assert.equal(review?.count, 1);
  assert.equal(review?.records[0]?.demandCycle, "summer");
  assert.equal(Object.hasOwn(review ?? {}, "exportFilter"), false);
  assert.equal(daily?.daySnapshot.demandCycle, "summer");
  assert.equal(Object.hasOwn(daily ?? {}, "exportFilter"), false);
});

test("all-export filenames contain data kind, cycle, and JST timestamp", () => {
  assert.equal(
    getDemandCycleAllExportFilename({
      dataKind: "review19",
      demandCycle: "normal",
      exportedAt: "2026-08-11T15:23:45.000Z",
    }),
    "nebiki-review19-normal-20260812-0023.json",
  );
  assert.equal(
    getDemandCycleAllExportFilename({
      dataKind: "daily",
      demandCycle: "summer",
      exportedAt: "2026-08-11T15:23:45.000Z",
    }),
    "nebiki-daily-summer-20260812-0023.json",
  );
});

test("one action downloads two JSON files without a popup", () => {
  const clicks: string[] = [];
  const appended: string[] = [];
  const revoked: string[] = [];
  let sequence = 0;
  let cleanup: (() => void) | null = null;
  const runtime: JsonDownloadRuntime = {
    createObjectUrl: () => `blob:${++sequence}`,
    revokeObjectUrl: (url) => revoked.push(url),
    createLink: () => ({
      href: "",
      download: "",
      click() {
        clicks.push(this.download);
      },
      remove() {},
    }),
    appendLink: (link) => appended.push(link.download),
    scheduleCleanup: (callback) => {
      cleanup = callback;
    },
  };
  assert.equal(
    downloadJsonFiles(
      [
        { filename: "normal.json", payload: { cycle: "normal" } },
        { filename: "summer.json", payload: { cycle: "summer" } },
      ],
      runtime,
    ),
    true,
  );
  assert.deepEqual(appended, ["normal.json", "summer.json"]);
  assert.deepEqual(clicks, ["normal.json", "summer.json"]);
  assert.equal(hookSource.includes("window.open"), false);
  if (!cleanup) throw new Error("cleanup was not scheduled");
  (cleanup as () => void)();
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
});

test("multi-download preparation failure returns false without clicking", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  let clickCount = 0;
  const runtime: JsonDownloadRuntime = {
    createObjectUrl: () => "blob:test",
    revokeObjectUrl: () => {},
    createLink: () => ({
      href: "",
      download: "",
      click: () => {
        clickCount += 1;
      },
      remove: () => {},
    }),
    appendLink: () => {},
    scheduleCleanup: (cleanup) => cleanup(),
  };
  assert.doesNotThrow(() => {
    assert.equal(
      downloadJsonFiles(
        [
          { filename: "valid.json", payload: {} },
          { filename: "invalid.json", payload: circular },
        ],
        runtime,
      ),
      false,
    );
  });
  assert.equal(clickCount, 0);
});

test("existing two all-data buttons are reused", () => {
  assert.equal(
    (settingsSource.match(/onExportAllReview19Data/g) ?? []).length,
    3,
  );
  assert.equal(
    (settingsSource.match(/onExportAllDailyData/g) ?? []).length,
    3,
  );
  assert.match(hookSource, /buildAllReview19DataExportPayloadsByDemandCycle/);
  assert.match(hookSource, /buildAllFinalizedDayDataExportPayloadsByDemandCycle/);
});

console.log(`Cycle-separated export checks passed: ${passed}/7`);
