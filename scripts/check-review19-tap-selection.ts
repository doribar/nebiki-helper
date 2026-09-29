import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import {
  createHumanEvaluationSelection,
  createReview19HumanEvaluationDetails,
  HUMAN_EVALUATION_LONG_PRESS_MS,
} from "../src/domain/humanEvaluation.ts";
import type {
  AreaCountEvaluation,
  AreaId,
  HumanEvaluationDetails,
  HumanEvaluationSelection,
  Review19AreaItem,
} from "../src/domain/types.ts";

// These are runtime component tests, not browser tests. As in the existing UI
// checks, compile the actual TSX and dependencies. This small persistent hook
// runner adds state/effect rerenders and capture/bubble dispatch so complete
// event sequences can be checked without a new test dependency. Native hit
// testing, keyboard synthesis and touch delivery are verified separately in
// the production browser check.
type Props = Record<string, unknown>;
type Component = (props: Props) => React.ReactNode;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { slots: Slot[]; cursor: number; type: Component };
type Element = { type: string; props: Props; parent: Element | null; children: Array<Element | string> };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

class Runtime {
  private instance: Instance | null = null;
  private instances = new Map<string, Instance>();
  private effects: Array<() => void> = [];
  private timers = new Map<number, { at: number; run: () => void }>();
  private timerId = 0;
  private now = 0;
  private dirty = true;
  private modules = new Map<string, Record<string, unknown>>();
  private root: (() => React.ReactNode) | null = null;
  private storage = new Map<string, string>();
  nodes: Element[] = [];
  vibrations: number[] = [];
  window = {
    setTimeout: (run: () => void, delay = 0) => {
      const id = ++this.timerId;
      this.timers.set(id, { at: this.now + delay, run });
      return id;
    },
    clearTimeout: (id: number) => { this.timers.delete(id); },
    addEventListener: () => {},
    removeEventListener: () => {},
    sessionStorage: {
      getItem: (key: string) => this.storage.get(key) ?? null,
      setItem: (key: string, value: string) => { this.storage.set(key, value); },
      removeItem: (key: string) => { this.storage.delete(key); },
    },
  };
  private slot(): Slot {
    assert.ok(this.instance, "hooks execute inside the real component render");
    const index = this.instance.cursor++;
    return this.instance.slots[index] ??= {};
  }
  private hooks = {
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
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
  async load(url: URL): Promise<Record<string, unknown>> {
    const cached = this.modules.get(url.href);
    if (cached) return cached;
    const source = readFileSync(url, "utf8");
    const ast = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const dependencies = new Map<string, unknown>([["react", this.hooks], ["react/jsx-runtime", jsxRuntime]]);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier));
      const id = statement.moduleSpecifier.text;
      if (dependencies.has(id)) continue;
      assert.ok(id.startsWith("."), `expected local component dependency: ${id}`);
      const dependency = [id, `${id}.ts`, `${id}.tsx`].map((path) => new URL(path, url)).find((path) => existsSync(path));
      assert.ok(dependency, `dependency exists: ${id}`);
      const needsEnvironment = dependency.pathname.endsWith(".tsx") || /\/(useSwipeToSkip|calculatorDraft)\.ts$/.test(dependency.pathname);
      dependencies.set(id, needsEnvironment ? await this.load(dependency) : await import(dependency.href));
    }
    const exports: Record<string, unknown> = {};
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(output, {
      exports, window: this.window,
      document: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
      navigator: { vibrate: (duration: number) => { this.vibrations.push(duration); } },
      require: (id: string) => {
        assert.ok(dependencies.has(id), `dependency was loaded: ${id}`);
        return dependencies.get(id);
      },
    });
    this.modules.set(url.href, exports);
    return exports;
  }
  mount(root: () => React.ReactNode) { this.root = root; this.rerender(); }
  rerender() { this.dirty = true; this.flush(); }
  flush() {
    assert.ok(this.root);
    let renders = 0;
    while (this.dirty) {
      assert.ok(++renders < 30, "component converges after state/effect updates");
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
            instance = { slots: [], cursor: 0, type };
            this.instances.set(key, instance);
          }
          visited.add(key);
          instance.cursor = 0;
          const previous = this.instance;
          this.instance = instance;
          const rendered = type(node.props);
          this.instance = previous;
          return expand(rendered, `${path}/render`, parent);
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
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].run();
      this.flush();
    }
    this.now = end;
  }
  find(predicate: (node: Element) => boolean): Element {
    const node = this.nodes.find(predicate);
    assert.ok(node, "rendered control exists");
    return node;
  }
  button(text: string) { return this.find((node) => node.type === "button" && textOf(node) === text); }
  choice(value: AreaCountEvaluation) { return this.find((node) => node.props["data-evaluation"] === value); }
  selector() { return this.find((node) => node.props["data-human-evaluation-selector"] === "true"); }
  selected(): AreaCountEvaluation[] {
    return this.nodes.filter((node) => node.props["data-evaluation"] && node.props["aria-pressed"])
      .map((node) => node.props["data-evaluation"] as AreaCountEvaluation).sort();
  }
  dispatch(target: Element, name: string, fields: Props = {}, force = false) {
    if (!force && target.props.disabled && (name === "Click" || name.startsWith("Pointer"))) return;
    let stopped = false;
    const event = {
      button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 50, detail: 1,
      defaultPrevented: false,
      currentTarget: { setPointerCapture: () => {}, hasPointerCapture: () => true, releasePointerCapture: () => {} },
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
      ...fields,
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = target; node; node = node.parent) ancestors.push(node);
    const invoke = (node: Element, key: string) => {
      if (!stopped && typeof node.props[key] === "function") (node.props[key] as (event: Props) => void)(event);
    };
    [...ancestors].reverse().forEach((node) => invoke(node, `on${name}Capture`));
    ancestors.forEach((node) => invoke(node, `on${name}`));
    this.flush();
    return event;
  }
  click(target: Element, detail = 1) { return this.dispatch(target, "Click", { detail }); }
  tap(value: AreaCountEvaluation, holdMs = 0) {
    this.dispatch(this.choice(value), "PointerDown");
    this.advance(holdMs);
    this.dispatch(this.choice(value), "PointerUp");
    this.click(this.choice(value));
  }
  touchSwipe(target: Element) {
    this.dispatch(target, "TouchStart", { touches: [{ identifier: 1, clientX: 200, clientY: 50 }] });
    this.dispatch(target, "TouchEnd", { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });
  }
}

