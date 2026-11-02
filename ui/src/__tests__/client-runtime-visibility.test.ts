import { afterEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import type { AppDefinition, ShellSnapshot } from "../contract/contract";
import { CLIENT_PING_TIMEOUT_SECS } from "../contract/limits";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { flushSandboxes } from "../blocks/sandbox-flush";
import { ClientRuntime } from "../runtime/client-runtime";

function snapshot(active: boolean): ShellSnapshot {
  return {
    device: { active_workspace_id: active ? "workspace-1" : null, active_desktop_ids: { "workspace-1": "desktop-1" } },
    shared: {
      windows: [{ id: "window-1", desktop_id: "desktop-1", minimized: false, state: {} }],
      desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }],
    },
  } as unknown as ShellSnapshot;
}

describe("client runtime visibility ping", () => {
  afterEach(() => {
    document.querySelector(".ks-client-frames")?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pauses pings while hidden and resets the response deadline on resume", async () => {
    vi.useFakeTimers();
    const intervals = vi.spyOn(globalThis, "setInterval");
    const clears = vi.spyOn(globalThis, "clearInterval");
    let current = snapshot(false);
    const listeners = new Set<() => void>();
    const store = {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      subscribeEvents: () => () => undefined,
      call: vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } })),
      nativeFiles: false,
    } as unknown as ShellStore;
    const failClient = vi.fn();
    const data = { windowId: "window-1", failClient } as unknown as WindowData;
    const definition = { assets: [] } as unknown as AppDefinition;
    const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {} };
    const runtime = new ClientRuntime(store, data, definition, client as never);

    await runtime.start();
    expect(intervals).not.toHaveBeenCalled();

    current = snapshot(true);
    listeners.forEach((listener) => listener());
    expect(intervals).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CLIENT_PING_TIMEOUT_SECS * 500);

    current = snapshot(false);
    listeners.forEach((listener) => listener());
    expect(clears).toHaveBeenCalledWith(intervals.mock.results[0]?.value);
    await vi.advanceTimersByTimeAsync(CLIENT_PING_TIMEOUT_SECS * 4000);
    expect(failClient).not.toHaveBeenCalled();

    current = snapshot(true);
    listeners.forEach((listener) => listener());
    expect(intervals).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CLIENT_PING_TIMEOUT_SECS * 500);
    expect(failClient).not.toHaveBeenCalled();

    await runtime.stop();
    expect(clears).toHaveBeenCalledWith(intervals.mock.results[1]?.value);
  });
});

