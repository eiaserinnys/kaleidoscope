import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import "../styles/data-blocks.css";
import "../styles/selection.css";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

function definition(ui: Block, state: Record<string, JsonValue>): AppDefinition {
  return {
    ...mdEditorDefinition,
    requires: { blocks: 14, modules: {} },
    state,
    ui,
  };
}

function setup(ui: Block, state: Record<string, JsonValue>) {
  const app = definition(ui, state);
  const seed = makeTestSeed({ definitions: [app] });
  seed.snapshot.shared.windows[0].state = structuredClone(state);
  const transport = createFakeTransport(seed);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { store, transport, spy };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("입력 블록 확장", () => {
  it("숫자 입력을 지정한 자릿수로 보이고 Enter와 이어진 blur에서 한 번 확정한다", async () => {
    const { spy } = setup(
      { type: "input", kind: "number", value: { state: "amount" }, on_change: { set_state: "amount" }, commit: "submit", format: { kind: "decimal", digits: 2 }, min: 0, max: 10, step: 0.05 },
      { amount: 1.2 },
    );
    const input = await screen.findByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("1.20");
    expect(input.min).toBe("0");
    expect(input.max).toBe("10");
    expect(input.step).toBe("0.05");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "4.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(spy.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer === "/ui/on_change")).toHaveLength(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_change", event: 4.5 }));
  });

  it("서식과 focus 신호가 없는 숫자 입력은 기존 숫자 컨트롤을 유지한다", async () => {
    setup(
      { type: "input", kind: "number", value: { state: "amount" }, on_change: { set_state: "amount" }, min: 0, max: 10, step: 0.5 },
      { amount: 1 },
    );
    const input = await screen.findByRole("spinbutton") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(fireEvent.keyDown(input, { key: "ArrowUp" })).toBe(true);
  });

  it("blur 모드는 입력을 떠날 때 한 번 확정한다", async () => {
    const { spy } = setup(
      { type: "input", kind: "number", value: { state: "amount" }, on_change: { set_state: "amount" }, commit: "blur", format: { kind: "decimal", digits: 2 } },
      { amount: 1 },
    );
    const input = await screen.findByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3.456" } });
    fireEvent.blur(input);
    await waitFor(() => expect(spy.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer === "/ui/on_change")).toHaveLength(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_change", event: 3.46 }));
  });

  it("Escape로 초안을 버리고 취소 동작만 보낸다", async () => {
    const { store, spy } = setup(
      { type: "input", kind: "number", value: { state: "amount" }, on_change: { set_state: "amount" }, on_cancel: [{ set_state: "cancelled", value: true }], commit: "submit" },
      { amount: 2, cancelled: false },
    );
    const input = await screen.findByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(input.value).toBe("2"));
    expect(store.getSnapshot()?.shared.windows[0].state).toMatchObject({ amount: 2, cancelled: true });
    expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer === "/ui/on_change")).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_cancel" }));
  });

  it("IME 조합 중 Escape를 입력 취소로 가로채지 않는다", async () => {
    const { spy } = setup(
      { type: "input", kind: "text", value: { state: "name" }, on_change: { set_state: "name" }, on_cancel: { set_state: "cancelled" }, commit: "submit" },
      { name: "Mira", cancelled: false },
    );
    const input = await screen.findByRole("textbox");
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer === "/ui/on_cancel")).toBe(false);
  });

  it("focus 신호가 바뀔 때 맨 위 창의 입력을 선택하고 단순 재렌더에서는 포커스를 빼앗지 않는다", async () => {
    const focusedApp = definition(
      { type: "input", kind: "number", value: { state: "amount" }, on_change: { set_state: "amount" }, focus: { state: "focus" }, placeholder: "값" },
      { amount: 12, focus: 0, other: 0 },
    );
    const otherApp: AppDefinition = { id: "other", name: "다른 창", requires: { blocks: 14, modules: {} }, permissions: [], state: {}, ui: { type: "text", value: "다른 창" } };
    const seed = makeTestSeed({ definitions: [focusedApp, otherApp] });
    seed.snapshot.shared.windows[0].state = { ...focusedApp.state };
    const transport = createFakeTransport(seed);
    const store = createShellStore(transport);
    render(<><AppWindowContent store={store} windowId="editor-window" /><AppWindowContent store={store} windowId="viewer-window" /></>);
    const input = await screen.findByPlaceholderText("값") as HTMLInputElement;
    await waitFor(() => expect(screen.getByText("다른 창")).toBeTruthy());
    await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { amount: 12, focus: 1, other: 0 } }); });
    expect(document.activeElement).not.toBe(input);
    await act(async () => { await store.call({ op: "window.raise", window_id: "editor-window" }); });
    await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { amount: 12, focus: 2, other: 0 } }); });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    const otherButton = document.createElement("button");
    otherButton.textContent = "다른 조작";
    document.body.append(otherButton);
    otherButton.focus();
    await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { amount: 12, focus: 2, other: 1 } }); });
    expect(document.activeElement).toBe(otherButton);
    otherButton.remove();
  });

  it("focus 신호가 일반 문자열 입력도 선택한다", async () => {
    const { store } = setup(
      { type: "input", kind: "text", value: { state: "name" }, on_change: { set_state: "name" }, focus: { state: "focus" } },
      { name: "Mira", focus: 0 },
    );
    const input = await screen.findByRole("textbox") as HTMLInputElement;
    await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { name: "Mira", focus: 1 } }); });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Mira".length);
  });
});

