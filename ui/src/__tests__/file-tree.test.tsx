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

  it("creates an md file only for readwrite access and selects it", async () => {
    const transport = createFakeTransport(makeTestSeed({
      grants: [grantFor("editor-window", "docs"), grantFor("viewer-window", "docs")],
      files: { "README.md": "# Hello" },
    }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    fireEvent.click(await screen.findByRole("button", { name: "새 파일" }));
    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    fireEvent.change(input, { target: { value: "회의 메모" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "files.write",
      window_id: "editor-window",
      permission: "docs",
      path: "회의 메모.md",
      text: "",
    }));
    await waitFor(() => expect(store.getSnapshot()?.shared.windows.find((item) => item.id === "editor-window")?.state.current_file).toBe("회의 메모.md"));
    expect((await screen.findByRole("button", { name: "회의 메모.md" })).getAttribute("aria-current")).toBe("page");
    expect(transport.getFiles()["회의 메모.md"]).toBe("");
  });

  it("loads the selected nested directory chain before showing the new-file row", async () => {
    const transport = createFakeTransport(makeTestSeed({
      editorPath: "notes/sub/기존.md",
      grants: [grantFor("editor-window", "docs")],
      files: { "notes/sub/기존.md": "# Existing" },
    }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    await screen.findByRole("button", { name: "notes" });
    await waitFor(() => expect(call.mock.calls
      .filter(([request]) => request.op === "files.list")
      .map(([request]) => request.op === "files.list" ? request.dir : null)).toEqual([""]));
    fireEvent.click(screen.getByRole("button", { name: "새 파일" }));

    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    await waitFor(() => {
      const directories = call.mock.calls
        .filter(([request]) => request.op === "files.list")
        .map(([request]) => request.op === "files.list" ? request.dir : null);
      expect(directories).toContain("notes");
      expect(directories).toContain("notes/sub");
    });
    const nestedChildren = input.closest(".ks-file-tree-children");
    expect(nestedChildren?.querySelector('[role="treeitem"] input[aria-label="새 파일 이름"]')).toBe(input);
    expect(await screen.findByRole("button", { name: "기존.md" })).toBeTruthy();
  });

  it("keeps the entered name and reports a conflict in the inline row", async () => {
    const transport = createFakeTransport(makeTestSeed({
      grants: [grantFor("editor-window", "docs")],
      files: { "notes.md": "already here" },
    }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    fireEvent.click(await screen.findByRole("button", { name: "새 파일" }));
    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain("같은 이름의 파일이 있습니다");
    expect((screen.getByRole("textbox", { name: "새 파일 이름" }) as HTMLInputElement).value).toBe("notes.md");
    expect(transport.getFiles()["notes.md"]).toBe("already here");
  });

  it("cancels new-file creation on Escape", async () => {
    const transport = createFakeTransport(makeTestSeed({ grants: [grantFor("editor-window", "docs")] }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    fireEvent.click(await screen.findByRole("button", { name: "새 파일" }));
    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    fireEvent.change(input, { target: { value: "취소.md" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "새 파일 이름" })).toBeNull());
    expect(call).not.toHaveBeenCalledWith(expect.objectContaining({ op: "files.write" }));
    expect(transport.getFiles()["취소.md"]).toBeUndefined();
  });
});
