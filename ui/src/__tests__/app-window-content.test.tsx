import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed, mdEditorDefinition } from "./fixtures";

const rangeGetClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");

beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
});

afterEach(() => {
  cleanup();
  if (rangeGetClientRects) Object.defineProperty(Range.prototype, "getClientRects", rangeGetClientRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.restoreAllMocks();
});

describe("app definition renderer", () => {
  it("shows an unknown block error while rendering its sibling block", async () => {
    const definition: AppDefinition = {
      ...mdEditorDefinition,
      ui: {
        type: "split",
        direction: "row",
        children: [
          { type: "future_block" } as unknown as Block,
          { type: "markdown_view", file: { permission: "docs", path: "README.md" } },
        ],
      },
    };
    const transport = createFakeTransport(makeTestSeed({
      definitions: [definition],
      grants: [grantFor("editor-window", "docs")],
      files: { "README.md": "# Remaining block" },
    }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    expect((await screen.findByRole("alert")).textContent).toContain("지원하지 않는 블록: future_block");
    expect(await screen.findByRole("heading", { name: "Remaining block" })).toBeTruthy();
  });

  it("keeps the cursor where it was while typing into a CRLF file", async () => {
    const transport = createFakeTransport(makeTestSeed({
      editorPath: "windows.md",
      grants: [grantFor("editor-window", "docs")],
      files: { "windows.md": "first\r\nsecond" },
    }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("편집기 뷰를 찾지 못했습니다");
    // 문서 중간(「fir|st」)에서 친다. 끝에서 치면 통째 교체 뒤에도 커서가 끝에 남아 결함이 안 보인다.
    await act(async () => {
      view.dispatch({ changes: { from: 3, insert: "A" }, selection: { anchor: 4 } });
    });
    await act(async () => {
      view.dispatch({ changes: { from: 4, insert: "B" }, selection: { anchor: 5 } });
    });

    expect(view.state.selection.main.head).toBe(5);
    expect(view.state.sliceDoc()).toBe("firABst\r\nsecond");
  });

  it("keeps unsaved markdown visible when a write fails", async () => {
    const transport = createFakeTransport(makeTestSeed({
      editorPath: "README.md",
      grants: [grantFor("editor-window", "docs")],
      files: { "README.md": "# Keep editing" },
    }));
    const call = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const user = userEvent.setup();
    await user.click(editor);
    call.mockRejectedValueOnce({ code: "io", message: "파일을 쓸 수 없습니다", details: [] });
    await user.keyboard("X");

    expect((await screen.findByRole("alert", {}, { timeout: 3_000 })).textContent).toContain("파일을 쓸 수 없습니다");
    expect(screen.getByRole("textbox", { name: "마크다운 편집기" })).toBeTruthy();
    expect(screen.getByText("저장 안 됨")).toBeTruthy();
  });
});
