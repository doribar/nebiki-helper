import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const noticeSource = source(
  "../src/components/screens/AutoSkipNoticeScreen.tsx",
);
const countSource = source(
  "../src/components/screens/AutoSkipCountScreen.tsx",
);

for (const label of [
  "残数だけ記録する",
  "今回は値引する",
  "測定せずスキップする",
]) {
  assert.ok(noticeSource.includes(label), `3択に「${label}」が必要です`);
}

assert.ok(noticeSource.includes("onRecordCountOnly"));
assert.ok(noticeSource.includes("onProcessNormally"));
assert.ok(noticeSource.includes("onSkipWithoutMeasurement"));

assert.ok(countSource.includes('inputMode="numeric"'));
assert.ok(countSource.includes('pattern="[0-9]*"'));
assert.ok(countSource.includes("Number.isSafeInteger"));
assert.ok(countSource.includes("Number.isSafeInteger(parsed) && parsed >= 0"));
assert.ok(countSource.includes("残数を保存する"));
assert.ok(countSource.includes("値引判断や追加の値引率計算は行いません"));
assert.equal(countSource.includes("onJudge"), false);
assert.equal(countSource.includes("AreaCountRecommendation"), false);

console.log("PASS: 先取り値引済みエリアの3択と残数のみ入力UI");
