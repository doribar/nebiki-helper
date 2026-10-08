import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { FULL_MODE_NOTICE_TEXTS } from "../src/domain/fullMode.ts";
import type { AreaCountRecommendation } from "../src/domain/areaCountHistory.ts";
import type { DemandCycle } from "../src/domain/types.ts";

// Real production TSX is compiled here. SSR checks use React's actual renderer;
// the persistent hook runner below checks event/state sequences without a DOM.
// Native touch delivery and visual layout are separate browser checks.
type Props = Record<string, unknown>;
type Component = (props: Props) => React.ReactNode;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { type: Component; slots: Slot[]; cursor: number };
type Element = { type: string; props: Props; parent: Element | null; children: Array<Element | string> };
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const textOf = (node: Element | string): string => typeof node === "string" ? node : node.children.map(textOf).join("");

class ModuleLoader {
  private modules = new Map<string, Record<string, unknown>>();
  private react: object;
  private environment: Props;
  constructor(react: object, environment: Props = {}) {
    this.react = react;
    this.environment = environment;
  }
  async load(path: string | URL): Promise<Record<string, unknown>> {
    const url = typeof path === "string" ? new URL(`../${path}`, import.meta.url) : path;
    const cached = this.modules.get(url.href);
    if (cached) return cached;
    const raw = readFileSync(url, "utf8");
    const ast = ts.createSourceFile(url.pathname, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dependencies = new Map<string, unknown>([["react", this.react], ["react/jsx-runtime", jsxRuntime]]);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
      const id = statement.moduleSpecifier.text;
      if (dependencies.has(id)) continue;
      assert.ok(id.startsWith("."), `expected local production dependency: ${id}`);
      const target = [id, `${id}.ts`, `${id}.tsx`].map((candidate) => new URL(candidate, url)).find((candidate) => existsSync(candidate));
      assert.ok(target, `actual dependency exists: ${id}`);
      const needsEnvironment = target.pathname.endsWith(".tsx") || /\/(useSwipeToSkip|calculatorDraft)\.ts$/.test(target.pathname);
      dependencies.set(id, needsEnvironment ? await this.load(target) : await import(target.href));
    }
    const exports: Record<string, unknown> = {};
    const output = ts.transpileModule(raw, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(output, {
      exports, ...this.environment,
      require: (id: string) => {
        assert.ok(dependencies.has(id), `actual dependency loaded: ${id}`);
        return dependencies.get(id);
      },
    });
    this.modules.set(url.href, exports);
    return exports;
  }
}

class Runtime {
  private active: Instance | null = null;
  private instances = new Map<string, Instance>();
  private effects: Array<() => void> = [];
  private root: (() => React.ReactNode) | null = null;
  private dirty = true;
  private timerId = 0;
  private timers = new Map<number, () => void>();
  private storage = new Map<string, string>();
  storageWrites = 0;
  nodes: Element[] = [];
  private slot(): Slot {
    assert.ok(this.active, "hooks run inside the production component");
    return this.active.slots[this.active.cursor++] ??= {};
  }
  private hooks = {
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((value: T) => T)) => void] => {
      const slot = this.slot();
      if (!Object.hasOwn(slot, "value")) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, (next) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; this.dirty = true; }
      }];
    },
    useRef: <T,>(initial: T): { current: T } => {
      const slot = this.slot();
      if (!Object.hasOwn(slot, "value")) slot.value = { current: initial };
      return slot.value as { current: T };
    },
    useMemo: <T,>(get: () => T, deps?: readonly unknown[]): T => {
      const slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.value = get(); slot.deps = deps; }
      return slot.value as T;
    },
    useCallback: <T,>(callback: T, deps?: readonly unknown[]): T => {
      const slot = this.slot();
      if (!sameDeps(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const slot = this.slot();
      if (sameDeps(slot.deps, deps)) return;
      slot.deps = deps;
      this.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
  loader = new ModuleLoader(this.hooks, {
    window: {
      setTimeout: (run: () => void) => { const id = ++this.timerId; this.timers.set(id, run); return id; },
      clearTimeout: (id: number) => { this.timers.delete(id); },
      addEventListener: () => {}, removeEventListener: () => {},
      sessionStorage: {
        getItem: (key: string) => this.storage.get(key) ?? null,
        setItem: (key: string, value: string) => { this.storage.set(key, value); this.storageWrites += 1; },
        removeItem: (key: string) => { this.storage.delete(key); this.storageWrites += 1; },
      },
    },
    document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    navigator: { vibrate: () => {} },
  });
  mount(component: Component, props: Props) { this.root = () => React.createElement(component, props); this.flush(); }
  flush() {
    assert.ok(this.root);
    let renders = 0;
    while (this.dirty) {
      assert.ok(++renders < 30, "state/effect rerenders converge");
      this.dirty = false;
      this.nodes = [];
      const visited = new Set<string>();
      const expand = (node: React.ReactNode, path: string, parent: Element | null): Array<Element | string> => {
        if (node === null || node === undefined || typeof node === "boolean") return [];
        if (typeof node === "string" || typeof node === "number") return [String(node)];
        if (Array.isArray(node)) return node.flatMap((child, index) => expand(child, `${path}/${index}`, parent));
        assert.ok(React.isValidElement<Props>(node));
        if (node.type === React.Fragment) return expand(node.props.children as React.ReactNode, `${path}/fragment`, parent);
        if (typeof node.type === "function") {
          const type = node.type as Component;
          const key = `${path}:${node.key ?? ""}`;
          let instance = this.instances.get(key);
          if (!instance || instance.type !== type) {
            instance?.slots.forEach((slot) => slot.cleanup?.());
            instance = { type, slots: [], cursor: 0 };
            this.instances.set(key, instance);
          }
          visited.add(key);
          instance.cursor = 0;
          const previous = this.active;
          this.active = instance;
          const result = type(node.props);
          this.active = previous;
          return expand(result, `${path}/render`, parent);
        }
        assert.equal(typeof node.type, "string");
        const element: Element = { type: node.type as string, props: node.props, parent, children: [] };
        this.nodes.push(element);
        element.children = expand(node.props.children as React.ReactNode, `${path}/children`, element);
        return [element];
      };
      expand(this.root(), "root", null);
      for (const [key, instance] of this.instances) {
        if (visited.has(key)) continue;
        instance.slots.forEach((slot) => slot.cleanup?.());
        this.instances.delete(key);
      }
      const effects = this.effects;
      this.effects = [];
      effects.forEach((effect) => effect());
    }
  }
  find(predicate: (node: Element) => boolean): Element {
    const element = this.nodes.find(predicate);
    assert.ok(element, "actual rendered control exists");
    return element;
  }
  buttons(text: string) { return this.nodes.filter((node) => node.type === "button" && textOf(node) === text); }
  button(text: string) { assert.equal(this.buttons(text).length, 1, `one ${text} control`); return this.buttons(text)[0]; }
  dialog() { return this.find((node) => node.props.role === "dialog"); }
  hasDialog() { return this.nodes.some((node) => node.props.role === "dialog"); }
  dispatch(target: Element, name: string, fields: Props = {}) {
    if (target.props.disabled) return;
    let stopped = false;
    const event = {
      detail: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; }, ...fields,
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = target; node; node = node.parent) ancestors.push(node);
    const invoke = (node: Element, key: string) => {
      if (!stopped && typeof node.props[key] === "function") (node.props[key] as (event: Props) => void)(event);
    };
    [...ancestors].reverse().forEach((node) => invoke(node, `on${name}Capture`));
    ancestors.forEach((node) => invoke(node, `on${name}`));
    this.flush();
  }
  click(target: Element) { this.dispatch(target, "Click"); }
  swipe(target: Element) {
    this.dispatch(target, "TouchStart", { touches: [{ identifier: 1, clientX: 200, clientY: 50 }] });
    this.dispatch(target, "TouchEnd", { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });
  }
}

const forbidden = /明らかに多い場合は無理に下げず|夕方〜夜の売れ方も考慮して個別に判断します/;
const productPrefix = "・商品が大パックと小パックで分かれている➡大パックだけ値引・期限が近いものと遠いもので分かれている➡近いものだけ値引・分かれていなければ値引時刻が";
function body(purpose: "product" | "manual-area", cycle: DemandCycle): string {
  const first = cycle === "summer" ? "15時・17時" : "15時";
  const second = cycle === "summer" ? "18時以降" : "17時以降";
  return purpose === "product"
    ? `${productPrefix}${first}：少ない側に寄せる${second}：多い側に寄せる`
    : `${first}：2つの間で迷う場合は選択肢を長押し。中間評価として記録し、値引率は少ない側の判定で計算します。${second}：2つの間で迷う場合は選択肢を長押し。中間評価として記録し、値引率は多い側の判定で計算します。`;
}
const ssr = new ModuleLoader(React);
const Dialog = (await ssr.load("src/components/common/JudgeHintDialog.tsx")).JudgeHintDialog as Component;
let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); passed += 1; console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
}

