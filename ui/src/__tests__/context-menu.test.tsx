import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost, openContextMenu, openFrameContextMenu, writeMenuClipboard } from "../components/context-menu";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("공용 우클릭 메뉴", () => {
  it("입력칸에 글 메뉴를 열고 자체 메뉴 항목을 뒤에 둔다", () => {
    render(<><ContextMenuHost /><input aria-label="내용" defaultValue="가나다" /></>);
    const input = screen.getByRole("textbox");
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "가나" } as Selection);
    fireEvent.contextMenu(input, { clientX: 40, clientY: 50 });
    expect(screen.getByRole("menuitem", { name: "잘라내기" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("menuitem", { name: "복사" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("menuitem", { name: "모두 선택" })).toHaveProperty("disabled", false);
  });

  it("읽기 전용 입력은 복사와 모두 선택만 보여준다", () => {
    render(<><ContextMenuHost /><input aria-label="내용" readOnly value="가나다" /></>);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "가나" } as Selection);
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.queryByRole("menuitem", { name: "잘라내기" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "복사" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("menuitem", { name: "모두 선택" })).toHaveProperty("disabled", false);
  });

  it("선택 없는 입력의 잘라내기와 복사를 비활성화한다", () => {
    render(<><ContextMenuHost /><input aria-label="내용" /></>);
    fireEvent.contextMenu(screen.getByRole("textbox"));
    expect(screen.getByRole("menuitem", { name: "잘라내기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: "복사" })).toHaveProperty("disabled", true);
  });

  it("비밀번호는 선택되어도 잘라내기와 복사를 비활성화한다", () => {
    render(<><ContextMenuHost /><input aria-label="암호" type="password" defaultValue="1234" /></>);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "123" } as Selection);
    fireEvent.contextMenu(screen.getByLabelText("암호"));
    expect(screen.getByRole("menuitem", { name: "잘라내기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: "복사" })).toHaveProperty("disabled", true);
  });

  it("선택된 읽는 글은 복사만 보여준다", () => {
    render(<><ContextMenuHost /><p>읽을 글</p></>);
    const paragraph = screen.getByText("읽을 글");
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.contextMenu(paragraph);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([expect.stringContaining("복사")]);
    selection.removeAllRanges();
  });

  it("기존에 처리된 우클릭과 선택 없는 글은 메뉴를 열지 않는다", () => {
    render(<><ContextMenuHost /><div onContextMenu={(event) => event.preventDefault()}>기존 메뉴</div><p>본문</p></>);
    fireEvent.contextMenu(screen.getByText("기존 메뉴"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("본문"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("키보드로 열고 Escape로 닫는다", () => {
    render(<><ContextMenuHost /><textarea aria-label="내용" /></>);
    const input = screen.getByRole("textbox");
    input.focus();
    fireEvent.keyDown(input, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toHaveProperty("disabled", false);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("지정된 자리 항목을 열고 누른다", () => {
    const run = vi.fn();
    render(<><ContextMenuHost /><button onContextMenu={(event) => openContextMenu(event, [{ id: "site", label: "자리 동작", onSelect: run }])}>자리</button></>);
    fireEvent.contextMenu(screen.getByText("자리"));
    fireEvent.click(screen.getByRole("menuitem", { name: "자리 동작" }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("프레임의 선택 글을 클립보드에 쓴다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<><ContextMenuHost /><iframe title="문서" /></>);
    const frame = screen.getByTitle("문서") as HTMLIFrameElement;
    const { act } = await import("@testing-library/react");
    act(() => openFrameContextMenu(frame, { x: 10, y: 20, text: "프레임 글" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("프레임 글"));
  });

  it("공용 클립보드 쓰기 실패를 호스트 알림으로 전달한다", async () => {
    const onError = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("권한 거부")) } });
    render(<ContextMenuHost onError={onError} />);
    expect(await writeMenuClipboard("글", "행 복사")).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: "SHELL_MENU_CLIPBOARD_WRITE_FAILED", message: expect.stringContaining("행 복사") }));
  });
});

describe("창 제목 줄 메뉴", () => {
  it("같이 보기와 창 동작을 제목 줄 단추와 같이 연결한다", async () => {
    const { WindowFrame } = await import("../../../app/src/shell/window-frame");
    const { makeTestSnapshot } = await import("./fixtures");
    const snapshot = makeTestSnapshot();
    const appWindow = snapshot.shared.windows[0];
    const onCall = vi.fn().mockResolvedValue(undefined);
    const onMinimize = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const store = { getSnapshot: () => snapshot, subscribe: () => () => {}, subscribeEvents: () => () => {}, call: onCall };
    render(<><ContextMenuHost /><WindowFrame area={{ width: 960, height: 600 }} appName="테스트 창" isTop sharing shareable hasSettings store={store as never} onCall={onCall} onMinimize={onMinimize} onMaximize={() => {}} onRestore={() => {}} window={appWindow}>본문</WindowFrame></>);
    fireEvent.contextMenu(screen.getByText("테스트 창"));
    expect(screen.getByRole("menuitem", { name: "같이 보기 끄기" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "같이 보기 끄기" }));
    expect(onCall).toHaveBeenCalledWith({ op: "share.set", window_id: appWindow.id, on: false });
    fireEvent.contextMenu(screen.getByText("테스트 창"));
    fireEvent.click(screen.getByRole("menuitem", { name: "창 최소화" }));
    expect(onMinimize).toHaveBeenCalledWith(appWindow.id);
    const maximize = screen.getByRole("button", { name: "창 최대화" });
    maximize.focus();
    fireEvent.keyDown(maximize, { key: "ContextMenu" });
    expect(screen.getByRole("menuitem", { name: "창 최대화" })).toBeTruthy();
  });
});
