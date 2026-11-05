import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler, useEffect, useState } from "react";
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
import { useWindowData, WindowDataProvider, type WindowData } from "../data/window-data";
import type { BlockContext } from "../blocks/block-context";
import { TimelineBlock } from "../blocks/timeline";
import { WindowNotice } from "../data/window-notice";
import * as renderBlockModule from "../render/render-block";
import { ClientRuntime } from "../runtime/client-runtime";
import { createRealtime } from "../runtime/realtime-socket";
import * as shellErrors from "../contract/shell-errors";
import { grantFor, makeTestSeed, makeTestSnapshot } from "./fixtures";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { useDefaultMessageApp } from "../shell/message-target";
import { useMessageSnapshot } from "../../../app/src/shell/use-message-snapshot";

const frameRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../app/src/shell/window-frame", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../app/src/shell/window-frame")>();
  return { ...original, WindowFrame: (props: import("../../../app/src/shell/window-frame").WindowFrameProps) => {
    frameRenders.count += 1;
    return <original.WindowFrame {...props} />;
  } };
});

const rowRenders = vi.hoisted(() => new Map<string, number>());
const tileRenders = vi.hoisted(() => new Map<string, number>());
const blockWrapperRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("../components/icon-tile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/icon-tile")>();
  return { ...actual, IconTile: (props: Parameters<typeof actual.IconTile>[0]) => {
    tileRenders.set(props.name, (tileRenders.get(props.name) ?? 0) + 1);
    return <actual.IconTile {...props} />;
  } };
});
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

vi.mock("thinking-orbs", () => ({ ThinkingOrb: () => <span aria-hidden="true" /> }));

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

