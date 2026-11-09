import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";
import { makeTestSeed } from "./fixtures";

afterEach(() => {
  document.querySelector(".ks-client-frames")?.remove();
  vi.restoreAllMocks();
});

const definition: AppDefinition = {
  id: "client-ready", name: "준비 상태 시험", requires: { blocks: 12, modules: { assets: 1, client: 1 } },
  permissions: [], state: {}, assets: [{ id: "script", version: 1 }],
  client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: [] },
  ui: { type: "text", value: "시험" },
};

it("client 준비 상태는 프레임 준비, 멈춤, 실패를 따른다", async () => {
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const store = createShellStore(transport);
  await store.ready;
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => {
    if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply;
    return call(request);
  });
  const data = new WindowData(store, "viewer-window", definition);
  expect(data.getClientReady()).toBe(false);
  const runtime = new ClientRuntime(store, data, definition, definition.client!);
  await runtime.start();
  const listener = vi.fn();
  const unsubscribe = data.subscribeClient(listener);
  try {
    const frame = document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as unknown as { token: string }).token, type: "ks-sandbox-ready" } }));
    expect(data.getClientReady()).toBe(true);
    expect(listener).toHaveBeenCalled();

    await runtime.stop();
    expect(data.getClientReady()).toBe(false);

    data.failClient({ id: "CLIENT_FAILED", code: "unavailable", message: "client를 시작하지 못했습니다", details: [] });
    expect(data.getClientReady()).toBe(false);
  } finally {
    unsubscribe();
    await runtime.stop();
    store.dispose();
  }
});

it("client가 없는 창은 기다릴 것이 없으므로 준비된 것으로 본다", async () => {
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const store = createShellStore(transport);
  await store.ready;
  try {
    const data = new WindowData(store, "plain-window", { ...definition, client: undefined });
    expect(data.getClientReady()).toBe(true);
  } finally {
    store.dispose();
  }
});
