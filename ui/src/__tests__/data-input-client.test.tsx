import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock, ColorBlock, InputBlock, SelectBlock, ToggleBlock } from "../blocks/data-input";

const runtime = vi.hoisted(() => ({ values: {} as Record<string, unknown>, act: vi.fn().mockResolvedValue(true) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding && typeof binding === "object" && "client" in binding ? runtime.values[(binding as { client: string }).client] : binding && typeof binding === "object" && "state" in binding ? 120 : binding }),
}));
afterEach(() => { cleanup(); runtime.values = {}; runtime.act.mockClear(); });

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
