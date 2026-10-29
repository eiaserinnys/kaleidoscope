import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("file_tree block", () => {
  it("목록 접기와 펼치기 뒤 짝이 되는 단추에 포커스를 유지한다", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed({ grants: [grantFor("editor-window", "docs")] })));
    render(<AppWindowContent store={store} windowId="editor-window" />);
    const collapse = await screen.findByRole("button", { name: "목록 접기" });
    collapse.focus();
    fireEvent.click(collapse);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "목록 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "목록 펼치기" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "목록 접기" }));
  });
  it("asks for the declared folder and lists files after it is granted", async () => {
    const transport = createFakeTransport(makeTestSeed({
      files: { "README.md": "# Hello", "notes.txt": "skip" },
    }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    const pickFolder = await screen.findByRole("button", { name: "문서 폴더 고르기" });
    fireEvent.click(pickFolder);

    expect(call).toHaveBeenCalledWith({
      op: "files.pick_folder",
      window_id: "editor-window",
      permission: "docs",
    });
    expect(await screen.findByRole("button", { name: "README.md" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "notes.txt" })).toBeNull();
  });

  it("writes a selected file path through window.set_state", async () => {
    const transport = createFakeTransport(makeTestSeed({
      grants: [grantFor("editor-window", "docs")],
    }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "window.set_state",
      window_id: "editor-window",
      state: { current_file: "README.md" },
    }));
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0]?.state.current_file).toBe("README.md"));
  });
});
