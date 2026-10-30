import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import explorerJson from "../../../apps/explorer.json";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { describeVisible } from "../share/visible";
import { grantFor, makeTestSeed, mdEditorDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => {
  mockVirtualLayout();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup({ legacy = false, folder = "", view = "icons", files, scope = "folder" }: { legacy?: boolean; folder?: string; view?: string; files?: Record<string, string>; scope?: "folder" | "pc" } = {}) {
  const permission = scope === "pc" ? "pc" : "folder";
  const definition: AppDefinition = {
    ...(explorerJson as AppDefinition),
    permissions: [{
      module: "files",
      id: permission,
      access: "read",
      label: scope === "pc" ? "내 PC" : "볼 폴더",
      ...(scope === "pc" ? { scope: "pc" as const } : {}),
    }],
    requires: { blocks: legacy ? 3 : 5, modules: { files: scope === "pc" ? 2 : 1 } },
    state: legacy ? {} : { folder, view },
    ui: legacy
      ? { type: "explorer", root: { permission } }
      : { ...(explorerJson.ui as Extract<Block, { type: "explorer" }>), root: { permission } },
  };
  const seed = makeTestSeed({
    definitions: [definition, mdEditorDefinition],
    grants: scope === "pc" ? [] : [grantFor("viewer-window", permission)],
    files: files ?? {
      ...(scope === "pc" ? {
        "documents/notes/a.md": "a",
        "documents/notes/b.md": "b",
        "documents/images/cover.png": "image",
        "documents/readme.txt": "readme",
      } : {
        "notes/a.md": "a",
        "notes/b.md": "b",
        "images/cover.png": "image",
        "readme.txt": "readme",
      }),
    },
  });
  const explorerWindow = seed.snapshot.shared.windows.find((window) => window.id === "viewer-window");
  if (explorerWindow) explorerWindow.state = legacy ? {} : { folder, view };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call;
  const calls = vi.spyOn(transport, "call");
  const { container } = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, container, originalCall, seed, transport };
}

describe("explorer block", () => {
  it("asks for PC access before showing the two panes, then displays known folders and drives", async () => {
    const { calls, transport } = setup({ scope: "pc" });
    expect(await screen.findByRole("button", { name: "이 PC의 파일 읽기 허용" })).toBeTruthy();
    expect(document.querySelector(".ks-empty-state-without-text")).not.toBeNull();
    expect(screen.queryByRole("tree", { name: "폴더 목록" })).toBeNull();
    await expect(transport.call({ op: "files.list", window_id: "viewer-window", permission: "pc", dir: "" }))
      .rejects.toMatchObject({ code: "not_granted" });

    fireEvent.click(screen.getByRole("button", { name: "이 PC의 파일 읽기 허용" }));

    const tree = await screen.findByRole("tree", { name: "폴더 목록" });
    expect(await within(tree).findByRole("treeitem", { name: /문서/ })).toBeTruthy();
    expect(await within(tree).findByRole("treeitem", { name: /로컬 디스크 \(C:\)/ })).toBeTruthy();
    expect(calls).toHaveBeenCalledWith({ op: "files.allow_pc", window_id: "viewer-window", permission: "pc" });
    expect(screen.getByRole("navigation", { name: "경로" }).querySelector('[aria-current="page"]')?.textContent).toBe("내 PC");
    expect(screen.queryByRole("button", { name: "폴더 바꾸기" })).toBeNull();
  });

  it("keeps the PC access screen and shows the core error below the action when access fails", async () => {
    const { calls, originalCall } = setup({ scope: "pc" });
    calls.mockImplementation((request) => request.op === "files.allow_pc"
      ? Promise.reject({ code: "permission_denied", message: "허용할 수 없습니다", details: [] })
      : originalCall(request));
    fireEvent.click(await screen.findByRole("button", { name: "이 PC의 파일 읽기 허용" }));

    expect((await screen.findByRole("alert")).textContent).toBe("허용할 수 없습니다");
    expect(screen.queryByRole("tree", { name: "폴더 목록" })).toBeNull();
    expect(screen.getByRole("button", { name: "이 PC의 파일 읽기 허용" })).toBeTruthy();
  });

  it("uses virtual PC roots in the breadcrumb and returns from a known folder to This PC", async () => {
    setup({ scope: "pc" });
    fireEvent.click(await screen.findByRole("button", { name: "이 PC의 파일 읽기 허용" }));
    const tree = await screen.findByRole("tree", { name: "폴더 목록" });
    fireEvent.click(await within(tree).findByRole("button", { name: "문서" }));
    fireEvent.click(await within(tree).findByRole("button", { name: "notes" }));

    expect(await screen.findByRole("option", { name: "a.md" })).toBeTruthy();
    const breadcrumb = screen.getByRole("navigation", { name: "경로" });
    expect(Array.from(breadcrumb.querySelectorAll(".ks-explorer-crumb-button"), (button) => button.textContent)).toEqual(["내 PC", "문서"]);
    expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe("notes");
    expect(tree.querySelector('[data-folder-path="documents"]')).not.toBeNull();
    expect(tree.querySelector('[data-folder-path="documents/notes"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "위 폴더" }));
    expect(await screen.findByRole("option", { name: "notes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "위 폴더" }));
    expect(await screen.findByRole("option", { name: "문서" })).toBeTruthy();
    expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe("내 PC");
  });

  it("labels PC root entries in details and opens a virtual path in the declared app", async () => {
    const { calls, transport } = setup({ scope: "pc" });
    fireEvent.click(await screen.findByRole("button", { name: "이 PC의 파일 읽기 허용" }));
    const documents = await screen.findByRole("option", { name: "문서" });
    const downloads = screen.getByRole("option", { name: "다운로드" });
    const drive = await screen.findByRole("option", { name: "로컬 디스크 (C:)" });
    const contents = screen.getByRole("listbox", { name: "폴더 내용" });
    expect(Array.from(within(contents).getAllByRole("option"), (item) => item.textContent)).toEqual([
      "문서", "다운로드", "로컬 디스크 (C:)",
    ]);
    expect(documents.querySelector("svg")?.classList).toContain("lucide-file-text");
    expect(downloads.querySelector("svg")?.classList).toContain("lucide-download");
    expect(drive.querySelector("svg")?.classList).toContain("lucide-hard-drive");
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));
    const table = await screen.findByRole("table", { name: "폴더 내용" });
    const documentsRow = within(table).getByRole("row", { name: /문서/ });
    expect(documentsRow.textContent).toContain("폴더");
    const documentsCells = within(documentsRow).getAllByRole("cell");
    expect(documentsCells[1].textContent).toBe("");
    expect(documentsCells[3].textContent).toBe("");
    expect(within(table).getByRole("row", { name: /로컬 디스크 \(C:\)/ }).textContent).toContain("드라이브");

    const tree = screen.getByRole("tree", { name: "폴더 목록" });
    fireEvent.click(within(tree).getByRole("button", { name: "문서" }));
    fireEvent.click(await within(tree).findByRole("button", { name: "notes" }));
    const fileRow = await within(await screen.findByRole("table", { name: "폴더 내용" })).findByRole("row", { name: /a\.md/ });
    fireEvent.click(fileRow);
    fireEvent.doubleClick(fileRow);
    await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({
      op: "files.open", path: "documents/notes/a.md", app_id: "md-editor",
    })));
    const state = await transport.call({ op: "state.get" });
    // 시험 기본 상태에 편집기 창(editor-window)이 이미 있으므로, 열기가 넘긴 폴더 권한으로 새 창을 찾는다.
    const openedGrant = state.snapshot.device.grants.find((grant) => grant.root_path === "documents/notes");
    const editor = state.snapshot.shared.windows.find((window) => window.id === openedGrant?.window_id);
    expect(editor?.app_id).toBe("md-editor");
    expect(editor?.state.current_file).toBe("a.md");

    const editorFiles = await transport.call({ op: "files.list", window_id: editor!.id, permission: "docs", dir: "" });
    expect(editorFiles.op).toBe("files.list");
    if (editorFiles.op === "files.list") {
      expect(editorFiles.entries.map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
    }
    await expect(transport.call({ op: "files.read", window_id: editor!.id, permission: "docs", path: "a.md" }))
      .resolves.toMatchObject({ text: "a" });
    await expect(transport.call({ op: "files.read", window_id: "viewer-window", permission: "pc", path: "documents/notes/a.md" }))
      .rejects.toMatchObject({ code: "not_granted" });
    await transport.call({ op: "files.write", window_id: editor!.id, permission: "docs", path: "new.md", text: "new" });
    expect(transport.getFiles()["documents/notes/new.md"]).toBe("new");
  });

  it("shows folder navigation beside the current folder contents", async () => {
    setup();
    const folders = await screen.findByRole("tree", { name: "폴더 목록" });
    fireEvent.click(within(folders).getByRole("button", { name: "notes" }));
    expect(await screen.findByRole("option", { name: /a\.md/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /b\.md/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /readme\.txt/ })).toBeNull();
  });

  it("switches to sortable details and preserves folders above files", async () => {
    const { calls } = setup();
    await screen.findByRole("option", { name: "readme.txt" });
    fireEvent.click(await screen.findByRole("button", { name: "자세히 보기" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "", view: "details" },
    }));
    const table = await screen.findByRole("table", { name: "폴더 내용" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "이름", "수정한 날짜", "종류", "크기",
    ]);
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4));
    fireEvent.click(within(within(table).getByRole("columnheader", { name: /크기/ })).getByRole("button"));
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].getAttribute("data-folder-path")).toBeTruthy();
  });

  it("opens a file on double click and writes folder navigation through its declared state key", async () => {
    const { calls } = setup({ folder: "", view: "icons" });
    const folders = await screen.findByRole("tree", { name: "폴더 목록" });
    fireEvent.click(within(folders).getByRole("button", { name: "notes" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "notes", view: "icons" },
    }));
    fireEvent.click(await screen.findByRole("option", { name: /a\.md/ }));
    fireEvent.doubleClick(screen.getByRole("option", { name: /a\.md/ }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "files.open", path: "notes/a.md" })));
  });

  it("keeps the two-pane explorer for older definitions without persisting its local navigation", async () => {
    const { calls } = setup({ legacy: true });
    const folders = await screen.findByRole("tree", { name: "폴더 목록" });
    fireEvent.click(within(folders).getByRole("button", { name: "notes" }));
    expect(await screen.findByRole("option", { name: /a\.md/ })).toBeTruthy();
    expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ op: "window.set_state" }));
  });

  it("describes visible explorer icons, details rows, and folder tree for sharing", async () => {
    const { container } = setup();
    await screen.findByRole("option", { name: "readme.txt" });
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(0, 0, 100, 40));
    vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect(0, 0, 60, 20)] }) as unknown as Range);

    const root = container.firstElementChild as HTMLElement;
    let description = describeVisible(root).text;
    expect(description).toContain("[목록, 전체 3개 중 1~3번째]");
    expect(description).toContain("[트리, 전체 2개 중 1~2번째]");

    fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));
    await screen.findByRole("table", { name: "폴더 내용" });
    description = describeVisible(root).text;
    expect(description).toContain("[표, 전체 3줄 중 1~3번째]");
    expect(description).toContain("[트리, 전체 2개 중 1~2번째]");
  });

  it("returns to the selected root and persists it when the saved folder no longer exists", async () => {
    const { calls } = setup({ folder: "missing", view: "icons" });
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "", view: "icons" },
    }));
    expect(await screen.findByRole("option", { name: "readme.txt" })).toBeTruthy();
  });

  it("reloads the right pane when the selected root changes while it is at the root", async () => {
    const { calls, originalCall, seed, transport } = setup();
    await screen.findByRole("option", { name: "readme.txt" });
    let switched = false;
    calls.mockImplementation(async (request) => {
      if (switched && request.op === "files.list" && request.dir === "") {
        return { op: "files.list", entries: [{ name: "other-root.txt", path: "other-root.txt", kind: "file", size: 15, modified: "2026-10-30T01:00:00Z" }] };
      }
      return originalCall(request);
    });
    const nextGrant = { ...grantFor("viewer-window", "folder", "other"), root_path: "/fake/other" };
    switched = true;
    act(() => transport.emit({
      event: "state.changed",
      snapshot: { ...seed.snapshot, device: { ...seed.snapshot.device, grants: [nextGrant] } },
    }));

    expect(await screen.findByRole("option", { name: "other-root.txt" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "readme.txt" })).toBeNull();
  });

  it("keeps the details view when focus returns from a deleted subfolder to the root", async () => {
    const { calls, originalCall, transport } = setup({ files: {
      "notes/a.md": "a",
      "notes/deeper/gone.md": "gone",
      "readme.txt": "readme",
    } });
    let removed = false;
    calls.mockImplementation(async (request) => {
      if (removed && request.op === "files.list" && request.dir === "notes/deeper") {
        throw { code: "not_found", message: "폴더를 찾을 수 없습니다", details: [] };
      }
      return originalCall(request);
    });

    await screen.findByRole("option", { name: "readme.txt" });
    fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "", view: "details" },
    }));
    await transport.call({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "notes/deeper", view: "details" },
    });
    const table = await screen.findByRole("table", { name: "폴더 내용" });
    await waitFor(() => expect(table.querySelector('[data-file-path="notes/deeper/gone.md"]')).not.toBeNull());

    removed = true;
    act(() => globalThis.window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "", view: "details" },
    }));
    expect(await screen.findByRole("table", { name: "폴더 내용" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "폴더 내용" }).querySelector('[data-file-path="readme.txt"]')).not.toBeNull();
  });
});
