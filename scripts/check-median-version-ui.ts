import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildMedianEvaluationDisplay } from "../src/domain/medianEvaluationPresentation.ts";
import type { AreaProgress } from "../src/domain/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(`${projectRoot}/${path}`, "utf8");

let passed = 0;
function test(name: string, run: () => void): void {
  run();
  passed += 1;
  console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

function makeProgress(
  patch: Partial<AreaProgress>,
): AreaProgress {
  return {
    areaId: "bento_men",
    status: "unstarted",
    areaJudge: "normal",
    ...patch,
  };
}

const readyBasis = {
  ruleVersion: "area_count_median_v1" as const,
  recommendationStatus: "ready" as const,
  sampleSize: 3,
  requiredSampleSize: 3,
};

test("manual/finalとは別に、手動変更前の中央値自動判定を表示", () => {
  const display = buildMedianEvaluationDisplay(
    makeProgress({
      areaCountEvaluation: "slightly_few",
      areaCountEvaluationSource: "manual",
      humanEvaluationDetails: {
        humanEvaluationScore9: 3,
        humanEvaluationScale: 9,
        humanEvaluationSelections: ["slightly_few"],
        automaticEvaluation: "normal",
        resolvedEvaluation: "slightly_few",
        resolutionDirection: "none",
        resolutionReason: "single_selection",
      },
      areaCountDecisionBasis: {
        ...readyBasis,
        baseEvaluation: "normal",
        finalEvaluation: "slightly_few",
      },
    }),
  );

  assert.deepEqual(display, {
    status: "ready",
    evaluation: "normal",
    text: "普通",
  });
});

test("履歴中央値をそのまま採用した場合も自動判定を表示", () => {
  const display = buildMedianEvaluationDisplay(
    makeProgress({
      areaCountEvaluation: "normal",
      areaCountEvaluationSource: "history",
      areaCountDecisionBasis: {
        ...readyBasis,
        baseEvaluation: "normal",
        finalEvaluation: "normal",
      },
    }),
  );

  assert.equal(display?.status, "ready");
  assert.equal(display?.text, "普通");
});

test("履歴不足を普通へfallbackせず明示", () => {
  const display = buildMedianEvaluationDisplay(
    makeProgress({
      areaCountDecisionBasis: {
        ...readyBasis,
        recommendationStatus: "insufficient",
        sampleSize: 2,
      },
    }),
  );

  assert.deepEqual(display, {
    status: "insufficient",
    evaluation: null,
    text: "履歴不足",
  });
});

test("ready情報が不完全でも普通を捏造しない", () => {
  const display = buildMedianEvaluationDisplay(
    makeProgress({ areaCountDecisionBasis: readyBasis }),
  );
  assert.deepEqual(display, {
    status: "unavailable",
    evaluation: null,
    text: "取得できません",
  });
});

test("値引率画面へ表示専用modelを配線", () => {
  const rateScreen = source("src/components/screens/RateDisplayScreen.tsx");
  const router = source("src/app/AppRouter.tsx");
  assert.match(rateScreen, /中央値判定：<strong>\{medianEvaluationDisplay\.text\}<\/strong>/);
  assert.match(router, /medianEvaluationDisplay=\{buildMedianEvaluationDisplay\(/);
});

test("トップは正規APP_VERSIONを同一header内に表示", () => {
  const start = source("src/components/screens/StartScreen.tsx");
  assert.match(start, /import \{ APP_VERSION \} from "\.\.\/\.\.\/domain\/dataVersion\.ts"/);
  assert.match(start, /値引ヘルパー[\s\S]*?aria-label="アプリバージョン"[\s\S]*?\{APP_VERSION\}/);
  assert.doesNotMatch(start, /2026\.8\.9-\d+/);
});

console.log(`median/version UI checks passed: ${passed}/6`);
