import { afterEach, describe, expect, it, vi } from "vitest";
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
  post.mockClear();
  bounds.mockReturnValue({ width: 500, height: 350 } as DOMRect);
  resized(); resized(); resized();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(post.mock.calls.filter(([message]) => message.type === "ks-client-lifecycle")).toHaveLength(1);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: expect.objectContaining({ viewport: expect.objectContaining({ width: 500, height: 350 }) }) }), "*");
  current = snapshot(false); listeners.forEach((listener) => listener());
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-lifecycle", lifecycle: expect.objectContaining({ phase: "change", visible: false }) }), "*");
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
