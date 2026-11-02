import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Shell } from "../../../app/src/shell/shell";
import type { AppDefinition, CoreEvent, ShellSnapshot } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore, shareStructure } from "../core/shell-store";
import * as renderBlockModule from "../render/render-block";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";

const fallbackProbe = vi.hoisted(() => ({
  current: null as null | ((windowId: string, pointer: string, type: string) => void),
}));

vi.mock("../blocks/data-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../blocks/data-layout")>();
  function StackBlock(props: Parameters<typeof actual.StackBlock>[0]) {
    fallbackProbe.current?.(props.context.window.id, props.pointer, "stack");
    return <actual.StackBlock {...props} />;
  }
  function TextBlock(props: Parameters<typeof actual.TextBlock>[0]) {
    fallbackProbe.current?.(props.context.window.id, props.pointer, "text");
    return <actual.TextBlock {...props} />;
  }
  return { ...actual, StackBlock, TextBlock };
});

vi.mock("../data/window-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/window-data")>();
  return {
    ...actual,
    useBinding(pointer: string, binding: Parameters<typeof actual.useBinding>[1]) {
      const value = actual.useBinding(pointer, binding);
      if (pointer.endsWith("/value")) {
        fallbackProbe.current?.(actual.useWindowData().windowId, pointer.slice(0, -"/value".length), "text");
      }
      return value;
    },
  };
});

const definition: AppDefinition = {
  id: "md-viewer",
  name: "격리 시험",
  requires: { blocks: 4, modules: {} },
  permissions: [],
  state: { first: null, second: null, compound: null },
  ui: {
    type: "stack", direction: "column",
    children: [
      { type: "text", value: { state: "first" } },
      { type: "text", value: { state: "second" } },
      { type: "text", value: { expr: "$data.sample" } },
      { type: "text", value: { state: "compound" } },
    ],
  },
};

function testSnapshot(): ShellSnapshot {
  const snapshot = makeTestSnapshot({ definitions: [definition] });
  const first = snapshot.shared.windows[0];
  first.id = "window-a";
  const compound = { items: [1, 2], nested: { label: "stable" } };
  first.state = { first: "a", second: "b", compound };
  snapshot.shared.windows = [
    first,
    { ...first, id: "window-b", state: { first: "a", second: "b", compound: structuredClone(compound) }, z: 2 },
  ];
  snapshot.shared.desktops.push({
    id: "desktop-2", workspace_id: "workspace-1", name: "Desktop 2", position: 1,
    created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
  });
  snapshot.device.active_desktop_ids["workspace-1"] = "desktop-1";
  return snapshot;
}

function countFor(windowId: string, pointer?: string) {
  return calls.filter((call) => call.windowId === windowId && (pointer === undefined || call.pointer === pointer)).length;
}

function dispatchPointer(target: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", pointerId: number, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

const calls: Array<{ windowId: string; pointer: string; type: string }> = [];

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 960, height: 552 } } as ResizeObserverEntry] as ResizeObserverEntry[], this as unknown as ResizeObserver);
      }
      disconnect() {}
    },
  });
}

async function setup() {
  calls.length = 0;
  const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
  if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
  else {
    const pending = new Set<string>();
    fallbackProbe.current = (windowId, pointer, type) => {
      const key = `${windowId}\0${pointer}`;
      if (pending.has(key)) return;
      pending.add(key);
      calls.push({ windowId, pointer, type });
      queueMicrotask(() => pending.delete(key));
    };
  }
  const snapshot = testSnapshot();
  const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  await waitFor(() => expect(document.querySelector('[data-window-id="window-a"]')).not.toBeNull());
  await waitFor(() => expect(document.querySelector(".ks-data-skeleton")).toBeNull());
  calls.length = 0;
  return { store, transport, snapshot };
}

async function setState(store: ReturnType<typeof createShellStore>, windowId: string, key: string, value: JsonValue) {
  const window = store.getSnapshot()!.shared.windows.find((item) => item.id === windowId)!;
  await store.call({ op: "window.set_state", window_id: windowId, state: { ...window.state, [key]: value } });
}

afterEach(() => {
  cleanup();
  const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
  if (probe) probe.current = null;
  fallbackProbe.current = null;
});

