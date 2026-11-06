import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useCommentPick } from "../comments/pick";

afterEach(cleanup);

it("고르기 상태에서 앱의 누름을 막고 대상을 넘기며 끄면 원래 누름을 되돌린다", () => {
  const picked = vi.fn(), clicked = vi.fn(), keydown = vi.fn(), hover = vi.fn();
  function Harness() {
    const [content, setContent] = useState<HTMLDivElement | null>(null);
    const [on, setOn] = useState(true);
    useCommentPick(content, on, picked, hover);
    return <><button onClick={() => setOn(false)}>고르기 종료</button><div ref={setContent}><div data-ks-block="/ui" data-ks-block-type="button"><button onClick={clicked} onKeyDown={keydown}>앱 동작</button></div></div></>;
  }
  render(<Harness />);
  const button = screen.getByRole("button", { name: "앱 동작" });
  button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  button.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
  fireEvent.click(button);
  expect(picked).toHaveBeenCalledOnce();
  expect(picked.mock.calls[0][0].anchor.kind).toBe("control");
  expect(clicked).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(keydown).toHaveBeenCalledOnce();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(keydown).toHaveBeenCalledOnce();
  expect(picked).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "고르기 종료" }));
  fireEvent.click(button);
  expect(clicked).toHaveBeenCalledOnce();
});
