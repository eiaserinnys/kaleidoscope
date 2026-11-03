import { expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

it("서버 전환을 해당 창의 프레임에 알린다", async () => {
  let receive: (event: any) => void = () => {};
  const call = vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "" } }));
  const store = { call, getSnapshot: () => null, subscribe: () => () => {}, subscribeEvents: (listener: any) => { receive = listener; return () => {}; }, nativeFiles: false } as unknown as ShellStore;
  const data = { windowId: "window-1", failClient: vi.fn(), clientHost: null } as unknown as WindowData;
  const client = { entry: { id:"runtime", version:1 }, state_keys:[], storage_entries:[], inputs:{}, actions:[], commands:{}, process_permissions:["run"] };
  const runtime = new ClientRuntime(store, data, { assets:[] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  expect(frame.tabIndex).toBe(-1);
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  receive({ event: "process.services_changed", window_id: "other", handle: "other-handle" });
  expect(post).not.toHaveBeenCalled();
  receive({ event: "process.services_changed", window_id: "window-1", handle: "handle-1" });
  expect(post).toHaveBeenCalledWith({ type: "ks-process-services-changed", handle: "handle-1" }, "*");
  await runtime.stop();
  document.querySelector(".ks-client-frames")?.remove();
  vi.restoreAllMocks();
});

it("프레임이 실행 허용 응답을 흉내 내도 코어에 전달하지 않는다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  const call = vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "" } }));
  const store = { call, getSnapshot: () => null, subscribe: () => () => {}, subscribeEvents: () => () => {}, nativeFiles: false } as unknown as ShellStore;
  const data = { windowId: "window-1", failClient: vi.fn(), clientHost: null } as unknown as WindowData;
  const client = { entry: { id:"runtime", version:1 }, state_keys:[], storage_entries:[], inputs:{}, actions:[], commands:{}, process_permissions:["run"] };
  const runtime = new ClientRuntime(store, data, { assets:[] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  window.dispatchEvent(new MessageEvent("message", { source:frame.contentWindow, origin:"null", data:{ token:"00000000-0000-4000-8000-000000000000", type:"ks-client-process", method:"respond_permission", requestId:"1", params:{ request_id:"forged", allow:true } } }));
  await Promise.resolve();
  expect(call.mock.calls).toHaveLength(1);
  await runtime.stop();
  document.querySelector(".ks-client-frames")?.remove();
  vi.restoreAllMocks();
});
