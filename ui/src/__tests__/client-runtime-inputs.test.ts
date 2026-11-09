import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, BindingValue, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

afterEach(() => {
  document.querySelector(".ks-client-frames")?.remove();
  vi.restoreAllMocks();
});

it("프레임이 준비되기 전에 원천이 ready가 되어도 준비 뒤 ready 입력을 받는다", async () => {
  const token = "00000000-0000-4000-8000-000000000000";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(token);
  const definition = { id: "app", name: "앱", assets: [] } as unknown as AppDefinition;
  const snapshot = {
    device: { active_workspace_id: null, active_desktop_ids: {}, grants: [] },
    shared: { windows: [{ id: "window-1", app_id: "app", desktop_id: "desktop-1", state: {} }], desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }] },
  } as unknown as ShellSnapshot;
  const store = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    subscribeEvents: () => () => {},
    call: vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } })),
    nativeFiles: false,
  } as unknown as ShellStore;
  let value: BindingValue = { status: "loading" };
  const getValue = vi.fn(() => value);
  const data = { windowId: "window-1", getValue, failClient: vi.fn(), setClientReady: vi.fn(), clientDormant: false } as unknown as WindowData;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: { remote: { expr: "원천" } }, actions: [], commands: {} };
  const runtime = new ClientRuntime(store, data, definition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (type: string, extra: object = {}) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin: "null", data: { token, type, ...extra },
  }));

  try {
    expect(getValue).toHaveBeenCalledWith("/client/inputs/remote");
    value = { status: "ready", value: { title: "자료" } };
    runtime.sync();
    const beforeReady = post.mock.calls.map(([message]) => message.type);
    post.mockClear();
    receive("ks-sandbox-ready");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "ks-client-inputs",
      inputs: { remote: { status: "ready", value: { title: "자료" } } },
      changed: ["remote"],
    }), "*");
    expect(beforeReady).not.toContain("ks-client-inputs");
    expect(beforeReady).not.toContain("ks-sandbox-state-sync");
  } finally {
    const stopping = runtime.stop();
    const flush = post.mock.calls.map(([message]) => message).find((message) => message.type === "ks-sandbox-flush");
    if (flush) receive("ks-sandbox-flushed", { requestId: flush.requestId, ok: true });
    await stopping;
  }
});
