import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { registerSandboxFlush, flushSandboxes } from "../blocks/sandbox-flush";
import type { AppDefinition, Block, CoreRequest, ShellSnapshot } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore, type ShellStore } from "../core/shell-store";
import { WindowData } from "../data/window-data";
import { patchWindowState } from "../data/window-state";
import { ClientRuntime } from "../runtime/client-runtime";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
}

const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  document.querySelector(".ks-client-frames")?.remove();
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

function memoDefinition(id: string, name: string): AppDefinition {
  return {
    ...mdEditorDefinition,
    id,
    name,
    permissions: [],
    state: { query: null, current_file: null },
    ui: {
      type: "stack",
      direction: "column",
      children: [{ type: "input", value: { state: "query" }, on_change: { set_state: "query" } }],
    } as unknown as Block,
  };
}

type Mode = "ok" | "delay" | "fail";

async function setup(options: { act?: Mode; patch?: Mode } = {}) {
  const seed = makeTestSeed({ definitions: [memoDefinition("md-editor", "메모"), memoDefinition("md-viewer", "보기")] });
  seed.snapshot.shared.windows[0].state = { query: "처음" };
  seed.snapshot.shared.windows[1].state = { query: "처음" };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const calls: CoreRequest[] = [];
  let releaseAct!: () => void;
  const actGate = new Promise<void>((resolve) => { releaseAct = resolve; });
  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  let actStarted = false;
  let patchStarted = false;
  let orderAtClose: string[] = [];
  let actsAtClose: Array<string | undefined> = [];
  const store = createShellStore(transport);
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    calls.push(request as CoreRequest);
    if (request.op === "data.act") {
      actStarted = true;
      if (options.act === "delay") await actGate;
      if (options.act === "fail") throw { code: "server", message: "저장에 실패했습니다", details: [] };
    }
    if (request.op === "window.patch_state") {
      patchStarted = true;
      if (options.patch === "delay") await patchGate;
      if (options.patch === "fail") throw { code: "conflict", message: "다른 곳에서 바뀌었습니다", details: [] };
    }
    if (request.op === "window.close" || request.op === "desktop.delete" || request.op === "workspace.delete") {
      orderAtClose = calls.filter((call) => call.op === "data.act" || call.op === "window.patch_state" || call.op === "window.close").map((call) => call.op);
      actsAtClose = calls.filter((call) => call.op === "data.act").map((call) => call.window_id);
      const snapshot = structuredClone(store.getSnapshot()!);
      const desktopIds = request.op === "workspace.delete"
        ? snapshot.shared.desktops.filter((desktop) => desktop.workspace_id === request.workspace_id).map((desktop) => desktop.id)
        : request.op === "desktop.delete" ? [request.desktop_id] : [];
      snapshot.shared.windows = snapshot.shared.windows.filter((window) => request.op === "window.close" ? window.id !== request.window_id : !desktopIds.includes(window.desktop_id));
      transport.emit({ event: "state.changed", snapshot });
      return { op: request.op } as never;
    }
    return original(request as never) as never;
  });
  disposers.push(() => store.dispose());
  render(<Shell store={store} />);
  await store.ready;
  return {
    store,
    calls,
    releaseAct: () => releaseAct(),
    releasePatch: () => releasePatch(),
    actStarted: () => actStarted,
    patchStarted: () => patchStarted,
    orderAtClose: () => orderAtClose,
    actsAtClose: () => actsAtClose,
  };
}

function closeEditorWindow() {
  const editor = screen.getByTestId("app-window-md-editor");
  fireEvent.click(within(editor).getByRole("button", { name: "창 닫기" }));
  return editor;
}

function editorInput(): HTMLInputElement {
  return within(screen.getByTestId("app-window-md-editor")).getByRole("textbox") as HTMLInputElement;
}

function viewerInput(): HTMLInputElement {
  return within(screen.getByTestId("app-window-md-viewer")).getByRole("textbox") as HTMLInputElement;
}

it("창 상태 입력을 코어에 보낸 뒤에 창을 닫는다", async () => {
  const { calls, orderAtClose } = await setup();
  fireEvent.change(editorInput(), { target: { value: "새 글" } });
  closeEditorWindow();
  await waitFor(() => expect(orderAtClose()).toContain("window.close"));
  expect(orderAtClose()).toEqual(["data.act", "window.close"]);
  expect(calls.filter((call) => call.op === "data.act")).toHaveLength(1);
});

it("입력 쓰기의 응답 전에는 창을 닫지 않는다", async () => {
  const { calls, actStarted, releaseAct } = await setup({ act: "delay" });
  fireEvent.change(editorInput(), { target: { value: "새 글" } });
  closeEditorWindow();
  await waitFor(() => expect(actStarted()).toBe(true));
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  releaseAct();
  await waitFor(() => expect(calls.some((call) => call.op === "window.close")).toBe(true));
});

it("입력 쓰기가 실패하면 창을 닫지 않고 초안과 화면을 남긴다", async () => {
  const { calls } = await setup({ act: "fail" });
  fireEvent.change(editorInput(), { target: { value: "새 글" } });
  closeEditorWindow();
  await screen.findByText("저장하지 못한 내용이 있어 창을 닫지 않았습니다. 내용을 저장한 뒤 다시 닫으세요.");
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  expect(editorInput().value).toBe("새 글");
});

