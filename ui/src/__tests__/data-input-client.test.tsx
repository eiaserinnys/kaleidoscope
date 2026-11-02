import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock, ColorBlock, InputBlock, SelectBlock } from "../blocks/data-input";

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
