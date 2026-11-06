import { afterEach, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import type { AppDefinition, Grant, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";

afterEach(() => {
  document.querySelector(".ks-client-frames")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("네이티브 창의 브라우저 파일은 읽기, 공유, blob 저장에서 같은 바이트를 쓰고 다른 창에는 보이지 않는다", async () => {
  vi.stubGlobal("File", NodeFile);
  const originalNavigator = Object.getOwnPropertyDescriptor(window, "navigator")!;
  const canShare = vi.fn(() => true);
  const share = vi.fn(async (_data: ShareData) => {});
  Object.defineProperty(window, "navigator", { configurable: true, value: Object.assign(Object.create(window.navigator), { canShare, share }) });
  const bytes = vi.fn(async (request: any, _body?: ArrayBuffer) => {
    if (request.op === "files.read_bytes") throw { id: "FILE_CLIENT_INPUT_NOT_OWNED", code: "permission_denied", message: "이 창에서 고른 파일이 아닙니다.", details: [] };
    return new Uint8Array([99]).buffer;
  });
  const call = vi.fn(async (request: any) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: "" } }
    : { op: request.op });
  const store = {
    getSnapshot: () => ({ device: {}, shared: { windows: [], desktops: [] } }),
    subscribe: () => () => undefined, subscribeEvents: () => () => undefined,
    nativeFiles: true, call, bytes,
  } as unknown as ShellStore;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {}, capabilities: ["share"] };
  const create = (windowId: string) => new ClientRuntime(store, { windowId, failClient: vi.fn(), setNotice: vi.fn() } as unknown as WindowData, { assets: [] } as unknown as AppDefinition, client as never);
  const first = create("window-1"), second = create("window-2");
  await first.start(); await second.start();
  const [frame1, frame2] = [...document.querySelectorAll("iframe")];
  const post1 = vi.spyOn(frame1.contentWindow!, "postMessage"), post2 = vi.spyOn(frame2.contentWindow!, "postMessage");
  const receive = (frame: HTMLIFrameElement, runtime: ClientRuntime, type: string, extra: object) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type, ...extra },
  }));
  const file = new NodeFile([new Uint8Array([1, 2, 3, 255])], "그림.bin", { type: "application/octet-stream" }) as unknown as File;
  const read = vi.spyOn(file, "arrayBuffer").mockImplementation(async () => new Uint8Array([1, 2, 3, 255]).buffer);
  const registered = (first as any).registerBrowserFile(file);
  expect(read).not.toHaveBeenCalled();
  receive(frame1, first, "ks-client-file-read", { requestId: "read", id: registered.id });
  await vi.waitFor(() => expect(post1.mock.calls.some(([message]) => message.requestId === "read")).toBe(true));
  const readReply = post1.mock.calls.find(([message]) => message.requestId === "read")![0];
  expect([...new Uint8Array(readReply.result)]).toEqual([1, 2, 3, 255]);
  receive(frame1, first, "ks-client-can-share", { requestId: "can", file_id: registered.id });
  receive(frame1, first, "ks-client-share", { requestId: "share", file_id: registered.id });
  await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(canShare).toHaveBeenCalled();
  expect([...new Uint8Array(await (share.mock.calls[0][0] as ShareData).files![0].arrayBuffer())]).toEqual([1, 2, 3, 255]);
  receive(frame1, first, "ks-client-blob-put", { requestId: "put", key: "image", fileId: registered.id });
  await vi.waitFor(() => expect(post1.mock.calls.some(([message]) => message.requestId === "put")).toBe(true));
  const put = bytes.mock.calls.find(([request]: any[]) => request.op === "client.blob_put")!;
  expect([...new Uint8Array(put[1] as ArrayBuffer)]).toEqual([1, 2, 3, 255]);
  expect(call.mock.calls.some(([request]) => request.op === "client.blob_put")).toBe(false);
  receive(frame2, second, "ks-client-file-read", { requestId: "other", id: registered.id });
  await vi.waitFor(() => expect(post2).toHaveBeenCalledWith(expect.objectContaining({ requestId: "other", errorId: "FILE_CLIENT_INPUT_NOT_OWNED" }), "*"));
  expect(bytes).toHaveBeenCalledWith({ op: "files.read_bytes", window_id: "window-2", handle: registered.id });
  await first.stop(); await second.stop();
  expect((first as any).fileRegistry.get(registered.id)).toBeUndefined();
  await expect((first as any).files.read(registered.id)).rejects.toMatchObject({ id: "SHELL_CLIENT_FILE_NOT_FOUND" });
  Object.defineProperty(window, "navigator", originalNavigator);
});

