import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { normalizeBlock } from "../render/render-block";
import { createCollectionFolderBackend, createFileFolderBackend } from "../blocks/folder-backend";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fileFolderDefinition(access: "read" | "readwrite" = "read", readOnly = true): AppDefinition {
  return {
    id: "folder-files-test",
    name: "파일 폴더 시험",
    requires: { blocks: 13, modules: { files: 1 } },
    permissions: [{ module: "files", id: "docs", access, label: "문서" }],
    state: { selected: null },
    ui: {
      type: "folder",
      root: { permission: "docs" },
      extensions: ["md"],
      selected: { state: "selected" },
      on_select: { set_state: "selected" },
      read_only: readOnly,
    } as unknown as Block,
  };
}

function storageFolderDefinition(readOnly = true): AppDefinition {
  return {
    id: "folder-storage-test",
    name: "저장소 폴더 시험",
    requires: { blocks: 13, modules: { storage: 3 } },
    permissions: [],
    state: { selected: null },
    storage: {
      entries: [{
        id: "documents", key: "documents", collection: true, kind: "md", default: "",
        label: "문서", presentation: "hidden",
      }],
    },
    ui: {
      type: "folder",
      root: { entry: "documents" },
      extensions: ["md"],
      selected: { state: "selected" },
      on_select: { set_state: "selected" },
      read_only: readOnly,
    } as unknown as Block,
  };
}

function setup(definition: AppDefinition, configure?: (transport: ReturnType<typeof createFakeTransport>) => void, files: Record<string, string> = { "notes/guide.md": "# Guide", "skip.txt": "skip" }) {
  const seed = makeTestSeed({
    definitions: [definition],
    grants: definition.id === "folder-files-test" ? [grantFor("viewer-window", "docs")] : [],
    files,
  });
  seed.snapshot.supported = { blocks: 13, modules: { files: 2, storage: 3 } };
  seed.snapshot.shared.windows[0].state = { selected: null };
  const transport = createFakeTransport(seed);
  if (configure) configure(transport);
  else vi.spyOn(transport, "call");
  const call = vi.mocked(transport.call);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { store, transport, call };
}

