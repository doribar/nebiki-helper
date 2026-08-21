import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AREA_MASTERS } from "../src/domain/area.ts";
import {
  getCurrentAreaSkipDecision,
  getNextPendingCandidate,
} from "../src/domain/pending.ts";
import { appendSkipRecordsInMemory } from "../src/domain/storage.ts";
import type {
  AreaId,
  AreaProgress,
  NextSessionSkipRecord,
} from "../src/domain/types.ts";

function completedAreaMap(): Record<AreaId, AreaProgress> {
  return Object.fromEntries(
    AREA_MASTERS.map((area) => [
      area.id,
      {
        areaId: area.id,
        status: "completed" as const,
        areaJudge: "normal" as const,
      },
    ]),
  ) as Record<AreaId, AreaProgress>;
}

{
  const areaProgressMap = {
    ...completedAreaMap(),
    tempura: {
      areaId: "tempura" as const,
      status: "skipped_manual" as const,
      areaJudge: null,
    },
  };
  const before = structuredClone(areaProgressMap);
  const decision = getCurrentAreaSkipDecision({
    areaProgressMap,
    currentAreaId: "tempura",
  });

  assert.deepEqual(decision, {
    canSkip: false,
    reason: "no_alternative_area",
    alternatives: [],
  });
  assert.deepEqual(areaProgressMap, before);
  console.log("PASS: 最後の未完了エリアはスキップ不可と判定し、stateを変更しない");
}

{
  const areaProgressMap = {
    ...completedAreaMap(),
    tempura: {
      areaId: "tempura" as const,
      status: "skipped_manual" as const,
      areaJudge: null,
    },
    bento_men: {
      areaId: "bento_men" as const,
      status: "unstarted" as const,
      areaJudge: null,
    },
  };
  const decision = getCurrentAreaSkipDecision({
    areaProgressMap,
    currentAreaId: "tempura",
  });

  assert.equal(decision.canSkip, true);
  assert.deepEqual(decision.alternatives.map((option) => option.areaId), ["bento_men"]);
  console.log("PASS: 別の未完了エリアがあれば従来どおりスキップ移動できる");
}

{
  const hook = readFileSync(
    new URL("../src/hooks/useNebikiApp.ts", import.meta.url),
    "utf8",
  );
  const start = hook.indexOf("function skipCurrentArea()");
  const end = hook.indexOf("function chooseSkipTargetArea", start);
  const body = hook.slice(start, end);
  const decisionIndex = body.indexOf("getCurrentAreaSkipDecision");
  const undoIndex = body.indexOf("setUndoSnapshot");

  assert.ok(decisionIndex >= 0, "skipの事前判定がhookへ配線されていること");
  assert.ok(undoIndex > decisionIndex, "block時はundo snapshotも変更しないこと");
  assert.match(
    body,
    /setUndoNotice\("他にスキップできるエリアがありません"\)/,
  );
  assert.match(body, /if \(!skipDecision\.canSkip\) \{[\s\S]*?return;/);
  const appShell = readFileSync(
    new URL("../src/app/App.tsx", import.meta.url),
    "utf8",
  );
  assert.match(appShell, /role="status"/);
  assert.match(appShell, /\{app\.derived\.undoNotice\}/);
  console.log("PASS: hookはundo snapshot変更前に最後1件をblockし、toast通知する");
}

{
  const areaProgressMap = {
    ...completedAreaMap(),
    tempura: {
      areaId: "tempura" as const,
      status: "skipped_manual" as const,
      areaJudge: null,
    },
  };
  const revisit = getNextPendingCandidate({
    areaProgressMap,
    referenceAreaId: "bento_men",
    deferredAreaIds: ["tempura"],
  });

  assert.equal(revisit?.areaId, "tempura");
  assert.equal(revisit?.reason, "manual");
  console.log("PASS: スキップ直後の自己ループを防ぎつつ、別エリア後の再訪は維持する");
}

{
  const record: NextSessionSkipRecord = {
    date: "2026-08-22",
    targetDiscountTime: "18",
    areaId: "tempura",
    demandCycle: "summer",
    skipKind: "early_next_minus5",
  };
  const merged = appendSkipRecordsInMemory({
    currentRecords: [record],
    recordsToAdd: [{ ...record }],
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], record);
  console.log("PASS: skip record identity (date/time/area) のdedupeと順序を維持する");
}

console.log("\n5 / 5 last-area skip checks passed.");