function textOf(node: Element | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
const values: AreaCountEvaluation[] = ["few", "slightly_few", "normal", "slightly_many", "many"];
function selection(first: AreaCountEvaluation, second?: AreaCountEvaluation): HumanEvaluationSelection {
  const value = createHumanEvaluationSelection(first, second);
  assert.ok(value);
  return value;
}
function details(first: AreaCountEvaluation, second?: AreaCountEvaluation): HumanEvaluationDetails {
  return createReview19HumanEvaluationDetails({ selection: selection(first, second), demandCycle: "normal", evaluatedAt: "2026-09-28T10:00:00.000Z" });
}
async function selectorHarness(options: { legacy?: boolean; value?: HumanEvaluationDetails; disabled?: boolean } = {}) {
  const runtime = new Runtime();
  const component = (await runtime.load(new URL("../src/components/common/HumanEvaluationSelector.tsx", import.meta.url))).HumanEvaluationSelector as Component;
  const changes: Array<HumanEvaluationSelection | null> = [];
  const commits: HumanEvaluationSelection[] = [];
  let longPresses = 0;
  let value: HumanEvaluationDetails | null = options.value ?? null;
  runtime.mount(() => React.createElement(component, {
    ariaLabel: "評価", layout: "compact", disabled: options.disabled ?? false, value,
    ...(options.legacy ? {} : { interactionMode: "tap-toggle" }),
    onCommit: (next: HumanEvaluationSelection) => { commits.push(copy(next)); },
    onSelectionChange: (next: HumanEvaluationSelection | null) => {
      changes.push(copy(next));
      value = next ? { ...next, humanEvaluationScale: 9, resolutionDirection: "not_applicable", resolutionReason: "review19_observation" } : null;
      runtime.rerender();
    },
    onLongPressActivated: () => { longPresses += 1; },
  }));
  return { runtime, changes, commits, longPresses: () => longPresses };
}
type Observation = { areaId: AreaId; count: number; humanEvaluationSelection: HumanEvaluationSelection };
const areaIds: AreaId[] = ["bento_men", "onigiri", "sushi"];
function item(index: number, extra: Partial<Review19AreaItem> = {}): Review19AreaItem {
  return { areaId: areaIds[index], areaName: `テスト売場${index + 1}`, excluded: false, ...extra };
}
async function screenHarness(inputItems: Review19AreaItem[]) {
  const runtime = new Runtime();
  const component = (await runtime.load(new URL("../src/components/screens/Review19Screen.tsx", import.meta.url))).Review19Screen as Component;
  let items = copy(inputItems);
  let scope = "tap-test";
  const completed: Observation[] = [];
  const saved: Array<Observation | undefined> = [];
  let backs = 0;
  runtime.mount(() => React.createElement(component, {
    items, calculatorDraftScope: scope, referenceConditionLabel: "月曜日・19時",
    onCompleteArea: (areaId: AreaId, count: number, humanEvaluationSelection: HumanEvaluationSelection) => {
      completed.push(copy({ areaId, count, humanEvaluationSelection }));
      items = items.map((entry) => entry.areaId !== areaId ? entry : {
        ...entry, count, humanEvaluationDetails: createReview19HumanEvaluationDetails({
          selection: humanEvaluationSelection, demandCycle: "normal", evaluatedAt: "2026-09-28T10:00:00.000Z",
        }),
      });
    },
    onSave: (latest?: Observation) => { saved.push(latest ? copy(latest) : undefined); },
    onGoBack: () => { backs += 1; }, onReturnHome: () => {},
  }));
  return {
    runtime, completed, saved, items: () => items, backs: () => backs,
    rerender: () => { items = copy(items); runtime.rerender(); },
    scope: (next: string) => { scope = next; runtime.rerender(); },
    active: () => areaIds.find((_, index) => runtime.nodes.some((node) => node.type === "div" && textOf(node) === `テスト売場${index + 1}`)),
  };
}
function assertSelection(runtime: Runtime, expected: AreaCountEvaluation[]) {
  assert.deepEqual(runtime.selected(), [...expected].sort());
  assert.equal(runtime.selector().props["data-intermediate-selection"], "", "tap mode has no long-press intermediate state");
}
function assertNoCompletion(harness: Awaited<ReturnType<typeof screenHarness>>) {
  assert.deepEqual(harness.completed, []);
  assert.deepEqual(harness.saved, []);
}
const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>) { cases.push({ name, run }); }

