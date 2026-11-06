import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreEvent, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { describeVisible } from "../share/visible";
import { flushSandboxes } from "../blocks/sandbox-flush";
import { ContextMenuHost } from "../components/context-menu";
import { registerCommentEntry } from "../comments/context-entry";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";
import { ClientRuntime } from "../runtime/client-runtime";
import type { WindowData } from "../data/window-data";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("클라이언트 상태 메시지는 허용 키만 보내고 지연 중 다른 키를 보존한다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, state: { a: 0, b: 0, current_file: null } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const subscribe = transport.subscribe.bind(transport);
  let held: CoreEvent | undefined;
  vi.spyOn(transport, "subscribe").mockImplementation((listener) => subscribe((event) => {
    if (event.event === "state.changed" && !held) { held = event; return; }
    if (held) { listener(held); held = undefined; }
    listener(event);
  }));
  const store = createShellStore(transport);
  await store.ready;
  const original = store.call.bind(store);
  let release!: () => void;
  const delay = new Promise<void>((resolve) => { release = resolve; });
  const call = vi.spyOn(store, "call").mockImplementation(async (request) => {
    const result = original(request);
    if (call.mock.calls.length === 1) await delay;
    return result;
  });
  const client = { state_keys: ["a", "b"], storage_entries: [], commands: {}, capabilities: [] };
  const runtime = new ClientRuntime(store, { windowId: "editor-window", setNotice: vi.fn() } as unknown as WindowData, definition, client as never);
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.assign(runtime, { frame, token: "test-token" });
  const receive = (patch: object) => (runtime as any).receive(new MessageEvent("message", {
    source: frame.contentWindow, origin: "null", data: { token: "test-token", type: "ks-sandbox-state-set", patch },
  }));
  receive({ a: 1, forbidden: 5 });
  await Promise.resolve();
  expect(held).toMatchObject({ event: "state.changed", snapshot: { shared: { windows: [{ state: { a: 1, b: 0 } }] } } });
  expect(store.getSnapshot()?.shared.windows[0].state).toEqual({ a: 0, b: 0, current_file: null });
  receive({ b: 1 });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.b).toBe(1));
  receive({ forbidden: 5 });
  expect(call.mock.calls.map(([request]) => request)).toEqual([
    { op: "window.patch_state", window_id: "editor-window", patch: { a: 1 } },
    { op: "window.patch_state", window_id: "editor-window", patch: { b: 1 } },
  ]);
  release();
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state).toEqual({ a: 1, b: 1, current_file: null }));
  frame.remove();
  store.dispose();
});

it("샌드박스의 올바른 토큰을 가진 선택 복사만 메뉴로 연다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 11, modules: {} }, ui: { type: "sandbox", value: "<p>글</p>", title: "격리" } as Block };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  render(<><ContextMenuHost /><div className="ks-window-content"><AppWindowContent store={store} windowId="editor-window" /></div></>);
  const frame = await screen.findByTitle("격리") as HTMLIFrameElement;
  const send = (token: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token, type: "ks-sandbox-context-menu", x: 10, y: 20, text: "선택한 글" } })));
  send("틀린 토큰");
  expect(screen.queryByRole("menu")).toBeNull();
  send("00000000-0000-4000-8000-000000000001");
  expect(screen.getByRole("menuitem", { name: "복사" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: "00000000-0000-4000-8000-000000000001", type: "ks-sandbox-context-menu", x: 10, y: 20, text: "", editable: true, readOnly: false, password: false } })));
  fireEvent.click(screen.getByRole("menuitem", { name: "모두 선택" }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-context-command", action: "selectAll", token: "00000000-0000-4000-8000-000000000001" }), "*");
  const pick = vi.fn();
  const unregister = registerCommentEntry(frame.closest<HTMLElement>(".ks-window-content")!, pick);
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: "00000000-0000-4000-8000-000000000001", type: "ks-sandbox-context-menu", x: 10, y: 20, text: "", editable: false } })));
  fireEvent.click(screen.getByRole("menuitem", { name: "커멘트 달기…" }));
  expect(pick).toHaveBeenCalledWith(frame, { x: 10, y: 20 });
  unregister();
  store.dispose();
});

