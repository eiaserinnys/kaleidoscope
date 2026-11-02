import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Shell } from "../../../app/src/shell/shell";
import type { AppDefinition, CoreEvent, ShellSnapshot } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore, shareShellSnapshot, shareStructure } from "../core/shell-store";
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

const whenDefinition: AppDefinition = {
  id: "when-isolation",
  name: "조건 격리 시험",
  requires: { blocks: 14, modules: {} },
  permissions: [],
  state: { visible: false, first: null, second: null, compound: null },
  ui: {
    type: "stack", direction: "column",
    children: [
      { type: "when", value: { state: "visible" }, child: { type: "text", value: "조건 자식" } },
      { type: "text", value: "다른 블록" },
    ],
  },
};

const chatDefinition: AppDefinition = {
  id: "provider-chat",
  name: "대화 앱",
  requires: { blocks: 2, modules: { agent: 3 } },
  permissions: [],
  state: {},
  ui: { type: "chat" },
  agent: {
    protocol: "conversation-v1", permission: "login", base_path: "api", namespace: "n", profile: "p",
    collection: "c", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "",
    instructions_template: "", thread_entry: "thread",
  },
};

const localizedDefinition: AppDefinition = {
  id: "localized-form",
  name: "다국어 양식",
  requires: { blocks: 14, modules: {} },
  permissions: [],
  state: { language: "ja" },
  messages: {
    ja: { greeting: "こんにちは" },
    en: { greeting: "Hello" },
  },
  locale: { state: "language" },
  ui: {
    type: "stack", direction: "column",
    children: [
      { type: "text", value: { message: "greeting" } },
      { type: "text", value: "unchanged" },
    ],
  },
};

function testSnapshot(definitions: AppDefinition[] = [definition], firstState: Record<string, JsonValue> = { first: null, second: null, compound: null }): ShellSnapshot {
  const snapshot = makeTestSnapshot({ definitions });
  const first = snapshot.shared.windows[0];
  first.id = "window-a";
  const compound = { items: [1, 2], nested: { label: "stable" } };
  first.state = { ...firstState };
  if (Object.hasOwn(definitions[0].state, "first")) first.state.first ??= "a";
  if (Object.hasOwn(definitions[0].state, "second")) first.state.second ??= "b";
  if (Object.hasOwn(definitions[0].state, "compound")) first.state.compound ??= compound;
  snapshot.shared.windows = [
    first,
    { ...first, id: "window-b", state: structuredClone(first.state), z: 2 },
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
      unobserve() {}
      disconnect() {}
    },
  });
}

async function setup(definitions: AppDefinition[] = [definition], firstState: Record<string, JsonValue> = { first: null, second: null, compound: null }) {
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
  const snapshot = testSnapshot(definitions, firstState);
  const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  await waitFor(() => expect(document.querySelector('[data-window-id="window-a"]')).not.toBeNull());
  await waitFor(() => expect(document.querySelector(".ks-data-skeleton")).toBeNull());
  calls.length = 0;
  return { store, transport, snapshot };
}

async function setupChatWindow() {
  calls.length = 0;
  const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
  if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
  const snapshot = makeTestSnapshot({ definitions: [definition, chatDefinition] });
  snapshot.shared.windows[0].id = "window-a";
  snapshot.shared.windows[0].state = { first: "a" };
  snapshot.shared.windows[1].id = "window-b";
  snapshot.link = { state: "connected", mode: "remote", server_url: "https://example.test", device_name: "시험" };
  const transport = createFakeTransport({
    snapshot,
    folder: null,
    files: {},
    conversation: {
      thread: {
        id: "thread-chat", external: { namespace: "workspace", key: "chat" }, title: "Chat",
        model: { id: "model", label: "Model" }, created_at: "2026-10-28T00:00:00Z", archived: false,
      },
      items: [], models: [{ id: "model", label: "Model", available: true }], profiles: [],
      start: { profile: "", model: "model" },
    },
  });
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  await waitFor(() => expect(document.querySelector('[data-window-id="window-b"]')).not.toBeNull());
  await screen.findByRole("textbox", { name: "메시지" });
  await settleRenders();
  calls.length = 0;
  return { store, transport, snapshot };
}

