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
  expect(call.mock.calls.filter(([request]) => request.op === "window.patch_state")).toHaveLength(2);
  store.dispose();
});

it("같은 창의 서로 다른 고정 문서를 각각 편집한다", async () => {
  const seed = structuredClone(makeTestSeed());
  const definition = seed.snapshot.shared.app_versions[0].definition;
  definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
  definition.ui = { type: "split", direction: "row", sizes: [50, 50], children: [
    { type: "markdown", document: { entry: "docs", doc: "a.md" } },
    { type: "markdown", document: { entry: "docs", doc: "b.md" } },
  ] };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "storage.get") return { op: "storage.get", result: { kind: "md", content: `내용 ${request.doc}`, revision: "r1", exists: true } };
    return original(request);
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  await waitFor(() => expect(container.querySelectorAll(".cm-content")).toHaveLength(2));
  const editors = [...container.querySelectorAll(".cm-content")];
  expect(editors[0].textContent).toContain("내용 a.md");
  expect(editors[1].textContent).toContain("내용 b.md");
  await act(async () => { transport.emit({ event: "storage.update", window_id: "editor-window", update: { kind: "moved", moved: { bucket_id: "bucket", entry_id: "docs", from_doc: "a.md", to_doc: "c.md", revision: "r1" } } }); });
  expect(editors[0].textContent).toContain("내용 a.md");
  expect(editors[1].textContent).toContain("내용 b.md");
  store.dispose();
});

it.each(["file", "document"] as const)("%s 고정 경로의 첫 읽기 중 이동하면 새 주소를 열고 옛 응답은 버린다", async (kind) => {
  const seed = structuredClone(makeTestSeed({ grants: [grantFor("editor-window", "docs")] }));
  const definition = seed.snapshot.shared.app_versions[0].definition;
  definition.ui = kind === "file"
    ? { type: "markdown", file: { permission: "docs", path: "old.md" } }
    : { type: "markdown", document: { entry: "docs", doc: "old.md" } };
  if (kind === "document") definition.storage = { entries: [{ id: "docs", key: "documents", kind: "md", collection: true, default: "", label: "문서", presentation: "hidden" }] };
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  let finishOld!: (value: never) => void;
  const call = vi.spyOn(transport, "call").mockImplementation(async (request) => {
    const doc = request.op === "files.read" ? request.path : request.op === "storage.get" ? request.doc : null;
    if (doc === "old.md") return new Promise((resolve) => { finishOld = resolve as (value: never) => void; });
    if (doc === "new.md") return request.op === "files.read"
      ? { op: "files.read", path: "new.md", text: "새 주소의 글", revision: "r1" }
      : { op: "storage.get", result: { kind: "md", content: "새 주소의 글", revision: "r1", exists: true } };
    return original(request);
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  await act(async () => {
    if (kind === "file") transport.emit({ event: "files.changed", root: "/fake/docs", changes: [{ from: "old.md", to: "new.md" }] });
    else transport.emit({ event: "storage.update", window_id: "editor-window", update: { kind: "moved", moved: { bucket_id: "bucket", entry_id: "docs", from_doc: "old.md", to_doc: "new.md", revision: "r1" } } });
  });
  await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("새 주소의 글"));
  await act(async () => finishOld((kind === "file"
    ? { op: "files.read", path: "old.md", text: "오래된 글", revision: "old" }
    : { op: "storage.get", result: { kind: "md", content: "오래된 글", revision: "old", exists: true } }) as never));
  expect(container.querySelector(".cm-content")?.textContent).toContain("새 주소의 글");
  expect(call).toHaveBeenCalledWith(expect.objectContaining(kind === "file" ? { op: "files.read", path: "new.md" } : { op: "storage.get", doc: "new.md" }));
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
