import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ColorField, NumberField } from "../blocks/html-document/fields";

afterEach(cleanup);

it("숫자를 끄는 동안 부모를 갱신하지 않고 놓을 때 한 번 확정한다", () => {
  const preview = vi.fn(); const commit = vi.fn(); let parentRenders = 0;
  function Parent() { parentRenders++; return <NumberField label="크기" prop="font-size" value="10" min={1} preview={preview} commit={commit} />; }
  render(<Parent />);
  const label = screen.getByText("크기");
  Object.defineProperty(label, "setPointerCapture", { value: vi.fn() });
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(label, event);
  };
  pointer("pointerdown", 10); pointer("pointermove", 15); pointer("pointermove", 20);
  expect(parentRenders).toBe(1);
  expect(commit).not.toHaveBeenCalled();
  expect(preview).toHaveBeenLastCalledWith("font-size", "20px");
  pointer("pointerup", 20);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith("font-size", "20px");
});

it("값을 고치지 않고 칸을 떠나면 편집을 만들지 않고 색 견본 변경을 표시한다", () => {
  const commit = vi.fn(); const preview = vi.fn(); const focus = vi.fn();
  const { rerender } = render(<><NumberField label="크기" prop="font-size" value="15" preview={preview} commit={commit} /><ColorField label="배경" prop="background-color" value="rgb(59, 91, 219)" focus={focus} preview={preview} commit={commit} /></>);
  const number = screen.getByRole("textbox", { name: "크기" });
  fireEvent.focus(number); fireEvent.blur(number);
  const color = screen.getByRole("textbox", { name: "배경" });
  fireEvent.focus(color);
  rerender(<><NumberField label="크기" prop="font-size" value="15" preview={preview} commit={commit} /><ColorField label="배경" prop="background-color" value="rgb(217, 72, 15)" focus={focus} preview={preview} commit={commit} /></>);
  expect(color).toHaveProperty("value", "#d9480f");
  fireEvent.blur(color);
  expect(commit).not.toHaveBeenCalled();
});

it("색상판 input은 미리 보고 change에서 한 번 확정한다", () => {
  const preview = vi.fn(); const commit = vi.fn();
  render(<ColorField label="배경" prop="background-color" value="#000000" focus={vi.fn()} preview={preview} commit={commit} />);
  const swatch = screen.getByLabelText("배경 선택");
  for (const value of ["#111111", "#222222", "#333333", "#444444", "#555555"]) fireEvent.input(swatch, { target: { value } });
  expect(preview).toHaveBeenCalledTimes(5);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(swatch, { target: { value: "#555555" } });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith("background-color", "#555555");
});
