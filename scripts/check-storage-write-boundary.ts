import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

type PrimitiveCall = {
  file: string;
  line: number;
  signature: string;
};

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(projectRoot, "src");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) return listSourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    })
    .sort();
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function collectStoragePrimitiveCalls(path: string): PrimitiveCall[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const file = relative(projectRoot, path).replaceAll("\\", "/");
  const calls: PrimitiveCall[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "setItem" ||
        node.expression.name.text === "removeItem")
    ) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const callee = compact(node.expression.getText(sourceFile));
      const key = compact(node.arguments[0]?.getText(sourceFile) ?? "<missing>");
      calls.push({
        file,
        line,
        signature: `${file}|${callee}|${key}`,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

// Exact low-level allowlist. Application hooks/components/App may not access
// setItem/removeItem directly. A new key or adapter site requires an explicit
// review and a corresponding high-level failure test before this list changes.
const allowedLocalStoragePrimitiveSignatures = new Set([
  "src/domain/areaCountLocalStorage.ts|storage.setItem|AREA_COUNT_LOCAL_STORAGE_KEY",
  "src/domain/areaCountLocalStorage.ts|storage.setItem|LEGACY_SUMMER_AREA_COUNT_STORAGE_KEY",
  "src/domain/demandCycleStorage.ts|localStorage.setItem|DEMAND_CYCLE_STORAGE_KEYS.state",
  "src/domain/demandCycleStorage.ts|localStorage.setItem|DEMAND_CYCLE_STORAGE_KEYS.fixedTimeState",
  "src/domain/demandCycleStorage.ts|localStorage.setItem|DEMAND_CYCLE_STORAGE_KEYS.summerAreaCountRecords",
  "src/domain/fixedTimeTemperatureMemory.ts|localStorage.setItem|FIXED_TIME_TEMPERATURE_STORAGE_KEY",
  "src/domain/finalizedDayData.ts|getLocalStorage()?.setItem|FINALIZED_DAY_DATA_STORAGE_KEY",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.currentSession",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.currentSession",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.workSessionCheckpoint",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.workSessionCheckpoint",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.runtimeState",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.runtimeState",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.nextSessionSkipRecords",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.lastSessionWeather",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.lastSessionWeather",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.lastUsedSessionDraft",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.lastUsedSessionDraft",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.dailyMessageState",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.finalDayAutoExportDates",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.review19Records",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.review19SourceState",
  "src/domain/storage.ts|localStorage.removeItem|STORAGE_KEYS.review19SourceState",
  "src/domain/storage.ts|localStorage.setItem|STORAGE_KEYS.dailySessionSnapshots",
  "src/domain/storage.ts|localStorage.removeItem|key",
  "src/domain/supabaseSyncQueue.ts|storage.setItem|PENDING_SUPABASE_SYNC_STORAGE_KEY",
  "src/domain/supabaseSyncQueue.ts|resolveStorage(options.storage)?.removeItem|PENDING_SUPABASE_SYNC_STORAGE_KEY",
]);

// calculatorDraft intentionally uses sessionStorage and catches all operations.
const allowedSessionStoragePrimitiveSignatures = new Set([
  "src/domain/calculatorDraft.ts|storage.removeItem|key",
  "src/domain/calculatorDraft.ts|storage.setItem|key",
]);

const calls = listSourceFiles(sourceRoot).flatMap(collectStoragePrimitiveCalls);
const unexpected = calls.filter(
  (call) =>
    !allowedLocalStoragePrimitiveSignatures.has(call.signature) &&
    !allowedSessionStoragePrimitiveSignatures.has(call.signature),
);

assert.deepEqual(
  unexpected.map(({ file, line, signature }) => ({ file, line, signature })),
  [],
  `Unreviewed storage primitive found. Route it through the shared boundary or add an exact reviewed allowlist entry:\n${unexpected
    .map((call) => `${call.file}:${call.line} ${call.signature}`)
    .join("\n")}`,
);

const applicationLayerRawCalls = calls.filter((call) =>
  call.file.startsWith("src/hooks/") ||
  call.file.startsWith("src/components/") ||
  call.file.startsWith("src/app/"),
);
assert.deepEqual(
  applicationLayerRawCalls,
  [],
  "App/hooks/components must not call setItem/removeItem directly.",
);

const calculatorDraftSource = readFileSync(
  resolve(projectRoot, "src/domain/calculatorDraft.ts"),
  "utf8",
);
assert.match(calculatorDraftSource, /window\.sessionStorage/);
assert.match(calculatorDraftSource, /try\s*\{/);

console.log(
  `PASS: storage primitive allowlist (${calls.length} reviewed call sites; application-layer raw calls 0)`,
);