async function settleRenders() {
  let seen = -1;
  while (seen !== calls.length) {
    seen = calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
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
  it("when 조건을 바꿀 때 자식만 마운트하고 다른 블록은 다시 그리지 않는다", async () => {
    const { store } = await setup([whenDefinition], { visible: false });
    expect(screen.queryByText("조건 자식")).toBeNull();
    calls.length = 0;

    await setState(store, "window-a", "visible", true);
    expect(await screen.findByText("조건 자식")).toBeTruthy();
    expect(countFor("window-a", "/ui/children/1")).toBe(0);

    calls.length = 0;
    await setState(store, "window-a", "visible", false);
    await waitFor(() => expect(screen.queryByText("조건 자식")).toBeNull());
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    store.dispose();
  });

  it("단축키 처리 중 다른 창과 무관한 블록을 다시 그리지 않는다", async () => {
    const shortcutDefinition: AppDefinition = { ...definition, requires: { blocks: 14, modules: { client: 2 } }, shortcuts: [{ code: "KeyR", modifiers: [], action: { client: "reset" } }] };
    const { store } = await setup([shortcutDefinition]);
    fireEvent.keyDown(document.body, { code: "KeyR", key: "r" });
    await settleRenders();
    expect(countFor("window-a")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("창 A 상태 변경은 창 B 블록을 다시 그리지 않는다", async () => {
    const { store } = await setup();
    for (let i = 0; i < 10; i += 1) await setState(store, "window-a", "first", `changed-${i}`);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("창 A 상태 변경 10회는 채팅 창 B를 다시 그리지 않는다", async () => {
    const { store } = await setupChatWindow();
    for (let i = 0; i < 10; i += 1) await setState(store, "window-a", "first", `changed-${i}`);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("sharing 변경은 채팅의 같이 보기 칩을 갱신한다", async () => {
    const { store, transport, snapshot } = await setupChatWindow();
    expect(screen.queryByRole("button", { name: "격리 시험 같이 보기 끄기" })).toBeNull();
    await act(async () => transport.emit({ event: "state.changed", snapshot: { ...snapshot, sharing: ["window-a"] } }));
    expect(await screen.findByRole("button", { name: "격리 시험 같이 보기 끄기" })).toBeTruthy();
    store.dispose();
  });

  it("창 A 상태 변경은 그 키를 읽는 블록만 다시 그린다", async () => {
    const { store } = await setup();
    for (let i = 0; i < 10; i += 1) await setState(store, "window-a", "first", `changed-${i}`);
    expect(calls.filter((call) => call.windowId === "window-a").map((call) => call.pointer)).toEqual(Array(10).fill("/ui/children/0"));
    expect(document.body.textContent).toContain("changed-9");
    store.dispose();
  });

  it("기본 locale 사전으로 표시하고 locale 변경 시 그 메시지 블록만 다시 그린다", async () => {
    const { store } = await setup([localizedDefinition], {});
    expect(screen.getAllByText("こんにちは")).toHaveLength(2);
    expect(screen.getAllByText("unchanged")).toHaveLength(2);
    calls.length = 0;

    await setState(store, "window-a", "language", "en");

    await waitFor(() => expect(screen.getByText("Hello")).toBeTruthy());
    expect(screen.getByText("こんにちは")).toBeTruthy();
    expect(screen.getAllByText("unchanged")).toHaveLength(2);
    expect(calls.filter((call) => call.windowId === "window-a").map((call) => call.pointer)).toEqual([
      "/ui/children/0",
    ]);
    expect(countFor("window-b")).toBe(0);
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

  it("반복 항목 300개에서 바뀐 행만 다시 그린다", async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ id: String(index), title: `항목 ${index}` }));
    const repeat: AppDefinition = { id: "repeat-isolation", name: "반복 격리", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { rows }, ui: { type: "repeat", key: "id", items: { state: "rows" }, virtual: false, template: { type: "text", value: { item: "title" } } } };
    const snapshot = makeTestSnapshot({ definitions: [repeat] });
    snapshot.shared.windows[0].id = "window-repeat";
    snapshot.shared.windows[0].state = { rows };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    renderBlockModule.renderProbe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    render(<Shell store={store} />);
    await store.ready;
    await screen.findByText("항목 299");
    await settleRenders();
    calls.length = 0;
    const changedAll = rows.map((row) => ({ ...row, title: `${row.title}!` }));
    await setState(store, "window-repeat", "rows", changedAll);
    await settleRenders();
    expect(countFor("window-repeat", "/ui/template")).toBe(300);
    calls.length = 0;
    const changedOne = changedAll.map((row, index) => index === 150 ? { ...row, title: "고친 항목" } : row);
    await setState(store, "window-repeat", "rows", changedOne);
    await settleRenders();
    expect(screen.getByText("고친 항목")).toBeTruthy();
    expect(countFor("window-repeat", "/ui/template")).toBe(1);
    calls.length = 0;
    await setState(store, "window-repeat", "rows", changedOne.slice(1));
    await settleRenders();
    expect(screen.queryByText("항목 0!")).toBeNull();
    expect(countFor("window-repeat", "/ui/template")).toBe(0);
    store.dispose();
  });

  it("반복 캔버스 한 행을 다시 마운트해도 다른 행은 다시 그리지 않는다", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: String(index), surface: `tile-${index}` }));
    const repeat: AppDefinition = { id: "canvas-isolation", name: "표면 격리", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { rows }, ui: { type: "repeat", key: "id", items: { state: "rows" }, layout: "grid", virtual: false, template: { type: "canvas", surface: { item: "surface" } } } };
    const snapshot = makeTestSnapshot({ definitions: [repeat] });
    snapshot.shared.windows[0].id = "window-canvas"; snapshot.shared.windows[0].state = { rows };
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    renderBlockModule.renderProbe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    render(<Shell store={store} />); await store.ready;
    await waitFor(() => expect(document.querySelectorAll('[data-testid="app-window-canvas-isolation"] .ks-canvas')).toHaveLength(10));
    await settleRenders(); calls.length = 0;
    const changed = rows.map((row, index) => index === 5 ? { ...row, surface: "new-tile" } : row);
    await setState(store, "window-canvas", "rows", changed);
    await settleRenders();
    expect(countFor("window-canvas", "/ui/template")).toBe(1);
    calls.length = 0;
    await setState(store, "window-canvas", "rows", changed.filter((row) => row.id !== "5"));
    await settleRenders();
    await setState(store, "window-canvas", "rows", changed);
    await settleRenders();
    expect(countFor("window-canvas", "/ui/template")).toBe(1);
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

  it("스냅샷 전체 구독과 Legacy 채팅 문맥은 없다", () => {
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
    const legacyReferences = files.flatMap((path) => {
      if (path.endsWith("render-isolation.test.tsx")) return [];
      const source = readFileSync(path, "utf8");
      return /\b(?:useShellSnapshot|LegacyBlockContext|LegacyContextBlock)\b/.test(source)
        ? [path.replace(repoRoot + "/", "")]
        : [];
    });
    expect(legacyReferences).toEqual([]);
    const contextSource = readFileSync(join(repoRoot, "ui/src/blocks/block-context.ts"), "utf8");
    const blockContext = contextSource.match(/export interface BlockContext \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const windowIdentity = contextSource.match(/export interface WindowIdentity \{([^}]+)\}/)?.[1] ?? "";
    expect(blockContext).not.toMatch(/\b(?:snapshot|state|rect|z)\s*:/);
    expect(windowIdentity).not.toMatch(/\b(?:state|rect|z)\s*:/);
  });
});

describe("shareStructure 참조 보존", () => {
  it("불변 앱 판은 내용을 비교하지 않고 이전 객체를 유지하며 새 판은 새 객체를 쓴다", () => {
    const previous = testSnapshot();
    const oldVersion = previous.shared.app_versions[0];
    const next = structuredClone(previous);
    next.shared.app_versions[0].definition.name = "달라진 정의";

    const sameVersion = shareShellSnapshot(previous, next).shared.app_versions[0];
    expect(sameVersion).toBe(oldVersion);
    expect(sameVersion.definition).toBe(oldVersion.definition);
    expect(sameVersion.definition.name).toBe(oldVersion.definition.name);

    const newVersion = structuredClone(next);
    newVersion.shared.app_versions[0].version += 1;
    const result = shareShellSnapshot(previous, newVersion).shared.app_versions[0];
    expect(result).toBe(newVersion.shared.app_versions[0]);
    expect(result.definition.name).toBe("달라진 정의");
  });

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