it("등록되지 않은 파일은 창의 기존 오류를 읽기와 blob 저장에서 유지한다", async () => {
  const coreError = { id: "FILE_CLIENT_INPUT_NOT_OWNED", code: "permission_denied", message: "이 창에서 고른 파일이 아닙니다.", details: ["missing"] };
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {} };
  for (const nativeFiles of [true, false]) {
    const call = vi.fn(async (request: any) => {
      if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "" } };
      if (request.op === "client.blob_put") throw coreError;
      return { op: request.op };
    });
    const bytes = vi.fn(async (_request: any, _body?: ArrayBuffer): Promise<ArrayBuffer> => { throw coreError; });
    const store = { getSnapshot: () => ({ device: {}, shared: { windows: [], desktops: [] } }), subscribe: () => () => undefined, subscribeEvents: () => () => undefined, nativeFiles, call, bytes } as unknown as ShellStore;
    const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), setNotice: vi.fn() } as unknown as WindowData, { assets: [] } as unknown as AppDefinition, client as never);
    await runtime.start();
    const frame = document.querySelector("iframe")!, post = vi.spyOn(frame.contentWindow!, "postMessage");
    const receive = (type: string, extra: object) => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type, ...extra } }));
    receive("ks-client-file-read", { requestId: "read", id: "missing" });
    receive("ks-client-blob-put", { requestId: "put", key: "image", fileId: "missing" });
    const errorId = nativeFiles ? "FILE_CLIENT_INPUT_NOT_OWNED" : "SHELL_CLIENT_FILE_NOT_FOUND";
    await vi.waitFor(() => {
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: "read", errorId }), "*");
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: "put", errorId }), "*");
    });
    if (nativeFiles) {
      expect(bytes).toHaveBeenCalledWith({ op: "files.read_bytes", window_id: "window-1", handle: "missing" });
      expect(call).toHaveBeenCalledWith({ op: "client.blob_put", window_id: "window-1", key: "image", file_id: "missing" });
    } else {
      expect(bytes).not.toHaveBeenCalled();
      expect(call.mock.calls.some(([request]) => request.op === "client.blob_put")).toBe(false);
    }
    await runtime.stop();
  }
});