const clientChatDefinition: AppDefinition = {
  id: "client-chat-isolation", name: "클라이언트 채팅 격리",
  requires: { blocks: 18, modules: { assets: 1, client: 4 } }, permissions: [], state: {},
  assets: [{ id: "chat-isolation", version: 1 }],
  client: {
    runtime: "javascript", entry: { id: "chat-isolation", version: 1 }, inputs: {}, outputs: {},
    channels: ["thread"], actions: ["send", "cancel", "attachment"], commands: {}, state_keys: [], storage_entries: [],
  },
  ui: {
    type: "stack", direction: "column", children: [
      {
        type: "chat", client: { channel: "thread", on_send: "send", on_cancel: "cancel", on_attachment: "attachment" },
        footer: { type: "text", value: "격리 바닥글" },
      },
      { type: "text", value: "채팅 바깥 블록" },
    ],
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

const messageItemIsolationDefinition: AppDefinition = {
  id: "message-item-isolation",
  name: "자료 키 렌더 격리",
  requires: { blocks: 19, modules: {} },
  permissions: [],
  state: { language: "en", unrelated: "initial", rows: [{ id: "row", label_key: "ready" }] },
  messages: { en: { ready: "Ready" }, ko: { ready: "준비" } },
  locale: { state: "language" },
  ui: {
    type: "repeat", items: { state: "rows" }, key: "id", virtual: false,
    template: { type: "text", value: { message: { item: "label_key" } } },
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

const localizedDialogTourDefinition: AppDefinition = {
  id: "localized-dialog-tour",
  name: "다국어 대화상자와 안내",
  requires: { blocks: 16, modules: {} },
  permissions: [],
  state: { language: "en", dialog_open: true, tour_open: true, tour_step: "first" },
  messages: {
    en: {
      close: "Close", cancel: "Cancel", previous: "Previous", next: "Next", done: "Done", skip: "Skip",
    },
    ko: {
      close: "닫기", cancel: "취소", previous: "이전", next: "다음", done: "끝내기", skip: "건너뛰기",
    },
  },
  locale: { state: "language" },
  ui: {
    type: "stack", direction: "column", children: [
      {
        type: "dialog", open: { state: "dialog_open" }, title: "Dialog",
        close_label: { message: "close" }, cancel_label: { message: "cancel" },
        child: { type: "text", value: "Stable dialog content" }, on_close: [{ set_state: "dialog_open", value: false }],
      },
      { type: "anchor", id: "guide-target", child: { type: "text", value: "Stable guide target" } },
      {
        type: "tour", open: { state: "tour_open" }, step: { state: "tour_step" },
        steps: [
          { key: "first", target: "guide-target", title: "Guide", body: "Guide body" },
          { key: "last", target: "guide-target", title: "Summary", body: "Summary body" },
        ],
        labels: {
          previous: { message: "previous" }, next: { message: "next" },
          done: { message: "done" }, skip: { message: "skip" },
        },
        on_step: [{ set_state: "tour_step", value: { expr: "$event" } }],
        on_close: [{ set_state: "tour_open", value: false }],
      },
      { type: "text", value: "Unrelated content" },
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

function dialogFooterDefinition(options: { onConfirm?: boolean; danger?: boolean; cancelLabel?: boolean } = {}): AppDefinition {
  const dialog: Record<string, unknown> = {
    type: "dialog",
    open: { state: "open" },
    title: options.danger ? "위험 확인" : options.onConfirm ? "변경 확인" : "안내",
    close_label: options.onConfirm ? "확인" : "닫기",
    child: { type: "text", value: "대화상자 내용" },
    on_close: [{ set_state: "open", value: false }],
  };
  if (options.cancelLabel) dialog.cancel_label = "취소";
  if (options.onConfirm) dialog.on_confirm = [{ set_state: "confirmed", value: true }];
  if (options.danger !== undefined) dialog.danger = options.danger;
  return {
    id: "dialog-footer", name: "대화상자 바닥 단추",
    requires: { blocks: 19, modules: {} }, permissions: [],
    state: { open: true, confirmed: false },
    ui: dialog as unknown as AppDefinition["ui"],
  };
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
  it("설정 창 이동과 크기 조절은 앱 창을 다시 그리지 않는다", async () => {
    if (!globalThis.PointerEvent) Object.defineProperty(globalThis, "PointerEvent", { configurable: true, value: MouseEvent });
    const snapshot = testSnapshot([definition]);
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />); await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    const window = screen.getByTestId("system-window-settings");
    await settleRenders(); frameRenders.count = 0;
    const before = { left: window.style.left, width: window.style.width };
    const title = window.querySelector(".ks-window-titlebar")!;
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 130, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 130, clientY: 130 });
    const resize = window.querySelector(".ks-window-resize-corner")!;
    fireEvent.pointerDown(resize, { pointerId: 2, button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 440, clientY: 330 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 440, clientY: 330 });
    await settleRenders();
    expect(window.style.left).not.toBe(before.left);
    expect(window.style.width).not.toBe(before.width);
    expect(frameRenders.count).toBe(0);
    store.dispose();
  });

  it("계정 설정은 다른 창을 다시 그리지 않고 창 상태는 닫힌 설정과 질문의 구독을 갱신하지 않는다", async () => {
    const snapshot = testSnapshot([definition]);
    snapshot.link = { state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "내 PC" };
    snapshot.shared.preferences = { revision: 1, default_message_app_id: null, asked_message_app_ids: [] };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    let renders = 0;
    function Observer() { useMessageSnapshot(store); renders += 1; return null; }
    render(<><Shell store={store} /><Observer /></>);
    await store.ready;
    await waitFor(() => expect(document.querySelector('[data-window-id="window-b"]')).not.toBeNull());
    await settleRenders();
    const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
    if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    else fallbackProbe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    calls.length = 0;
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, preferences: { revision: 2, default_message_app_id: null, asked_message_app_ids: ["other"] } } } }));
    await settleRenders();
    expect(countFor("window-a")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    const beforeWindowChange = renders;
    await setState(store, "window-a", "first", "변경");
    await settleRenders();
    expect(renders).toBe(beforeWindowChange);
    store.dispose();
  });

  it("앱 아이콘 수신은 다른 창과 블록을 다시 그리지 않는다", async () => {
    const withIcon = { ...definition, icon: { asset: "logo", version: 1 } };
    const snapshot = testSnapshot([withIcon]);
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    let complete!: (reply: CoreReply) => void;
    const pending = new Promise<CoreReply>((resolve) => { complete = resolve; });
    vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) =>
      request.op === "app.icon" ? pending : original(request)) as typeof transport.call);
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    await waitFor(() => expect(document.querySelector('[data-window-id="window-b"]')).not.toBeNull());
    await settleRenders();
    const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
    if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    else fallbackProbe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    calls.length = 0;
    await act(async () => complete({ op: "app.icon", media: { mime: "image/png", data_base64: "AA==", width: null, height: null } }));
    await waitFor(() => expect(document.querySelectorAll("img.ks-app-icon")).toHaveLength(2));
    await settleRenders();
    expect(countFor("window-b")).toBe(0);
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("소켓 수신을 한 출력에 발행하면 그 출력의 블록만 다시 그린다", async () => {
    vi.spyOn(ClientRuntime.prototype, "start").mockResolvedValue();
    const live: AppDefinition = {
      id: "realtime-render", name: "실시간 렌더", requires: { blocks: 12, modules: { assets: 1, client: 1 } }, permissions: [], state: {},
      assets: [{ id: "script", version: 1 }],
      client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: { first: { default: "이전" }, second: { default: "고정" } }, actions: [], commands: {}, state_keys: [], storage_entries: [] },
      ui: { type: "stack", direction: "column", children: [{ type: "text", value: { client: "first" } }, { type: "text", value: { client: "second" } }] },
    };
    const snapshot = testSnapshot([live], {});
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    await store.ready;
    let dataA: WindowData | null = null;
    function Capture() { const data = useWindowData(); useEffect(() => { dataA = data; }, [data]); return null; }
    const context = (window: ShellSnapshot["shared"]["windows"][number]): BlockContext => ({ store, window: { id: window.id, app_id: window.app_id, app_version: window.app_version, desktop_id: window.desktop_id }, definition: live });
    render(<>
      {snapshot.shared.windows.map((window) => <WindowDataProvider key={window.id} store={store} windowId={window.id} definition={live}>
        {window.id === "window-a" && <Capture />}{renderBlockModule.renderBlock(live.ui, context(window))}
      </WindowDataProvider>)}
    </>);
    await waitFor(() => expect(dataA).toBeTruthy());
    await settleRenders();
    const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
    if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    else fallbackProbe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    calls.length = 0;
    const failure = shellErrors.SHELL_REALTIME_PROTOCOL_INVALID();
    const realtime = createRealtime({ open: () => ({ result: Promise.resolve({ handle: "socket", protocol: "" }), cancel() {} }), send: async () => {}, close: async () => {}, login: async () => {} }, { urlInvalid: failure, sendTypeInvalid: failure, sendConnecting: failure, binaryTypeUnsupported: failure, protocolInvalid: failure, queueFull: failure, messageTooLarge: failure });
    const Socket = realtime.webSocketConstructor("live"); const socket = new Socket("/socket");
    socket.onmessage = (event) => dataA!.publishClient({ first: event.data as string });
    await act(async () => { await Promise.resolve(); realtime.event({ handle: "socket", event: "message", data: "갱신" }); });
    await settleRenders();
    expect(screen.getByText("갱신")).toBeTruthy();
    expect(countFor("window-a", "/ui/children/0")).toBeGreaterThan(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    store.dispose(); vi.restoreAllMocks();
  });

  it("단추 설명이 바뀌면 그 단추만 다시 그린다", async () => {
    const definition: AppDefinition = {
      id: "tooltip-isolation", name: "설명", requires: { blocks: 27, modules: {} }, permissions: [], state: { hint: "이전 설명", count: 0 },
      ui: { type: "stack", direction: "column", children: [
        { type: "button", label: "실행", description: { state: "hint" }, on_click: [{ set_state: "count", value: 1 }] },
        { type: "text", value: "바뀌지 않는 내용" },
      ] },
    };
    const { store } = await setup([definition], { hint: "이전 설명", count: 0 });
    await settleRenders();
    calls.length = 0;
    await setState(store, "window-a", "hint", "새 설명");
    await settleRenders();
    expect(countFor("window-a", "/ui/children/0")).toBeGreaterThan(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    const first = document.querySelector<HTMLButtonElement>('.ks-data-window[data-window-id="window-a"] button[aria-label="실행"]')!;
    act(() => first.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("새 설명");
    store.dispose();
  });

  it("창 제목 바인딩 변경은 해당 창 머리만 다시 그린다", async () => {
    const titleDefinition: AppDefinition = {
      id: "window-title-render-isolation", name: "기본 제목",
      requires: { blocks: 18, modules: {} }, permissions: [],
      state: { title: "기본 제목", meta: "기본 메타" },
      window_title: { title: { state: "title" }, meta: { state: "meta" } },
      ui: { type: "text", value: "본문 고정" },
    };
    const { store } = await setup([titleDefinition], { title: "창 A", meta: "작업 공간 A" });
    await setState(store, "window-b", "title", "창 B");
    await setState(store, "window-b", "meta", "작업 공간 B");
    await settleRenders();
    expect(screen.getByText("창 A")).toBeTruthy();
    expect(screen.getByText("창 B")).toBeTruthy();
    expect(screen.getByText("작업 공간 A")).toBeTruthy();
    expect(screen.getByText("작업 공간 B")).toBeTruthy();

    calls.length = 0;
    await setState(store, "window-a", "title", "새 창 A 제목");
    await setState(store, "window-a", "meta", "새 작업 공간 A");
    await settleRenders();

    expect(screen.getByText("새 창 A 제목")).toBeTruthy();
    expect(screen.getByText("새 작업 공간 A")).toBeTruthy();
    expect(screen.getByText("창 B")).toBeTruthy();
    expect(screen.getByText("작업 공간 B")).toBeTruthy();
    expect(calls).toEqual([]);
    store.dispose();
  });

  it("입력 라벨 바인딩이 비어 있다가 채워져도 입력 노드와 포커스를 유지한다", async () => {
    const inputDefinition: AppDefinition = {
      id: "bound-input-label", name: "입력 라벨", requires: { blocks: 16, modules: {} }, permissions: [],
      state: { draft: "", label: null },
      ui: { type: "input", value: { state: "draft" }, label: { state: "label" }, on_change: { set_state: "draft" }, commit: "submit" },
    };
    const { store } = await setup([inputDefinition], { draft: "", label: null });
    const input = document.querySelector<HTMLInputElement>('.ks-data-window[data-ks-app-id="bound-input-label"] input.ks-text-input')!;
    input.focus();
    await userEvent.type(input, "typed");

    await setState(store, "window-a", "label", "Name");
    await screen.findByText("Name");

    expect(document.querySelector('.ks-data-window[data-ks-app-id="bound-input-label"] input.ks-text-input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("typed");
    store.dispose();
  });

  it("선택 라벨 바인딩이 비어 있다가 채워져도 선택 노드와 포커스를 유지한다", async () => {
    const selectDefinition: AppDefinition = {
      id: "bound-select-label", name: "선택 라벨", requires: { blocks: 16, modules: {} }, permissions: [],
      state: { choice: "one", label: null },
      ui: { type: "select", value: { state: "choice" }, label: { state: "label" }, options: ["one", "two"], on_change: { set_state: "choice" } },
    };
    const { store } = await setup([selectDefinition], { choice: "one", label: null });
    const select = document.querySelectorAll<HTMLButtonElement>('.ks-data-window[data-ks-app-id="bound-select-label"] button')[0]!;
    select.focus();

    await setState(store, "window-a", "label", "Choice");
    await screen.findByText("Choice");

    expect(document.querySelector('.ks-data-window[data-ks-app-id="bound-select-label"] .ks-select-field button')).toBe(select);
    expect(document.activeElement).toBe(select);
    store.dispose();
  });

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
  it("when 폭 조건은 첫 화면 너비를 반영하고 경계가 바뀔 때 자식만 교체한다", async () => {
    const definition: AppDefinition = {
      id: "when-width", name: "창 너비 조건", requires: { blocks: 19, modules: {} }, permissions: [], state: {},
      ui: { type: "stack", direction: "column", children: [
        { type: "when", min_width: 600, max_width: 899, child: { type: "text", value: "폭 안쪽" } },
        { type: "text", value: "폭 조건 밖에서도 유지" },
      ] },
    };
    let width = 720;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("ks-data-window")) return { width, height: 500 } as DOMRect;
      if (this.classList.contains("ks-data-window-body")) return { width, height: 500 } as DOMRect;
      return originalRect.call(this);
    });
    const resizeWindows: Array<(width: number) => void> = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (!target.classList.contains("ks-data-window")) return;
        const resize = (nextWidth: number) => this.callback([{ target, contentRect: { width: nextWidth, height: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        resizeWindows.push(resize);
        resize(width);
      }
      unobserve() {}
      disconnect() {}
    });
    const { store } = await setup([definition]);
    try {
      expect(document.querySelector(".ks-data-window-body")?.getBoundingClientRect().width).toBe(720);
      expect(resizeWindows).toHaveLength(2);
      expect(screen.getAllByText("폭 안쪽")).toHaveLength(2);
      expect(screen.getAllByText("폭 조건 밖에서도 유지")).toHaveLength(2);
      calls.length = 0;

      width = 599;
      act(() => resizeWindows.forEach((resize) => resize(width)));
      await waitFor(() => expect(screen.queryByText("폭 안쪽")).toBeNull());
      expect(countFor("window-a", "/ui/children/1")).toBe(0);

      width = 600;
      act(() => resizeWindows.forEach((resize) => resize(width)));
      expect(await screen.findAllByText("폭 안쪽")).toHaveLength(2);
      expect(countFor("window-a", "/ui/children/1")).toBe(0);

      calls.length = 0;
      width = 899;
      act(() => resizeWindows.forEach((resize) => resize(width)));
      expect(screen.getAllByText("폭 안쪽")).toHaveLength(2);
      expect(calls).toHaveLength(0);

      width = 900;
      act(() => resizeWindows.forEach((resize) => resize(width)));
      await waitFor(() => expect(screen.queryByText("폭 안쪽")).toBeNull());
      expect(screen.getAllByText("폭 조건 밖에서도 유지")).toHaveLength(2);
      expect(countFor("window-a", "/ui/children/1")).toBe(0);
    } finally {
      store.dispose();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
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

  it("제목 줄 메뉴를 열고 닫아도 창 블록을 다시 그리지 않는다", async () => {
    const { store } = await setup();
    const titlebar = document.querySelector<HTMLElement>(".ks-window-titlebar")!;
    fireEvent.contextMenu(titlebar, { clientX: 50, clientY: 50 });
    expect(screen.getByRole("menuitem", { name: "창 닫기" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
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
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "회의 안건" })).toBeNull());
    fireEvent.keyDown(document.body, { code: "KeyR", key: "r" });
    await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.act" && call.pointer === "/shortcuts/0/action")).toHaveLength(1));
    store.dispose();
  });

  it("확인 동작이 없는 대화상자는 취소 없이 닫기 단추 하나를 보인다", async () => {
    const { store, transport } = await setup([dialogFooterDefinition({ cancelLabel: true })], { open: true, confirmed: false });
    const dialog = (await screen.findAllByRole("dialog", { name: "안내" }))[0];
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(transport.getCalls().some((call) => call.op === "data.act" && call.pointer === "/ui/on_close")).toBe(true);
    store.dispose();
  });

  it("확인 대화상자는 취소와 확인 동작을 나누고 Escape는 닫기 동작을 부른다", async () => {
    const { store, transport } = await setup([dialogFooterDefinition({ onConfirm: true, cancelLabel: true })], { open: true, confirmed: false });
    const windowA = within(document.querySelector<HTMLElement>('[data-window-id="window-a"]')!);
    const dialog = await windowA.findByRole("dialog", { name: "변경 확인" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(windowA.queryByRole("dialog", { name: "변경 확인" })).toBeNull());
    await setState(store, "window-a", "open", true);
    const reopened = await windowA.findByRole("dialog", { name: "변경 확인" });
    await userEvent.click(within(reopened).getByRole("button", { name: "확인" }));
    fireEvent.keyDown(document, { key: "Escape" });
    const actions = transport.getCalls().filter((call) => call.op === "data.act").map((call) => call.pointer);
    expect(actions).toContain("/ui/on_close");
    expect(actions).toContain("/ui/on_confirm");
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("위험 확인은 공용 대화상자 단추에 위험 표시를 적용한다", async () => {
    const { store, transport } = await setup([dialogFooterDefinition({ onConfirm: true, danger: true })], { open: true, confirmed: false });
    const dialog = (await screen.findAllByRole("dialog", { name: "위험 확인" }))[0];
    expect(dialog.querySelector(".ks-dialog-confirm.is-danger")).not.toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "확인" }));
    expect(transport.getCalls().some((call) => call.op === "data.act" && call.pointer === "/ui/on_confirm")).toBe(true);
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

  it("클라이언트 채팅 글 조각 10개와 100개는 다시 그리는 횟수가 비례하지 않는다", async () => {
    calls.length = 0;
    const probe = (renderBlockModule as unknown as { renderProbe?: { current: typeof fallbackProbe.current } }).renderProbe;
    if (probe) probe.current = (windowId, pointer, type) => calls.push({ windowId, pointer, type });
    const snapshot = testSnapshot([clientChatDefinition], {});
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    await store.ready;
    const first = snapshot.shared.windows[0]!;
    const second = snapshot.shared.windows[1]!;
    const contextFor = (appWindow: typeof first): BlockContext => ({
      store,
      window: { id: appWindow.id, app_id: appWindow.app_id, app_version: appWindow.app_version, desktop_id: appWindow.desktop_id },
      definition: clientChatDefinition,
    });
    let dataA: WindowData | null = null;
    let dataB: WindowData | null = null;
    let commitsA = 0;
    let commitsB = 0;
    function Capture({ save }: { save: (data: WindowData) => void }) {
      const data = useWindowData();
      useEffect(() => save(data), [data, save]);
      return null;
    }
    const commitTraceA: Array<{ activity: string; streamedText: string; cancelVisible: boolean }> = [];
    render(<>
      <WindowDataProvider store={store} windowId={first.id} definition={clientChatDefinition}>
        <Capture save={(data) => { dataA = data; }} />
        <Profiler id="chat-window-a" onRender={() => {
          commitsA += 1;
          const history = document.querySelector(".ks-agent-chat-history");
          commitTraceA.push({
            activity: history?.querySelector(".ks-agent-chat-working")?.textContent ?? "",
            streamedText: history?.querySelector(".ks-agent-chat-assistant")?.textContent ?? "",
            cancelVisible: !!document.querySelector('button[aria-label="멈춤"]'),
          });
        }}>
          {renderBlockModule.renderBlock(clientChatDefinition.ui, contextFor(first))}
        </Profiler>
      </WindowDataProvider>
      <WindowDataProvider store={store} windowId={second.id} definition={clientChatDefinition}>
        <Capture save={(data) => { dataB = data; }} />
        <Profiler id="chat-window-b" onRender={() => { commitsB += 1; }}>
          {renderBlockModule.renderBlock(clientChatDefinition.ui, contextFor(second))}
        </Profiler>
      </WindowDataProvider>
    </>);
    await waitFor(() => expect(dataA && dataB).toBeTruthy());
    await settleRenders();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const measureBurst = async (count: number) => {
      await act(async () => {
        dataA!.publishClientChat("thread", { kind: "snapshot", items: [], stream_id: null, text: "", busy: false, tool: null, queued: [] });
        await nextFrame();
      });
      await act(async () => { await nextFrame(); });
      await act(async () => { await nextFrame(); });
      calls.length = 0;
      commitsA = 0;
      commitsB = 0;
      commitTraceA.length = 0;
      const coreCallsBefore = transport.getCalls().length;
      await act(async () => {
        dataA!.publishClientChat("thread", { kind: "event", event: { kind: "activity", busy: true, tool: "응답 생성" } });
        await nextFrame();
      });
      await act(async () => { await nextFrame(); });
      await act(async () => {
        for (let index = 0; index < count; index += 1) {
          dataA!.publishClientChat("thread", { kind: "event", event: { kind: "text", stream_id: "rapid", text: `조각 ${index + 1}` } });
        }
        await nextFrame();
      });
      await act(async () => { await nextFrame(); });
      await act(async () => { await nextFrame(); });
      return {
        commits: commitsA,
        otherWindowCommits: commitsB,
        outsideChatRenders: calls.filter((call) => call.pointer === "/ui/children/0/footer" || call.pointer === "/ui/children/1"),
        coreCalls: transport.getCalls().length - coreCallsBefore,
        trace: [...commitTraceA],
      };
    };

    const ten = await measureBurst(10);
    expect(document.body.textContent).toContain("조각 10");
    const hundred = await measureBurst(100);
    expect(document.body.textContent).toContain("조각 100");
    expect(ten.commits).toBe(hundred.commits);
    expect(ten.commits * 2).toBeLessThan(10);
    expect(hundred.commits * 2).toBeLessThan(100);
    expect(ten.otherWindowCommits).toBe(0);
    expect(hundred.otherWindowCommits).toBe(0);
    expect(ten.outsideChatRenders).toEqual([]);
    expect(hundred.outsideChatRenders).toEqual([]);
    expect(ten.coreCalls).toBe(0);
    expect(hundred.coreCalls).toBe(0);
    console.log(JSON.stringify({ "10_events": ten, "100_events": hundred }));
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

  it("메시지 키 라벨은 무관한 상태와 다른 창 변경에서 다시 그리지 않고 코어도 추가 호출하지 않는다", async () => {
    const { store, transport } = await setup([messageItemIsolationDefinition], {
      language: "en", unrelated: "initial", rows: [{ id: "row", label_key: "ready" }],
    });
    expect(screen.getAllByText("Ready")).toHaveLength(2);

    for (const [windowId, value] of [["window-a", "same-window"], ["window-b", "other-window"]]) {
      calls.length = 0;
      const before = transport.getCalls().length;
      await setState(store, windowId, "unrelated", value);
      await settleRenders();
      expect(calls).toEqual([]);
      expect(transport.getCalls().slice(before).map((call) => call.op)).toEqual(["window.set_state"]);
    }

    expect(screen.getAllByText("Ready")).toHaveLength(2);
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

  it("대화상자와 안내 단추 라벨은 locale을 따르고 내부의 고정 글은 다시 그리지 않는다", async () => {
    const { store } = await setup([localizedDialogTourDefinition], {
      language: "en", dialog_open: true, tour_open: true, tour_step: "first",
    });
    const tourButtons = (name: string) => [...document.querySelectorAll(".ks-tour-actions button")]
      .filter((button) => button.textContent?.trim() === name);
    const stepCounts = () => [...document.querySelectorAll(".ks-tour-step-count")].map((element) => element.textContent?.trim());
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: "Cancel" })).toHaveLength(0);
    expect(tourButtons("Previous")).toHaveLength(2);
    expect(tourButtons("Next")).toHaveLength(2);
    expect(tourButtons("Skip")).toHaveLength(2);
    expect(stepCounts()).toEqual(["1 / 2", "1 / 2"]);
    calls.length = 0;

    await setState(store, "window-a", "tour_step", "last");
    await waitFor(() => expect(tourButtons("Done")).toHaveLength(1));
    await waitFor(() => expect(stepCounts()).toContain("2 / 2"));
    expect(tourButtons("Next")).toHaveLength(1);
    await setState(store, "window-a", "tour_step", "first");
    await waitFor(() => expect(tourButtons("Next")).toHaveLength(2));
    calls.length = 0;

    await setState(store, "window-a", "language", "ko");

    await waitFor(() => expect(screen.getAllByRole("button", { name: "닫기" })).toHaveLength(1));
    expect(screen.queryAllByRole("button", { name: "취소" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "닫기" }).length + screen.getAllByRole("button", { name: "Close" }).length).toBe(2);
    expect(tourButtons("이전")).toHaveLength(1);
    expect(tourButtons("다음")).toHaveLength(1);
    expect(tourButtons("건너뛰기")).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: "Cancel" })).toHaveLength(0);
    expect(countFor("window-a", "/ui/children/0/child")).toBe(0);
    expect(countFor("window-a", "/ui/children/1/child")).toBe(0);
    expect(countFor("window-a", "/ui/children/3")).toBe(0);

    await setState(store, "window-a", "tour_step", "last");
    await waitFor(() => expect(tourButtons("끝내기")).toHaveLength(1));
    expect(tourButtons("Done")).toHaveLength(0);
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

  it("다른 창의 선택지 갱신은 입력과 이웃 블록을 다시 그리지 않는다", async () => {
    const optionsInput: AppDefinition = { ...definition, requires: { blocks: 33, modules: {} }, state: { first: "a", second: "옆 글", choices: ["a", "b"] }, ui: { type: "stack", direction: "column", children: [
      { type: "input", value: { state: "first" }, on_change: { set_state: "first" }, options: { state: "choices" } },
      { type: "text", value: { state: "second" } },
    ] } };
    const { store } = await setup([optionsInput], { first: "a", second: "옆 글", choices: ["a", "b"] });
    await setState(store, "window-a", "choices", ["a", "c"]);
    await settleRenders();
    expect(countFor("window-b")).toBe(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    store.dispose();
  });

  it("다른 창의 날짜 변경은 날짜 입력과 이웃 글을 다시 그리지 않는다", async () => {
    const dateInput: AppDefinition = { ...definition, requires: { blocks: 35, modules: {} }, state: { first: "2026-11-20", second: "옆 글" }, ui: { type: "stack", direction: "column", children: [
      { type: "input", kind: "date", value: { state: "first" }, on_change: { set_state: "first" } },
      { type: "text", value: { state: "second" } },
    ] } };
    const { store } = await setup([dateInput], { first: "2026-11-20", second: "옆 글" });
    await setState(store, "window-a", "first", "2026-11-21");
    await settleRenders();
    expect(countFor("window-b")).toBe(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    store.dispose();
  });

  it("설치 목록을 쓰는 값이 바뀌어도 다른 창과 형제 블록은 다시 그리지 않는다", async () => {
    const storeView: AppDefinition = { ...definition, ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$count($apps)" } },
      { type: "text", value: { state: "second" } },
    ] } };
    const { store, transport } = await setup([storeView]);
    calls.length = 0;
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: {
      "/ui/children/0/value": { status: "ready", value: 1 },
    } } }));
    await settleRenders();
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("긴 목록은 가상화가 그린 항목보다 많은 이미지를 미리 받지 않는다", async () => {
    mockVirtualLayout();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ks-media-thumbnail")
        ? { width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
        : originalRect.call(this);
    });
    const list: AppDefinition = { ...definition, ui: { type: "list", layout: "icons", items: { expr: "$data.sample" } } };
    const { store, transport } = await setup([list]);
    const original = store.call.bind(store);
    const mediaCalls: string[] = [];
    vi.spyOn(store, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
      if (request.op === "data.media") {
        mediaCalls.push(JSON.stringify(request.media));
        return Promise.resolve({ op: "data.media", media: { mime: "image/png", data_base64: "AA==", width: null, height: null } });
      }
      return original(request);
    }) as typeof store.call);
    const items = Array.from({ length: 200 }, (_, i) => ({ key: String(i), title: `앱 ${i}`, image: { permission: "catalog", path: `apps/${i}.png`, query: { server: "https://store.example" } } }));
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: { "/ui/items": { status: "ready", value: items } } } }));
    await waitFor(() => expect(mediaCalls.length).toBeGreaterThan(0));
    await settleRenders();
    const window = document.querySelector('[data-window-id="window-a"]')!;
    const rendered = window.querySelectorAll('[role="option"]').length;
    expect(rendered).toBeLessThan(items.length);
    expect(mediaCalls.length).toBeLessThanOrEqual(rendered);
    store.dispose();
  });

  it("다음 쪽 상태 변화는 다른 창과 형제 블록을 다시 그리지 않는다", async () => {
    const paged: AppDefinition = { ...definition, ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { state: "first" } },
      { type: "list", items: { expr: "$data.sample" } },
      { type: "text", value: { state: "second" } },
    ] } };
    const { store, transport } = await setup([paged]);
    const rows = [{ key: "a", title: "첫 항목" }];
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: {
      "/ui/children/1/items": { status: "ready", value: rows, more: { source: "sample", state: "loading", retry: false } },
    } } }));
    await settleRenders();
    calls.length = 0;
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: {
      "/ui/children/1/items": { status: "ready", value: rows, more: { source: "sample", state: "failed", message: "다음 쪽 실패", id: "DATA_TEST_PAGE_FAILED", retry: false } },
    } } }));
    await settleRenders();
    expect(document.body.textContent).toContain("다음 쪽 실패");
    expect(countFor("window-a", "/ui/children/0")).toBe(0);
    expect(countFor("window-a", "/ui/children/2")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    store.dispose();
  });

  it("아이콘 목록은 다른 창과 형제를 격리하고 선택과 쪽 추가에 필요한 타일만 그린다", async () => {
    mockVirtualLayout();
    const paged: AppDefinition = { ...definition, ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { state: "first" } },
      { type: "list", layout: "icons", items: { expr: "$data.sample" }, selected: { state: "second" } },
      { type: "text", value: { state: "compound" } },
    ] } };
    const { store, transport } = await setup([paged], { first: "a", second: "a", compound: "c" });
    const rows = [{ key: "a", title: "아이콘 하나" }, { key: "b", title: "아이콘 둘" }, { key: "c", title: "아이콘 셋" }];
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: {
      "/ui/children/1/items": { status: "ready", value: rows },
      "/ui/children/1/selected": { status: "ready", value: "a" },
    } } }));
    await screen.findByRole("option", { name: "아이콘 셋" });
    await settleRenders(); tileRenders.clear(); calls.length = 0;
    await setState(store, "window-b", "first", "다른 창");
    await settleRenders();
    expect(tileRenders.size).toBe(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    tileRenders.clear(); calls.length = 0;
    await setState(store, "window-a", "second", "b");
    await settleRenders();
    expect(Object.fromEntries(tileRenders)).toEqual({ "아이콘 하나": 1, "아이콘 둘": 1 });
    expect(countFor("window-a", "/ui/children/0")).toBe(0);
    expect(countFor("window-a", "/ui/children/2")).toBe(0);
    expect(countFor("window-b")).toBe(0);
    tileRenders.clear();
    await act(async () => transport.emit({ event: "data.update", window_id: "window-a", view: { sources: {}, values: {
      "/ui/children/1/items": { status: "ready", value: [...rows, { key: "d", title: "아이콘 넷" }] },
    } } }));
    await settleRenders();
    for (const row of rows) expect(tileRenders.get(row.title) ?? 0).toBeLessThanOrEqual(1);
    expect(tileRenders.get("아이콘 넷")).toBe(1);
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

  it("자동 격자 칸 폭을 바꿔도 같은 창의 다른 블록은 다시 그리지 않는다", async () => {
    mockVirtualLayout();
    let width = 327.5;
    const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { callback: ResizeObserverCallback; targets: Set<Element> };
      constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: new Set() }; observers.push(this.entry); }
      observe(target: Element) { this.entry.targets.add(target); }
      disconnect() { this.entry.targets.clear(); }
      unobserve(target: Element) { this.entry.targets.delete(target); }
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    const rows = [{ id: "one" }, { id: "two" }];
    const repeat: AppDefinition = {
      id: "repeat-grid-render-isolation", name: "격자 렌더 격리", requires: { blocks: 20, modules: {} }, permissions: [],
      state: { rows }, ui: { type: "stack", direction: "column", children: [
        { type: "repeat", key: "id", items: { state: "rows" }, layout: "grid", grid: { columns: "auto", item_width: "small" },
          template: { type: "text", value: { item: "id" } } },
        { type: "text", value: "고정 블록" },
      ] },
    };
    const { store } = await setup([repeat], { rows });
    const grid = document.querySelector<HTMLElement>('[data-window-id="window-a"] .ks-repeat')!;
    grid.style.setProperty("--ks-repeat-grid-item-width-small", "128px");
    grid.style.setProperty("--ks-space-3", "12px");
    grid.style.padding = "0px";
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("ks-repeat-grid-width-probe")) return originalRect.call(this);
      const parent = this.parentElement!;
      const widthVariable = this.style.width.match(/var\((--[^)]+)\)/)?.[1];
      const gapValue = this.style.marginInlineEnd;
      const gapVariable = gapValue.match(/var\((--[^)]+)\)/)?.[1];
      const width = Number.parseFloat(parent.style.getPropertyValue(widthVariable ?? ""));
      const gap = Number.parseFloat(gapVariable ? parent.style.getPropertyValue(gapVariable) : gapValue);
      if (Number.isFinite(gap)) this.style.marginInlineEnd = `${gap}px`;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON() {} } as DOMRect;
    });
    const fixedBlocks = screen.getAllByText("고정 블록");
    expect(fixedBlocks).toHaveLength(2);
    const resize = async (next: number) => {
      width = next;
      await act(async () => {
        observers.filter(({ targets }) => targets.has(grid)).forEach(({ callback }) => callback([], {} as ResizeObserver));
      });
    };
    await resize(327.5);
    expect(grid.querySelector<HTMLElement>(".ks-repeat-content")?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    calls.length = 0;
    await resize(900);
    await waitFor(() => expect(grid.querySelector<HTMLElement>(".ks-repeat-content")?.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))"));
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    expect(screen.getAllByText("고정 블록")).toEqual(fixedBlocks);
    store.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("가상 반복에서 preview 단추 행이 돌아오면 해당 캔버스 표면을 다시 붙인다", async () => {
    mockVirtualLayout();
    const rows = Array.from({ length: 80 }, (_, index) => ({ id: String(index), surface: `preview-${index}`, label: `견본 ${index}` }));
    const definition: AppDefinition = {
      id: "virtual-preview-isolation", name: "반복 카드 격리",
      requires: { blocks: 19, modules: { assets: 1, client: 1 } }, permissions: [], state: { rows }, assets: [{ id: "script", version: 1 }],
      client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] },
      ui: { type: "repeat", key: "id", items: { state: "rows" }, virtual: true, template: {
        type: "button", label: { item: "label" }, preview: { type: "canvas", surface: { item: "surface" }, aspect_ratio: 1 }, on_click: [],
      } },
    };
    const snapshot = makeTestSnapshot({ definitions: [definition] });
    snapshot.shared.windows[0].id = "window-preview";
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
    const row = await waitFor(() => {
      const found = document.querySelector('[data-testid="app-window-virtual-preview-isolation"] [data-repeat-key="0"] .ks-data-button-card');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const scroll = document.querySelector<HTMLElement>('[data-testid="app-window-virtual-preview-isolation"] .ks-repeat')!;
    const firstCanvas = row.querySelector(".ks-canvas");
    const messages = () => vi.mocked(ClientRuntime.prototype.surface).mock.calls.map(([message]) => message).filter((message) => message.id === "preview-0");
    scroll.scrollTop = 1600;
    fireEvent.scroll(scroll);
    await waitFor(() => expect(scroll.querySelector('[data-repeat-key="0"]')).toBeNull());
    await waitFor(() => expect(messages().some((message) => message.phase === "detach")).toBe(true));
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
    const nextCanvas = await waitFor(() => {
      const found = scroll.querySelector<HTMLElement>('[data-repeat-key="0"] .ks-canvas');
      expect(found).not.toBeNull();
      return found;
    });
    expect(nextCanvas).not.toBe(firstCanvas);
    expect(messages().filter((message) => message.phase === "attach").length).toBeGreaterThan(1);
    view.unmount();
    store.dispose();
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  });

  it("자동 열 수가 바뀌어도 미리보기 캔버스가 유지되고 크기를 다시 알린다", async () => {
    mockVirtualLayout();
    let width = 900;
    const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      entry: { callback: ResizeObserverCallback; targets: Set<Element> };
      constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: new Set() }; observers.push(this.entry); }
      observe(target: Element) { this.entry.targets.add(target); }
      disconnect() { this.entry.targets.clear(); }
      unobserve(target: Element) { this.entry.targets.delete(target); }
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("ks-repeat-grid-width-probe")) {
        const parent = this.parentElement!;
        const widthVariable = this.style.width.match(/var\((--[^)]+)\)/)?.[1];
        const gapVariable = this.style.marginInlineEnd.match(/var\((--[^)]+)\)/)?.[1];
        const pane = Number.parseFloat(parent.style.getPropertyValue(widthVariable ?? ""));
        const gap = Number.parseFloat(parent.style.getPropertyValue(gapVariable ?? ""));
        if (Number.isFinite(gap)) this.style.marginInlineEnd = `${gap}px`;
        return { x: 0, y: 0, top: 0, left: 0, right: pane, bottom: 0, width: pane, height: 0, toJSON() {} } as DOMRect;
      }
      return { ...originalRect.call(this), width, height: width / 2 } as DOMRect;
    });
    const rows = [{ id: "a", surface: "preview-a" }, { id: "b", surface: "preview-b" }];
    const definition: AppDefinition = {
      id: "auto-preview-isolation", name: "자동 열 미리보기", requires: { blocks: 19, modules: { assets: 1, client: 1 } },
      permissions: [], state: { rows }, assets: [{ id: "script", version: 1 }],
      client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] },
      ui: { type: "repeat", key: "id", items: { state: "rows" }, layout: "grid", grid: { columns: "auto" }, template: {
        type: "button", label: { item: "id" }, preview: { type: "canvas", surface: { item: "surface" }, aspect_ratio: 2 }, on_click: [],
      } },
    };
    const snapshot = makeTestSnapshot({ definitions: [definition] });
    snapshot.shared.windows[0].id = "window-auto-preview";
    snapshot.shared.windows[0].state = { rows };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const call = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "data.media"
      ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
      : call(request));
    const messages = vi.spyOn(ClientRuntime.prototype, "surface");
    const originalTransfer = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "transferControlToOffscreen");
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
    const store = createShellStore(transport);
    const view = render(<Shell store={store} />);
    await store.ready;
    const grid = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-testid="app-window-auto-preview-isolation"] .ks-repeat');
      expect(found?.querySelectorAll(".ks-canvas")).toHaveLength(2);
      return found!;
    });
    grid.style.setProperty("--ks-repeat-grid-item-width-medium", "160px");
    grid.style.setProperty("--ks-space-3", "12px");
    grid.style.padding = "0px";
    const resize = async (next: number) => {
      width = next;
      await act(async () => { observers.filter(({ targets }) => [...targets].some((target) => target === grid || target.classList.contains("ks-canvas"))).forEach(({ callback }) => callback([], {} as ResizeObserver)); });
    };
    await resize(900);
    const before = [...grid.querySelectorAll(".ks-canvas")];
    await resize(340);
    expect(grid.querySelector<HTMLElement>(".ks-repeat-content")?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect([...grid.querySelectorAll(".ks-canvas")]).toEqual(before);
    expect(messages.mock.calls.some(([message]) => message.id === "preview-a" && message.phase === "resize" && message.css_width === 340)).toBe(true);
    await resize(900);
    expect([...grid.querySelectorAll(".ks-canvas")]).toEqual(before);
    view.unmount(); store.dispose();
    if (originalTransfer) Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", originalTransfer);
    else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("숨긴 이름표 슬라이더의 값 변화는 다른 창과 형제를 다시 그리지 않는다", async () => {
    const app: AppDefinition = {
      id: "field-isolation", name: "입력 격리", requires: { blocks: 21, modules: {} }, permissions: [],
      state: { value: 20, other: "고정" },
      ui: { type: "stack", direction: "column", children: [
        { type: "slider", label: "밝기", label_position: "hidden", show_value: false, value: { state: "value" }, on_change: { set_state: "value" }, min: 0, max: 100 },
        { type: "text", value: { state: "other" } },
      ] },
    };
    const { store } = await setup([app], { value: 20, other: "고정" });
    await waitFor(() => expect(screen.getAllByRole("slider", { name: "밝기" })).toHaveLength(2));
    calls.length = 0;
    await setState(store, "window-a", "value", 45);
    await settleRenders();
    expect(countFor("window-b")).toBe(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    store.dispose();
  });

  it("숫자 스핀 값 변화는 다른 창과 형제를 다시 그리지 않는다", async () => {
    const app: AppDefinition = {
      id: "spin-isolation", name: "숫자 입력 격리", requires: { blocks: 31, modules: {} }, permissions: [],
      state: { value: 2, other: "고정" },
      ui: { type: "stack", direction: "column", children: [
        { type: "input", kind: "number", spin: true, label: "수량", value: { state: "value" }, on_change: { set_state: "value" } },
        { type: "text", value: { state: "other" } },
      ] },
    };
    const { store } = await setup([app], { value: 2, other: "고정" });
    await waitFor(() => expect(screen.getAllByRole("spinbutton", { name: "수량" })).toHaveLength(2));
    calls.length = 0;
    await setState(store, "window-a", "value", 3);
    await settleRenders();
    expect(countFor("window-b")).toBe(0);
    expect(countFor("window-a", "/ui/children/1")).toBe(0);
    store.dispose();
  });

  it("창 정보 알림 표시와 소멸은 형제 내용과 다른 창을 다시 그리지 않는다", async () => {
    const snapshot = testSnapshot([definition]);
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    await store.ready;
    const windows = snapshot.shared.windows;
    let firstData: WindowData | undefined;
    const firstRender = vi.fn();
    const secondRender = vi.fn();
    function Probe() { firstData = useWindowData(); return null; }
    function Body({ track }: { track: () => void }) { track(); return <div>창 내용</div>; }
    render(<>
      <WindowDataProvider store={store} windowId={windows[0].id} definition={definition}><Probe /><WindowNotice /><Body track={firstRender} /></WindowDataProvider>
      <WindowDataProvider store={store} windowId={windows[1].id} definition={definition}><WindowNotice /><Body track={secondRender} /></WindowDataProvider>
    </>);
    const firstCount = firstRender.mock.calls.length;
    const secondCount = secondRender.mock.calls.length;
    vi.useFakeTimers();
    act(() => { firstData!.setStatus("완료했습니다"); });
    expect(screen.getByRole("status").textContent).toContain("완료했습니다");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(firstRender).toHaveBeenCalledTimes(firstCount);
    expect(secondRender).toHaveBeenCalledTimes(secondCount);
    vi.useRealTimers();
    store.dispose();
  });

  it("날짜 시간축 스크롤은 다른 창을 다시 그리거나 코어를 부르지 않는다", async () => {
    const timeline = { type: "timeline" as const, scale: "dates" as const, today: false,
      tracks: [{ id: "track", items: [{ id: "item", label: "구간", start: "2026-11-01", end: "2026-11-07" }] }] };
    const app: AppDefinition = { id: "dates-isolation", name: "날짜 격리", requires: { blocks: 34, modules: {} },
      permissions: [], state: {}, ui: timeline };
    const snapshot = testSnapshot([app], {});
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    await store.ready;
    const otherWindowRender = vi.fn(), timelineRender = vi.fn();
    const first = snapshot.shared.windows[0], second = snapshot.shared.windows[1];
    const context = { store, window: first, definition: app };
    function OtherWindow() { otherWindowRender(); return <span>다른 창</span>; }
    const view = render(<>
      <WindowDataProvider store={store} windowId={first.id} definition={app}>
        <Profiler id="dates" onRender={timelineRender}><TimelineBlock block={timeline} pointer="/ui" context={context} /></Profiler>
      </WindowDataProvider>
      <WindowDataProvider store={store} windowId={second.id} definition={app}><OtherWindow /></WindowDataProvider>
    </>);
    const scroll = view.container.querySelector(".ks-dates-scroll") as HTMLElement;
    expect(scroll).not.toBeNull();
    await settleRenders();
    const beforeOther = otherWindowRender.mock.calls.length, beforeTimeline = timelineRender.mock.calls.length;
    const beforeCalls = transport.getCalls().length;
    scroll.scrollTop = 50; fireEvent.scroll(scroll);
    await settleRenders();
    expect(timelineRender.mock.calls.length).toBeGreaterThan(beforeTimeline);
    expect(otherWindowRender).toHaveBeenCalledTimes(beforeOther);
    expect(transport.getCalls().slice(beforeCalls)).toEqual([]);
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

  it("선택지가 없는 입력은 창을 최소화하고 복원해도 다시 그리지 않는다", async () => {
    const plainInput: AppDefinition = { ...definition, state: { first: "내용" }, ui: { type: "input", value: { state: "first" }, on_change: { set_state: "first" } } };
    const { store } = await setup([plainInput], { first: "내용" });
    await store.call({ op: "window.minimize", window_id: "window-a" });
    await store.call({ op: "window.raise", window_id: "window-a" });
    await settleRenders();
    expect(countFor("window-a", "/ui")).toBe(0);
    store.dispose();
  });

  it("선택지 입력을 연 창을 최소화하면 팝업을 닫는다", async () => {
    const optionsInput: AppDefinition = { ...definition, requires: { blocks: 33, modules: {} }, state: { first: "a" }, ui: { type: "input", value: { state: "first" }, on_change: { set_state: "first" }, options: ["a", "b"] } };
    const { store } = await setup([optionsInput], { first: "a" });
    const root = document.querySelector<HTMLElement>('[data-window-id="window-a"]')!;
    fireEvent.focus(within(root).getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    await act(async () => { await store.call({ op: "window.minimize", window_id: "window-a" }); });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
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
  it("같은 계정 설정은 참조를 유지하고 바뀐 설정은 교체한다", () => {
    const previous = testSnapshot();
    previous.shared.preferences = { revision: 1, default_message_app_id: "agent", asked_message_app_ids: ["explorer"] };
    const next = structuredClone(previous);
    expect(shareShellSnapshot(previous, next).shared.preferences).toBe(previous.shared.preferences);
    next.shared.preferences!.revision = 2;
    expect(shareShellSnapshot(previous, next).shared.preferences).not.toBe(previous.shared.preferences);
  });

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

describe("표 칸 렌더 격리", () => {
  it("선택 이동은 이전 칸과 새 칸 및 두 행만 그리고 다른 창은 그리지 않는다", async () => {
    mockVirtualLayout();
    const { GridCell, GridRow } = await import("../blocks/data-table-grid");
    const cellSpy = vi.spyOn(GridCell as unknown as { type: (...args: never[]) => unknown }, "type");
    const rowSpy = vi.spyOn(GridRow as unknown as { type: (...args: never[]) => unknown }, "type");
    const app: AppDefinition = {
      id: "grid-selection-isolation", name: "선택 격리", requires: { blocks: 24, modules: {} }, permissions: [],
      state: { chosen: { row: "a", column: "mon" } },
      ui: { type: "table", rows: [
        { key: "a", label: "기획", mon: "회의", tue: "초안" },
        { key: "b", label: "제작", mon: "검토", tue: "완료" },
        { key: "c", label: "배포", mon: "준비", tue: "공개" },
      ], columns: [{ field: "label", label: "항목" }, { field: "mon", label: "월요일" }, { field: "tue", label: "화요일" }],
      selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } },
    };
    const snapshot = testSnapshot([app], app.state);
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    await store.ready;
    render(<>{snapshot.shared.windows.map((window) => <div key={window.id} data-testid={window.id}>
      <AppWindowContent store={store} windowId={window.id} />
    </div>)}</>);
    await waitFor(() => expect(screen.getAllByRole("gridcell")).toHaveLength(12));
    await settleRenders();
    rowSpy.mockClear(); cellSpy.mockClear();
    await act(async () => { await setState(store, "window-a", "chosen", { row: "b", column: "tue" }); });
    await settleRenders();
    expect(rowSpy).toHaveBeenCalledTimes(2);
    expect(cellSpy).toHaveBeenCalledTimes(2);
    expect(rowSpy.mock.calls.map(([props]) => (props as { row: { key: string } }).row.key)).toEqual(["a", "b"]);
    expect(cellSpy.mock.calls.map(([props]) => { const cell = props as { rowKey: string; column: { field: string } }; return `${cell.rowKey}/${cell.column.field}`; })).toEqual(["a/mon", "b/tue"]);
    expect(within(screen.getByTestId("window-b")).getByRole("gridcell", { name: "기획, 월요일, 회의" }).getAttribute("aria-selected")).toBe("true");
    cellSpy.mockRestore(); rowSpy.mockRestore(); store.dispose();
  });

  it("client가 새 행렬 전체를 발행해도 바뀐 행과 칸만 그린다", async () => {
    mockVirtualLayout();
    const { GridCell, GridRow } = await import("../blocks/data-table-grid");
    const cellSpy = vi.spyOn(GridCell as unknown as { type: (...args: never[]) => unknown }, "type");
    const rowSpy = vi.spyOn(GridRow as unknown as { type: (...args: never[]) => unknown }, "type");
    const rows = [
      { key: "a", label: "기획", mon: { title: "첫 회의" }, tue: { title: "초안" } },
      { key: "b", label: "제작", mon: { title: "검토" }, tue: { title: "완료" } },
    ];
    const columns: JsonValue[] = [{ field: "label", label: "항목" }, { field: "mon", label: "월요일", format: "content" }, { field: "tue", label: "화요일", format: "content" }];
    const app: AppDefinition = {
      id: "grid-isolation", name: "일정", requires: { blocks: 24, modules: { assets: 1, client: 1 } }, permissions: [], state: { chosen: null },
      assets: [{ id: "grid-runtime", version: 1 }],
      client: { runtime: "javascript", entry: { id: "grid-runtime", version: 1 }, inputs: {}, outputs: { rows: { default: rows }, columns: { default: columns } }, actions: [], commands: {}, state_keys: [], storage_entries: [] },
      ui: { type: "table", rows: { client: "rows" }, columns: { client: "columns" }, selection: "cell", row_header: "label", selected: { state: "chosen" }, on_select: { set_state: "chosen" } },
    };
    const snapshot = testSnapshot([app], { chosen: null });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    await store.ready;
    const first = snapshot.shared.windows[0];
    const context: BlockContext = { store, window: { id: first.id, app_id: first.app_id, app_version: first.app_version, desktop_id: first.desktop_id }, definition: app };
    let data: WindowData | null = null;
    function Capture() { const value = useWindowData(); useEffect(() => { data = value; }, [value]); return null; }
    render(<WindowDataProvider store={store} windowId={first.id} definition={app}><Capture />{renderBlockModule.renderBlock(app.ui, context)}</WindowDataProvider>);
    await screen.findByText("첫 회의");
    await settleRenders();
    rowSpy.mockClear(); cellSpy.mockClear();
    const next = structuredClone(rows);
    next[0].mon.title = "길게 바뀐 회의 내용";
    await act(async () => { data!.publishClient({ rows: next, columns: structuredClone(columns) }); });
    await screen.findByText("길게 바뀐 회의 내용");
    await settleRenders();
    expect(rowSpy).toHaveBeenCalledTimes(1);
    expect(cellSpy).toHaveBeenCalledTimes(1);
    cellSpy.mockRestore(); rowSpy.mockRestore(); store.dispose();
  });
});

it("기본 메시지 앱 구독은 창 상태 변경으로 다시 그리지 않는다", async () => {
  const receiver = { ...definition, id: "receiver", name: "받는 앱", agent: {} } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition, receiver] });
  seed.snapshot.shared.windows[0].id = "window-a";
  seed.snapshot.shared.preferences = { revision: 1, default_message_app_id: receiver.id, asked_message_app_ids: [] };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  await store.ready;
  let renders = 0;
  function Probe() { renders++; const app = useDefaultMessageApp(store); return <span>{app?.name}</span>; }
  render(<Probe />);
  expect(screen.getByText("받는 앱")).toBeTruthy();
  const before = renders;
  await act(async () => { await store.call({ op: "window.set_state", window_id: "window-a", state: { first: "변경", second: null, compound: null } }); });
  expect(renders).toBe(before);
  store.dispose();
});
