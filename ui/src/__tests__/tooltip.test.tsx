import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipProvider } from "../components/tooltip";

function fixtures() {
  return render(<TooltipProvider><Tooltip content="첫 설명"><button aria-describedby="existing">첫 단추</button></Tooltip><Tooltip content="둘 설명"><button>둘째 단추</button></Tooltip></TooltipProvider>);
}
const originalPointerEvent = window.PointerEvent;
window.PointerEvent = MouseEvent as typeof PointerEvent;
afterEach(() => { cleanup(); vi.useRealTimers(); });
afterAll(() => { window.PointerEvent = originalPointerEvent; });
describe("Tooltip", () => {
  it("delays hover, keeps the surface hovered, and skips the next delay", () => {
    vi.useFakeTimers(); fixtures();
    const first = screen.getByRole("button", { name: "첫 단추" });
    const second = screen.getByRole("button", { name: "둘째 단추" });
    fireEvent.pointerEnter(first, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("첫 설명");
    expect(first.getAttribute("aria-describedby")).toContain("existing");
    fireEvent.pointerLeave(first, { relatedTarget: tip, pointerType: "mouse" });
    fireEvent.pointerEnter(tip, { relatedTarget: first, pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.pointerLeave(tip, { relatedTarget: second, pointerType: "mouse" });
    fireEvent.pointerEnter(second, { relatedTarget: tip, pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toBe("둘 설명");
  });
  it("opens on keyboard focus immediately and Escape suppresses reopening until exit", () => {
    vi.useFakeTimers(); fixtures();
    const first = screen.getByRole("button", { name: "첫 단추" });
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => first.focus());
    expect(screen.getByRole("tooltip").textContent).toBe("첫 설명");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => first.blur());
    act(() => first.focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});

it("설명이 없는 비활성 단추는 기존처럼 직계 자식이다", () => {
  const view = render(<div className="ks-data-button"><Tooltip content={null}><button disabled>비활성</button></Tooltip></div>);
  expect(view.container.querySelector(".ks-data-button > button:disabled")).toBeTruthy();
  expect(view.container.querySelector(".ks-tooltip-disabled")).toBeNull();
});

it("비활성 단추도 감싸지 않고 올림으로 설명을 연다", () => {
  vi.useFakeTimers();
  const view = render(<TooltipProvider><div className="ks-data-button"><Tooltip content="비활성 설명"><button disabled>비활성</button></Tooltip></div></TooltipProvider>);
  const button = screen.getByRole("button", { name: "비활성" });
  expect(view.container.querySelector(".ks-data-button > button:disabled")).toBe(button);
  fireEvent.pointerEnter(button, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("tooltip").textContent).toBe("비활성 설명");
  fireEvent.pointerLeave(button, { relatedTarget: document.body, pointerType: "mouse" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
