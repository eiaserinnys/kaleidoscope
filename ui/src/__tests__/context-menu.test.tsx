import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost, openContextMenu, openFrameContextMenu, writeMenuClipboard } from "../components/context-menu";
import { EditorView } from "@codemirror/view";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("공용 우클릭 메뉴", () => {
  it("값이 같으면 입력 선택을 되돌리고 바뀌었으면 현재 선택을 유지한다", async () => {
    const readText = vi.fn().mockResolvedValue("새 글");
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText } });
    const calls: Array<number | null> = [];
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => { calls.push((document.activeElement as HTMLInputElement).selectionStart); return true; }) });
    render(<><ContextMenuHost /><input aria-label="선택" defaultValue="abcde" /></>);
    const input = screen.getByLabelText("선택") as HTMLInputElement;
    input.focus(); input.setSelectionRange(1, 2); fireEvent.contextMenu(input);
    input.setSelectionRange(5, 5); fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    await waitFor(() => expect(calls).toEqual([1]));
    input.setSelectionRange(1, 2); fireEvent.contextMenu(input);
    input.value = "바뀐 값"; input.setSelectionRange(3, 3); fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    await waitFor(() => expect(calls).toEqual([1, 3]));
  });

  it("복사할 때도 같은 값의 선택 범위를 되돌린다", () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "bc" } as Selection);
    render(<><ContextMenuHost /><input aria-label="선택" defaultValue="abcde" /></>);
    const input = screen.getByLabelText("선택") as HTMLInputElement;
    input.focus(); input.setSelectionRange(1, 3); fireEvent.contextMenu(input);
    input.setSelectionRange(5, 5); fireEvent.click(screen.getByRole("menuitem", { name: "복사" }));
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });

  it("클립보드 응답을 기다리는 동안 다른 칸에 초점이 가면 편집하지 않는다", async () => {
    let finish!: (text: string) => void;
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText: () => new Promise<string>((resolve) => { finish = resolve; }) } });
    const exec = vi.fn(); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    render(<><ContextMenuHost /><input aria-label="원래 칸" /><input aria-label="다른 칸" /></>);
    const input = screen.getByLabelText("원래 칸"); input.focus(); fireEvent.contextMenu(input);
    fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    screen.getByLabelText("다른 칸").focus();
    await act(async () => { finish("내용"); await Promise.resolve(); });
    expect(exec).not.toHaveBeenCalled();
  });

  it.each(["email", "number"])("%s 입력의 선택 API는 호출하지 않는다", async (type) => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText: vi.fn().mockResolvedValue("2") } });
    const exec = vi.fn(); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    render(<><ContextMenuHost /><input aria-label="칸" type={type} defaultValue={type === "number" ? "123" : "a@b.com"} /></>);
    const input = screen.getByLabelText("칸") as HTMLInputElement;
    const range = vi.spyOn(input, "setSelectionRange");
    input.focus(); fireEvent.contextMenu(input); fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    expect(range).not.toHaveBeenCalled();
  });

  it("잘라내기 쓰기 중 다른 칸으로 이동하면 삭제하지 않는다", async () => {
    let finish!: () => void;
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "ab" } as Selection);
    const exec = vi.fn(); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    render(<><ContextMenuHost /><input aria-label="원래 칸" defaultValue="abc" /><input aria-label="다른 칸" /></>);
    const input = screen.getByLabelText("원래 칸"); input.focus(); fireEvent.contextMenu(input);
    fireEvent.click(screen.getByRole("menuitem", { name: "잘라내기" }));
    screen.getByLabelText("다른 칸").focus();
    await act(async () => { finish(); await Promise.resolve(); });
    expect(exec).not.toHaveBeenCalled();
  });

  it("CodeMirror의 비동기 클립보드 작업 중 다른 곳에 초점이 가면 문서를 바꾸지 않는다", async () => {
    let finishRead!: (text: string) => void;
    let finishWrite!: () => void;
    vi.stubGlobal("navigator", { ...navigator, clipboard: {
      readText: () => new Promise<string>((resolve) => { finishRead = resolve; }),
      writeText: () => new Promise<void>((resolve) => { finishWrite = resolve; }),
    } });
    render(<><ContextMenuHost /><div className="cm-editor"><div className="cm-content" contentEditable suppressContentEditableWarning>abc</div></div></>);
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    let focused = true;
    const dispatch = vi.fn();
    const view = { contentDOM: content, get hasFocus() { return focused; }, dispatch, state: { selection: { main: { from: 0, to: 2, head: 2 } }, sliceDoc: () => "ab", replaceSelection: vi.fn(), facet: () => false } };
    vi.spyOn(EditorView, "findFromDOM").mockReturnValue(view as unknown as EditorView);
    fireEvent.contextMenu(content); fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    focused = false; await act(async () => { finishRead("새 글"); await Promise.resolve(); });
    expect(dispatch).not.toHaveBeenCalled();
    focused = true; fireEvent.contextMenu(content); fireEvent.click(screen.getByRole("menuitem", { name: "잘라내기" }));
    focused = false; await act(async () => { finishWrite(); await Promise.resolve(); });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("창 밖으로 초점이 가면 메뉴를 닫는다", () => {
    render(<><ContextMenuHost /><input aria-label="칸" /></>);
    fireEvent.contextMenu(screen.getByLabelText("칸"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("프레임 편집 칸에는 붙여넣기와 모두 선택이 있다", () => {
    render(<><ContextMenuHost /><iframe title="문서" /></>);
    const frame = screen.getByTitle("문서") as HTMLIFrameElement;
    act(() => openFrameContextMenu(frame, { requestId: 1, x: 10, y: 20, text: "", editable: true, readOnly: false, password: false }));
    expect(screen.getByRole("menuitem", { name: "붙여넣기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "모두 선택" })).toBeTruthy();
  });
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
    act(() => openFrameContextMenu(frame, { requestId: 1, x: 10, y: 20, text: "프레임 글" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("프레임 글"));
  });

  it("공용 클립보드 쓰기 실패를 호스트 알림으로 전달한다", async () => {
    const onError = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("권한 거부")) } });
    render(<ContextMenuHost onError={onError} />);
    expect(await writeMenuClipboard("글", "행 복사")).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: "SHELL_MENU_CLIPBOARD_WRITE_FAILED", message: "행 복사 작업을 하지 못했습니다. Ctrl+C로 복사하세요. 원인: 권한 거부" }));
  });

  it("잘라내기 쓰기 실패에는 Ctrl+X를 안내한다", async () => {
    const onError = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("권한 거부")) } });
    render(<ContextMenuHost onError={onError} />);
    expect(await writeMenuClipboard("글", "잘라내기")).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "잘라내기 작업을 하지 못했습니다. Ctrl+X로 잘라내세요. 원인: 권한 거부" }));
  });

  it("프레임 명령에 메뉴 요청 번호를 돌려준다", () => {
    const send = vi.fn();
    render(<><ContextMenuHost /><iframe title="요청 프레임" /></>);
    const frame = screen.getByTitle("요청 프레임") as HTMLIFrameElement;
    act(() => openFrameContextMenu(frame, { requestId: 17, x: 0, y: 0, text: "글", editable: true }, send));
    fireEvent.click(screen.getByRole("menuitem", { name: "모두 선택" }));
    expect(send).toHaveBeenCalledWith({ requestId: 17, action: "selectAll" });
  });

  it("붙여넣기 읽기 실패에는 Ctrl+V를 안내한다", async () => {
    const onError = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText: vi.fn().mockRejectedValue(new Error("권한 거부")) } });
    render(<><ContextMenuHost onError={onError} /><input aria-label="칸" /></>);
    fireEvent.contextMenu(screen.getByLabelText("칸"));
    fireEvent.click(screen.getByRole("menuitem", { name: "붙여넣기" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: "SHELL_MENU_CLIPBOARD_READ_FAILED", message: "붙여넣기를 하지 못했습니다. Ctrl+V로 붙여넣으세요. 원인: 권한 거부" })));
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
    expect(screen.getByRole("menuitem", { name: "같이 보기" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "같이 보기" }));
    expect(onCall).toHaveBeenCalledWith({ op: "share.set", window_id: appWindow.id, on: false });
    fireEvent.click(screen.getByRole("button", { name: "앱 설정" }));
    fireEvent.contextMenu(screen.getByText("테스트 창"));
    expect(screen.getByRole("menuitem", { name: "앱 설정" }).getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.contextMenu(screen.getByText("테스트 창"));
    fireEvent.click(screen.getByRole("menuitem", { name: "창 최소화" }));
    expect(onMinimize).toHaveBeenCalledWith(appWindow.id);
    const maximize = screen.getByRole("button", { name: "창 최대화" });
    maximize.focus();
    fireEvent.keyDown(maximize, { key: "ContextMenu" });
    expect(screen.getByRole("menuitem", { name: "창 최대화" })).toBeTruthy();
  });
});
