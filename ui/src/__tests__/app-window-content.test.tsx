import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { ContextMenuHost } from "../components/context-menu";
import type { WindowData } from "../data/window-data";
import { normalizeBlock } from "../render/render-block";
import { bookmarkTarget, focusBookmark, focusRescued, isUnclaimedFocus, restoreWindowFocus } from "../components/focus-rescue";
import { commentSession, forgetCommentSession } from "../comments/session";
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
  it("앱이 없는 창과 앱의 판만 없는 창을 구분한다", async () => {
    const missingApp = makeTestSeed({ definitions: [mdViewerDefinition] });
    missingApp.snapshot.shared.apps = [];
    missingApp.snapshot.shared.app_versions = [];
    const first = createShellStore(createFakeTransport(missingApp));
    const view = render(<AppWindowContent store={first} windowId="viewer-window" />);
    expect((await screen.findByRole("alert")).querySelector(".ks-error-id")?.textContent).toBe("SHELL_APP_NOT_INSTALLED");
    expect(screen.getByText(/md-viewer 앱이 이 기기에 설치되어 있지 않습니다/)).toBeTruthy();
    view.unmount();
    first.dispose();

    const missingVersion = makeTestSeed({ definitions: [mdViewerDefinition] });
    missingVersion.snapshot.shared.app_versions = [];
    const second = createShellStore(createFakeTransport(missingVersion));
    render(<AppWindowContent store={second} windowId="viewer-window" />);
    expect((await screen.findByRole("alert")).querySelector(".ks-error-id")?.textContent).toBe("SHELL_APP_VERSION_NOT_FOUND");
    expect(screen.getByText(/앱 정의를 찾을 수 없어 창을 표시하지 못했습니다/)).toBeTruthy();
    second.dispose();
  });
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
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "뒤로" })));
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

  async function noticeFocusFixture() {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const definition: AppDefinition = {
      id: "notice-focus", name: "알림 초점", requires: { blocks: 14, modules: {} },
      permissions: [], state: {}, ui: { type: "list", items: [{ key: "a", title: "첫 내용" }, { key: "b", title: "다음 내용" }] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    let data: WindowData | null = null;
    const view = render(<AppWindowContent store={store} windowId="viewer-window" onWindowData={(value) => { data = value; }} />);
    const row = await screen.findByRole("option", { name: "첫 내용" });
    await waitFor(() => expect(data).not.toBeNull());
    return { ...view, row, showNotice: () => act(() => data!.setNotice("동작을 처리하지 못했습니다")) };
  }

  it("알림을 닫으면 마지막으로 고른 본문 행으로 초점을 돌린다", async () => {
    const { container, row, showNotice } = await noticeFocusFixture();
    row.focus();
    showNotice();
    container.querySelector(".ks-data-window-notice")!.setAttribute("data-ks-overlay", "");
    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    const update = document.createElement("span");
    container.querySelector(".ks-data-window-notice")!.append(update);
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(close);
    update.remove();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("본문 초점 기록 없이 알림을 닫으면 첫 내용으로 초점을 옮긴다", async () => {
    const { row, showNotice } = await noticeFocusFixture();
    showNotice();
    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  async function noticeFixture(markup: string) {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const definition: AppDefinition = {
      id: "notice-fixture", name: "알림 초점", requires: { blocks: 14, modules: {} },
      permissions: [], state: {}, ui: { type: "text", value: "시험" },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    let data: WindowData | null = null;
    const { container } = render(<AppWindowContent store={store} windowId="viewer-window" onWindowData={(value) => { data = value; }} />);
    await screen.findByText("시험");
    const body = container.querySelector(".ks-data-window-body")!;
    const fixture = document.createElement("div");
    fixture.innerHTML = markup;
    body.append(fixture);
    await waitFor(() => expect(data).not.toBeNull());
    return { container, fixture, showNotice: () => act(() => data!.setNotice("동작을 처리하지 못했습니다")), showStatus: () => act(() => data!.setStatus("저장했습니다")) };
  }

  it("상태 알림만 뜨면 본문 아래 자리를 주지 않고 창 오류 알림에만 준다", async () => {
    const previous = globalThis.ResizeObserver;
    let fire: (() => void) | null = null;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { fire = () => callback([], this as unknown as ResizeObserver); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains("ks-notice") ? 46 : 0 } as DOMRect;
    });
    try {
      const { container, showStatus, showNotice } = await noticeFixture("<p>본문</p>");
      const body = container.querySelector(".ks-data-window-body") as HTMLElement;
      showStatus();
      await screen.findByRole("status");
      fire!();
      expect(body.style.getPropertyValue("--ks-notice-space")).toBe("0px");
      showNotice();
      await screen.findByRole("alert");
      fire!();
      expect(body.style.getPropertyValue("--ks-notice-space")).toBe("calc(var(--ks-space-4) + 46px)");
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = previous;
    }
  });

  it("본문 밖 알림 단추를 닫으면 마지막 단추가 아니라 쓰던 글칸으로 돌아간다", async () => {
    const { showNotice } = await noticeFixture('<textarea aria-label="메모"></textarea><button>올리기</button>');
    const memo = screen.getByRole("textbox", { name: "메모" });
    const submit = screen.getByRole("button", { name: "올리기" });
    memo.focus();
    submit.focus();
    showNotice();
    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(memo));
  });

  it("본문 밖 알림을 닫으면 글칸이 없을 때 마지막 내용 행으로 돌아간다", async () => {
    const { showNotice } = await noticeFixture('<div role="listbox"><div role="option" tabindex="0">첫 행</div></div><button>올리기</button>');
    const row = screen.getByRole("option", { name: "첫 행" });
    row.focus();
    screen.getByRole("button", { name: "올리기" }).focus();
    showNotice();
    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("강조 단추만 있는 창은 열 때 강조 단추 대신 창 본문에 초점을 둔다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const definition: AppDefinition = {
      id: "focus-emphasis-only", name: "강조뿐", requires: { blocks: 14, modules: {} }, permissions: [], state: {},
      ui: { type: "button", label: "올리기", variant: "primary", on_click: { set_state: "sent" } },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    expect(document.activeElement?.classList.contains("ks-button-emphasis")).toBe(false);
  });

  it("분할 손잡이는 책갈피 복귀 대상이 아니다", () => {
    const content = document.createElement("div");
    content.className = "ks-data-window-body";
    content.innerHTML = '<div class="ks-split-pane"><div role="separator" tabindex="0"></div><input aria-label="메모" /></div>';
    document.body.append(content);
    const handle = content.querySelector<HTMLElement>('[role="separator"]')!;
    const target = bookmarkTarget(focusBookmark(handle, content), content);
    expect(target).not.toBe(handle);
    expect(target.getAttribute("aria-label")).toBe("메모");
    content.remove();
  });

  it("대화상자 안의 초점 요소가 제거될 때 창의 복구가 개입하지 않는다", async () => {
    const { container, row } = await noticeFocusFixture();
    row.focus();
    const overlay = document.createElement("div");
    overlay.className = "ks-dialog-overlay";
    const button = document.createElement("button");
    overlay.append(button);
    container.querySelector(".ks-data-window")!.append(overlay);
    button.focus();
    button.remove();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body);
  });

  function dialogNoticeDefinition(): AppDefinition {
    return {
      id: "dialog-notice", name: "대화상자 알림", requires: { blocks: 19, modules: {} }, permissions: [],
      state: { open: false, draft: "보존", confirmed: false },
      ui: { type: "stack", direction: "column", children: [
        { type: "button", label: "열기", on_click: [{ set_state: "open", value: true }] },
        {
          type: "dialog", open: { state: "open" }, title: "변경 확인", close_label: "확인",
          child: { type: "input", value: { state: "draft" }, on_change: { set_state: "draft" } },
          on_confirm: [{ set_state: "open", value: false }, { set_state: "confirmed", value: true }],
          on_close: [{ set_state: "open", value: false }],
        },
      ] },
    };
  }

  it("확정 실패 알림은 열린 대화상자 안에 남고 닫은 뒤 다시 확인할 수 있다", async () => {
    const transport = createFakeTransport(makeTestSeed({ definitions: [dialogNoticeDefinition()] }));
    const original = transport.call.bind(transport);
    let failing = true;
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (failing && request.op === "data.act" && request.pointer.endsWith("/on_confirm")) throw new Error("저장하지 못했습니다");
      return original(request);
    });
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const opener = await screen.findByRole("button", { name: "열기" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("보존");
    const confirm = within(dialog).getByRole("button", { name: "확인" });
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent).toContain("저장하지 못했습니다");
    expect(alert.querySelector(".ks-error-id")?.textContent).toBe("SHELL_CALL_UNEXPECTED_FAILURE");
    const slot = dialog.querySelector(".ks-dialog-notice-slot");
    expect(slot?.contains(alert)).toBe(true);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(input.value).toBe("보존");
    expect(document.activeElement).toBe(confirm);
    const close = within(dialog).getByRole("button", { name: "닫기" });
    expect(slot?.contains(close)).toBe(true);
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" })));
    expect(screen.getByRole("dialog")).toBe(dialog);
    failing = false;
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("대화상자를 취소하면 남은 상태 알림은 창 자리로 돌아간다", async () => {
    let data: WindowData | null = null;
    const transport = createFakeTransport(makeTestSeed({ definitions: [dialogNoticeDefinition()] }));
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="viewer-window" onWindowData={(value) => { data = value; }} />);
    const opener = await screen.findByRole("button", { name: "열기" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(data).not.toBeNull());
    act(() => data!.setStatus("저장했습니다"));
    const status = await within(dialog).findByRole("status");
    expect(dialog.querySelector(".ks-dialog-notice-slot")?.contains(status)).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const windowNotice = document.querySelector(".ks-data-window-notice") as HTMLElement;
    expect(within(windowNotice).getByRole("status").textContent).toContain("저장했습니다");
  });

  it("포인터로 repeat 줄을 지우면 이웃 줄의 같은 자리에 초점을 둔다", async () => {
    await focusFixture('<div class="ks-repeat-content"><div><button>첫 행</button><button>첫 해제</button></div><div><button>둘째 행</button><button>둘째 해제</button></div></div>');
    const removed = screen.getByRole("button", { name: "첫 해제" });
    fireEvent.pointerDown(removed);
    removed.focus();
    removed.parentElement!.remove();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "둘째 해제" })));
  });

  it("포인터로 가지를 바꾸면 같은 자리의 새 단추에 초점을 둔다", async () => {
    await focusFixture('<div><button>해제</button></div>');
    const old = screen.getByRole("button", { name: "해제" });
    fireEvent.pointerDown(old);
    old.focus();
    const next = document.createElement("button");
    next.textContent = "모두 해제";
    old.replaceWith(next);
    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it("포인터 복구도 같은 칸의 입력에 초점을 둔다", async () => {
    await focusFixture('<div><button>해제</button><input aria-label="검색" /></div>');
    const old = screen.getByRole("button", { name: "해제" });
    fireEvent.pointerDown(old);
    old.focus();
    old.remove();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "검색" })));
  });

  it("잠긴 조작은 같은 칸의 내용으로 초점을 넘긴다", async () => {
    await focusFixture('<div class="ks-split-pane"><button>위로</button><div role="listbox"><div role="option" tabindex="0">항목</div></div></div><div role="separator" tabindex="0"></div>');
    const up = screen.getByRole("button", { name: "위로" }) as HTMLButtonElement;
    up.focus();
    up.disabled = true;
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "항목" })));
  });

  it("처리 중 단추는 초점을 유지하고 실제로 잠기면 내용으로 넘긴다", async () => {
    await focusFixture('<div class="ks-split-pane"><button>위로</button><div role="listbox"><div role="option" tabindex="0">항목</div></div></div>');
    const up = screen.getByRole("button", { name: "위로" }) as HTMLButtonElement;
    up.focus();
    up.setAttribute("aria-disabled", "true");
    up.setAttribute("aria-busy", "true");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(up);
    up.disabled = true;
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "항목" })));
  });

  it("StrictMode 재실행 뒤 늦게 나타난 내용에 초점을 둔다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const definition: AppDefinition = {
      id: "focus-delayed", name: "늦은 내용", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { visible: false }, ui: { type: "when", value: { state: "visible" }, child: { type: "list", items: [{ key: "a", title: "첫 내용" }] } },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<StrictMode><AppWindowContent store={store} windowId="viewer-window" /></StrictMode>);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { visible: true } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "첫 내용" })));
  });

  it("늦게 나타난 일반 조작도 임시 본문 다음에 초점을 받는다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const definition: AppDefinition = {
      id: "focus-delayed-button", name: "늦은 조작", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { visible: false }, ui: { type: "when", value: { state: "visible" }, child: { type: "button", label: "시작", on_click: { set_state: "done" } } },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<StrictMode><AppWindowContent store={store} windowId="viewer-window" /></StrictMode>);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { visible: true } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "시작" })));
  });

  it("새 맨 위 창은 도구 막대보다 내용에 첫 초점을 둔다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const definition: AppDefinition = {
      id: "focus-first", name: "첫 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ key: "a", title: "Alpha" }], search: "" },
      ui: { type: "stack", direction: "column", children: [
        { type: "toolbar", start: [{ type: "input", label: "검색", value: { state: "search" }, on_change: { set_state: "search" } }] },
        { type: "list", items: { state: "items" } },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const row = await screen.findByRole("option", { name: "Alpha" });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("커멘트 상태에서는 사라진 앱 조작의 초점을 자동으로 옮기지 않는다", async () => {
    await focusFixture('<div class="ks-split-pane"><button>허용</button><button>다음</button></div>');
    const button = screen.getByRole("button", { name: "허용" });
    button.focus();
    commentSession("viewer-window").set(true);
    button.remove();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body);
    commentSession("viewer-window").set(false);
    forgetCommentSession("viewer-window");
  });

  it("커멘트 종료 뒤 창 내용에서 마지막 앱 초점으로 돌아간다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const fixture = await focusFixture('<div role="listbox"><button role="option" tabindex="0">첫째</button><button role="option" tabindex="-1">둘째</button></div>');
    const second = screen.getByRole("option", { name: "둘째" });
    second.focus();
    const content = fixture.closest<HTMLElement>(".ks-app-window-content")!;
    commentSession("viewer-window").set(true);
    content.tabIndex = -1;
    content.focus();
    commentSession("viewer-window").set(false);
    restoreWindowFocus(content);
    expect(document.activeElement).toBe(second);
    forgetCommentSession("viewer-window");
  });

  it("실제 목록의 끝 항목과 마지막 항목 삭제를 구분한다", async () => {
    const definition: AppDefinition = {
      id: "focus-empty-list", name: "목록 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ key: "a", title: "Alpha" }, { key: "b", title: "Beta" }] },
      ui: { type: "stack", direction: "column", children: [
        { type: "button", label: "앞 조작", on_click: [{ set_state: "unused" }] },
        { type: "list", items: { state: "items" } },
        { type: "button", label: "올리기", variant: "primary", on_click: [{ set_state: "unused" }] },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const beta = await screen.findByRole("option", { name: "Beta" });
    beta.focus();
    fireEvent.keyDown(beta, { key: "Delete" });
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { items: [{ key: "a", title: "Alpha" }] } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("option", { name: "Alpha" })));
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { items: [] } }); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "앞 조작" })));
  });

  it("repeat 항목이 남은 채 when 안의 단추만 바뀌면 강조 단추가 아닌 창 본문으로 초점을 옮긴다", async () => {
    const definition: AppDefinition = {
      id: "focus-repeat-when", name: "반복 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ id: "a" }, { id: "b" }], visible: true },
      ui: { type: "stack", direction: "column", children: [
        { type: "repeat", items: { state: "items" }, key: "id", template: {
          type: "when", value: { state: "visible" }, child: { type: "button", label: "선택", on_click: [{ set_state: "visible", value: false }] },
        } },
        { type: "button", label: "다음 화면", variant: "primary", on_click: [{ set_state: "unused" }] },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const first = (await screen.findAllByRole("button", { name: "선택" }))[0];
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const replacement = definition.state!.items;
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { items: replacement, visible: false } }); });
    // 강조 단추는 자동 선택하지 않는다. 남은 조작이 강조 단추뿐이면 창 본문에 임시 초점을 두고 Tab으로 가게 한다.
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "다음 화면" }));
  });

  it("모음이 when으로 사라지고 강조 단추만 남으면 창 본문으로 초점을 옮긴다", async () => {
    const definition: AppDefinition = {
      id: "focus-sibling-when", name: "전환 초점", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { items: [{ id: "a" }], choosing: true, next: false },
      ui: { type: "stack", direction: "column", children: [
        { type: "when", value: { state: "choosing" }, child: {
          type: "repeat", items: { state: "items" }, key: "id", template: {
            type: "button", label: "선택", on_click: [{ set_state: "unused" }],
          },
        } },
        { type: "when", value: { state: "next" }, child: {
          type: "button", label: "폴더 선택", variant: "primary", on_click: [{ set_state: "unused" }],
        } },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const first = await screen.findByRole("button", { name: "선택" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { choosing: false, next: true } }); });
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "폴더 선택" }));
  });

  it("같은 부모에서 가지가 바뀌면 강조 단추가 아닌 일반 단추로 초점을 옮긴다", async () => {
    const fixture = await focusFixture('<div><div role="list"><button>에이전트 하나</button></div><button>뒤로</button></div>');
    const parent = fixture.firstElementChild!;
    const first = screen.getByRole("button", { name: "에이전트 하나" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const next = document.createElement("button");
    next.className = "ks-button-emphasis";
    next.textContent = "폴더 선택";
    parent.replaceChild(next, first.parentElement!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "뒤로" })));
  });

  it("모음에 새 조작이 함께 들어오면 문서 순서의 첫 조작으로 옮긴다", async () => {
    const fixture = await focusFixture('<div role="list"><button>이전 항목</button><button>남은 항목</button></div><button class="ks-button-emphasis">다음 화면</button>');
    const group = fixture.firstElementChild!;
    const first = screen.getByRole("button", { name: "이전 항목" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const replacement = document.createElement("button");
    replacement.textContent = "새 항목";
    group.replaceChild(replacement, first);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "새 항목" })));
  });

  it("초점을 쥔 글칸이 같은 자리의 단추로 바뀌면 그 단추로 옮기고 스크롤을 건드리지 않는다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const rows = Array.from({ length: 30 }, (_, index) => ({ key: `r${index}`, title: `행 ${String(index + 1).padStart(2, "0")}` }));
    const definition: AppDefinition = {
      id: "focus-swap", name: "같은 자리 교체", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { rows, idle: true, editing: false, name: "" },
      ui: { type: "stack", direction: "column", children: [
        { type: "list", items: { state: "rows" } },
        { type: "when", value: { state: "idle" }, child: { type: "button", label: "편집 시작", on_click: [{ set_state: "idle", value: false }, { set_state: "editing", value: true }] } },
        { type: "when", value: { state: "editing" }, child: {
          type: "input", label: "이름", value: { state: "name" }, on_change: { set_state: "name" }, focus: { state: "editing" },
          on_submit: [{ set_state: "editing", value: false }, { set_state: "idle", value: true }],
          on_cancel: [{ set_state: "editing", value: false }, { set_state: "idle", value: true }],
        } },
      ] },
    };
    const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
    const original = transport.call.bind(transport);
    // 실제 코어는 연속된 SetState를 한 번의 상태 갱신으로 모아 보낸다(crates/core/src/data_runtime/actions.rs).
    // 가짜 전송은 한 번에 하나씩 적용해 제거와 생성이 다른 MutationObserver 알림으로 오므로,
    // 같은 알림으로 오는 실제 동작을 여기서 재현한다.
    vi.spyOn(transport, "call").mockImplementation(async (request) => {
      if (request.op === "data.act" && (request.pointer.endsWith("/on_submit") || request.pointer.endsWith("/on_cancel"))) {
        await original({ op: "window.patch_state", window_id: request.window_id, patch: { editing: false, idle: true } });
        return { op: "data.act", sequence: 0 };
      }
      return original(request);
    });
    const store = createShellStore(transport);
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const open = await screen.findByRole("button", { name: "편집 시작" });
    fireEvent.click(open);
    const input = await screen.findByRole("textbox", { name: "이름" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    fireEvent.keyDown(input, { key: "Enter" });
    const afterEnter = await screen.findByRole("button", { name: "편집 시작" });
    await waitFor(() => expect(document.activeElement).toBe(afterEnter));
    // jsdom에는 배치가 없어 스크롤 자체는 잴 수 없다. 쉘이 옮기는 초점이 스크롤을 건드리지 않는지로 확인한다.
    expect(focus.mock.calls.at(-1)?.[0]).toMatchObject({ preventScroll: true });

    fireEvent.click(afterEnter);
    const again = await screen.findByRole("textbox", { name: "이름" });
    await waitFor(() => expect(document.activeElement).toBe(again));

    fireEvent.keyDown(again, { key: "Escape" });
    const afterEscape = await screen.findByRole("button", { name: "편집 시작" });
    await waitFor(() => expect(document.activeElement).toBe(afterEscape));
    expect(focus.mock.calls.at(-1)?.[0]).toMatchObject({ preventScroll: true });
    store.dispose();
  });

  it("초점을 쥔 글칸이 같은 자리의 Tab 순서 밖 트리 행으로 바뀌면 그 행으로 옮긴다", async () => {
    await focusFixture('<div role="tree"><div class="ks-tree-virtual-row"><button role="treeitem" tabindex="0">앞 행</button></div><div class="ks-tree-virtual-row"><div class="ks-file-tree-entry"><input aria-label="항목 이름" /></div></div></div>');
    const input = screen.getByRole("textbox", { name: "항목 이름" });
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    const next = document.createElement("button");
    next.setAttribute("role", "treeitem");
    next.tabIndex = -1;
    next.textContent = "확정한 행";
    input.parentElement!.replaceWith(next);
    await waitFor(() => expect(document.activeElement).toBe(next));
  });

  it("초점을 쥔 글칸이 사라지기 전 알림에서 생긴 같은 자리 조작으로 초점을 옮긴다", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const rows = Array.from({ length: 30 }, (_, index) => ({ key: `r${index}`, title: `행 ${String(index + 1).padStart(2, "0")}` }));
    const definition: AppDefinition = {
      id: "focus-swap-split", name: "두 알림 교체", requires: { blocks: 14, modules: {} }, permissions: [],
      state: { rows, idle: false, editing: true, name: "" },
      ui: { type: "stack", direction: "column", children: [
        { type: "list", items: { state: "rows" } },
        { type: "when", value: { state: "idle" }, child: { type: "button", label: "편집 시작", on_click: [{ set_state: "idle", value: false }, { set_state: "editing", value: true }] } },
        { type: "when", value: { state: "editing" }, child: {
          type: "input", label: "이름", value: { state: "name" }, on_change: { set_state: "name" }, focus: { state: "editing" },
          on_submit: [{ set_state: "editing", value: false }, { set_state: "idle", value: true }],
          on_cancel: [{ set_state: "editing", value: false }, { set_state: "idle", value: true }],
        } },
      ] },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<AppWindowContent store={store} windowId="viewer-window" />);
    const input = await screen.findByRole("textbox", { name: "이름" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    // 실제 앱은 저장이 끝나고 글칸을 닫는 두 번의 내보내기를 따로 하므로, 새 조작이 생기는 알림과
    // 초점을 쥔 글칸이 사라지는 알림이 나뉘어 온다. 첫 알림에서는 글칸이 아직 살아 있다.
    await act(async () => { await store.call({ op: "window.patch_state", window_id: "viewer-window", patch: { idle: true } }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const added = screen.getByRole("button", { name: "편집 시작" });
    expect(input.isConnected).toBe(true);

    await act(async () => { await store.call({ op: "window.patch_state", window_id: "viewer-window", patch: { editing: false } }); });
    await waitFor(() => expect(document.activeElement).toBe(added));
    expect(focus.mock.calls.at(-1)?.[0]).toMatchObject({ preventScroll: true });
    store.dispose();
  });

  // 구역 반복 key가 이름인 앱. 이름을 바꾸면 그 구역이 새 key로 다시 만들어져 머리 글칸이 사라진다.
  async function sectionNameFixture() {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const rename = '$map($state.sections, function($s){ $s.title = $item.title ? $merge([$s, {"editing": true}]) : $s })';
    const commit = '$map($state.sections, function($s){ $s.title = $item.title ? $merge([$s, {"title": ($event = "막힌 이름" ? $s.title : $event), "editing": false}]) : $s })';
    const cancel = '$map($state.sections, function($s){ $merge([$s, {"editing": false}]) })';
    const definition: AppDefinition = {
      id: "section-name-focus", name: "구역 이름 초점", requires: { blocks: 60, modules: {} }, permissions: [],
      state: { sections: [
        { title: "이번 주", editing: false, rows: [{ key: "a", title: "첫 항목" }] },
        { title: "다음 주", editing: false, rows: [{ key: "b", title: "둘째 항목" }] },
      ] },
      ui: { type: "repeat", items: { state: "sections" }, key: "title", layout: "column", template: {
        type: "section", collapsible: true, title: { item: "title" }, editing: { item: "editing" },
        menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: rename } }] }],
        on_edit: [{ set_state: "sections", value: { expr: commit } }],
        on_edit_cancel: [{ set_state: "sections", value: { expr: cancel } }],
        child: { type: "tree", items: { item: "rows" } },
      } },
    };
    const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
    render(<><ContextMenuHost /><AppWindowContent store={store} windowId="viewer-window" /></>);
    return store;
  }

  async function openSectionNameEdit(title: string) {
    fireEvent.contextMenu(await screen.findByRole("button", { name: title }), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "이름 바꾸기" }));
    const input = await screen.findByRole("textbox", { name: "구역 이름" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    return input;
  }

  it("구역 이름을 확정해 구역이 다시 만들어져도 같은 자리 구역의 접기 단추로 초점을 옮긴다", async () => {
    await sectionNameFixture();
    const input = await openSectionNameEdit("다음 주");
    fireEvent.change(input, { target: { value: "새 이름" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // 확정 전에도 옛 구역의 접기 단추가 친 이름을 보여 주므로, 새 key로 다시 만들어진 구역의 단추를 기다려 확인한다.
    await waitFor(() => {
      const item = document.querySelector('.ks-repeat-item[data-repeat-key="새 이름"]');
      expect(item).not.toBeNull();
      expect(document.activeElement).toBe(item!.querySelector(".ks-data-section-toggle"));
    });
    const samePosition = screen.getByRole("button", { name: "새 이름" });
    expect(samePosition.closest(".ks-repeat-item")?.getAttribute("data-repeat-key")).toBe("새 이름");
  });

  it("구역 이름 바꾸기 Escape와 거절은 지금처럼 그 구역 접기 단추로 초점을 돌려준다", async () => {
    await sectionNameFixture();
    const input = await openSectionNameEdit("다음 주");
    fireEvent.change(input, { target: { value: "버릴 이름" } });
    fireEvent.keyDown(input, { key: "Escape" });
    const toggle = screen.getByRole("button", { name: "다음 주" });
    await waitFor(() => expect(document.activeElement).toBe(toggle));

    const again = await openSectionNameEdit("다음 주");
    fireEvent.change(again, { target: { value: "막힌 이름" } });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "구역 이름" })).toBeNull());
    expect(screen.getByRole("button", { name: "다음 주" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "다음 주" })));
  });

  it("승인 목록이 비면 말풍선 대신 대화 입력칸으로 초점을 옮긴다", async () => {
    await focusFixture('<div><button>내 말풍선</button><div role="list"><button role="listitem">허용</button></div></div><textarea class="ks-agent-chat-input" aria-label="메시지"></textarea>');
    const allow = screen.getByRole("listitem");
    allow.focus();
    fireEvent.keyDown(allow, { key: "Enter" });
    allow.parentElement!.removeChild(allow);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "메시지" })));
  });

  it("마지막 목록 항목을 지우면 뒤의 강조 단추가 아닌 앞 조작에 초점을 둔다", async () => {
    const fixture = await focusFixture('<button>앞 조작</button><div role="list"><button role="listitem">마지막 지우기</button></div><button class="ks-button-emphasis">올리기</button>');
    const remove = screen.getByRole("listitem");
    remove.focus();
    fireEvent.keyDown(remove, { key: "Enter" });
    fixture.children[1].removeChild(remove);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "앞 조작" })));
  });

  it("빈 목록 앞에 조작이 없으면 창 내용에 테두리 없이 초점을 둔다", async () => {
    const fixture = await focusFixture('<div role="list"><button role="listitem">마지막 지우기</button></div><button class="ks-button-emphasis">올리기</button>');
    const remove = screen.getByRole("listitem");
    remove.focus();
    fireEvent.keyDown(remove, { key: "Enter" });
    fixture.firstElementChild!.removeChild(remove);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
  });

  it("구역 동작 단추가 사라지면 아래 표 행이 아니라 이웃이나 pane의 임시 초점으로 간다", async () => {
    const markup = (actions: string) => `<section class="ks-data-section"><div class="ks-data-section-header"><div class="ks-data-section-actions">${actions}</div></div><div class="ks-data-section-child"><div role="table"><div role="row" tabindex="0">첫 행</div></div></div></section>`;
    // 뒤 이웃이 있으면 그 단추로 간다.
    let fixture = await focusFixture(markup("<button>날짜 풀기</button><button>적용</button>"));
    let button = within(fixture).getByRole("button", { name: "날짜 풀기" });
    button.focus();
    button.remove();
    await waitFor(() => expect(document.activeElement).toBe(within(fixture).getByRole("button", { name: "적용" })));
    cleanup();

    // 뒤가 없으면 앞 이웃으로 간다.
    fixture = await focusFixture(markup("<button>적용</button><button>날짜 풀기</button>"));
    button = within(fixture).getByRole("button", { name: "날짜 풀기" });
    button.focus();
    button.remove();
    await waitFor(() => expect(document.activeElement).toBe(within(fixture).getByRole("button", { name: "적용" })));
    cleanup();

    // 이웃이 없으면 표 첫 행이 아니라 pane의 임시 초점으로 간다.
    fixture = await focusFixture(markup("<button>날짜 풀기</button>"));
    button = within(fixture).getByRole("button", { name: "날짜 풀기" });
    const row = fixture.querySelector<HTMLElement>('[role="row"]')!;
    const body = fixture.closest<HTMLElement>(".ks-data-window-body")!;
    button.focus();
    button.remove();
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(document.activeElement).not.toBe(row);
    expect(body.classList.contains("ks-focus-rescue-empty")).toBe(true);
  });

  it("형제 칸의 모음에 새 반복 항목 단추가 생겨도 그 단추로 초점을 옮기지 않는다", async () => {
    const fixture = await focusFixture('<div class="ks-data-stack"><div class="ks-data-stack-item"><button>해제</button></div><div class="ks-data-stack-item"><div class="ks-repeat-content"></div></div></div>');
    const button = screen.getByRole("button", { name: "해제" });
    button.focus();
    button.remove();
    const item = document.createElement("div");
    item.className = "ks-repeat-item";
    const answer = document.createElement("button");
    answer.textContent = "답하기";
    item.append(answer);
    fixture.querySelector(".ks-repeat-content")!.append(item);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    expect(document.activeElement).not.toBe(answer);
    expect(within(fixture).getByRole("button", { name: "답하기" })).toBe(answer);
  });

  it("반복 항목 깊은 곳의 단추가 사라지고 먼 칸에 새 단추가 서도 그 단추로 가지 않는다", async () => {
    const fixture = await focusFixture('<div class="ks-data-stack"><div class="ks-data-stack-item"><div class="ks-repeat-content"><div class="ks-repeat-item"><div class="ks-data-stack"><div class="ks-data-stack-item"><button>되묻기</button></div></div></div></div></div><div class="ks-data-stack-item"></div></div>');
    const button = screen.getByRole("button", { name: "되묻기" });
    button.focus();
    button.remove();
    const far = document.createElement("button");
    far.textContent = "실행";
    fixture.firstElementChild!.children[1].append(far);
    await waitFor(() => expect(document.activeElement?.classList.contains("ks-focus-rescue-empty")).toBe(true));
    expect(document.activeElement).not.toBe(far);
    expect(within(fixture).getByRole("button", { name: "실행" })).toBe(far);
  });

  it("대화 footer 안 단추가 사라지면 본문 첫 입력창이 아니라 그 대화의 입력창으로 초점을 옮긴다", async () => {
    const fixture = await focusFixture('<section class="ks-agent-chat"><div class="ks-agent-chat-footer"><button>첫 대화 해제</button></div><textarea class="ks-agent-chat-input" aria-label="첫 대화 입력"></textarea></section><section class="ks-agent-chat"><div class="ks-agent-chat-footer"><div class="ks-data-stack"><div class="ks-data-stack-item"><div class="ks-repeat-content"><div class="ks-repeat-item"><button>되묻기</button></div></div></div><div class="ks-data-stack-item"></div></div></div><textarea class="ks-agent-chat-input" aria-label="둘째 대화 입력"></textarea></section>');
    const button = within(fixture).getByRole("button", { name: "되묻기" });
    button.focus();
    button.closest(".ks-repeat-item")!.remove();
    const next = document.createElement("button");
    next.textContent = "해제";
    fixture.querySelectorAll(".ks-agent-chat")[1].querySelectorAll(".ks-data-stack-item")[1].append(next);
    await waitFor(() => expect(document.activeElement).toBe(within(fixture).getByRole("textbox", { name: "둘째 대화 입력" })));
    expect(document.activeElement).not.toBe(within(fixture).getByRole("textbox", { name: "첫 대화 입력" }));
    expect(within(fixture).getByRole("button", { name: "해제" })).toBe(next);
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
