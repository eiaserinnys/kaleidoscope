import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { normalizeBlock } from "../render/render-block";
import { focusRescued, isUnclaimedFocus } from "../components/focus-rescue";
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
    [{ type: "file_tree", root: { permission: "docs" }, extensions: [], selected: { state: "file" }, on_select: { set_state: "file" } }, { type: "folder", root: { permission: "docs" }, extensions: [], selected: { state: "file" }, on_select: { set_state: "file" }, read_only: true, legacyTreeRoot: true }],
    [{ type: "markdown_editor", file: { permission: "docs", path: "README.md" } }, { type: "markdown", file: { permission: "docs", path: "README.md" } }],
    [{ type: "markdown_view", value: "# 제목" }, { type: "markdown", value: "# 제목", read_only: true }],
    [{ type: "code_editor", file: { permission: "docs", path: "main.rs" } }, { type: "code", file: { permission: "docs", path: "main.rs" } }],
    [{ type: "code_view", value: "fn main() {}" }, { type: "code", value: "fn main() {}", read_only: true }],
    [{ type: "agent_chat" }, { type: "chat" }],
    [{ type: "keypad", columns: 4, buttons: [], on_press: { set_state: "value" } }, { type: "button_grid", columns: 4, buttons: [], on_press: { set_state: "value" } }],
  ] as const;
  for (const [legacy, canonical] of aliases) expect(normalizeBlock(legacy as unknown as Block)).toEqual(canonical);
});

describe("app definition renderer", () => {
  it("대신 옮긴 초점을 떠난 뒤 직접 다시 고르면 사용자 초점으로 남긴다", () => {
    render(<><button>대신</button><button>직접</button></>);
    const rescued = screen.getByRole("button", { name: "대신" });
    focusRescued(rescued);
    expect(isUnclaimedFocus(rescued)).toBe(true);
    screen.getByRole("button", { name: "직접" }).focus();
    rescued.focus();
    expect(isUnclaimedFocus(rescued)).toBe(false);
  });
  it("창의 포커스된 조작이 사라지면 남은 첫 조작으로 포커스를 옮긴다", async () => {
    const definition: AppDefinition = {
      id: "focus-test", name: "초점", requires: { blocks: 14, modules: {} }, permissions: [], state: { visible: true },
      ui: { type: "stack", direction: "column", children: [
        { type: "when", value: { state: "visible" }, child: { type: "button", label: "선택", on_click: [{ set_state: "visible", value: false }] } },
        { type: "button", label: "뒤로", on_click: [{ set_state: "visible", value: true }] },
        { type: "button", label: "다음", variant: "primary", on_click: [{ set_state: "visible", value: true }] },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const first = await screen.findByRole("button", { name: "선택" });
    first.focus();
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { visible: false } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "다음" })));
  });

  it("목록 항목을 키보드로 지우면 강조 단추 대신 다음 항목으로 초점을 옮긴다", async () => {
    const definition: AppDefinition = {
      id: "focus-list-test", name: "목록 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ key: "a", title: "Alpha" }, { key: "b", title: "Beta" }, { key: "c", title: "Gamma" }] },
      ui: { type: "stack", direction: "column", children: [
        { type: "list", items: { state: "items" } },
        { type: "button", label: "올리기", variant: "primary", on_click: [{ set_state: "unused" }] },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const alpha = await screen.findByRole("option", { name: "Alpha" });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "Delete" });
    await act(async () => {
      await store.call({ op: "window.set_state", window_id: "viewer-window", state: {
        items: [{ key: "b", title: "Beta" }, { key: "c", title: "Gamma" }],
      } });
    });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" })));
  });

  it("목록이 창 내용의 뿌리여도 삭제 뒤 이웃으로 초점을 옮긴다", async () => {
    const definition: AppDefinition = {
      id: "focus-root-list", name: "목록 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ key: "a", title: "Alpha" }, { key: "b", title: "Beta" }] },
      ui: { type: "list", items: { state: "items" } },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const first = await screen.findByRole("option", { name: "Alpha" });
    first.focus();
    fireEvent.keyDown(first, { key: "Delete" });
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { items: [{ key: "b", title: "Beta" }] } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" })));
  });

  async function focusFixture(markup: string) {
    const definition: AppDefinition = {
      id: "focus-fixture", name: "초점 시험", requires: { blocks: 14, modules: {} },
      permissions: [], state: {}, ui: { type: "text", value: "시험" },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    const { container } = render(<AppWindowContent store={store} windowId="viewer-window" />);
    await screen.findByText("시험");
    const body = container.querySelector(".ks-data-window-body")!;
    const fixture = document.createElement("div");
    fixture.innerHTML = markup;
    body.append(fixture);
    return fixture;
  }

  it("같은 부모에서 가지가 바뀌면 새 화면의 강조 단추로 초점을 옮긴다", async () => {
    const fixture = await focusFixture('<div><div role="list"><button>에이전트 하나</button></div><button>뒤로</button></div>');
    const parent = fixture.firstElementChild!;
    const first = screen.getByRole("button", { name: "에이전트 하나" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const next = document.createElement("button");
    next.className = "ks-button-emphasis";
    next.textContent = "폴더 선택";
    parent.replaceChild(next, first.parentElement!);
    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it("모음에 새 조작이 함께 들어오면 이웃 대신 새 화면의 강조 단추로 옮긴다", async () => {
    const fixture = await focusFixture('<div role="list"><button>이전 항목</button><button>남은 항목</button></div><button class="ks-button-emphasis">다음 화면</button>');
    const group = fixture.firstElementChild!;
    const first = screen.getByRole("button", { name: "이전 항목" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const replacement = document.createElement("button");
    replacement.textContent = "새 항목";
    group.replaceChild(replacement, first);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "다음 화면" })));
  });

  it("승인 목록이 비면 말풍선 대신 대화 입력칸으로 초점을 옮긴다", async () => {
    await focusFixture('<div><button>내 말풍선</button><div role="list"><button>허용</button></div></div><textarea class="ks-agent-chat-input" aria-label="메시지"></textarea>');
    const allow = screen.getByRole("button", { name: "허용" });
    allow.focus();
    fireEvent.keyDown(allow, { key: "Enter" });
    allow.parentElement!.removeChild(allow);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "메시지" })));
  });

  it("마지막 목록 항목을 지우면 뒤의 강조 단추가 아닌 앞 조작에 초점을 둔다", async () => {
    const fixture = await focusFixture('<button>앞 조작</button><div role="list"><button>마지막 지우기</button></div><button class="ks-button-emphasis">올리기</button>');
    const remove = screen.getByRole("button", { name: "마지막 지우기" });
    remove.focus();
    fireEvent.keyDown(remove, { key: "Enter" });
    fixture.children[1].removeChild(remove);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "앞 조작" })));
  });

  it("빈 목록 앞에 조작이 없으면 창 내용에 테두리 없이 초점을 둔다", async () => {
    const fixture = await focusFixture('<div role="list"><button>마지막 지우기</button></div><button class="ks-button-emphasis">올리기</button>');
    const remove = screen.getByRole("button", { name: "마지막 지우기" });
    remove.focus();
    fireEvent.keyDown(remove, { key: "Enter" });
    fixture.firstElementChild!.removeChild(remove);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
  });

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
    const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("지원하지 않는 블록: future_block");
    expect(container.querySelector("[data-ks-app-id]")?.getAttribute("data-ks-app-id")).toBe("md-editor");
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
