import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock, ColorBlock, InputBlock, SelectBlock, ToggleBlock } from "../blocks/data-input";
import "../styles/data-input-preview.css";

it.each([undefined, { kind: "decimal", digits: 2 }])("전송 성공 뒤에도 입력 중 소수점과 자릿수를 보존한다: %j", async (format) => {
  vi.useFakeTimers();
  try {
    runtime.values = { value: null };
    const input = { type: "input", kind: "number", value: { client: "value" }, format, on_change: { client: "change" } };
    const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
    const view = render(draw());
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "1." } });
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(runtime.act).toHaveBeenLastCalledWith("/input/on_change", 1, undefined, undefined, undefined, { input: true });
    runtime.values.value = 1;
    view.rerender(draw());
    expect(field.value).toBe("1.");
    fireEvent.change(field, { target: { value: field.value + "5" } });
    await act(async () => { vi.advanceTimersByTime(700); });
    runtime.values.value = 1.5;
    view.rerender(draw());
    expect(field.value).toBe("1.5");
    fireEvent.blur(field);
    expect(field.value).toBe(format ? "1.50" : "1.5");
  } finally { vi.useRealTimers(); }
});

it("숫자 초안은 Enter와 증감에서 서식을 확정한다", async () => {
  vi.useFakeTimers();
  try {
    const input = { type: "input", kind: "number", value: null, format: { kind: "decimal", digits: 2 }, on_change: { client: "change" } };
    render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "1.5" } });
    await act(async () => { vi.advanceTimersByTime(700); });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("1.50");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(field.value).toBe("2.50");
  } finally { vi.useRealTimers(); }
});

