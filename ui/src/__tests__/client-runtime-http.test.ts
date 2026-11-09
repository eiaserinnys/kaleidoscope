import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

afterEach(() => { document.querySelector(".ks-client-frames")?.remove(); vi.restoreAllMocks(); });

it.each([true, false])("HTTP 이진 요청과 응답을 전달하거나 운반 수단 없음 오류를 낸다: %s", async (available) => {
  const meta = new TextEncoder().encode(JSON.stringify({ status: 412, headers: { etag: "v1" }, mime: "text/plain" }));
  const response = new Uint8Array(4 + meta.length + 2);
  new DataView(response.buffer).setUint32(0, meta.length);
  response.set(meta, 4); response.set([1, 2], 4 + meta.length);
  const bytes = vi.fn(async () => response.buffer);
  const store = { call: vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "" } })), bytes: available ? bytes : undefined,
    getSnapshot: () => null, subscribe: () => () => {}, subscribeEvents: () => () => {}, nativeFiles: false } as unknown as ShellStore;
  const data = { windowId: "window-1", failClient: vi.fn(), setClientReady: vi.fn(), clientHost: null } as unknown as WindowData;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {} };
  const runtime = new ClientRuntime(store, data, { assets: [] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const body = new Uint8Array([3, 4]).buffer;
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type: "ks-client-http-request", requestId: "1", permission: "net", method: "PUT", path: "/item", query: {}, headers: { "if-match": "v1" }, body } }));
  if (available) {
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "1", result: expect.objectContaining({ status: 412, headers: { etag: "v1" }, mime: "text/plain" }) }), "*", expect.any(Array)));
    expect(bytes).toHaveBeenCalledOnce();
    const [operation, packet] = bytes.mock.calls[0] as unknown as [object, ArrayBuffer];
    expect(operation).toEqual({ op: "client.http_request", window_id: "window-1", handle: "" });
    const size = new DataView(packet).getUint32(0);
    expect(JSON.parse(new TextDecoder().decode(packet.slice(4, 4 + size)))).toEqual({ permission: "net", method: "PUT", path: "/item", query: {}, headers: { "if-match": "v1" } });
    expect([...new Uint8Array(packet.slice(4 + size))]).toEqual([3, 4]);
    const reply = post.mock.calls.map(([message]) => message).find((message) => message.requestId === "1");
    expect([...new Uint8Array(reply.result.bytes)]).toEqual([1, 2]);
  } else {
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "1", errorId: "SHELL_CLIENT_HTTP_REQUEST_TRANSPORT_UNAVAILABLE" }), "*"));
  }
  await runtime.stop();
});
