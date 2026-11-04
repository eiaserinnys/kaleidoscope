import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorBlock, InputBlock, SelectBlock, SliderBlock } from "../blocks/data-input";

vi.mock("../data/window-data", () => ({
  useWindowData: () => ({ act: vi.fn().mockResolvedValue(true), holdInput: () => () => undefined, store: { getSnapshot: () => ({}) } }),
  useBinding: (_pointer: string, value: unknown) => ({ status: "ready", value }),
}));
vi.mock("../data/window-state", () => ({ useWindowVisible: () => true, isWindowTop: () => true }));
const context = { store: {} as never, window: { id: "w", app_id: "app", app_version: 1, desktop_id: "d" }, definition: {} as never };
const common = { label: "이름", value: "red", on_change: { set_state: "value" } };
afterEach(cleanup);

describe.each(["inline", "top", "hidden"] as const)("이름표 %s", (position) => {
  it.each(["input", "select", "slider", "color"] as const)("%s의 접근 이름과 위치", (kind) => {
    const props = { pointer: "/ui", context };
    const block = { ...common, type: kind, label_position: position, ...(kind === "select" ? { options: ["red"] } : {}), ...(kind === "slider" ? { min: 0, max: 100, value: 42 } : {}) } as never;
    const components = { input: InputBlock, select: SelectBlock, slider: SliderBlock, color: ColorBlock };
    const Control = components[kind] as typeof InputBlock;
    const { container } = render(<Control {...props} block={block} />);
    const control = kind === "slider" ? screen.getByRole("slider", { name: "이름" }) : kind === "select" ? screen.getByRole("button", { name: "이름" }) : container.querySelector("input")!;
    expect(control).toBeTruthy();
    if (kind === "input") expect(screen.getByRole("textbox", { name: "이름" })).toBeTruthy();
    if (kind === "color") expect(control.getAttribute("aria-label")).toBe("이름");
    expect(container.querySelector(".ks-field-label") !== null).toBe(position !== "hidden");
    expect(container.querySelector(".ks-field")?.classList.contains(`is-label-${position}`)).toBe(position !== "inline");
  });
});
it("슬라이더 숫자는 생략하면 보이고 false면 숨긴다", () => {
  const props = { pointer: "/ui", context };
  const base = { type: "slider" as const, label: "크기", value: 42, min: 0, max: 100, on_change: { set_state: "value" } };
  const view = render(<SliderBlock {...props} block={base} />);
  expect(view.container.querySelector(".ks-slider-value")?.textContent).toBe("42");
  view.rerender(<SliderBlock {...props} block={{ ...base, show_value: false } as typeof base} />);
  expect(view.container.querySelector(".ks-slider-value")).toBeNull();
});

it("숨긴 이름표는 분할 고르기 묶음의 접근 이름이다", () => {
  const block = { ...common, type: "select" as const, style: "segmented" as const, label_position: "hidden" as const, options: ["red", "blue"] };
  render(<SelectBlock block={block} context={context} pointer="/ui" />);
  expect(screen.getByRole("group", { name: "이름" })).toBeTruthy();
});
