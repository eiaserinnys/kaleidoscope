import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import explorerJson from "../../../examples/explorer.json";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
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

function setup({ legacy = false, folder = "", view = "icons" }: { legacy?: boolean; folder?: string; view?: string } = {}) {
  const definition: AppDefinition = {
    ...(explorerJson as AppDefinition),
    requires: { blocks: legacy ? 3 : 5, modules: { files: 1 } },
    state: legacy ? {} : { folder, view },
    ui: legacy
      ? { type: "explorer", root: { permission: "folder" } }
      : explorerJson.ui as Block,
  };
  const seed = makeTestSeed({
    definitions: [definition, mdEditorDefinition],
    grants: [grantFor("viewer-window", "folder")],
    files: {
      "notes/a.md": "a",
      "notes/b.md": "b",
      "images/cover.png": "image",
      "readme.txt": "readme",
    },
  });
  const explorerWindow = seed.snapshot.shared.windows.find((window) => window.id === "viewer-window");
  if (explorerWindow) explorerWindow.state = legacy ? {} : { folder, view };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}

describe("explorer block", () => {
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

  it("returns to the selected root and persists it when the saved folder no longer exists", async () => {
    const { calls } = setup({ folder: "missing", view: "icons" });
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.set_state", window_id: "viewer-window", state: { folder: "", view: "icons" },
    }));
    expect(await screen.findByRole("option", { name: "readme.txt" })).toBeTruthy();
  });
});
