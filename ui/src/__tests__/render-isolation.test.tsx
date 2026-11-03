import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { TreeView } from "../components/tree/tree-view";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Shell } from "../../../app/src/shell/shell";
import type { AppDefinition, CoreEvent, CoreReply, ShellSnapshot } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore, shareShellSnapshot, shareStructure } from "../core/shell-store";
import * as windowData from "../data/window-data";
import { TimelineBlock } from "../blocks/timeline";
import * as renderBlockModule from "../render/render-block";
import { ClientRuntime } from "../runtime/client-runtime";
import { grantFor, makeTestSeed, makeTestSnapshot } from "./fixtures";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";

const rowRenders = vi.hoisted(() => new Map<string, number>());
const blockWrapperRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("../components/tree/tree-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/tree/tree-row")>();
  const { memo } = await import("react");
  return { ...actual, TreeRow: memo(function ObservedRow(props: Parameters<typeof actual.TreeRow>[0]) {
    rowRenders.set(props.row.id, (rowRenders.get(props.row.id) ?? 0) + 1);
    return <actual.TreeRow {...props} />;
  }) };
});

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
  function TabsBlock(props: Parameters<typeof actual.TabsBlock>[0]) {
    const key = `${props.context.window.id}\0${props.pointer}`;
    blockWrapperRenders.set(key, (blockWrapperRenders.get(key) ?? 0) + 1);
    return <actual.TabsBlock {...props} />;
  }
  return { ...actual, StackBlock, TextBlock, TabsBlock };
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
  state: { language: "ja", name: "" },
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
      { type: "input", value: { state: "name" }, on_change: { set_state: "name" } },
    ],
  },
};

const localizedLabelsDefinition: AppDefinition = {
  id: "localized-controls",
  name: "다국어 컨트롤",
  requires: { blocks: 16, modules: {} },
  permissions: [],
  state: { language: "en", enabled: false, amount: 2, color: "#123456", name: "", choice: null },
  messages: {
    en: { overview: "Overview", enabled: "Enabled", amount: "Amount", color: "Color", name: "Name", name_hint: "Type a name", choice: "Choice", choice_hint: "Select choice" },
    ko: { overview: "개요", enabled: "사용", amount: "양", color: "색", name: "이름", name_hint: "이름 입력", choice: "선택", choice_hint: "하나 고르기" },
  },
  locale: { state: "language" },
  ui: {
    type: "tabs", tabs: [
      { label: { message: "overview" }, child: { type: "stack", direction: "column", children: [
        { type: "toggle", value: { state: "enabled" }, on_change: { set_state: "enabled" }, label: { message: "enabled" } },
        { type: "slider", value: { state: "amount" }, on_change: { set_state: "amount" }, label: { message: "amount" }, min: 0, max: 10 },
        { type: "color", value: { state: "color" }, on_change: { set_state: "color" }, label: { message: "color" } },
        { type: "input", value: { state: "name" }, on_change: { set_state: "name" }, label: { message: "name" }, placeholder: { message: "name_hint" } },
        { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["one", "two"], label: { message: "choice" }, placeholder: { message: "choice_hint" } },
        { type: "text", value: "Stable content" },
      ] } },
      { label: "Other", child: { type: "text", value: "Other content" } },
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
      private readonly targets = new Set<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.targets.add(target);
        this.callback([...this.targets].map((observed) => ({
          target: observed,
          contentRect: { width: 960, height: observed.hasAttribute("data-tree-row") ? 32 : 552 },
        } as ResizeObserverEntry)), this as unknown as ResizeObserver);
      }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    },
  });
}

async function setup(definitions: AppDefinition[] = [definition], firstState: Record<string, JsonValue> = { first: null, second: null, compound: null }) {
  calls.length = 0;
  blockWrapperRenders.clear();
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
  rowRenders.clear();
  const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
  if (probe) probe.current = null;
  fallbackProbe.current = null;
});