for (const [index, value] of values.entries()) {
  test(`tap ${value}: odd score ${index * 2 + 1}, toggle to null, no commit`, async () => {
    const h = await selectorHarness();
    h.runtime.tap(value);
    assert.deepEqual(h.changes, [selection(value)]);
    assertSelection(h.runtime, [value]);
    h.runtime.tap(value);
    assert.deepEqual(h.changes, [selection(value), null]);
    assertSelection(h.runtime, []);
    assert.deepEqual(h.commits, []);
  });
}
for (let index = 0; index < values.length - 1; index += 1) {
  for (const reverse of [false, true]) {
    const pair = reverse ? [values[index + 1], values[index]] : [values[index], values[index + 1]];
    test(`adjacent ${pair.join(" then ")}: even score, order, both removal paths and all clear`, async () => {
      for (const removeIndex of [0, 1]) {
        const h = await selectorHarness();
        h.runtime.tap(pair[0]);
        h.runtime.tap(pair[1]);
        assert.deepEqual(h.changes.at(-1), selection(pair[0], pair[1]));
        assert.equal(h.changes.at(-1)?.humanEvaluationScore9, index * 2 + 2);
        assertSelection(h.runtime, pair);
        h.runtime.tap(pair[removeIndex]);
        assert.deepEqual(h.changes.at(-1), selection(pair[1 - removeIndex]));
        assertSelection(h.runtime, [pair[1 - removeIndex]]);
        h.runtime.tap(pair[1 - removeIndex]);
        assert.equal(h.changes.at(-1), null);
        assertSelection(h.runtime, []);
        assert.deepEqual(h.commits, []);
      }
    });
  }
}
test("all non-adjacent and third choices remain unchanged, including guarded handler calls", async () => {
  for (let index = 0; index < values.length; index += 1) {
    const h = await selectorHarness();
    h.runtime.tap(values[index]);
    for (let other = 0; other < values.length; other += 1) {
      if (Math.abs(index - other) <= 1) continue;
      assert.equal(h.runtime.choice(values[other]).props.disabled, true);
      h.runtime.dispatch(h.runtime.choice(values[other]), "Click", {}, true);
      assertSelection(h.runtime, [values[index]]);
      assert.equal(h.changes.length, 1);
    }
    if (index === values.length - 1) continue;
    h.runtime.tap(values[index + 1]);
    for (const other of values.filter((value) => value !== values[index] && value !== values[index + 1])) {
      assert.equal(h.runtime.choice(other).props.disabled, true);
      h.runtime.dispatch(h.runtime.choice(other), "Click", {}, true);
      assertSelection(h.runtime, [values[index], values[index + 1]]);
      assert.equal(h.changes.length, 2);
    }
  }
});
test("keyboard/programmatic click and pointerup plus click each toggle exactly once", async () => {
  const h = await selectorHarness();
  h.runtime.click(h.runtime.choice("normal"), 0);
  assert.deepEqual(h.changes, [selection("normal")]);
  h.runtime.dispatch(h.runtime.choice("slightly_many"), "PointerDown");
  h.runtime.dispatch(h.runtime.choice("slightly_many"), "PointerUp");
  assert.equal(h.changes.length, 1, "pointerup does not also update selection");
  h.runtime.click(h.runtime.choice("slightly_many"));
  assert.deepEqual(h.changes.at(-1), selection("normal", "slightly_many"));
  assert.equal(h.changes.length, 2);
  h.runtime.click(h.runtime.choice("normal"), 0);
  assert.deepEqual(h.changes.at(-1), selection("slightly_many"));
});
test("tap-mode long hold starts no intermediate state, haptic, or long-press callback", async () => {
  const h = await selectorHarness();
  h.runtime.dispatch(h.runtime.choice("normal"), "PointerDown");
  h.runtime.advance(HUMAN_EVALUATION_LONG_PRESS_MS * 3);
  assertSelection(h.runtime, []);
  assert.deepEqual(h.changes, []);
  assert.equal(h.longPresses(), 0);
  assert.deepEqual(h.runtime.vibrations, []);
  h.runtime.dispatch(h.runtime.choice("normal"), "PointerUp");
  h.runtime.click(h.runtime.choice("normal"));
  assert.deepEqual(h.changes, [selection("normal")]);
});
test("disabled tap selector ignores pointer and forced click activation", async () => {
  const h = await selectorHarness({ disabled: true });
  for (const value of values) {
    assert.equal(h.runtime.choice(value).props.disabled, true);
    h.runtime.tap(value);
    h.runtime.dispatch(h.runtime.choice(value), "Click", {}, true);
  }
  assert.deepEqual(h.changes, []);
  assert.deepEqual(h.commits, []);
});
test("Review count and evaluation are both required; valid zero remains supported", async () => {
  const h = await screenHarness([item(0)]);
  assert.equal(h.runtime.button("完了").props.disabled, true);
  h.runtime.dispatch(h.runtime.button("完了"), "Click", {}, true);
  h.runtime.tap("normal");
  assertSelection(h.runtime, []);
  assertNoCompletion(h);
  h.runtime.click(h.runtime.button("0"));
  assert.equal(h.runtime.button("完了").props.disabled, true);
  h.runtime.tap("normal");
  assert.equal(h.runtime.button("完了").props.disabled, false);
  assertNoCompletion(h);
  const backspace = h.runtime.find((node) => node.props["aria-label"] === "電卓を1文字削除");
  h.runtime.click(backspace);
  assert.equal(h.runtime.button("完了").props.disabled, true);
  h.runtime.dispatch(h.runtime.button("完了"), "Click", {}, true);
  assertNoCompletion(h);
  h.runtime.click(h.runtime.button("0"));
  h.runtime.click(h.runtime.button("完了"));
  assert.deepEqual(h.completed, [{ areaId: areaIds[0], count: 0, humanEvaluationSelection: selection("normal") }]);
  h.runtime.advance(0);
  assert.deepEqual(h.saved, h.completed);
});
test("invalid nonfinite count remains blocked even when a saved evaluation exists", async () => {
  const h = await screenHarness([item(0, { humanEvaluation: "normal" })]);
  // Enter enough digits to overflow Number, using only real keypad handlers.
  for (let index = 0; index < 310; index += 1) h.runtime.click(h.runtime.button("9"));
  assert.equal(h.runtime.button("完了").props.disabled, true);
  h.runtime.dispatch(h.runtime.button("完了"), "Click", {}, true);
  assertNoCompletion(h);
});
for (const legacy of [false, true]) {
  test(`recorded ${legacy ? "legacy 5-level" : "raw9 pair"}: clear is explicit null, re-render cannot fall back, reselect then complete`, async () => {
    const initial = item(0, legacy ? { count: 42, humanEvaluation: "normal" } : { count: 42, humanEvaluationDetails: details("slightly_many", "normal") });
    const h = await screenHarness([initial, item(1)]);
    const savedBefore = copy(h.items());
    assertSelection(h.runtime, legacy ? ["normal"] : ["slightly_many", "normal"]);
    if (!legacy) h.runtime.tap("slightly_many");
    h.runtime.tap("normal");
    assertSelection(h.runtime, []);
    assert.equal(h.runtime.button("完了").props.disabled, true);
    h.rerender();
    assertSelection(h.runtime, []);
    h.runtime.dispatch(h.runtime.button("完了"), "Click", {}, true);
    assertNoCompletion(h);
    assert.deepEqual(h.items(), savedBefore, "editing only changes the screen draft");
    h.runtime.tap("few");
    h.runtime.tap("slightly_few");
    assert.equal(h.runtime.button("完了").props.disabled, false);
    assertNoCompletion(h);
    h.runtime.click(h.runtime.button("完了"));
    assert.deepEqual(h.completed, [{ areaId: areaIds[0], count: 42, humanEvaluationSelection: selection("few", "slightly_few") }]);
    assert.equal(h.active(), areaIds[1]);
    assertSelection(h.runtime, []);
    assert.deepEqual(h.saved, []);
  });
}
const completionCases = [
  ...values.map((value) => [value]),
  ...values.slice(0, -1).flatMap((value, index) => [[value, values[index + 1]], [values[index + 1], value]]),
];
for (const choice of completionCases) {
  test(`final area ${choice.join(" / ")}: no early completion, same latest-observation payload on save`, async () => {
    const h = await screenHarness([item(0, { count: 12 })]);
    for (const value of choice) h.runtime.tap(value);
    h.runtime.advance(1000);
    assertNoCompletion(h);
    const expected = { areaId: areaIds[0], count: 12, humanEvaluationSelection: selection(choice[0], choice[1]) };
    h.runtime.click(h.runtime.button("完了"));
    assert.deepEqual(h.completed, [expected]);
    assert.deepEqual(h.saved, [], "onSave remains deferred until the existing timeout");
    h.runtime.advance(0);
    assert.deepEqual(h.saved, [expected]);
    assert.deepEqual(Object.keys(h.saved[0]!).sort(), ["areaId", "count", "humanEvaluationSelection"]);
  });
}
test("area advance, back, skip and session scope keep drafts isolated", async () => {
  const h = await screenHarness([item(0, { count: 10 }), item(1, { count: 20 }), item(2, { count: 30 })]);
  h.runtime.tap("normal");
  h.runtime.click(h.runtime.button("完了"));
  assert.equal(h.active(), areaIds[1]);
  assertSelection(h.runtime, []);
  h.runtime.tap("many");
  h.runtime.click(h.runtime.button("戻る"));
  assert.equal(h.active(), areaIds[0]);
  assertSelection(h.runtime, ["normal"]);
  h.runtime.click(h.runtime.button("今はスキップ（画面左スワイプ）"));
  assert.equal(h.active(), areaIds[1]);
  assertSelection(h.runtime, ["many"]);
  h.runtime.click(h.runtime.button("今はスキップ（画面左スワイプ）"));
  assert.equal(h.active(), areaIds[2]);
  assertSelection(h.runtime, []);
  h.runtime.tap("few");
  h.scope("another-review-session");
  assertSelection(h.runtime, []);
  assert.equal(h.completed.length, 1);
  assert.deepEqual(h.saved, []);
});
test("correction loads the target evaluation and returns to the previous area without draft leakage", async () => {
  const h = await screenHarness([
    item(0, { count: 10, humanEvaluationDetails: details("normal", "slightly_few") }),
    item(1, { count: 20 }), item(2),
  ]);
  h.runtime.click(h.runtime.button("今はスキップ（画面左スワイプ）"));
  assert.equal(h.active(), areaIds[1]);
  h.runtime.tap("many");
  h.runtime.click(h.runtime.button("入力した残数を修正"));
  h.runtime.click(h.runtime.button("テスト売場1（10個）"));
  assert.equal(h.active(), areaIds[0]);
  assertSelection(h.runtime, ["normal", "slightly_few"]);
  h.runtime.tap("normal");
  h.runtime.tap("slightly_few");
  assert.equal(h.runtime.button("完了").props.disabled, true);
  h.runtime.tap("few");
  h.runtime.click(h.runtime.button("完了"));
  assert.equal(h.active(), areaIds[1]);
  assertSelection(h.runtime, []);
  assert.deepEqual(h.completed, [{ areaId: areaIds[0], count: 10, humanEvaluationSelection: selection("few") }]);
  assert.deepEqual(h.saved, []);
});
test("evaluation touch gestures cannot skip the area; page swipe and explicit skip still work", async () => {
  const h = await screenHarness([item(0, { count: 10 }), item(1, { count: 20 }), item(2)]);
  h.runtime.touchSwipe(h.runtime.choice("normal"));
  assert.equal(h.active(), areaIds[0]);
  assertNoCompletion(h);
  h.runtime.touchSwipe(h.runtime.find((node) => node.type === "main"));
  assert.equal(h.active(), areaIds[1]);
  h.runtime.click(h.runtime.button("今はスキップ（画面左スワイプ）"));
  assert.equal(h.active(), areaIds[2]);
  assertNoCompletion(h);
});
test("back from the first area does not complete or persist a partial observation", async () => {
  const h = await screenHarness([item(0, { count: 10 }), item(1)]);
  h.runtime.tap("normal");
  h.runtime.click(h.runtime.button("戻る"));
  assert.equal(h.backs(), 1);
  assertNoCompletion(h);
});
test("default mode still commits a normal click immediately with no selection-change callback", async () => {
  const h = await selectorHarness({ legacy: true });
  h.runtime.tap("normal");
  assert.deepEqual(h.commits, [selection("normal")]);
  assert.deepEqual(h.changes, []);
});
test("default mode keeps the 500ms intermediate hold and suppresses its generated click", async () => {
  assert.equal(HUMAN_EVALUATION_LONG_PRESS_MS, 500);
  const h = await selectorHarness({ legacy: true });
  h.runtime.dispatch(h.runtime.choice("normal"), "PointerDown");
  h.runtime.advance(499);
  assert.equal(h.runtime.selector().props["data-intermediate-selection"], "");
  h.runtime.advance(1);
  assert.equal(h.runtime.selector().props["data-intermediate-selection"], "normal");
  assert.equal(h.longPresses(), 1);
  assert.deepEqual(h.runtime.vibrations, [15]);
  h.runtime.dispatch(h.runtime.choice("normal"), "PointerUp");
  h.runtime.click(h.runtime.choice("normal"));
  assert.deepEqual(h.commits, []);
  h.runtime.click(h.runtime.choice("slightly_many"), 0);
  assert.deepEqual(h.commits, [selection("normal", "slightly_many")]);
  assert.deepEqual(h.changes, []);
});
test("default saved legacy five-level and raw9 values still highlight without being converted", async () => {
  for (const value of [details("many"), details("normal", "slightly_few"), {
    humanEvaluationScore9: 5 as const, humanEvaluationScale: 5 as const,
    humanEvaluationSelections: ["normal"] as [AreaCountEvaluation], resolvedEvaluation: "normal" as const,
    resolutionDirection: "none" as const, resolutionReason: "legacy_5_level" as const,
  }]) {
    const before = copy(value);
    const h = await selectorHarness({ legacy: true, value });
    assert.deepEqual(h.runtime.selected(), [...value.humanEvaluationSelections].sort());
    assert.deepEqual(value, before);
    assert.deepEqual(h.commits, []);
    assert.deepEqual(h.changes, []);
  }
});

for (const { name, run } of cases) {
  await run();
  console.log(`PASS: ${name}`);
}
console.log(`Review19 tap-selection runtime checks passed: ${cases.length}/${cases.length}`);
