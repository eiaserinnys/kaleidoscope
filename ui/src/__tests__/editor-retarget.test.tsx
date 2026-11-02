import { act, cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["markdown", "code"] as const)("%s 파일 이동 이벤트는 상태와 CodeMirror 인스턴스 및 선택을 유지한다", async (kind) => {
  const seed = structuredClone(makeTestSeed({ editorPath: "old/note.md", grants: [grantFor("editor-window", "docs")], files: { "old/note.md": "첫 줄\n둘째 줄" } }));
  const file = { permission: "docs", path: { state: "current_file" } };
  seed.snapshot.shared.app_versions[0].definition.ui = kind === "markdown" ? { type: "markdown", file } : { type: "code", file };
  const transport = createFakeTransport(seed);
  const call = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
  const element = container.querySelector(".cm-editor") as HTMLElement;
  const editor = EditorView.findFromDOM(element)!;
  await act(async () => {
    editor.dispatch({ selection: { anchor: 3 }, changes: { from: editor.state.doc.length, insert: " 초안" } });
    transport.emit({ event: "files.changed", root: "/fake/docs", changes: [{ from: "old", to: "new" }] });
  });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.current_file).toBe("new/note.md"));
  expect(container.querySelector(".cm-editor")).toBe(element);
  expect(editor.state.selection.main.head).toBe(3);
  expect(editor.state.sliceDoc()).toContain("초안");
  expect(call.mock.calls.filter(([request]) => request.op === "files.read")).toHaveLength(1);
  store.dispose();
});

it("같은 이동 이벤트를 받은 두 창의 서로 다른 경로 상태 키가 모두 따라간다", async () => {
  const seed = structuredClone(makeTestSeed({ grants: [grantFor("editor-window", "docs"), grantFor("second-window", "docs")], files: { "old/note.md": "문서" } }));
  const definition = seed.snapshot.shared.app_versions[0].definition;
  definition.state = { first: null, second: null };
  definition.ui = { type: "split", direction: "row", sizes: [50, 50], children: [
    { type: "markdown", file: { permission: "docs", path: { state: "first" } } },
    { type: "markdown", file: { permission: "docs", path: { state: "second" } } },
  ] };
  const firstWindow = seed.snapshot.shared.windows[0];
  firstWindow.state = { first: "old/note.md", second: "old/note.md" };
  seed.snapshot.shared.windows.push({ ...structuredClone(firstWindow), id: "second-window" });
  const transport = createFakeTransport(seed);
  const call = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  const { container } = render(<><AppWindowContent store={store} windowId="editor-window" /><AppWindowContent store={store} windowId="second-window" /></>);
  await waitFor(() => expect(container.querySelectorAll(".cm-editor")).toHaveLength(4));
  await act(async () => { transport.emit({ event: "files.changed", root: "/fake/docs", changes: [{ from: "old", to: "new" }] }); });
  await waitFor(() => {
    for (const id of ["editor-window", "second-window"]) {
      expect(store.getSnapshot()?.shared.windows.find((item) => item.id === id)?.state).toEqual({ first: "new/note.md", second: "new/note.md" });
    }
  });
  expect(call.mock.calls.filter(([request]) => request.op === "window.set_state")).toHaveLength(2);
  store.dispose();
});

it("문서 모음 선택이 null이면 요청하지 않고 선택된 doc으로 읽고 이동을 따라간다", async () => {
  const seed = structuredClone(makeTestSeed());
  const def = seed.snapshot.shared.app_versions[0].definition;
  def.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
  def.state = { selected_doc: null };
  def.ui = { type: "markdown", document: { entry: "docs", doc: { state: "selected_doc" } } };
  seed.snapshot.shared.windows[0].state = { selected_doc: null };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const call = vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "storage.get") return { op: "storage.get", result: { kind: "md", content: "문서 내용", revision: "r1", exists: true } };
    if (request.op === "storage.write") return { op: "storage.write", revision: "r2" };
    return original(request);
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  await store.ready;
  expect(call.mock.calls.filter(([request]) => request.op === "storage.get")).toHaveLength(0);
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { selected_doc: "a.md" } }); });
  await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.get", entry: "docs", doc: "a.md" }));
  const element = container.querySelector(".cm-editor");
  await act(async () => { transport.emit({ event: "storage.update", window_id: "editor-window", update: { kind: "moved", moved: { bucket_id: "bucket", entry_id: "docs", from_doc: "a.md", to_doc: "b.md", revision: "r1" } } }); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected_doc).toBe("b.md"));
  expect(container.querySelector(".cm-editor")).toBe(element);
  expect(call.mock.calls.filter(([request]) => request.op === "storage.get")).toHaveLength(1);
  const editor = EditorView.findFromDOM(element as HTMLElement)!;
  await act(async () => {
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " 초안" } });
    await store.call({ op: "window.set_state", window_id: "editor-window", state: { selected_doc: "c.md" } });
  });
  await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", doc: "b.md", content: "문서 내용 초안" })));
  await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.get", doc: "c.md" })));
  store.dispose();
});

it("읽기 전용 문서도 선택 전에는 요청하지 않고 선택한 문서를 읽는다", async () => {
  const seed = structuredClone(makeTestSeed());
  const definition = seed.snapshot.shared.app_versions[0].definition;
  definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
  definition.state = { selected_doc: null };
  definition.ui = { type: "markdown", read_only: true, document: { entry: "docs", doc: { state: "selected_doc" } } };
  seed.snapshot.shared.windows[0].state = { selected_doc: null };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const call = vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "storage.get") return { op: "storage.get", result: { kind: "md", content: "# 선택 문서", revision: "r1", exists: true } };
    return original(request);
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  await store.ready;
  expect(call.mock.calls.filter(([request]) => request.op === "storage.get")).toHaveLength(0);
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { selected_doc: "a.md" } }); });
  await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("선택 문서"));
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.get", entry: "docs", doc: "a.md" }));
  store.dispose();
});