describe("표시·배치 블록 확장", () => {
  it("time 텍스트를 Clock 값에서 표시하고 키보드와 수정 키로 조작한다", async () => {
    const clock = { position: 62.349, sampled_at: 1000, rate: 1, running: false, duration: 120 };
    const { spy } = setup(
      { type: "text", value: { state: "clock" }, format: "time", on_click: { set_state: "clicked" }, on_double_click: { set_state: "double_clicked" } },
      { clock, clicked: false, double_clicked: false },
    );
    const text = await screen.findByRole("button", { name: "01:02.35" });
    fireEvent.keyDown(text, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_click", modifiers: { shift: true, alt: false, ctrl: false, meta: false } })));
    fireEvent.doubleClick(text);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_double_click" })));
  });

  it("두 번 누르기만 있는 텍스트도 키보드로 실행할 수 있다", async () => {
    const { spy } = setup({ type: "text", value: "열기", on_double_click: { set_state: "opened" } }, { opened: false });
    const text = await screen.findByRole("button", { name: "열기" });
    fireEvent.keyDown(text, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_double_click" })));
  });

  it("chip 단추는 pressed 상태를 접근성 상태와 공용 선택 모양으로 보인다", async () => {
    setup({ type: "button", variant: "chip", label: "반복", pressed: { state: "pressed" }, on_click: [{ set_state: "pressed", value: false }] }, { pressed: true });
    const chip = await screen.findByRole("button", { name: "반복" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.classList.contains("is-selected")).toBe(true);
  });

  it("section action은 접기를 건드리지 않고 stack은 줄을 감싸며 progress는 진행과 미정 상태를 보인다", async () => {
    const { store } = setup({
      type: "stack", direction: "row", wrap: true, children: [
        { type: "section", title: "작업", meta: "1개", collapsible: true, actions: [{ type: "button", label: "실행", on_click: [{ set_state: "ran", value: true }] }], child: { type: "text", value: "세부 내용" } },
        { type: "progress", value: { state: "amount" }, max: 10, label: "진행" },
        { type: "progress", value: { state: "unknown" }, max: 1, label: "미정" },
      ],
    }, { amount: 4, unknown: null, ran: false });
    const stack = await screen.findByText("세부 내용").then((text) => text.closest(".ks-data-stack"));
    expect(stack?.classList.contains("is-wrap")).toBe(true);
    await screen.findByRole("progressbar", { name: "진행" });
    const unknown = screen.getByRole("progressbar", { name: "미정" });
    expect(unknown.hasAttribute("aria-valuenow")).toBe(false);
    await fireEvent.click(screen.getByRole("button", { name: "실행" }));
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.ran).toBe(true));
    expect(screen.getByText("세부 내용")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /작업/ }));
    expect(screen.queryByText("세부 내용")).toBeNull();
  });
});