it("숫자 입력은 기본 단추 없이 키로 범위를 지켜 증감한다", () => {
  vi.useFakeTimers();
  try {
  const input = { type: "input", kind: "number", value: 1, min: 0, max: 10, step: 0.5, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton") as HTMLInputElement;
  expect(field.type).toBe("text");
  expect(field.inputMode).toBe("decimal");
  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(field.value).toBe("1.5");
  fireEvent.keyDown(field, { key: "PageUp" });
  expect(field.value).toBe("6.5");
  fireEvent.keyDown(field, { key: "End" });
  expect(field.value).toBe("10");
  fireEvent.keyDown(field, { key: "Home" });
  expect(field.value).toBe("0");
  } finally { cleanup(); vi.useRealTimers(); }
});

it("스핀을 누르는 동안 반복하고 놓은 뒤 마지막 값만 보낸다", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    const input = { type: "input", kind: "number", spin: true, value: 1, min: 0, max: 20, on_change: { client: "change" } };
    render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "늘리기" });
    fireEvent.pointerDown(up, { button: 0, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(Number(field.value)).toBeGreaterThan(2);
    expect(runtime.act).not.toHaveBeenCalled();
    fireEvent.pointerUp(up, { pointerId: 1 });
    fireEvent.click(up, { detail: 1 });
    const finalValue = Number(field.value);
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(runtime.act).toHaveBeenCalledTimes(1);
    expect(runtime.act).toHaveBeenCalledWith("/input/on_change", finalValue, undefined, undefined, undefined, { input: true });
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it("스핀 경계와 읽기 전용 상태는 해당 단추를 잠근다", () => {
  runtime.values = { value: 2, locked: false };
  const input = { type: "input", kind: "number", spin: true, value: { client: "value" }, read_only: { client: "locked" }, min: 0, max: 2, on_change: { client: "change" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  expect((screen.getByRole("button", { name: "늘리기" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "줄이기" }) as HTMLButtonElement).disabled).toBe(false);
  runtime.values.locked = true;
  view.rerender(draw());
  expect((screen.getByRole("button", { name: "늘리기" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "줄이기" }) as HTMLButtonElement).disabled).toBe(true);
});

it("스핀 단추는 툴팁과 탭 순서 없이 접근성 이름을 유지한다", () => {
  const input = { type: "input", kind: "number", spin: true, value: 1, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  for (const name of ["늘리기", "줄이기"]) {
    const button = screen.getByRole("button", { name });
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.getAttribute("title") || "").toBe("");
  }
});

it("짧게 누르면 놓고 300ms 뒤 한 번만 보낸다", async () => {
  vi.useFakeTimers(); vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    const input = { type: "input", kind: "number", spin: true, value: 1, on_change: { client: "change" } };
    render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const up = screen.getByRole("button", { name: "늘리기" });
    fireEvent.pointerDown(up, { button: 0 });
    fireEvent.pointerUp(up);
    fireEvent.click(up, { detail: 1 });
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("2");
    act(() => { vi.advanceTimersByTime(299); });
    expect(runtime.act).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(runtime.act).toHaveBeenCalledTimes(1);
    expect(runtime.act).toHaveBeenCalledWith("/input/on_change", 2, undefined, undefined, undefined, { input: true });
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it("입력에 초점이 없어도 스핀 조작 중 바깥 값이 초안을 덮지 않는다", () => {
  vi.useFakeTimers(); vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    runtime.values = { value: 1 };
    const input = { type: "input", kind: "number", spin: true, value: { client: "value" }, on_change: { client: "change" } };
    const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
    const view = render(draw());
    const up = screen.getByRole("button", { name: "늘리기" });
    fireEvent.pointerDown(up, { button: 0 });
    runtime.values.value = 9;
    view.rerender(draw());
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("2");
    fireEvent.pointerUp(up);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it.each(["cancel", "lost", "unmount"])("스핀 %s 종료는 반복을 멈추고 마지막 값을 보낸다", async (ending) => {
  vi.useFakeTimers(); vi.stubGlobal("PointerEvent", MouseEvent);
  try {
    const input = { type: "input", kind: "number", spin: true, value: 1, on_change: { client: "change" } };
    const view = render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const up = screen.getByRole("button", { name: "늘리기" });
    fireEvent.pointerDown(up, { button: 0 });
    if (ending === "cancel") fireEvent.pointerCancel(up);
    else if (ending === "lost") fireEvent.lostPointerCapture(up);
    else view.unmount();
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(runtime.act).toHaveBeenCalledTimes(1);
    expect(runtime.act).toHaveBeenCalledWith("/input/on_change", 2, undefined, undefined, undefined, { input: true });
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

it("빈 숫자는 0에서 시작하고 경계 없는 Home은 텍스트 조작에 남긴다", () => {
  vi.useFakeTimers();
  try {
  const input = { type: "input", kind: "number", value: null, step: 0.25, format: { kind: "decimal", digits: 2 }, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton") as HTMLInputElement;
  expect(field.hasAttribute("aria-valuenow")).toBe(false);
  expect(fireEvent.keyDown(field, { key: "Home" })).toBe(true);
  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(field.value).toBe("-0.25");
  } finally { cleanup(); vi.useRealTimers(); }
});

it("서식 없는 소수 step도 부동소수 오차 없이 증감한다", () => {
  vi.useFakeTimers();
  try {
    const input = { type: "input", kind: "number", value: 0.2, step: 0.1, on_change: { client: "change" } };
    render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(field.value).toBe("0.3");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(field.value).toBe("0.2");
  } finally { cleanup(); vi.useRealTimers(); }
});

const runtime = vi.hoisted(() => ({ values: {} as Record<string, unknown>, loading: false, act: vi.fn().mockResolvedValue(true), holdInput: () => () => undefined }));
const previewRender = vi.hoisted(() => vi.fn());
vi.mock("../data/window-state", async (importOriginal) => ({ ...(await importOriginal<typeof import("../data/window-state")>()), useWindowVisible: () => true }));
vi.mock("../render/render-block", () => ({ renderBlock: (...args: unknown[]) => previewRender(...args) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (pointer: string, binding: unknown) => runtime.loading && pointer === "/button/label" ? { status: "loading" } : ({ status: "ready", value: binding && typeof binding === "object" && "client" in binding ? runtime.values[(binding as { client: string }).client] : binding && typeof binding === "object" && "state" in binding ? 120 : binding }),
}));
afterEach(() => { cleanup(); runtime.values = {}; runtime.loading = false; runtime.act.mockClear(); previewRender.mockClear(); });

it("자동 높이는 테두리를 더하고 폭이 바뀔 때 다시 재며 고정 행에는 적용하지 않는다", () => {
  let notify!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const scroll = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(74);
  const width = vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get").mockReturnValue(300);
  const client = vi.spyOn(HTMLTextAreaElement.prototype, "clientHeight", "get").mockReturnValue(51);
  const offset = vi.spyOn(HTMLTextAreaElement.prototype, "offsetHeight", "get").mockReturnValue(53);
  try {
    const input = { type: "input", multiline: true, value: "내용" };
    const view = render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(field.style.height).toBe("76px");
    scroll.mockReturnValue(95);
    act(() => notify([{ target: field, contentRect: { width: 300 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(field.style.height).toBe("97px");
    scroll.mockReturnValue(116);
    act(() => notify([{ target: field, contentRect: { width: 300 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(field.style.height).toBe("97px");
    act(() => notify([{ target: field, contentRect: { width: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(field.style.height).toBe("97px");
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    render(<InputBlock block={{ ...input, rows: 3 } as never} context={{} as never} pointer="/fixed" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("");
  } finally {
    cleanup(); scroll.mockRestore(); width.mockRestore(); client.mockRestore(); offset.mockRestore(); vi.unstubAllGlobals();
  }
});

it("단추 이름을 불러오는 동안 한 줄 대기 표시를 보이고 누름을 막는다", () => {
  runtime.loading = true;
  const button = { type: "button", label: { client: "label" }, on_click: { client: "go" } };
  const view = render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const control = screen.getByRole("button", { name: "불러오는 중" }) as HTMLButtonElement;
  expect(control.disabled).toBe(true);
  expect(control.querySelector(".ks-data-skeleton i")).toBeTruthy();
  fireEvent.click(control);
  expect(runtime.act).not.toHaveBeenCalled();
  runtime.loading = false;
  runtime.values.label = "실행";
  view.rerender(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  expect((screen.getByRole("button", { name: "실행" }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([false, true])("읽기 전용 %s줄 입력은 동작을 막고 해제하면 다시 편집한다", async (multiline) => {
  runtime.values = { text: "저장된 내용", locked: false };
  const input = { type: "input", label: "내용", multiline, value: { client: "text" }, read_only: { client: "locked" },
    on_change: { client: "change" }, on_submit: { client: "submit" }, on_cancel: { client: "cancel" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" }) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "임시 초안" } });
  runtime.values.locked = true;
  view.rerender(draw());
  expect(field.readOnly).toBe(true);
  expect(field.getAttribute("aria-readonly")).toBe("true");
  expect(field.value).toBe("저장된 내용");
  fireEvent.change(field, { target: { value: "막힌 입력" } });
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: multiline });
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.blur(field);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(runtime.act).not.toHaveBeenCalled();
  runtime.values.locked = false;
  view.rerender(draw());
  expect(field.readOnly).toBe(false);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "다시 수정" } });
  fireEvent.blur(field);
  await vi.waitFor(() => expect(runtime.act).toHaveBeenCalledWith("/input/on_change", "다시 수정", undefined, undefined, undefined, { input: true }));
});

it("읽기 전용 검색 입력의 지우기 조작은 값을 보내지 않는다", () => {
  runtime.values = { text: "검색어", locked: true };
  const input = { type: "input", kind: "search", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const clear = screen.queryByRole("button", { name: "지우기" }) as HTMLButtonElement | null;
  if (clear) fireEvent.click(clear);
  expect(runtime.act).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("검색어");
});

it("초점을 유지한 채 읽기 전용을 해제한 뒤에도 편집 중 초안을 보존한다", () => {
  runtime.values = { text: "원본", locked: false };
  const input = { type: "input", label: "내용", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" }) as HTMLInputElement;
  fireEvent.focus(field);
  runtime.values.locked = true;
  view.rerender(draw());
  runtime.values.locked = false;
  view.rerender(draw());
  fireEvent.change(field, { target: { value: "새 초안" } });
  runtime.values.text = "외부 변경";
  view.rerender(draw());
  expect(field.value).toBe("새 초안");
});

it("전환 전에 확정한 편집은 순서대로 전송하고 전환 뒤 새 입력과 제출은 막는다", async () => {
  let complete!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { complete = resolve; }));
  runtime.values = { text: "원본", locked: false };
  const input = { type: "input", label: "내용", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" }, on_submit: { client: "submit" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "첫 편집" } });
  fireEvent.blur(field);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "다음 편집" } });
  fireEvent.blur(field);
  expect(runtime.act).toHaveBeenCalledTimes(1);
  runtime.values.locked = true;
  view.rerender(draw());
  fireEvent.change(field, { target: { value: "잠긴 뒤 입력" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await act(async () => complete(true));
  expect(runtime.act).toHaveBeenCalledTimes(2);
  expect(runtime.act).toHaveBeenNthCalledWith(1, "/input/on_change", "첫 편집", undefined, undefined, undefined, { input: true });
  expect(runtime.act).toHaveBeenNthCalledWith(2, "/input/on_change", "다음 편집", undefined, undefined, undefined, { input: true });
  expect(runtime.act).not.toHaveBeenCalledWith("/input/on_submit", expect.anything());
});

it("클라이언트 버튼 이름·아이콘과 색상 비활성 상태가 바뀐다", () => {
  runtime.values = { label: "재생", icon: "play", disabled: true, color: "#123456" };
  const button = { type: "button", label: { client: "label" }, icon: { client: "icon" }, on_click: { client: "go" } };
  const color = { type: "color", label: "배경", value: { client: "color" }, disabled: { client: "disabled" }, on_change: { client: "change" } };
  const draw = () => <><ButtonBlock block={button as never} context={{} as never} pointer="/button" /><ColorBlock block={color as never} context={{} as never} pointer="/color" /></>;
  const view = render(draw());
  expect(screen.getByRole("button", { name: "재생" }).querySelector("svg")).toBeTruthy();
  expect((screen.getByLabelText("배경") as HTMLInputElement).disabled).toBe(true);
  runtime.values = { ...runtime.values, label: "일시정지", icon: "pause", disabled: false };
  view.rerender(draw());
  expect(screen.getByRole("button", { name: "일시정지" }).querySelector("svg")).toBeTruthy();
  expect((screen.getByLabelText("배경") as HTMLInputElement).disabled).toBe(false);
  runtime.values = { ...runtime.values, icon: "volume-2" };
  view.rerender(draw());
  expect(screen.getByRole("button", { name: "일시정지" }).querySelector("svg")).toBeNull();
});

it("라벨 입력과 묶음 선택지를 기존 선택기로 표시한다", () => {
  const input = { type: "input", label: "BPM", kind: "number", value: { state: "bpm" }, on_change: { client: "bpm" } };
  const select = { type: "select", label: "스타일", value: { state: "style" }, on_change: { client: "style" }, options: [{ name: "기본", options: [{ value: "a", label: "누아르" }] }] };
  render(<><InputBlock block={input as never} context={{} as never} pointer="/input" /><SelectBlock block={select as never} context={{} as never} pointer="/select" /></>);
  expect(screen.getByRole("spinbutton", { name: "BPM" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "스타일" }));
  expect(screen.getByText("기본")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "누아르" }));
  expect(runtime.act).toHaveBeenCalledWith("/select/on_change", "a");
});

it("자동 숫자로 정규화된 값이 이전과 같아도 흐린 입력 초안을 비운다", async () => {
  runtime.values = { bpm: null };
  const input = { type: "input", label: "BPM", kind: "number", value: { client: "bpm" }, on_change: { client: "bpm" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-5" } });
  fireEvent.blur(field);
  await vi.waitFor(() => expect(field.value).toBe(""));
});

it("수정 키를 눌러 단추를 누르면 동작에 그대로 전한다", () => {
  const button = { type: "button", label: "선택", on_click: { client: "select" } };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  fireEvent.click(screen.getByRole("button", { name: "선택" }), { shiftKey: true });
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: true, alt: false, ctrl: false, meta: false });
});

it("비활성 선택기와 토글은 disabled 접근성 상태를 내고 조작되지 않는다", () => {
  runtime.values = { disabled: true };
  const select = { type: "select", label: "환경", value: "local", on_change: { client: "select" }, options: ["local", "remote"], disabled: { client: "disabled" } };
  const toggle = { type: "toggle", label: "자동 저장", value: true, on_change: { client: "toggle" }, disabled: { client: "disabled" } };
  render(<><SelectBlock block={select as never} context={{} as never} pointer="/select" /><ToggleBlock block={toggle as never} context={{} as never} pointer="/toggle" /></>);

  const selectButton = screen.getByRole("button", { name: "환경" }) as HTMLButtonElement;
  const toggleButton = screen.getByRole("switch", { name: "자동 저장" }) as HTMLButtonElement;
  expect(selectButton.disabled).toBe(true);
  expect(toggleButton.disabled).toBe(true);
  fireEvent.click(selectButton);
  fireEvent.click(toggleButton);
  expect(screen.queryByRole("menuitem")).toBeNull();
  expect(runtime.act).not.toHaveBeenCalled();
});

it("공용 select와 버튼 블록은 축약 가능한 라벨 요소를 쓴다", () => {
  const select = { type: "select", value: "long", on_change: { client: "select" }, options: [{ value: "long", label: "아주 길어서 좁은 창에서 한 줄 말줄임이 필요한 선택지" }] };
  const button = { type: "button", label: "아주 길어서 좁은 창에서 한 줄 말줄임이 필요한 단추", on_click: { client: "run" } };
  render(<><SelectBlock block={select as never} context={{} as never} pointer="/select" /><ButtonBlock block={button as never} context={{} as never} pointer="/button" /></>);
  expect(document.querySelector(".ks-select-button .ks-select-choice-label")).toBeTruthy();
  expect(document.querySelector(".ks-data-button .ks-truncate-label")?.textContent).toContain("아주 길어서");
});

it("columns 입력은 보일 문자 수와 숫자 조작부 폭을 전달한다", () => {
  const input = { type: "input", kind: "number", columns: 4, value: 12, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton") as HTMLInputElement;
  const wrapper = field.closest(".ks-data-input") as HTMLDivElement;
  expect(wrapper.classList.contains("has-columns")).toBe(true);
  expect(wrapper.classList.contains("is-number")).toBe(true);
  expect(wrapper.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  field.focus();
  fireEvent.change(field, { target: { value: "1234" } });
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("1234");
});

it("search columns는 같은 문자 수와 검색 아이콘·지우기 조작부를 유지한다", () => {
  const plain = { type: "input", kind: "text", columns: 4, value: "표본", on_change: { client: "plain" } };
  const search = { type: "input", kind: "search", columns: 4, value: "표본", on_change: { client: "search" } };
  const view = render(<><InputBlock block={plain as never} context={{} as never} pointer="/plain" /><InputBlock block={search as never} context={{} as never} pointer="/search" /></>);
  const plainInput = view.container.querySelector(".ks-data-input.has-columns:not(.is-search)") as HTMLDivElement;
  const searchInput = view.container.querySelector(".ks-data-input.has-columns.is-search") as HTMLDivElement;
  expect(plainInput.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  expect(searchInput.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  expect(searchInput.classList.contains("is-search")).toBe(true);
  expect(searchInput.querySelector(".ks-data-input-search")).toBeTruthy();
  expect(searchInput.querySelector(".ks-data-input-clear")).toBeTruthy();
});

it("preview 단추는 그림과 이름을 한 선택 가능한 카드로 묶고 prefix를 접근 이름에 넣는다", () => {
  const preview = { type: "canvas", surface: "tile", aspect_ratio: 1 };
  const context = {} as never;
  const button = {
    type: "button", variant: "chip", label: "격자", prefix: "배치", preview,
    pressed: true, on_click: { client: "choose" },
  };
  render(<ButtonBlock block={button as never} context={context} pointer="/button" />);
  const action = screen.getByRole("button", { name: "배치: 격자" });
  const card = action.closest(".ks-data-button-card");
  expect(card).toBeTruthy();
  expect(card?.querySelector(".ks-data-button-card-preview")).toBeTruthy();
  expect(action.classList.contains("ks-data-button-card-action")).toBe(true);
  expect(action.getAttribute("aria-pressed")).toBe("true");
  expect(card?.querySelector(".ks-data-button-prefix")?.textContent).toBe("배치");
  expect(card?.querySelector(".ks-data-button-label")?.textContent).toBe("격자");
  expect(previewRender).toHaveBeenCalledWith(preview, context, "/button/preview");
  fireEvent.click(action);
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: false, alt: false, ctrl: false, meta: false });
});

it.each(["일반", "아이콘", "카드"])("%s 단추는 실행 중 포커스를 유지하고 중복 실행을 막는다", async (kind) => {
  let finish!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const button = { type: "button", label: "선택", on_click: { client: "choose" },
    ...(kind === "아이콘" ? { icon: "check", icon_only: true } : {}),
    ...(kind === "카드" ? { preview: { type: "canvas", surface: "tile" } } : {}) };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const action = screen.getByRole("button", { name: "선택" }) as HTMLButtonElement;
  action.focus();
  await userEvent.keyboard("{Enter}");
  expect(action.disabled).toBe(false);
  expect(action.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(action);
  await userEvent.keyboard("{Enter}");
  expect(runtime.act).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(document.activeElement).toBe(action);
});

it("image preview의 포커스 가능한 자식은 inert이고 탭 순서에는 카드 단추만 남는다", () => {
  previewRender.mockImplementation(() => <><button aria-label="확대" /><button aria-label="다시 시도" /></>);
  const image = { type: "image", src: { asset: "sample" } };
  const button = { type: "button", label: "견본", preview: image, on_click: { client: "choose" } };
  const view = render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const preview = view.container.querySelector(".ks-data-button-card-preview") as HTMLDivElement;
  const cardButton = screen.getByRole("button", { name: "견본" });
  const tabStops = [...view.container.querySelectorAll("button")].filter((item) => !item.closest("[inert]") && !item.disabled);

  expect(preview.hasAttribute("inert")).toBe(true);
  expect(preview.querySelectorAll("button")).toHaveLength(2);
  expect(cardButton.closest(".ks-data-button-card")).toBeTruthy();
  expect(preview.contains(cardButton)).toBe(false);
  expect(tabStops).toEqual([cardButton]);
});

it("단추는 늦은 동작 중 초점을 유지하고 250ms 뒤 진행을 보인다", async () => {
  vi.useFakeTimers();
  let finish!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  try {
    const button = { type: "button", label: "번역", on_click: { client: "go" } };
    render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
    const control = screen.getByRole("button", { name: "번역" }) as HTMLButtonElement;
    control.focus();
    fireEvent.click(control);
    expect(document.activeElement).toBe(control);
    expect(control.disabled).toBe(false);
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(control.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(control);
    expect(runtime.act).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(control.querySelector(".ks-button-progress")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(control.querySelector(".ks-button-progress")).toBeTruthy();
    await act(async () => { finish(true); });
    expect(control.querySelector(".ks-button-progress")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(control.querySelector(".ks-button-progress")).toBeNull();
    expect(document.activeElement).toBe(control);
  } finally { vi.useRealTimers(); }
});

it.each(["일반", "아이콘", "카드"])("%s 단추는 짧은 동작은 흐리지 않고 진행 표시는 최소 400ms 유지한다", async (kind) => {
  vi.useFakeTimers();
  try {
    for (const duration of [100, 300, 1000]) {
      runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { setTimeout(() => resolve(true), duration); }));
      const button = { type: "button", label: "시험", on_click: { client: "go" },
        ...(kind === "아이콘" ? { icon: "check", icon_only: true } : {}),
        ...(kind === "카드" ? { preview: { type: "canvas", surface: "tile" } } : {}) };
      const view = render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
      const control = screen.getByRole("button", { name: "시험" }) as HTMLButtonElement;
      const dimmed = () => kind === "카드" ? !!control.closest(".ks-data-button-card")?.classList.contains("is-disabled") : control.classList.contains("is-progress");
      const progress = () => !!view.container.querySelector(".ks-button-progress");
      const check = (busy: boolean, shown: boolean) => {
        expect(control.getAttribute("aria-busy") === "true").toBe(busy);
        expect(control.getAttribute("aria-disabled") === "true").toBe(busy);
        expect(dimmed()).toBe(shown);
        expect(progress()).toBe(shown);
      };
      const callsBefore = runtime.act.mock.calls.length;
      fireEvent.click(control);
      check(true, false);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      check(duration > 100, false);
      if (duration > 100) {
        await act(async () => { await vi.advanceTimersByTimeAsync(149); });
        check(true, false);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        check(true, true);
        await act(async () => { await vi.advanceTimersByTimeAsync(50); });
        check(true, true);
        fireEvent.click(control);
        expect(runtime.act).toHaveBeenCalledTimes(callsBefore + 1);
        await act(async () => { await vi.advanceTimersByTimeAsync(349); });
        check(true, true);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        check(duration > 650, duration > 650);
        if (duration > 650) {
          await act(async () => { await vi.advanceTimersByTimeAsync(350); });
          check(false, false);
        }
      }
      view.unmount();
    }
  } finally { vi.useRealTimers(); }
});

it("빠른 단추 동작은 진행 표시를 보이지 않는다", async () => {
  vi.useFakeTimers();
  try {
    const button = { type: "button", label: "실행", on_click: { client: "go" } };
    render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
    const control = screen.getByRole("button", { name: "실행" });
    await act(async () => { fireEvent.click(control); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(control.querySelector(".ks-button-progress")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("단추 강조가 바인딩 값으로 바뀌어도 같은 단추에 초점이 남는다", () => {
  runtime.values = { style: "default" };
  const button = { type: "button", label: "번역", variant: { client: "style" }, on_click: { client: "go" } };
  const draw = () => <ButtonBlock block={button as never} context={{} as never} pointer="/button" />;
  const view = render(draw());
  const control = screen.getByRole("button", { name: "번역" });
  control.focus();
  runtime.values.style = "primary";
  view.rerender(draw());
  expect(control.classList.contains("ks-button-emphasis")).toBe(true);
  expect(document.activeElement).toBe(control);
  runtime.values.style = "unknown";
  view.rerender(draw());
  expect(control.classList.contains("ks-button-default")).toBe(true);
});

it("아이콘 단추는 오래 도는 동안 기존 아이콘 대신 진행을 보인다", async () => {
  vi.useFakeTimers();
  let finish!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  try {
    const button = { type: "button", label: "새로 받기", icon: "refresh-cw", icon_only: true, on_click: { client: "go" } };
    render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
    const control = screen.getByRole("button", { name: "새로 받기" });
    control.focus();
    fireEvent.click(control);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(control.querySelector(".ks-button-progress")).toBeTruthy();
    expect(control.querySelector(".lucide-refresh-cw")).toBeNull();
    expect(document.activeElement).toBe(control);
    await act(async () => { finish(true); });
  } finally { vi.useRealTimers(); }
});

it.each([100, 300])("%sms에 닫힌 단추는 남은 진행 타이머를 정리한다", async (unmountAt) => {
  vi.useFakeTimers();
  let finish!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  try {
    const button = { type: "button", label: "실행", on_click: { client: "go" } };
    const view = render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
    fireEvent.click(screen.getByRole("button", { name: "실행" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(unmountAt); });
    if (unmountAt > 250) await act(async () => { finish(true); });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    if (unmountAt < 250) await act(async () => { finish(true); });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each([false, true])("앱이 잠근 단추는 미리보기 %s에서도 기본 비활성 모양을 유지한다", (preview) => {
  const button = { type: "button", label: "잠김", disabled: true, on_click: { client: "go" },
    ...(preview ? { preview: { type: "canvas", surface: "tile" } } : {}) };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const control = screen.getByRole("button", { name: "잠김" }) as HTMLButtonElement;
  expect(control.disabled).toBe(true);
  if (preview) expect(control.closest(".ks-data-button-card")?.classList.contains("is-disabled")).toBe(true);
  fireEvent.click(control);
  expect(runtime.act).not.toHaveBeenCalled();
});
