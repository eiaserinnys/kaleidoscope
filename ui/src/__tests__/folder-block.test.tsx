import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { normalizeBlock } from "../render/render-block";
import { collectionFolderCapabilities, fileFolderCapabilities } from "../blocks/folder-backend";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fileFolderDefinition(): AppDefinition {
  return {
    id: "folder-files-test",
    name: "파일 폴더 시험",
    requires: { blocks: 13, modules: { files: 1 } },
    permissions: [{ module: "files", id: "docs", access: "read", label: "문서" }],
    state: { selected: null },
    ui: {
      type: "folder",
      root: { permission: "docs" },
      extensions: ["md"],
      selected: { state: "selected" },
      on_select: { set_state: "selected" },
      read_only: true,
    } as unknown as Block,
  };
}

function storageFolderDefinition(): AppDefinition {
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
      read_only: true,
    } as unknown as Block,
  };
}

function setup(definition: AppDefinition, configure?: (transport: ReturnType<typeof createFakeTransport>) => void) {
  const seed = makeTestSeed({
    definitions: [definition],
    grants: definition.id === "folder-files-test" ? [grantFor("viewer-window", "docs")] : [],
    files: { "notes/guide.md": "# Guide", "skip.txt": "skip" },
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
    expect(fileFolderCapabilities(true, "folder", false)).toMatchObject({ createFile: true, rename: true, reveal: true, absolutePath: true });
    expect(fileFolderCapabilities(true, "pc", false).createFile).toBe(false);
    expect(fileFolderCapabilities(true, "folder", true).rename).toBe(false);
    expect(collectionFolderCapabilities(false)).toMatchObject({ createFile: true, permanentDelete: true, properties: true });
    expect(collectionFolderCapabilities(true).createFile).toBe(false);
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