await test("dialog requires an explicit purpose and removes the old compact switch", () => {
  const raw = source("src/components/common/JudgeHintDialog.tsx");
  const ast = ts.createSourceFile("JudgeHintDialog.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "JudgeHintDialog");
  assert.ok(declaration && ts.isFunctionDeclaration(declaration));
  const props = declaration.parameters[0]?.type;
  assert.ok(props && ts.isTypeLiteralNode(props));
  const purpose = props.members.find((member) => ts.isPropertySignature(member) && member.name.getText(ast) === "purpose");
  assert.ok(purpose && ts.isPropertySignature(purpose));
  assert.equal(purpose.questionToken, undefined, "purpose has no implicit fallback");
  assert.equal(purpose.type?.getText(ast), '"product" | "manual-area"');
  assert.doesNotMatch(raw, /\bcompact\b/);
});

for (const purpose of ["product", "manual-area"] as const) {
  for (const cycle of ["normal", "summer"] as const) {
    await test(`actual SSR: ${purpose} / ${cycle} contains exactly its prescribed guidance`, () => {
      const markup = renderToStaticMarkup(React.createElement(Dialog, { purpose, demandCycle: cycle, onClose: () => {} }));
      assert.equal(markup.replace(/<[^>]*>/g, ""), `迷った時の判断基準${body(purpose, cycle)}OK`);
      assert.doesNotMatch(markup, forbidden);
      if (purpose === "product") assert.doesNotMatch(markup, /長押し|中間評価|として計算|側の判定/);
      else assert.doesNotMatch(markup, /大パック|小パック|期限が近い|近いものだけ値引|側に寄せる/);
      assert.match(markup, /role="dialog" aria-modal="true" aria-labelledby="judge-hint-title"/);
      assert.match(markup, /id="judge-hint-title"/);
      assert.equal([...markup.matchAll(/<button\b/g)].length, 1);
      assert.doesNotMatch(markup, /<(?:input|textarea|select|form)\b/);
      assert.match(markup, /max-height:calc\(100dvh - 32px\);overflow-y:auto/);
    });
  }
}

await test("all four variants close only on OK or backdrop, while content clicks stay open", async () => {
  for (const purpose of ["product", "manual-area"] as const) {
    for (const demandCycle of ["normal", "summer"] as const) {
      const runtime = new Runtime();
      const component = (await runtime.loader.load("src/components/common/JudgeHintDialog.tsx")).JudgeHintDialog as Component;
      let closes = 0;
      runtime.mount(component, { purpose, demandCycle, onClose: () => { closes += 1; } });
      assert.equal(closes, 0, "rendering invokes no callback");
      const content = runtime.find((node) => node.parent === runtime.dialog());
      runtime.click(content);
      assert.equal(closes, 0, "content stops propagation to backdrop");
      runtime.click(runtime.button("OK"));
      assert.equal(closes, 1, "OK invokes only one close callback");
      runtime.click(runtime.dialog());
      assert.equal(closes, 2, "backdrop invokes only one close callback");
      assert.equal(runtime.storageWrites, 0);
    }
  }
});

const noop = () => {};
const basisGuide = { referenceText: "9月・火曜日・17時", referenceConditionLabel: "9月・火曜日・17時" };
const rateProps = {
  weekdayText: "火曜日", timeText: "17時", areaName: "弁当", discountTime: "17", basisGuide,
  rateDisplay: { many: { main: "30%" }, normal: { main: "20%" }, few: { main: "10%" } },
  onNextArea: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
};
const areaProps = {
  weekdayText: "火曜日", timeText: "17時", areaId: "bento_men", areaName: "弁当", basisGuide,
  calculatorDraftScope: "judge-hint-test", areaCountAssistEnabled: true,
  onJudge: noop, onSkip: noop, onGoBack: noop, onReturnHome: noop,
};
async function mountScreen(name: "RateDisplay" | "AreaJudge" | "Review19", props: Props) {
  const runtime = new Runtime();
  const component = (await runtime.loader.load(`src/components/screens/${name}Screen.tsx`))[`${name}Screen`] as Component;
  runtime.mount(component, props);
  return runtime;
}
function assertDialog(runtime: Runtime, purpose: "product" | "manual-area", demandCycle: DemandCycle) {
  assert.equal(textOf(runtime.dialog()), `迷った時の判断基準${body(purpose, demandCycle)}OK`);
}
function closeAndReopen(runtime: Runtime, hint: () => Element, purpose: "product" | "manual-area", cycle: DemandCycle, actions: () => number) {
  const before = actions();
  const writes = runtime.storageWrites;
  runtime.click(hint());
  assertDialog(runtime, purpose, cycle);
  const content = runtime.find((node) => node.parent === runtime.dialog());
  runtime.click(content);
  assert.equal(runtime.hasDialog(), true);
  runtime.swipe(content);
  assert.equal(actions(), before, "dialog touch gestures invoke no judge/advance/skip action");
  runtime.click(runtime.button("OK"));
  assert.equal(runtime.hasDialog(), false);
  runtime.click(hint());
  assertDialog(runtime, purpose, cycle);
  runtime.click(runtime.dialog());
  assert.equal(runtime.hasDialog(), false);
  assert.equal(actions(), before, "opening and both close paths invoke no business callback");
  assert.equal(runtime.storageWrites, writes, "hint interactions perform no draft writes");
}

for (const demandCycle of ["normal", "summer"] as const) {
  await test(`both product instruction stages keep product guidance: ${demandCycle}`, async () => {
    let advanced = 0, skipped = 0;
    const runtime = await mountScreen("RateDisplay", { ...rateProps, demandCycle, onNextArea: () => { advanced += 1; }, onSkip: () => { skipped += 1; } });
    assert.equal(runtime.buttons("迷ったら…").length, 1);
    assert.ok(runtime.nodes.some((node) => node.type === "div" && textOf(node) === "1 / 2"));
    closeAndReopen(runtime, () => runtime.button("迷ったら…"), "product", demandCycle, () => advanced + skipped);
    runtime.click(runtime.button("終わった"));
    assert.equal(advanced, 0, "first completion changes only instruction stage");
    assert.ok(runtime.nodes.some((node) => node.type === "div" && textOf(node) === "2 / 2"));
    closeAndReopen(runtime, () => runtime.button("迷ったら…"), "product", demandCycle, () => advanced + skipped);
    runtime.click(runtime.button("終わった"));
    assert.equal(advanced, 1, "second completion keeps the existing next-area callback");
    assert.equal(skipped, 0);
  });

  await test(`manual override hint appears only beside the expanded selector: ${demandCycle}`, async () => {
    let overridden = 0, advanced = 0, skipped = 0;
    const runtime = await mountScreen("RateDisplay", {
      ...rateProps, demandCycle, canOverrideAreaCountEvaluation: true,
      onOverrideAreaCountEvaluation: () => { overridden += 1; },
      onNextArea: () => { advanced += 1; }, onSkip: () => { skipped += 1; },
    });
    assert.equal(runtime.buttons("迷ったら…").length, 1, "collapsed override has only product hint");
    runtime.click(runtime.button("自動判定を手動で変更"));
    assert.equal(runtime.buttons("迷ったら…").length, 2);
    const stateBefore = runtime.nodes.filter((node) => node.props["data-evaluation"]).map((node) => [node.props["data-evaluation"], node.props.disabled, node.props["aria-pressed"]]);
    const manualHint = () => {
      const selector = runtime.find((node) => node.props["data-human-evaluation-selector"] === "true");
      return runtime.find((node) => node.type === "button" && textOf(node) === "迷ったら…" && node.parent?.parent === selector.parent?.parent);
    };
    closeAndReopen(runtime, manualHint, "manual-area", demandCycle, () => overridden + advanced + skipped);
    assert.deepEqual(runtime.nodes.filter((node) => node.props["data-evaluation"]).map((node) => [node.props["data-evaluation"], node.props.disabled, node.props["aria-pressed"]]), stateBefore);
    runtime.click(runtime.find((node) => node.props["data-evaluation"] === "normal"));
    assert.equal(overridden, 1, "selector retains its existing manual commit");
    assert.equal(runtime.buttons("迷ったら…").length, 1, "commit collapses manual selector and hint");
    assert.equal(advanced + skipped, 0);
  });

  await test(`insufficient-history AreaJudge presents manual guidance without changing input: ${demandCycle}`, async () => {
    let judged = 0, skipped = 0;
    const recommendation = (count: number): AreaCountRecommendation => ({
      status: "insufficient", demandCycle, count, sampleSize: 0, requiredSampleSize: 3,
      matchedRecords: [], summaryText: "履歴不足", detailLines: [],
    });
    const runtime = await mountScreen("AreaJudge", {
      ...areaProps, demandCycle, getAreaCountRecommendation: recommendation,
      onJudge: () => { judged += 1; }, onSkip: () => { skipped += 1; },
    });
    assert.equal(runtime.buttons("迷ったら…").length, 0, "count entry precedes manual selector");
    runtime.click(runtime.button("4"));
    runtime.click(runtime.button("2"));
    runtime.click(runtime.button("完了"));
    assert.equal(judged, 0, "insufficient history requires a manual observation");
    assert.equal(runtime.buttons("迷ったら…").length, 1);
    assert.equal(runtime.nodes.filter((node) => node.props["data-evaluation"]).length, 5);
    closeAndReopen(runtime, () => runtime.button("迷ったら…"), "manual-area", demandCycle, () => judged + skipped);
    assert.ok(runtime.nodes.some((node) => textOf(node) === "入力した残数：42個"));
    runtime.click(runtime.find((node) => node.props["data-evaluation"] === "normal"));
    assert.equal(judged, 1);
    assert.equal(skipped, 0);
  });
}

await test("automatic, legacy three-choice and final-count AreaJudge branches add no hint", async () => {
  for (const patch of [{ areaCountAssistEnabled: false }, { finalCountMode: true }]) {
    const runtime = await mountScreen("AreaJudge", { ...areaProps, ...patch });
    assert.equal(runtime.buttons("迷ったら…").length, 0);
    assert.equal(runtime.hasDialog(), false);
  }
  let judged = 0;
  const runtime = await mountScreen("AreaJudge", {
    ...areaProps, getAreaCountRecommendation: (count: number) => ({
      status: "ready", demandCycle: "normal", count, sampleSize: 3, requiredSampleSize: 3,
      matchedRecords: [], summaryText: "普通", detailLines: [], suggestedEvaluation: "normal",
    }), onJudge: () => { judged += 1; },
  });
  runtime.click(runtime.button("4")); runtime.click(runtime.button("2")); runtime.click(runtime.button("完了"));
  assert.equal(judged, 1, "ready median keeps automatic completion");
  assert.equal(runtime.buttons("迷ったら…").length, 0);
});

await test("final 20:30, missing instructions and unavailable overrides add no hint entry", async () => {
  for (const patch of [
    { discountTime: "20", canOverrideAreaCountEvaluation: true, onOverrideAreaCountEvaluation: noop },
    { rateDisplay: null },
  ]) {
    const runtime = await mountScreen("RateDisplay", { ...rateProps, ...patch });
    assert.equal(runtime.buttons("迷ったら…").length, 0);
    assert.equal(runtime.buttons("自動判定を手動で変更").length, 0);
  }
  for (const patch of [
    { canOverrideAreaCountEvaluation: false, onOverrideAreaCountEvaluation: noop },
    { canOverrideAreaCountEvaluation: true },
  ]) {
    const runtime = await mountScreen("RateDisplay", { ...rateProps, ...patch });
    assert.equal(runtime.buttons("迷ったら…").length, 1);
    assert.equal(runtime.buttons("自動判定を手動で変更").length, 0);
  }
});

await test("Review19 retains its independent tap selector without discount guidance", async () => {
  const runtime = await mountScreen("Review19", {
    items: [{ areaId: "bento_men", areaName: "弁当", count: 42 }],
    referenceConditionLabel: "9月・火曜日・19時", calculatorDraftScope: "judge-hint-review",
    onCompleteArea: noop, onSave: noop, onGoBack: noop, onReturnHome: noop,
  });
  assert.equal(runtime.buttons("迷ったら…").length, 0);
  assert.equal(runtime.hasDialog(), false);
  assert.equal(runtime.nodes.filter((node) => node.props["data-evaluation"]).length, 5);
  assert.doesNotMatch(source("src/components/screens/Review19Screen.tsx"), /JudgeHintDialog|ManualAreaJudgeHint/);
});

await test("all seven notices including small-pack-excluding 20-count guidance remain exact", async () => {
  const expected = [
    "残り2個の商品は「多い」にしない",
    "残り1個の商品は「少ない」にする",
    "定番商品・夜によく売れる商品・広告商品は、表示値引率から-10%",
    "見た目が悪い個別商品・不人気な商品は、表示値引率に+10%",
    "やや不人気な商品は、10個以上ある場合のみ表示値引率に+10%。大パックと小パックに分かれている場合は大パックのみ+10%",
    "同一商品が、小パックを含めずに20個以上ある場合は、表示値引率に＋10％。",
    "多い・少ないの判断は、残り数だけでなく商品の減り方も含める",
  ];
  assert.deepEqual(FULL_MODE_NOTICE_TEXTS, expected);
  const Notice = (await ssr.load("src/components/screens/RateDisplayScreen.tsx")).NoticeItems as Component;
  const markup = renderToStaticMarkup(React.createElement(Notice));
  assert.equal(markup.replace(/<[^>]*>/g, ""), expected.map((line) => `・${line}`).join(""));
  assert.match(markup, /<strong>同一商品<\/strong><span>が、<\/span><strong>小パックを含めずに<\/strong><strong>20個以上<\/strong><span>ある場合は、表示値引率に<\/span><strong>＋10％<\/strong>/);
});

await test("obsolete summer advice is absent and shared guidance introduces no persistence/business actions", () => {
  for (const path of ["src/components/common/JudgeHintDialog.tsx", "src/components/screens/RateDisplayScreen.tsx", "src/components/screens/AreaJudgeScreen.tsx"])
    assert.doesNotMatch(source(path), forbidden);
  assert.doesNotMatch(source("src/components/common/JudgeHintDialog.tsx"), /\b(?:onJudge|onCommit|onOverrideAreaCountEvaluation|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/);
});

console.log(`judge hint guidance checks passed: ${passed}/${passed}`);
