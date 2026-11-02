import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { describeVisible } from "../share/visible";
import { flushSandboxes } from "../blocks/sandbox-flush";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
    if (request.op === "storage.write" && request.content === "충돌") throw { code: "conflict", message: "다른 창에서 변경했습니다", details: [] };
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
  expect(spy.mock.calls.some(([request]) => request.op === "window.set_state")).toBe(false);
  message({ type: "ks-sandbox-state-set", patch: { count: 2, private: "차단" } });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "window.set_state", state: { count: 2, private: "비공개" } })));
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
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-storage-reply", requestId: "2", error: "다른 창에서 변경했습니다" }), "*"));
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