it("브라우저 선택과 저장 후 파일은 같은 창에서 읽히고 blob 열기는 코어를 사용한다", async () => {
  vi.stubGlobal("File", NodeFile);
  if (!URL.createObjectURL) URL.createObjectURL = () => "";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:시험");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const picked = new NodeFile(["입력"], "입력.txt", { type: "text/plain" }) as unknown as File;
  vi.spyOn(picked, "arrayBuffer").mockResolvedValue(new TextEncoder().encode("입력").buffer);
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, "files", { configurable: true, value: [picked] });
    this.dispatchEvent(new Event("change"));
  });
  const call = vi.fn(async (request: any) => {
    if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "" } };
    if (request.op === "client.blob_open") return { op: "client.blob_open", file: { id: "core-blob", name: "blob.bin", size: 1, mime: "application/octet-stream" } };
    return { op: request.op };
  });
  const bytes = vi.fn(async (_request: any, _body?: ArrayBuffer) => new Uint8Array([8]).buffer);
  const store = { getSnapshot: () => ({ device: {}, shared: { windows: [], desktops: [] } }), subscribe: () => () => undefined, subscribeEvents: () => () => undefined, nativeFiles: false, call, bytes } as unknown as ShellStore;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: ["picked"], commands: {} };
  const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), setNotice: vi.fn() } as unknown as WindowData, { assets: [] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!, post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (type: string, extra: object) => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type, ...extra } }));
  await runtime.pick({ accept: [], client: "picked" } as never);
  const selected = post.mock.calls.find(([message]) => message.type === "ks-client-action" && message.name === "picked")![0].context.event.files[0];
  receive("ks-client-file-read", { requestId: "picked-read", id: selected.id });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "picked-read")).toBe(true));
  expect(new TextDecoder().decode(post.mock.calls.find(([message]) => message.requestId === "picked-read")![0].result)).toBe("입력");
  receive("ks-client-save-prompt", { requestId: "save", suggested_name: "출력.txt", mime: "text/plain" });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "save")).toBe(true));
  const sink = post.mock.calls.find(([message]) => message.requestId === "save")![0].result;
  receive("ks-client-file-write", { requestId: "write", sink, offset: 0, bytes: new TextEncoder().encode("출력").buffer });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "write")).toBe(true));
  receive("ks-client-file-close", { requestId: "close", sink });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "close")).toBe(true));
  receive("ks-client-file-read", { requestId: "saved-read", id: sink });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "saved-read")).toBe(true));
  expect(new TextDecoder().decode(post.mock.calls.find(([message]) => message.requestId === "saved-read")![0].result)).toBe("출력");
  receive("ks-client-blob-open", { requestId: "open", key: "image" });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "open")).toBe(true));
  receive("ks-client-blob-put", { requestId: "put", key: "copy", fileId: "core-blob" });
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith({ op: "client.blob_put", window_id: "window-1", key: "copy", file_id: "core-blob" }));
  await runtime.stop();
  expect(call).toHaveBeenCalledWith({ op: "client.release", window_id: "window-1" });
});

it("네이티브 선택과 blob 열기는 코어에서 읽고 blob 저장은 파일 핸들을 유지하며 출력 sink는 기존 경로를 쓴다", async () => {
  const file = { id: "core-file", name: "입력.bin", size: 3, mime: "application/octet-stream" };
  const call = vi.fn(async (request: any) => {
    if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "" } };
    if (request.op === "files.pick") return { op: "files.pick", cancelled: false, files: [file] };
    if (request.op === "client.blob_open") return { op: "client.blob_open", file: { ...file, id: "blob-file" } };
    if (request.op === "export.begin") return { op: "export.begin", cancelled: false, sink_id: "sink" };
    return { op: request.op };
  });
  const bytes = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
  const store = { getSnapshot: () => ({ device: {}, shared: { windows: [], desktops: [] } }), subscribe: () => () => undefined, subscribeEvents: () => () => undefined, nativeFiles: true, call, bytes } as unknown as ShellStore;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: ["picked", "saved"], commands: {} };
  const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), setNotice: vi.fn() } as unknown as WindowData, { assets: [] } as unknown as AppDefinition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!, post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (type: string, extra: object) => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type, ...extra } }));
  await runtime.pick({ accept: [], client: "picked" } as never);
  receive("ks-client-blob-open", { requestId: "open", key: "image" });
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: "open", result: expect.objectContaining({ id: "blob-file" }) }), "*"));
  for (const id of ["core-file", "blob-file"]) {
    receive("ks-client-file-read", { requestId: `read-${id}`, id });
    await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === `read-${id}`)).toBe(true));
    expect(bytes).toHaveBeenCalledWith({ op: "files.read_bytes", window_id: "window-1", handle: id });
    receive("ks-client-blob-put", { requestId: `put-${id}`, key: "image", fileId: id });
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith({ op: "client.blob_put", window_id: "window-1", key: "image", file_id: id }));
  }
  await runtime.save({ client: "saved", mime: "application/octet-stream" } as never, "출력.bin");
  receive("ks-client-file-write", { requestId: "write", sink: "sink", offset: 0, bytes: new Uint8Array([7]).buffer });
  receive("ks-client-file-truncate", { requestId: "truncate", sink: "sink", size: 1 });
  receive("ks-client-file-close", { requestId: "close", sink: "sink" });
  await vi.waitFor(() => expect(post.mock.calls.some(([message]) => message.requestId === "close")).toBe(true));
  expect(bytes).toHaveBeenCalledWith({ op: "export.write", window_id: "window-1", handle: "sink", offset: 0 }, expect.any(ArrayBuffer));
  expect(call).toHaveBeenCalledWith({ op: "export.truncate", window_id: "window-1", sink_id: "sink", size: 1 });
  expect(call).toHaveBeenCalledWith({ op: "export.close", window_id: "window-1", sink_id: "sink" });
  await runtime.stop();
  expect(call).toHaveBeenCalledWith({ op: "client.release", window_id: "window-1" });
});