it("클라이언트에 내용 크기와 가시성, 종료를 전달한다", async () => {
  let current = snapshot(true);
  const listeners = new Set<() => void>();
  const store = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvents: () => () => undefined,
    call: vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } })),
    nativeFiles: false,
  } as unknown as ShellStore;
  const host = document.createElement("div"); document.body.append(host);
  const bounds = vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ width: 400, height: 300 } as DOMRect);
  const data = { windowId: "window-1", failClient: vi.fn(), clientHost: host, clientDormant: false } as unknown as WindowData;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {} };
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  let resized = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  const runtime = new ClientRuntime(store, data, { assets: [] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: "00000000-0000-4000-8000-000000000000", type: "ks-sandbox-ready" } }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-lifecycle", lifecycle: expect.objectContaining({ phase: "ready", visible: true, viewport: expect.objectContaining({ width: 400, height: 300 }) }) }), "*");
  runtime.surface({ phase: "attach", id: "tile", generation: 1, canvas: {} as OffscreenCanvas, css_width: 100, css_height: 100, dpr: 1, visible: true });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-surface", phase: "attach", id: "tile", visible: true }), "*", expect.any(Array));
  post.mockClear();
  bounds.mockReturnValue({ width: 500, height: 350 } as DOMRect);
  resized(); resized(); resized();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(post.mock.calls.filter(([message]) => message.type === "ks-client-lifecycle")).toHaveLength(1);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: expect.objectContaining({ viewport: expect.objectContaining({ width: 500, height: 350 }) }) }), "*");
  current = snapshot(false); listeners.forEach((listener) => listener());
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-lifecycle", lifecycle: expect.objectContaining({ phase: "change", visible: false }) }), "*");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-surface", phase: "visibility", id: "tile", visible: false }), "*");
  current = snapshot(true); listeners.forEach((listener) => listener());
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-surface", phase: "visibility", id: "tile", visible: true }), "*");
  post.mockClear();
  runtime.surface({ phase: "attach", id: "tile", generation: 2, canvas: {} as OffscreenCanvas, css_width: 120, css_height: 80, dpr: 1, visible: true });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-surface", phase: "attach", id: "tile", generation: 2 }), "*", expect.any(Array));
  post.mockClear();
  runtime.surface({ phase: "detach", id: "tile", generation: 1 });
  expect(post).not.toHaveBeenCalled();
  runtime.surface({ phase: "detach", id: "tile", generation: 2 });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-surface", phase: "detach", id: "tile", generation: 2 }), "*");
  post.mockClear();
  const beforeClose = flushSandboxes("window-1");
  expect(post.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ type: "ks-client-lifecycle", lifecycle: expect.objectContaining({ phase: "closing" }) }));
  expect(post.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ type: "ks-sandbox-flush" }));
  const flushed = () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: "00000000-0000-4000-8000-000000000000", type: "ks-sandbox-flushed", requestId: "00000000-0000-4000-8000-000000000000", ok: true } }));
  flushed();
  expect(await beforeClose).toBe(true);
  const stop = runtime.stop();
  flushed();
  await stop;
  host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("client runtime host services", () => {
  let originalWindowNavigator: PropertyDescriptor | undefined;

  afterEach(() => {
    document.querySelector(".ks-client-frames")?.remove();
    if (originalWindowNavigator) Object.defineProperty(window, "navigator", originalWindowNavigator);
    originalWindowNavigator = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const setWindowNavigator = (navigator: Navigator) => {
    originalWindowNavigator ??= Object.getOwnPropertyDescriptor(window, "navigator");
    Object.defineProperty(window, "navigator", { configurable: true, value: navigator });
  };

  const receive = (frame: HTMLIFrameElement, token: string, type: string, extra: object = {}) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type, ...extra },
  }));

  const createRuntime = (options: { capabilities?: string[]; nativeFiles?: boolean; active?: boolean; call?: (request: any) => Promise<any>; bytes?: (request: any, body?: ArrayBuffer) => Promise<ArrayBuffer> }) => {
    let current = snapshot(options.active ?? false);
    const listeners = new Set<() => void>();
    const store = {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      subscribeEvents: () => () => undefined,
      call: vi.fn(options.call ?? (async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } }))),
      bytes: options.bytes,
      nativeFiles: options.nativeFiles ?? false,
    } as unknown as ShellStore;
    const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {}, capabilities: options.capabilities };
    const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), clientDormant: false } as unknown as WindowData, { assets: [] } as unknown as AppDefinition, client as never);
    return { runtime, store, get current() { return current; }, activate() { current = snapshot(true); listeners.forEach((listener) => listener()); }, hide() { current = snapshot(false); listeners.forEach((listener) => listener()); } };
  };

  it("기능 capability가 빠진 앱의 host 요청을 거부한다", async () => {
    const bytes = vi.fn(async () => new ArrayBuffer(0));
    const { runtime } = createRuntime({ bytes });
    await runtime.start();
    const frame = document.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const actualToken = (runtime as any).token;
    receive(frame, actualToken, "ks-client-can-share", { requestId: "1", file_id: "file-1" });
    receive(frame, actualToken, "ks-client-share", { requestId: "2", file_id: "file-1", title: "메모" });
    receive(frame, actualToken, "ks-client-keep-awake", { requestId: "3", enabled: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "1", error: expect.any(String) }), "*");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "2", error: expect.any(String) }), "*");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "3", error: expect.any(String) }), "*");
    expect(bytes).not.toHaveBeenCalled();
    await runtime.stop();
  });

  it("브라우저 API가 없으면 false를 돌려주고, 저장 파일 공유와 종료 시 wake lock 해제를 처리한다", async () => {
    vi.stubGlobal("File", NodeFile);
    const browserNavigator = window.navigator;
    const unsupportedNavigator = Object.create(browserNavigator);
    setWindowNavigator(unsupportedNavigator);
    const unsupported = createRuntime({ capabilities: ["share", "keep_awake"], nativeFiles: true, active: true, bytes: vi.fn(async () => new ArrayBuffer(0)) });
    await unsupported.runtime.start();
    const unsupportedFrame = document.querySelector("iframe")!;
    const unsupportedPost = vi.spyOn(unsupportedFrame.contentWindow!, "postMessage");
    receive(unsupportedFrame, (unsupported.runtime as any).token, "ks-client-can-share", { requestId: "can", file_id: "missing" });
    receive(unsupportedFrame, (unsupported.runtime as any).token, "ks-client-keep-awake", { requestId: "awake", enabled: true });
    await vi.waitFor(() => {
      expect(unsupportedPost).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "can", result: false }), "*");
      expect(unsupportedPost).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "awake", result: false }), "*");
    });
    await unsupported.runtime.stop();

    let released = false;
    const sentinel = { get released() { return released; }, release: vi.fn(async () => { released = true; }), addEventListener: vi.fn() };
    const canShare = vi.fn((_data: any) => true);
    const share = vi.fn(async (_data: any) => { throw new DOMException("취소", "AbortError"); });
    const request = vi.fn(async (_type: string) => sentinel);
    const supportedNavigator = Object.create(browserNavigator);
    Object.assign(supportedNavigator, { canShare, share, wakeLock: { request } });
    setWindowNavigator(supportedNavigator);
    const bytes = vi.fn(async () => new TextEncoder().encode("본문").buffer);
    const call = vi.fn(async (request: any) => request.op === "data.media"
      ? { op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } }
      : { op: "files.save_prompt", file_id: "saved-file" });
    const supported = createRuntime({ capabilities: ["share", "keep_awake"], nativeFiles: true, active: true, call, bytes });
    await supported.runtime.start();
    const frame = document.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const token = (supported.runtime as any).token;
    receive(frame, token, "ks-client-save-prompt", { requestId: "save", suggested_name: "메모.txt", mime: "text/plain" });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "save", result: "saved-file" }), "*"));
    receive(frame, token, "ks-client-can-share", { requestId: "can", file_id: "saved-file" });
    await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "can")).toBe(true));
    expect(bytes).toHaveBeenCalled();
    expect(canShare).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "can", result: true }), "*");
    expect(canShare.mock.calls[0]?.[0].files[0]).toMatchObject({ name: "메모.txt", type: "text/plain" });
    receive(frame, token, "ks-client-share", { requestId: "share", file_id: "saved-file", title: "메모" });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "share", result: { status: "cancelled" } }), "*"));
    expect(share.mock.calls[0]?.[0]).toMatchObject({ title: "메모", files: [expect.objectContaining({ name: "메모.txt" })] });
    receive(frame, token, "ks-client-keep-awake", { requestId: "awake", enabled: true });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "awake", result: true }), "*"));
    const stopping = supported.runtime.stop();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    await stopping;
  });

  it("창이 숨겨지면 화면 켜짐 유지를 해제한다", async () => {
    const browserNavigator = window.navigator;
    let released = false;
    const sentinel = { get released() { return released; }, release: vi.fn(async () => { released = true; }), addEventListener: vi.fn() };
    const request = vi.fn(async (_type: string) => sentinel);
    setWindowNavigator(Object.assign(Object.create(browserNavigator), { wakeLock: { request } }));
    const hidden = createRuntime({ capabilities: ["keep_awake"], nativeFiles: true, active: true });
    await hidden.runtime.start();
    const frame = document.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    receive(frame, (hidden.runtime as any).token, "ks-client-keep-awake", { requestId: "awake", enabled: true });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "awake", result: true }), "*"));
    hidden.hide();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    await hidden.runtime.stop();
  });
});