it("샌드박스의 허용된 상태와 저장을 중계하고 같이 볼 이미지를 전달한다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 11, modules: { storage: 1 } },
    state: { count: 1, private: "비공개" },
    storage: { entries: [{ id: "draft", key: "draft", kind: "md", label: "문서", presentation: "hidden", default: "" }] },
    ui: { type: "sandbox", value: '<div style="display:none">숨겨진 내용</div><canvas></canvas>', title: "시험", state_keys: ["count"], storage_entries: ["draft"] } as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const original = store.call.bind(store);
  let stored = "문서";
  let revision = "r1";
  const spy = vi.spyOn(store, "call").mockImplementation(async (request) => {
    if (request.op === "storage.get") return { op: "storage.get", result: { content: stored, revision, exists: true, kind: "md" } } as CoreReply;
    if (request.op === "storage.write" && request.content === "충돌") throw { id: "STORAGE_ITEM_WRITE_CONFLICT", code: "conflict", message: "다른 창에서 변경했습니다", details: [] };
    if (request.op === "storage.write") { stored = String(request.content); revision = "r2"; return { op: "storage.write", revision } as CoreReply; }
    return original(request);
  });
  render(<AppWindowContent store={store} windowId="editor-window" />);
  const iframe = await screen.findByTitle("시험") as HTMLIFrameElement;
  expect(iframe.getAttribute("allow")).toBe("autoplay");
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  expect(describeVisible(iframe.closest(".ks-sandbox") as HTMLElement).text).not.toContain("숨겨진 내용");
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  const message = (data: object, origin = "null") => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, origin, data: { token: "00000000-0000-4000-8000-000000000001", ...data } }));
  message({ type: "ks-sandbox-ready" });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-storage-sync", entry: "draft", content: "문서" }), "*"));
  message({ type: "ks-sandbox-state-set", patch: { count: 2, private: "차단" } }, "https://outside.test");
  window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, origin: "null", data: { type: "ks-sandbox-state-set", token: "틀린 토큰", patch: { count: 9 } } }));
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: "null", data: { type: "ks-sandbox-state-set", token: "00000000-0000-4000-8000-000000000001", patch: { count: 9 } } }));
  expect(spy.mock.calls.some(([request]) => request.op === "window.patch_state")).toBe(false);
  message({ type: "ks-sandbox-state-set", patch: { count: 2, private: "차단" } });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "window.patch_state", patch: { count: 2 } })));
  message({ type: "ks-sandbox-storage-set", requestId: "1", entry: "draft", content: "새 문서" });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", entry: "draft", content: "새 문서", expected_revision: "r1" })));
  post.mockClear();
  await act(async () => { transport.emit({ event: "storage.update", window_id: "editor-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "draft", key: "draft", kind: "md", revision: "r2", exists: true } } } }); });
  await waitFor(() => expect(spy.mock.calls.filter(([request]) => request.op === "storage.get").length).toBeGreaterThan(1));
  expect(post.mock.calls.some(([data]) => data.type === "ks-sandbox-storage-sync" && data.content === "새 문서")).toBe(false);
  stored = "다른 창의 변경"; revision = "r3";
  await act(async () => { transport.emit({ event: "storage.update", window_id: "editor-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "draft", key: "draft", kind: "md", revision, exists: true } } } }); });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-storage-sync", content: "다른 창의 변경", revision: "r3" }), "*"));
  message({ type: "ks-sandbox-storage-set", requestId: "2", entry: "draft", content: "충돌" });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-storage-reply", requestId: "2", error: "다른 창에서 변경했습니다", errorId: "STORAGE_ITEM_WRITE_CONFLICT", errorCode: "conflict" }), "*"));
  const storageError = await screen.findByRole("alert");
  expect(storageError.textContent).toContain("STORAGE_ITEM_WRITE_CONFLICT");
  expect(storageError.textContent).toContain("다른 창에서 변경했습니다");
  expect(spy.mock.calls.filter(([request]) => request.op === "storage.write" && request.content === "충돌")).toHaveLength(1);
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: "충돌", expected_revision: "r2" }));
  message({ type: "ks-sandbox-storage-applied", entry: "draft", revision: "r3" });
  message({ type: "ks-sandbox-storage-set", requestId: "3", entry: "draft", content: "수락한 변경" });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: "수락한 변경", expected_revision: "r3" })));
  message({ type: "ks-sandbox-share", text: "보이는 글", imageBase64: "cG5n" });
  await waitFor(() => expect(iframe.closest(".ks-sandbox")?.getAttribute("data-share-seq")).toBe("1"));
  expect(describeVisible(iframe.closest(".ks-sandbox") as HTMLElement)).toMatchObject({ text: expect.stringContaining("보이는 글"), image_base64: "cG5n", visual: true });
  act(() => message({ type: "ks-sandbox-share", text: "보이는 글", imageBase64: "cG5n" }));
  expect(iframe.closest(".ks-sandbox")?.getAttribute("data-share-seq")).toBe("1");
  act(() => message({ type: "ks-sandbox-share", text: "바뀐 글", imageBase64: "cG5n" }));
  expect(iframe.closest(".ks-sandbox")?.getAttribute("data-share-seq")).toBe("2");
  const flushing = flushSandboxes("editor-window");
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-flush" }), "*"));
  const flushRequest = post.mock.calls.map(([data]) => data).find((data) => data.type === "ks-sandbox-flush");
  message({ type: "ks-sandbox-flushed", requestId: flushRequest.requestId, ok: true });
  expect(await flushing).toBe(true);
  const originalSource = iframe.srcdoc;
  vi.mocked(crypto.randomUUID).mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
  fireEvent.load(iframe); fireEvent.load(iframe);
  await waitFor(() => expect(screen.getByTitle("시험")).not.toBe(iframe));
  expect((screen.getByTitle("시험") as HTMLIFrameElement).srcdoc).not.toBe(originalSource);
});