it("client 폴더 선택은 코어 권한 확인을 거쳐 이름만 돌려주고 grant 변경을 알린다", async () => {
  const declared: Grant = { window_id: "window-1", permission: "docs", root_path: "/private/docs", root_name: "작업 폴더", granted_at: "2026-11-03T00:00:00Z" };
  const pc: Grant = { window_id: "window-1", permission: "pc", root_path: "/private", root_name: "내 PC", granted_at: "2026-11-03T00:00:00Z" };
  let current = {
    device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: [] },
    shared: { windows: [{ id: "window-1", desktop_id: "desktop-1", minimized: false, state: {} }], desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }] },
  } as unknown as ShellSnapshot;
  const listeners = new Set<() => void>();
  const store = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvents: () => () => undefined,
    nativeFiles: true,
    call: vi.fn(async (request: any) => {
      if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: "" } };
      if (request.op === "client.release") return { op: "client.release" };
      if (request.op === "files.pick_folder" && request.permission === "docs") {
        current = { ...current, device: { ...current.device, grants: [declared, pc] } };
        listeners.forEach((listener) => listener());
        return { op: "files.pick_folder", grant: declared };
      }
      throw { id: "FILE_ACCESS_PERMISSION_UNDECLARED", code: "permission_denied", message: "파일 권한 undeclared: 앱 정의 permissions에 선언되지 않았습니다.", details: [] };
    }),
  } as unknown as ShellStore;
  const definition = {
    assets: [],
    permissions: [
      { module: "files", id: "docs", access: "read", label: "문서", scope: "folder" },
      { module: "files", id: "pc", access: "read", label: "내 PC", scope: "pc" },
    ],
  } as unknown as AppDefinition;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: ["pick"], commands: {} };
  const setNotice = vi.fn();
  const runtime = new ClientRuntime(store, { windowId: "window-1", failClient: vi.fn(), setNotice, clientHost: null } as unknown as WindowData, definition, client as never);
  await runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const token = (runtime as any).token;
  const receive = (requestId: string, permission: string) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type: "ks-client-pick-folder", requestId, permission },
  }));

  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type: "ks-sandbox-ready" },
  }));
  receive("pick", "docs");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "pick", result: "작업 폴더" }), "*"));
  expect(store.call).toHaveBeenCalledWith({ op: "files.pick_folder", window_id: "window-1", permission: "docs" });
  expect(post).toHaveBeenCalledWith({ type: "ks-client-grants", grants: { docs: "작업 폴더" } }, "*");

  receive("denied", "undeclared");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-reply", requestId: "denied", errorId: "FILE_ACCESS_PERMISSION_UNDECLARED", errorCode: "permission_denied" }), "*"));
  const stopping = runtime.stop();
  const flush = post.mock.calls.map(([message]) => message).find((message) => message.type === "ks-sandbox-flush");
  expect(flush).toBeTruthy();
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow,
    origin: "null",
    data: { token, type: "ks-sandbox-flushed", requestId: flush.requestId, ok: true },
  }));
  await stopping;
  expect(setNotice).not.toHaveBeenCalled();
});
