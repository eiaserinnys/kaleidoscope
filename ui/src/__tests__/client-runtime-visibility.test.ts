import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, ShellSnapshot } from "../contract/contract";
import { CLIENT_PING_TIMEOUT_SECS } from "../contract/limits";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
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
