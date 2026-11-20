import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost, openContextMenu } from "../components/context-menu";
import { installTouchGestures } from "../components/touch-gestures";

// jsdom에는 PointerEvent 생성자가 없어 MouseEvent에 포인터 속성만 얹어 쓴다.
function touch(type: string, { x = 100, y = 100, id = 1 } = {}): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1 }) as PointerEvent;
  Object.defineProperty(event, "pointerType", { value: "touch" });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

function InstallGestures() {
  useEffect(() => installTouchGestures(() => {}), []);
  return null;
}

const removers: Array<() => void> = [];
function listen(type: string, listener: (event: MouseEvent) => void) {
  document.addEventListener(type, listener as EventListener);
  removers.push(() => document.removeEventListener(type, listener as EventListener));
}

async function send(target: Element, type: string, init?: { x?: number; y?: number; id?: number }) {
  await act(async () => { target.dispatchEvent(touch(type, init)); });
}

async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  removers.splice(0).forEach((remove) => remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("손가락 길게 누르기", () => {
  it("500ms 동안 누르면 누른 자리에서 contextmenu 하나를 보낸다", async () => {
    render(<><InstallGestures /><button>항목</button></>);
    const button = screen.getByRole("button", { name: "항목" });
    const events: MouseEvent[] = [];
    listen("contextmenu", (event) => events.push(event));
    await send(button, "pointerdown", { x: 40, y: 50 });
    await wait(499);
    expect(events).toHaveLength(0);
    await wait(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ clientX: 40, clientY: 50, button: 2, bubbles: true, cancelable: true });
    await send(button, "pointerup", { x: 40, y: 50 });
  });

  it("10px 넘게 움직이거나 떼면 길게 누르기를 그만둔다", async () => {
    render(<><InstallGestures /><button>항목</button></>);
    const button = screen.getByRole("button", { name: "항목" });
    const events: MouseEvent[] = [];
    listen("contextmenu", (event) => events.push(event));
    await send(button, "pointerdown", { x: 40, y: 50 });
    await wait(100);
    await send(button, "pointermove", { x: 51, y: 50 });
    await wait(500);
    expect(events).toHaveLength(0);
    await send(button, "pointerup", { x: 51, y: 50 });
    await send(button, "pointerdown", { x: 40, y: 50 });
    await wait(200);
    await send(button, "pointerup", { x: 40, y: 50 });
    await wait(500);
    expect(events).toHaveLength(0);
  });

  it("입력 칸에서는 길게 눌러도 메뉴를 만들지 않는다", async () => {
    render(<><InstallGestures /><input aria-label="칸" /></>);
    const input = screen.getByLabelText("칸");
    const events: MouseEvent[] = [];
    listen("contextmenu", (event) => events.push(event));
    await send(input, "pointerdown", { x: 40, y: 50 });
    await wait(1000);
    expect(events).toHaveLength(0);
    await send(input, "pointerup", { x: 40, y: 50 });
  });
});

