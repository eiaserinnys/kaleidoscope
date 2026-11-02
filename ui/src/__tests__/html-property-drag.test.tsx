import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NumberField } from "../blocks/html-document/fields";

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