it("flush가 남긴 창 상태 쓰기의 응답 전에는 창을 닫지 않는다", async () => {
  const { store, calls, patchStarted, releasePatch } = await setup({ patch: "delay" });
  disposers.push(registerSandboxFlush("editor-window", async () => {
    void patchWindowState({ store, window: { id: "editor-window" } }, { query: "탭" }).catch(() => undefined);
    return true;
  }));
  closeEditorWindow();
  await waitFor(() => expect(patchStarted()).toBe(true));
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  releasePatch();
  await waitFor(() => expect(calls.some((call) => call.op === "window.close")).toBe(true));
});

it("flush가 남긴 창 상태 쓰기가 거절되면 창을 닫지 않는다", async () => {
  const { store, calls } = await setup({ patch: "fail" });
  disposers.push(registerSandboxFlush("editor-window", async () => {
    void patchWindowState({ store, window: { id: "editor-window" } }, { query: "탭" }).catch(() => undefined);
    return true;
  }));
  closeEditorWindow();
  await screen.findByText("저장하지 못한 내용이 있어 창을 닫지 않았습니다. 내용을 저장한 뒤 다시 닫으세요.");
  expect(calls.some((call) => call.op === "window.close")).toBe(false);
  expect(screen.getByTestId("app-window-md-editor")).toBeTruthy();
});

it("닫는 창의 입력만 보낸다", async () => {
  const { actsAtClose, orderAtClose } = await setup();
  fireEvent.change(editorInput(), { target: { value: "편집 창 글" } });
  fireEvent.change(viewerInput(), { target: { value: "보기 창 글" } });
  closeEditorWindow();
  await waitFor(() => expect(orderAtClose()).toContain("window.close"));
  expect(actsAtClose()).toEqual(["editor-window"]);
});

function clientSnapshot(): ShellSnapshot {
  return {
    device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" } },
    shared: {
      windows: [{ id: "window-1", desktop_id: "desktop-1", minimized: false, state: {} }],
      desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }],
    },
  } as unknown as ShellSnapshot;
}

const TOKEN = "00000000-0000-4000-8000-000000000000";

it("클라이언트 다시 시작의 flush가 실패하면 이전 런타임과 iframe을 남긴다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(TOKEN);
  const store = {
    getSnapshot: () => clientSnapshot(),
    subscribe: () => () => undefined,
    subscribeEvents: () => () => undefined,
    call: vi.fn(async (request: { op: string }) => request.op === "data.media"
      ? { op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } }
      : request.op === "data.attach" ? { op: "data.attach", view: { sources: {}, values: {} } } : { op: request.op }),
    nativeFiles: false,
    dispose: () => undefined,
    ready: Promise.resolve(),
    reached: () => null,
    getInstallConsent: () => undefined,
    subscribeInstallConsent: () => () => undefined,
  } as unknown as ShellStore;
  const definition = {
    id: "widget", name: "위젯", requires: { blocks: 1, modules: {} }, permissions: [], state: {},
    ui: { type: "stack", direction: "column", children: [] },
    client: { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {}, outputs: {} },
    assets: [],
  } as unknown as AppDefinition;
  const data = new WindowData(store, "window-1", definition);
  const unmount = data.mount();
  await (data as unknown as { ready: Promise<void> }).ready;
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  const frame = document.querySelector("iframe")!;
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: { type?: string; requestId?: string }) => {
    if (message?.type === "ks-sandbox-flush") {
      queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: TOKEN, type: "ks-sandbox-flushed", requestId: message.requestId, ok: false } })));
    }
  });
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: TOKEN, type: "ks-sandbox-ready" } }));
  const stop = vi.spyOn(ClientRuntime.prototype, "stop");
  await data.restartClient();
  expect(stop).not.toHaveBeenCalled();
  expect(document.querySelector("iframe")).toBe(frame);
  expect(data.getNotice() ?? "").toContain("다시 시작하지 않았습니다");
  unmount();
});

it("클라이언트 저장 쓰기의 응답 전에는 flush가 끝나지 않는다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(TOKEN);
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((_resolve, reject) => { releaseWrite = () => reject({ code: "io", message: "저장 실패", details: [] }); });
  const store = {
    getSnapshot: () => clientSnapshot(),
    subscribe: () => () => undefined,
    subscribeEvents: () => () => undefined,
    call: vi.fn(async (request: { op: string }) => {
      if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } };
      if (request.op === "storage.get") return { op: "storage.get", result: { content: "원본", revision: "r1" } };
      if (request.op === "storage.write") await writeGate;
      return { op: request.op };
    }),
    nativeFiles: false,
  } as unknown as ShellStore;
  const data = { windowId: "window-1", failClient: vi.fn(), setNotice: vi.fn() } as unknown as WindowData;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: ["docs"], inputs: {}, actions: [], commands: {} };
  const runtime = new ClientRuntime(store, data, { assets: [], permissions: [] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: { type?: string; requestId?: string }) => {
    if (message?.type === "ks-sandbox-flush") {
      window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: TOKEN, type: "ks-sandbox-flushed", requestId: message.requestId, ok: true } }));
    }
  });
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: TOKEN, type: "ks-sandbox-ready" } }));
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: TOKEN, type: "ks-sandbox-storage-set", requestId: "s1", entry: "docs", content: "새 값" } }));
  await waitFor(() => expect(store.call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write" })));
  const flushing = flushSandboxes("window-1");
  let outcome: boolean | undefined;
  void flushing.then((value) => { outcome = value; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(outcome).toBeUndefined();
  releaseWrite();
  expect(await flushing).toBe(false);
  await runtime.stop();
});