describe("실제 Shell의 블록 렌더 격리", () => {
  it("창 A 상태 변경은 창 B 블록을 다시 그리지 않는다", async () => {
    const { store } = await setup();
    for (let i = 0; i < 10; i += 1) await setState(store, "window-a", "first", `changed-${i}`);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("창 A 상태 변경은 그 키를 읽는 블록만 다시 그린다", async () => {
    const { store } = await setup();
    for (let i = 0; i < 10; i += 1) await setState(store, "window-a", "first", `changed-${i}`);
    expect(calls.filter((call) => call.windowId === "window-a").map((call) => call.pointer)).toEqual(Array(10).fill("/ui/children/0"));
    expect(document.body.textContent).toContain("changed-9");
    store.dispose();
  });

  it("data.update는 바뀐 포인터의 블록만 다시 그린다", async () => {
    const { store, transport } = await setup();
    const event: CoreEvent = {
      event: "data.update", window_id: "window-a",
      view: { sources: {}, values: { "/ui/children/2/value": { status: "ready", value: "new" } } },
    };
    await act(async () => transport.emit(event));
    expect(calls.map((call) => call.pointer)).toEqual(["/ui/children/2"]);
    expect(document.body.textContent).toContain("new");
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("창을 올리거나 옮기거나 크기를 바꿔도 블록은 다시 그리지 않는다", async () => {
    const { store } = await setup();
    await store.call({ op: "window.raise", window_id: "window-a" });
    for (let frame = 0; frame < 30; frame += 1) {
      await store.call({ op: "window.set_rect", window_id: "window-a", rect: { x: 20 + frame, y: 30 + frame, width: 620 + frame, height: 400 + frame } });
    }
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("최소화, 복원, 최대화는 복합 상태를 읽는 블록을 다시 그리지 않는다", async () => {
    const { store } = await setup();
    await store.call({ op: "window.minimize", window_id: "window-a" });
    await store.call({ op: "window.raise", window_id: "window-a" });
    await store.call({ op: "window.maximize", window_id: "window-a" });
    expect(countFor("window-a", "/ui/children/3")).toBe(0);
    expect(document.body.textContent).toContain("stable");
    store.dispose();
  });

  it("제목 줄의 실제 포인터 드래그 중에는 앱 블록을 다시 그리지 않는다", async () => {
    const { store } = await setup();
    const windows = [...document.querySelectorAll<HTMLElement>(".ks-window")];
    const windowElement = windows[1];
    const titlebar = windowElement?.querySelector<HTMLElement>(".ks-window-titlebar");
    if (!windowElement || !titlebar) throw new Error("두 번째 창의 제목 줄을 찾지 못했습니다");
    const before = store.getSnapshot()!.shared.windows.find((item) => item.id === "window-b")!.rect;
    await act(async () => {
      dispatchPointer(titlebar, "pointerdown", 7, 100, 100);
      for (let frame = 1; frame <= 30; frame += 1) {
        dispatchPointer(windowElement, "pointermove", 7, 100 + frame, 100 + frame);
      }
      dispatchPointer(windowElement, "pointerup", 7, 130, 130);
    });
    await waitFor(() => {
      const after = store.getSnapshot()!.shared.windows.find((item) => item.id === "window-b")!.rect;
      expect(Number.isFinite(after.x) && Number.isFinite(after.y)).toBe(true);
      expect(after.x).toBeGreaterThan(before.x);
      expect(after.y).toBeGreaterThan(before.y);
    });
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("쉘 업데이트 상태 변경은 앱 블록을 다시 그리지 않는다", async () => {
    const { store, snapshot, transport } = await setup();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, update: { state: "ready", current_version: "0.6.2", version: "0.7.0" } } });
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("다른 데스크톱으로 전환해도 앱 블록은 다시 그리지 않는다", async () => {
    const { store } = await setup();
    for (const desktopId of ["desktop-2", "desktop-1", "desktop-2"] as const) {
      await store.call({ op: "desktop.activate", desktop_id: desktopId });
    }
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("useShellSnapshot 사용은 LegacyContextBlock 하나로 제한한다", () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const targets = [join(repoRoot, "ui/src"), join(repoRoot, "app/src")];
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.[jt]sx?$/.test(entry.name)) files.push(path);
      }
    };
    targets.forEach(visit);
    const uses = files.flatMap((path) => {
      if (path.endsWith("render-isolation.test.tsx")) return [];
      const source = readFileSync(path, "utf8");
      return /\buseShellSnapshot\s*\(/.test(source) && !/function\s+useShellSnapshot\s*\(/.test(source)
        ? [path.replace(repoRoot + "/", "")]
        : [];
    });
    expect(uses).toEqual(["ui/src/render/render-block.tsx"]);
    expect(readFileSync(join(repoRoot, "ui/src/index.ts"), "utf8")).not.toMatch(/useShellSnapshot/);
    const legacyContextFiles = files.flatMap((path) => {
      if (path.endsWith("render-isolation.test.tsx")) return [];
      return readFileSync(path, "utf8").includes("LegacyBlockContext")
        ? [path.replace(repoRoot + "/", "")]
        : [];
    }).sort();
    expect(legacyContextFiles).toEqual([
      "ui/src/blocks/agent-chat.tsx",
      "ui/src/blocks/agent-session.tsx",
      "ui/src/blocks/block-context.ts",
      "ui/src/render/render-block.tsx",
    ]);
    const contextSource = readFileSync(join(repoRoot, "ui/src/blocks/block-context.ts"), "utf8");
    const blockContext = contextSource.match(/export interface BlockContext \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const windowIdentity = contextSource.match(/export interface WindowIdentity \{([^}]+)\}/)?.[1] ?? "";
    expect(blockContext).not.toMatch(/\b(?:snapshot|state|rect|z)\s*:/);
    expect(windowIdentity).not.toMatch(/\b(?:state|rect|z)\s*:/);
  });
});

describe("shareStructure 참조 보존", () => {
  it("키가 추가되거나 삭제되어도 공통 자식 참조를 보존하고, 값이 같으면 이전 객체를 돌려준다", () => {
    const common = { nested: { value: 1 }, items: ["a", "b"] };
    type Structure = { common: typeof common; other: { enabled: boolean }; extra?: string; removed?: { value: number } };
    const previous: Structure = { common, other: { enabled: true } };
    const equal = shareStructure(previous, {
      common: { nested: { value: 1 }, items: ["a", "b"] },
      other: { enabled: true },
    });
    expect(equal).toBe(previous);

    const added = shareStructure(previous, {
      common: { nested: { value: 1 }, items: ["a", "b"] },
      other: { enabled: true },
      extra: "new",
    });
    expect(added).not.toBe(previous);
    expect(added.common).toBe(common);
    expect(added.other).toBe(previous.other);

    const withRemoved: Structure = { ...previous, removed: { value: 2 } };
    const removed = shareStructure(withRemoved, {
      common: { nested: { value: 1 }, items: ["a", "b"] },
      other: { enabled: true },
    });
    expect(removed).not.toBe(withRemoved);
    expect(removed.common).toBe(common);
    expect(removed.other).toBe(previous.other);
  });
});
