import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WindowChrome } from "../../../app/src/shell/window-chrome";

afterEach(cleanup);

function renderChrome(overrides: Partial<Parameters<typeof WindowChrome>[0]> = {}) {
  const onRaise = vi.fn();
  const onMinimize = vi.fn();
  const onMaximize = vi.fn();
  const onClose = vi.fn();
  render(
    <WindowChrome
      area={{ width: 1200, height: 800 }}
      rect={{ x: 100, y: 100, width: 800, height: 600 }}
      maximized={false}
      minimized={false}
      zIndex={1}
      isTop={false}
      title="앱"
      icon={<span />}
      menuEntries={[]}
      onRaise={onRaise}
      onMinimize={onMinimize}
      onMaximize={onMaximize}
      onRestore={() => undefined}
      onClose={onClose}
      onRectCommit={async () => true}
      testId="app-window-test"
      {...overrides}
    >내용</WindowChrome>,
  );
  return { onRaise, onMinimize, onMaximize, onClose };
}

it("맨 위가 아닌 창의 최소화와 닫기 누름은 창을 올리지 않고 동작만 실행한다", () => {
  const { onRaise, onMinimize, onClose } = renderChrome();

  fireEvent.pointerDown(screen.getByRole("button", { name: "창 최소화" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "창 닫기" }));
  expect(onRaise).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "창 최소화" }));
  expect(onMinimize).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("맨 위가 아닌 창의 최대화와 내용 누름은 창을 올린다", () => {
  const { onRaise } = renderChrome();

  fireEvent.pointerDown(screen.getByRole("button", { name: "창 최대화" }));
  expect(onRaise).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(screen.getByText("내용"));
  expect(onRaise).toHaveBeenCalledTimes(2);
});

it("최소화와 닫기 누름은 다른 창이 쥔 초점을 거두지 않는다", () => {
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  renderChrome();

  fireEvent.pointerDown(screen.getByRole("button", { name: "창 최소화" }));
  expect(document.activeElement).toBe(input);
  fireEvent.pointerDown(screen.getByRole("button", { name: "창 최대화" }));
  expect(document.activeElement).not.toBe(input);
  input.remove();
});
