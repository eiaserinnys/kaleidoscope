import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { normalizeBlock } from "../render/render-block";
import { grantFor, makeTestSeed, mdEditorDefinition, mdViewerDefinition } from "./fixtures";

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

it("기존 블록 이름을 정본 이름과 모드로 정규화한다", () => {
  const aliases = [
    [{ type: "file_tree", root: { permission: "docs" }, extensions: [], selected: { state: "file" }, on_select: { set_state: "file" } }, { type: "tree", root: { permission: "docs" }, extensions: [], by: "children", selected: { state: "file" }, on_select: { set_state: "file" } }],
    [{ type: "markdown_editor", file: { permission: "docs", path: "README.md" } }, { type: "markdown", file: { permission: "docs", path: "README.md" } }],
    [{ type: "markdown_view", value: "# 제목" }, { type: "markdown", value: "# 제목", read_only: true }],
    [{ type: "code_editor", file: { permission: "docs", path: "main.rs" } }, { type: "code", file: { permission: "docs", path: "main.rs" } }],
    [{ type: "code_view", value: "fn main() {}" }, { type: "code", value: "fn main() {}", read_only: true }],
    [{ type: "agent_chat" }, { type: "chat" }],
    [{ type: "agent_session", permission: "run", root: { permission: "work" }, agents: [], selected: { state: "agent" }, on_select: { set_state: "agent" } }, { type: "chat", permission: "run", root: { permission: "work" }, agents: [], selected: { state: "agent" }, on_select: { set_state: "agent" } }],
    [{ type: "keypad", columns: 4, buttons: [], on_press: { set_state: "value" } }, { type: "button_grid", columns: 4, buttons: [], on_press: { set_state: "value" } }],
  ] as const;
  for (const [legacy, canonical] of aliases) expect(normalizeBlock(legacy as unknown as Block)).toEqual(canonical);
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
          { type: "markdown", file: { permission: "docs", path: "README.md" }, read_only: true },
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
    expect(screen.queryByRole("status", { name: "저장 대기" })).toBeNull();
  });

  it("shows a pending dot while edited and removes it after saving", async () => {
    const transport = createFakeTransport(makeTestSeed({
      editorPath: "README.md",
      grants: [grantFor("editor-window", "docs")],
      files: { "README.md": "# Pending" },
    }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="editor-window" />);

    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const user = userEvent.setup();
    await user.click(editor);
    await user.keyboard("X");

    expect(screen.getByRole("status", { name: "저장 대기" })).toBeTruthy();
    await user.keyboard("{Control>}s{/Control}");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("status", { name: "저장 대기" })).toBeNull();
    expect(screen.queryByRole("status", { name: "저장 중" })).toBeNull();
  });

  it("leaves editor and viewer content blank until a path is selected", async () => {
    const editorStore = createShellStore(createFakeTransport(makeTestSeed({
      editorPath: null,
      grants: [grantFor("editor-window", "docs")],
    })));
    const editorView = render(<AppWindowContent store={editorStore} windowId="editor-window" />);

    expect(await screen.findByRole("tree", { name: "파일 목록" })).toBeTruthy();
    expect(screen.queryByText("폴더를 먼저 선택하세요")).toBeNull();
    expect(screen.queryByText("파일을 선택하세요")).toBeNull();
    editorView.unmount();

    const viewerStore = createShellStore(createFakeTransport(makeTestSeed({
      definitions: [mdViewerDefinition],
      viewerPath: null,
    })));
    render(<AppWindowContent store={viewerStore} windowId="viewer-window" />);

    expect(screen.queryByText("폴더를 먼저 선택하세요")).toBeNull();
    expect(screen.queryByText("파일을 선택하세요")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