describe("실제 Shell의 블록 렌더 격리", () => {
  it("트리 끝 액션을 갱신해도 기존 내용 행은 다시 그리지 않는다", () => {
    let rendered = 0;
    function Leading() { rendered += 1; return <span>내용 아이콘</span>; }
    const nodes = [{ id: "file", label: "문서.md", leading: <Leading /> }];
    function Harness() {
      const [created, setCreated] = useState(false);
      return <TreeView className="ks-file-tree-list" label="격리 트리" expanded={new Set()} nodes={nodes}
        endAction={{ label: created ? "다음 문서" : "새 문서", onActivate: () => setCreated(true) }}
        onActivate={() => {}} onExpandedChange={() => {}} />;
    }
    render(<Harness />);
    const before = rendered;
    fireEvent.click(screen.getByRole("treeitem", { name: "새 문서" }));
    expect(screen.getByRole("treeitem", { name: "다음 문서" })).toBeTruthy();
    expect(rendered).toBe(before);
  });

  it("폴더 선택과 끌기 대상 변경은 무관한 행을 다시 그리지 않는다", async () => {
    const folder: AppDefinition = {
      id: "folder-isolation", name: "폴더 격리", requires: { blocks: 13, modules: { files: 3 } },
      permissions: [{ module: "files", id: "docs", access: "readwrite", label: "문서" }],
      state: { selected: null },
      ui: { type: "folder", root: { permission: "docs" }, selected: { state: "selected" }, on_select: { set_state: "selected" } },
    };
    const seed = makeTestSeed({ definitions: [folder], grants: [grantFor("viewer-window", "docs")], files: { "a.md": "a", "b.md": "b", "z.md": "z", "target/inside.md": "x" } });
    seed.snapshot.shared.windows[0].state = { selected: null };
    const store = createShellStore(createFakeTransport(seed));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const target = screen.getByRole("treeitem", { name: "target" });
    rowRenders.clear();
    fireEvent.click(a, { ctrlKey: true });
    expect(rowRenders.get("a.md")).toBe(1);
    expect(rowRenders.get("z.md") ?? 0).toBe(0);
    rowRenders.clear();
    fireEvent.click(b, { ctrlKey: true });
    expect(rowRenders.get("b.md")).toBe(1);
    expect(rowRenders.get("a.md") ?? 0).toBe(0);
    expect(rowRenders.get("z.md") ?? 0).toBe(0);
    const values = new Map<string, string>();
    const dataTransfer = { setData: (type: string, data: string) => values.set(type, data), getData: (type: string) => values.get(type) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer });
    rowRenders.clear();
    fireEvent.dragOver(target, { dataTransfer });
    expect(rowRenders.get("target")).toBe(1);
    expect(rowRenders.get("a.md") ?? 0).toBe(0);
    expect(rowRenders.get("z.md") ?? 0).toBe(0);
    fireEvent.dragEnd(a, { dataTransfer });
    store.dispose();
  });
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

  it("실제 대화상자가 열린 동안 창 단축키를 막고 닫은 뒤 다시 허용한다", async () => {
    const dialogShortcut: AppDefinition = {
      id: "dialog-shortcut", name: "대화상자 단축키", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { open: false, used: false },
      shortcuts: [{ code: "KeyR", modifiers: [], action: [{ set_state: "used", value: true }] }],
      ui: { type: "stack", direction: "column", children: [
        { type: "button", label: "열기", on_click: [{ set_state: "open", value: true }] },
        { type: "dialog", open: { state: "open" }, title: "회의 안건", child: { type: "text", value: "안건 편집 중" }, on_close: [{ set_state: "open", value: false }] },
      ] },
    };
    const { store, transport } = await setup([dialogShortcut], { open: false, used: false });
    await store.call({ op: "window.raise", window_id: "window-a" });
    await userEvent.click(screen.getAllByRole("button", { name: "열기" })[0]);
    await screen.findByRole("dialog", { name: "회의 안건" });
    fireEvent.keyDown(document.body, { code: "KeyR", key: "r" });
    await settleRenders();
    expect(transport.getCalls().filter((call) => call.op === "data.act" && call.pointer === "/shortcuts/0/action")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(transport.getCalls().some((call) => call.op === "data.act" && call.pointer === "/ui/children/1/on_close")).toBe(true);
    // FakeData does not execute dialog.on_close; the local-core scenario covers the actual close action.
    await setState(store, "window-a", "open", false);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "회의 안건" })).toBeNull());
    fireEvent.keyDown(document.body, { code: "KeyR", key: "r" });
    await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.act" && call.pointer === "/shortcuts/0/action")).toHaveLength(1));
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

  it("탭 라벨과 입력 라벨·자리표시자가 locale을 따르며 탭 본문은 다시 그리지 않는다", async () => {
    const { store } = await setup([localizedLabelsDefinition], {
      language: "en", enabled: false, amount: 2, color: "#123456", name: "", choice: null,
    });
    expect(screen.getAllByRole("tab", { name: "Overview" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("tab", { name: "Other" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Amount").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Color").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Choice").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("Type a name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Select choice").length).toBeGreaterThan(0);
    blockWrapperRenders.clear();
    calls.length = 0;

    await setState(store, "window-a", "language", "ko");

    expect((await screen.findAllByRole("tab", { name: "개요" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("tab", { name: "Other" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("사용").length).toBeGreaterThan(0);
    expect(screen.getAllByText("양").length).toBeGreaterThan(0);
    expect(screen.getAllByText("색").length).toBeGreaterThan(0);
    expect(screen.getAllByText("이름").length).toBeGreaterThan(0);
    expect(screen.getAllByText("선택").length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText("이름 입력").length).toBeGreaterThan(0);
    expect(screen.getAllByText("하나 고르기").length).toBeGreaterThan(0);
    expect(blockWrapperRenders.get("window-a\0/ui") ?? 0).toBe(0);
    expect(calls.some((call) => call.windowId === "window-a" && call.pointer === "/ui/tabs/0/child/children/5")).toBe(false);
    store.dispose();
  });

  it("언어를 바꾸는 동안 포커스된 입력 초안을 유지한다", async () => {
    const { store } = await setup([localizedDefinition], { language: "ja", name: "" });
    const input = (await screen.findAllByRole("textbox"))[0] as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "초안 보존" } });
    await setState(store, "window-a", "language", "en");
    await waitFor(() => expect(screen.getByText("Hello")).toBeTruthy());
    expect(input.value).toBe("초안 보존");
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

  it("가상 반복에서 캔버스 행이 화면 밖으로 나갔다 돌아오면 표면을 떼고 다시 붙인다", async () => {
    mockVirtualLayout();
    const rows = Array.from({ length: 80 }, (_, index) => ({ id: String(index), surface: `surface-${index}` }));
    const repeat: AppDefinition = {
      id: "virtual-canvas-isolation", name: "가상 표면 격리", requires: { blocks: 14, modules: { assets: 1, client: 1 } }, permissions: [],
      state: { rows }, assets: [{ id: "script", version: 1 }],
      client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] },
      ui: { type: "repeat", key: "id", items: { state: "rows" }, virtual: true, template: { type: "canvas", surface: { item: "surface" } } },
    };
    const snapshot = makeTestSnapshot({ definitions: [repeat] });
    snapshot.shared.windows[0].id = "window-virtual-canvas";
    snapshot.shared.windows[0].state = { rows };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const call = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "data.media"
      ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
      : call(request));
    vi.spyOn(ClientRuntime.prototype, "surface");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 180 } as DOMRect);
    const originalTransfer = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
    const store = createShellStore(transport);
    const view = render(<Shell store={store} />);
    await store.ready;
    await waitFor(() => expect(document.querySelector('[data-testid="app-window-virtual-canvas-isolation"] .ks-canvas')).not.toBeNull());
    const scroll = document.querySelector<HTMLElement>('[data-testid="app-window-virtual-canvas-isolation"] .ks-repeat')!;
    const firstSurface = () => vi.mocked(ClientRuntime.prototype.surface).mock.calls
      .map(([message]) => message).filter((message) => message.id === "surface-0");
    const firstCanvas = scroll.querySelector('[data-repeat-key="0"] .ks-canvas');

    scroll.scrollTop = 1600;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(scroll.querySelector('[data-repeat-key="0"]')).toBeNull());
    await waitFor(() => expect(firstSurface().some((message) => message.phase === "detach")).toBe(true));
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(scroll.querySelector('[data-repeat-key="0"] .ks-canvas')).not.toBeNull());
    const nextCanvas = scroll.querySelector('[data-repeat-key="0"] .ks-canvas');
    expect(nextCanvas).not.toBe(firstCanvas);
    expect(firstSurface().filter((message) => message.phase === "attach").length).toBeGreaterThan(1);
    view.unmount();
    store.dispose();
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  });

  it("숨긴 반복 영역은 행 값이 바뀌어도 다시 그리지 않는다", async () => {
    const hiddenRepeat: AppDefinition = {
      id: "hidden-repeat-isolation", name: "숨긴 반복 격리", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { visible: true, rows: [{ id: "a", title: "첫 안건" }] },
      ui: { type: "when", value: { state: "visible" }, child: {
        type: "repeat", key: "id", items: { state: "rows" }, virtual: false,
        template: { type: "text", value: { item: "title" } },
      } },
    };
    const { store } = await setup([hiddenRepeat], { visible: true, rows: [{ id: "a", title: "첫 안건" }] });
    await setState(store, "window-a", "visible", false);
    await setState(store, "window-b", "visible", false);
    await waitFor(() => expect(screen.queryByText("첫 안건")).toBeNull());
    calls.length = 0;
    await setState(store, "window-a", "rows", [{ id: "a", title: "바뀐 안건" }]);
    await settleRenders();
    expect(calls.filter((call) => call.windowId === "window-a" && call.pointer.startsWith("/ui/child/template"))).toHaveLength(0);
    await setState(store, "window-a", "visible", true);
    await screen.findByText("바뀐 안건");
    store.dispose();
  });

  it("timeline 확대 단추는 코어를 부르지 않고 형제 블록을 다시 그리지 않는다", async () => {
    const timeline = {
      type: "timeline" as const, duration: 100, position: 0, tracks: [],
      viewport: { client: "viewport" }, controls: true, on_viewport: { client: "set_viewport" },
    };
    const definition: AppDefinition = {
      id: "timeline-isolation", name: "시간축 격리", requires: { blocks: 14, modules: { assets: 1, client: 1 } },
      permissions: [], state: {}, assets: [{ id: "script", version: 1 }],
      client: {
        runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {},
        outputs: { viewport: { default: { start: 10, end: 50 } } }, actions: ["set_viewport"],
        commands: {}, state_keys: [], storage_entries: [],
      },
      ui: { type: "stack", direction: "column", children: [timeline, { type: "text", value: "다른 블록" }] },
    };
    const seed = makeTestSeed({ definitions: [definition] });
    const appWindow = seed.snapshot.shared.windows[0];
    const transport = createFakeTransport(seed);
    const call = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "data.media"
      ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
      : call(request));
    const store = createShellStore(transport);
    const context = { store, window: appWindow, definition };
    const siblingRender = vi.fn();
    function Sibling() { siblingRender(); return <span>다른 블록</span>; }
    render(<windowData.WindowDataProvider store={store} windowId={appWindow.id} definition={definition}>
      <TimelineBlock block={timeline} pointer="/ui/children/0" context={context} />
      <Sibling />
    </windowData.WindowDataProvider>);
    await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).not.toBeNull());

    const frame = document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    const siblingRendersBefore = siblingRender.mock.calls.length;
    const coreCallsBefore = transport.getCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "확대" }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "ks-client-action", name: "set_viewport",
    }), "*"));
    await settleRenders();

    expect(siblingRender).toHaveBeenCalledTimes(siblingRendersBefore);
    expect(transport.getCalls().slice(coreCallsBefore)).toEqual([]);
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
