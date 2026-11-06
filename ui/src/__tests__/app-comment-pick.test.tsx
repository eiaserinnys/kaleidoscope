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
  expect(picked.mock.calls[0][0].input).toBe("pointer");
  expect(clicked).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(keydown).not.toHaveBeenCalled();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(keydown).not.toHaveBeenCalled();
  expect(picked).toHaveBeenCalledTimes(2);
  expect(picked.mock.calls[1][0].input).toBe("keyboard");
  fireEvent.click(screen.getByRole("button", { name: "고르기 종료" }));
  fireEvent.click(button);
  expect(clicked).toHaveBeenCalledOnce();
});

it("화살표로 목록 초점을 옮기되 앱 키 동작은 실행하지 않는다", () => {
  const acted = vi.fn(), hover = vi.fn();
  function Harness() {
    const [content, setContent] = useState<HTMLDivElement | null>(null);
    useCommentPick(content, true, () => {}, hover);
    return <div ref={setContent}><div role="listbox"><button role="option" data-focus-index={0} onKeyDown={acted}>첫째</button><button role="option" data-focus-index={1} onKeyDown={acted}>둘째</button></div></div>;
  }
  render(<Harness />);
  const first = screen.getByRole("option", { name: "첫째" });
  const second = screen.getByRole("option", { name: "둘째" });
  second.scrollIntoView = vi.fn();
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(second);
  expect(hover).toHaveBeenLastCalledWith(second);
  expect(acted).not.toHaveBeenCalled();
});