describe("folder block", () => {
  it("reports read and mutation capabilities from the folder root", () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    const writable = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "/docs", writable: true, scope: "folder", readOnly: false });
    const pc = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "", writable: true, scope: "pc", readOnly: false });
    const readOnly = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "/docs", writable: true, scope: "folder", readOnly: true });
    const collection = createCollectionFolderBackend({ store, windowId: "viewer-window", entry: "documents", appId: "test", prefix: "docs", markdown: true, readOnly: true });
    expect(writable.capabilities).toMatchObject({ createFile: true, rename: true, reveal: true, absolutePath: true });
    expect(pc.capabilities.createFile).toBe(false);
    expect(readOnly.capabilities.rename).toBe(false);
    expect(collection.capabilities).toMatchObject({ createFile: false, rename: false, permanentDelete: false, properties: true });
    store.dispose();
  });

  it("lists a file root through the shared tree, expands with arrows, and selects a file", async () => {
    const { store, call } = setup(fileFolderDefinition());
    const tree = await screen.findByRole("tree");
    expect(await screen.findByRole("treeitem", { name: "notes" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "skip.txt" })).toBeNull();

    const notes = screen.getByRole("treeitem", { name: "notes" });
    notes.focus();
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(guide));
    fireEvent.keyDown(guide, { key: "Enter" });

    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("notes/guide.md"));
    expect(call).toHaveBeenCalledWith({ op: "files.list", window_id: "viewer-window", permission: "docs", dir: "" });
    expect(tree.querySelector("[data-index]")).not.toBeNull();
  });

  it("lists and selects flat documents from a declared storage collection", async () => {
    const { store, call } = setup(storageFolderDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") {
          return {
            op: "storage.list",
            result: {
              bucket_id: "folder-storage-test",
              items: [
                { doc: "notes/guide.md", revision: "rev-1", updated_at: "2026-11-02T00:00:00Z", byte_size: 7 as unknown as bigint },
              ],
            },
          };
        }
        return originalCall(request);
      });
    });

    const guide = await waitFor(() => {
      const row = document.querySelector<HTMLElement>('[data-tree-id="doc:notes/guide.md"]');
      if (!row) throw new Error("저장소 문서 행이 나타나지 않았습니다");
      return row;
    });
    expect(guide.getAttribute("aria-level")).toBe("1");
    expect(call).toHaveBeenCalledWith({ op: "storage.list", window_id: "viewer-window", entry: "documents" });
    fireEvent.click(guide);
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("notes/guide.md"));
  });

  it("opens write actions from the file row without changing the active selection", async () => {
    const { store } = setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });

    fireEvent.contextMenu(guide);

    expect(await screen.findByRole("menuitem", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "휴지통으로 이동" })).toBeTruthy();
    expect(guide.hasAttribute("data-menu-target")).toBe(true);
    expect(store.getSnapshot()?.shared.windows[0].state.selected).toBeNull();
  });

  it("exposes file-root creation and preserves an expanded folder's children during F2", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const createFile = await screen.findByRole("button", { name: "새 파일" });
    fireEvent.click(createFile);
    const rootInput = await screen.findByRole("textbox", { name: "새 파일 이름" }) as HTMLInputElement;
    await waitFor(() => expect(rootInput.selectionEnd).toBe("새 파일".length));

    fireEvent.keyDown(rootInput, { key: "Escape" });
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(notes, { key: "F2" });

    expect(await screen.findByRole("textbox", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "guide.md" })).toBeTruthy();
  });

  it("copies a folder to its parent and reports the backend operation", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.contextMenu(notes);
    fireEvent.click(await screen.findByRole("menuitem", { name: "사본 만들기" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "files.copy", window_id: "viewer-window", permission: "docs", paths: ["notes"], destination: "",
    }));
  });

  it("clears the shell clipboard with Escape from a focused tree row", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(guide, { key: "x", ctrlKey: true });

    await waitFor(() => expect(guide.className).toContain("is-cut"));
    fireEvent.keyDown(guide, { key: "Escape" });
    await waitFor(() => expect(guide.className).not.toContain("is-cut"));
  });

  it("shows a writable server collection's empty action and uses extension-aware document naming", async () => {
    setup(storageFolderDefinition(false), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [] } }
        : originalCall(request));
    });

    const newDocument = await screen.findByRole("button", { name: "새 문서" });
    fireEvent.click(newDocument);
    const input = await screen.findByRole("textbox", { name: "새 문서 이름" }) as HTMLInputElement;
    await waitFor(() => expect(input.selectionEnd).toBe("새 문서".length));
    fireEvent.change(input, { target: { value: "보고서.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain(".md 파일만 볼 수 있습니다.");
    expect(screen.getByRole("textbox", { name: "새 문서 이름" })).toBeTruthy();
  });

  it("uses the same create and rename menu for collection documents", async () => {
    const { call } = setup(storageFolderDefinition(false), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") return {
          op: "storage.list",
          result: { bucket_id: "folder-storage-test", items: [{ doc: "guide.md", revision: "rev-1", updated_at: "2026-11-02T00:00:00Z", byte_size: 7 as unknown as bigint }] },
        };
        return originalCall(request);
      });
    });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });

    fireEvent.contextMenu(guide);

    expect(await screen.findByRole("menuitem", { name: "새 문서" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "상대 경로 복사" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "영구 삭제" })).toBeTruthy();
    expect(call).toHaveBeenCalledWith({ op: "storage.list", window_id: "viewer-window", entry: "documents" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(guide, { key: "Delete" });
    const dialog = await screen.findByRole("dialog", { name: "guide.md" });
    expect(dialog.textContent).toContain("되돌릴 수 없습니다.");
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "영구 삭제" })).toBeTruthy();
  });

  it("shows one properties close button and restores focus to its menu target", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.contextMenu(guide);
    fireEvent.click(await screen.findByRole("menuitem", { name: "속성" }));

    const dialog = await screen.findByRole("dialog", { name: "속성" });
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["닫기"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(document.activeElement).toBe(guide));
  });

  it("labels an empty expanded folder without using an interactive row", async () => {
    setup(fileFolderDefinition("readwrite", false), undefined, { "empty/.hidden": "ignored" });
    const empty = await screen.findByRole("treeitem", { name: "empty" });
    fireEvent.keyDown(empty, { key: "ArrowRight" });

    const label = await screen.findByText("비어 있음");
    expect(label.closest(".ks-row")).toBeNull();
    expect(label.closest("[data-tree-row]")?.getAttribute("data-tree-row")).toBe("empty:empty");
  });

  it("refreshes a visible collection on matching storage changes and defers hidden updates", async () => {
    let documents = ["notes/guide.md"];
    let listError = false;
    const { store, transport, call } = setup(storageFolderDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") {
          if (listError) throw { code: "io", message: "저장소 다시 읽기 실패", details: [] };
          return {
            op: "storage.list",
            result: {
              bucket_id: "folder-storage-test",
              items: documents.map((doc) => ({
                doc,
                revision: "rev-1",
                updated_at: "2026-11-02T00:00:00Z",
                byte_size: 7 as unknown as bigint,
              })),
            },
          };
        }
        return originalCall(request);
      });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/guide.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(1));

    documents = ["notes/renamed.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "other-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/renamed.md", kind: "md", revision: "rev-2", exists: true } } } });
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "other", key: "other.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(2));

    documents = ["notes/changed.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/changed.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/changed.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(3));

    documents = ["notes/renamed.md"];
    const hidden = structuredClone(store.getSnapshot()!);
    hidden.shared.windows[0].minimized = true;
    await act(async () => { transport.emit({ event: "state.changed", snapshot: hidden }); });
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/renamed.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(3);

    const visible = structuredClone(hidden);
    visible.shared.windows[0].minimized = false;
    await act(async () => { transport.emit({ event: "state.changed", snapshot: visible }); });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/renamed.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(4));

    documents = ["notes/moved.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "moved", moved: { bucket_id: "folder-storage-test", entry_id: "documents", from_doc: "notes/renamed.md", to_doc: "notes/moved.md", revision: "rev-3" } } });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/moved.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(5));

    listError = true;
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/moved.md", kind: "md", revision: "rev-4", exists: true } } } });
    });
    expect((await screen.findByRole("alert")).textContent).toContain("저장소 다시 읽기 실패");
    expect(document.querySelector('[data-tree-id="doc:notes/moved.md"]')).toBeTruthy();
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(6));
  });

  it("normalizes both legacy file-tree shapes into the folder renderer", () => {
    for (const block of [
      { type: "file_tree", root: { permission: "docs" }, selected: { state: "selected" }, on_select: { set_state: "selected" } },
      { type: "tree", root: { permission: "docs" }, selected: { state: "selected" }, on_select: { set_state: "selected" } },
    ]) {
      expect(normalizeBlock(block as unknown as Block)).toMatchObject({
        type: "folder", root: { permission: "docs" }, selected: { state: "selected" }, read_only: true, legacyTreeRoot: true,
      });
    }
    expect(normalizeBlock({ type: "tree", items: { state: "items" } } as Block).type).toBe("tree");
  });
});