describe("메뉴와 길게 누르기", () => {
  it("메뉴가 열린 뒤 따라오는 클릭을 막고 메뉴를 닫지 않는다", async () => {
    const select = vi.fn();
    render(<><ContextMenuHost /><button onContextMenu={(event) => openContextMenu(event, [{ id: "act", label: "동작", onSelect: select }])}>행</button></>);
    const row = screen.getByRole("button", { name: "행" });
    await send(row, "pointerdown", { x: 40, y: 50 });
    await wait(500);
    expect(screen.getByRole("menuitem", { name: "동작" })).toBeTruthy();
    await send(row, "pointerup", { x: 40, y: 50 });
    let click!: MouseEvent;
    await act(async () => { click = new MouseEvent("click", { bubbles: true, cancelable: true }); row.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByRole("menuitem", { name: "동작" })).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    await wait(1000);
    let later!: MouseEvent;
    await act(async () => { later = new MouseEvent("click", { bubbles: true, cancelable: true }); row.dispatchEvent(later); });
    expect(later.defaultPrevented).toBe(false);
  });

  it("메뉴를 연 뒤 첫 click은 메뉴 항목이어도 막는다", async () => {
    const select = vi.fn();
    render(<><ContextMenuHost /><button onContextMenu={(event) => openContextMenu(event, [{ id: "act", label: "동작", onSelect: select }])}>행</button></>);
    const row = screen.getByRole("button", { name: "행" });
    await send(row, "pointerdown", { x: 40, y: 50 });
    await wait(500);
    const item = screen.getByRole("menuitem", { name: "동작" });
    await send(row, "pointerup", { x: 40, y: 50 });
    let click!: MouseEvent;
    await act(async () => { click = new MouseEvent("click", { bubbles: true, cancelable: true }); item.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "동작" })).toBeTruthy();
  });

  it("억제 뒤 손가락으로 메뉴 항목을 새로 누르면 한 번 실행된다", async () => {
    const select = vi.fn();
    render(<><ContextMenuHost /><button onContextMenu={(event) => openContextMenu(event, [{ id: "act", label: "동작", onSelect: select }])}>행</button></>);
    const row = screen.getByRole("button", { name: "행" });
    await send(row, "pointerdown", { x: 40, y: 50 });
    await wait(500);
    const item = screen.getByRole("menuitem", { name: "동작" });
    await send(row, "pointerup", { x: 40, y: 50 });
    await send(item, "pointerdown", { x: 60, y: 60 });
    await send(item, "pointerup", { x: 60, y: 60 });
    let click!: MouseEvent;
    await act(async () => { click = new MouseEvent("click", { bubbles: true, cancelable: true }); item.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("짧은 두 번 누르기", () => {
  it("두 번 누르면 dblclick 하나를 보내고 기기의 dblclick은 한 번 막는다", async () => {
    render(<><InstallGestures /><button>행</button></>);
    const row = screen.getByRole("button", { name: "행" });
    const events: MouseEvent[] = [];
    listen("dblclick", (event) => events.push(event));
    await send(row, "pointerdown", { x: 40, y: 50 });
    await send(row, "pointerup", { x: 40, y: 50 });
    await wait(100);
    await send(row, "pointerdown", { x: 41, y: 50 });
    await send(row, "pointerup", { x: 41, y: 50 });
    await wait(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ clientX: 41, clientY: 50, detail: 2, bubbles: true, cancelable: true });
    await act(async () => { row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); });
    expect(events).toHaveLength(1);
    await wait(700);
    await act(async () => { row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); });
    expect(events).toHaveLength(2);
  });
});

describe("글자 선택과 마우스", () => {
  it("글자 선택이 열린 자리에서는 기본 메뉴를 열지 않고 선택을 그대로 둔다", async () => {
    render(<><ContextMenuHost /><div style={{ userSelect: "text" }}>읽는 글</div></>);
    const reading = screen.getByText("읽는 글");
    await act(async () => {
      const range = document.createRange();
      range.selectNodeContents(reading);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await send(reading, "pointerdown", { x: 10, y: 10 });
    await wait(500);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(window.getSelection()?.toString()).toBe("읽는 글");
    await send(reading, "pointerup", { x: 10, y: 10 });
  });

  it("글자 선택 자리에서 앱이 메뉴를 열면 기기 선택을 지운다", async () => {
    render(<><ContextMenuHost /><div style={{ userSelect: "text" }} onContextMenu={(event) => openContextMenu(event, [{ id: "act", label: "동작", onSelect() {} }])}>읽는 글</div></>);
    const reading = screen.getByText("읽는 글");
    await act(async () => {
      const range = document.createRange();
      range.selectNodeContents(reading);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await send(reading, "pointerdown", { x: 10, y: 10 });
    await wait(500);
    expect(screen.getByRole("menuitem", { name: "동작" })).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe("");
    await send(reading, "pointerup", { x: 10, y: 10 });
  });

  it("마우스 우클릭과 더블클릭은 그대로 둔다", async () => {
    render(<><ContextMenuHost /><button onContextMenu={(event) => openContextMenu(event, [{ id: "act", label: "동작", onSelect() {} }])}>행</button></>);
    const row = screen.getByRole("button", { name: "행" });
    const contexts: MouseEvent[] = [];
    listen("contextmenu", (event) => contexts.push(event));
    fireEvent.contextMenu(row, { clientX: 12, clientY: 14 });
    expect(contexts).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: "동작" })).toBeTruthy();
    const mouseDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 12, clientY: 14 }) as PointerEvent;
    Object.defineProperty(mouseDown, "pointerType", { value: "mouse" });
    Object.defineProperty(mouseDown, "pointerId", { value: 1 });
    Object.defineProperty(mouseDown, "isPrimary", { value: true });
    await act(async () => { row.dispatchEvent(mouseDown); });
    await wait(800);
    expect(contexts).toHaveLength(1);
    const doubles: MouseEvent[] = [];
    listen("dblclick", (event) => doubles.push(event));
    await act(async () => { row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); });
    expect(doubles).toHaveLength(1);
  });
});
