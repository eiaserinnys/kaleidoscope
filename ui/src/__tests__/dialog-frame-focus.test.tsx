import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "../components/dialog";

// jsdom은 스타일시트를 적용하지 않으므로, 브라우저가 계산할 user-select 값을 시험마다 요소에 직접 적는다.
afterEach(cleanup);

function open(body: React.ReactNode, options: { windowModal?: boolean; busy?: boolean } = {}) {
  const onCancel = vi.fn();
  render(<Dialog host={document.body} title="확인" body={body} ok="확인" onCancel={onCancel} onConfirm={() => {}} {...options} />);
  const dialog = screen.getByRole("dialog");
  const overlay = dialog.parentElement as HTMLElement;
  return { dialog, overlay, onCancel };
}

it("대화상자 제목을 눌러도 기본 동작을 막아 초점을 빼앗기지 않는다", () => {
  const { dialog, onCancel } = open(<input aria-label="이름" />);
  const title = dialog.querySelector<HTMLElement>(".ks-dialog-title")!;
  title.style.userSelect = "none";
  expect(fireEvent.mouseDown(title)).toBe(false);
  expect(onCancel).not.toHaveBeenCalled();
});

it("대화상자 빈 곳을 눌러도 기본 동작을 막는다", () => {
  const { dialog } = open("내용");
  dialog.style.userSelect = "none";
  expect(fireEvent.mouseDown(dialog)).toBe(false);
});

it("누를 수 있는 요소의 기본 동작은 막지 않는다", () => {
  const { dialog } = open(<input aria-label="이름" />);
  const button = screen.getByRole("button", { name: "확인" });
  button.style.userSelect = "none";
  expect(fireEvent.mouseDown(button)).toBe(true);
  expect(fireEvent.mouseDown(screen.getByRole("textbox", { name: "이름" }))).toBe(true);
  expect(dialog).toBeTruthy();
});

it("창 본문 컨테이너 안의 대화상자도 제목을 누르면 초점을 빼앗기지 않는다", () => {
  const windowContent = document.createElement("div");
  windowContent.className = "ks-window-content";
  windowContent.tabIndex = -1;
  document.body.appendChild(windowContent);
  const host = document.createElement("div");
  windowContent.appendChild(host);
  try {
    render(<Dialog host={host} title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={() => {}} onConfirm={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const title = dialog.querySelector<HTMLElement>(".ks-dialog-title")!;
    title.style.userSelect = "none";
    expect(fireEvent.mouseDown(title)).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("textbox", { name: "이름" }))).toBe(true);
  } finally {
    windowContent.remove();
  }
});

it("읽을 수 있는 글은 끌어 고를 수 있게 두고, 눌렀다 떼면 대화상자 입력으로 초점을 돌려준다", () => {
  const { dialog } = open(<><input aria-label="이름" /><p style={{ userSelect: "text" }}>읽을 글</p></>);
  const input = screen.getByRole("textbox", { name: "이름" });
  input.focus();
  const text = dialog.querySelector("p")!;
  expect(fireEvent.mouseDown(text)).toBe(true);
  // 브라우저는 누름의 기본 동작으로 초점을 바닥으로 옮긴다.
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(text);
  expect(document.activeElement).toBe(input);
});

it("글을 끌어 고른 뒤에는 초점을 되돌리지 않아 선택이 남는다", () => {
  const { dialog } = open(<><input aria-label="이름" /><p style={{ userSelect: "text" }}>읽을 글</p></>);
  const input = screen.getByRole("textbox", { name: "이름" });
  input.focus();
  const text = dialog.querySelector("p")!;
  fireEvent.mouseDown(text);
  (document.activeElement as HTMLElement | null)?.blur();
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.click(text);
  expect(document.activeElement).not.toBe(input);
});

it("덮개 바깥을 누르면 지금처럼 취소한다", () => {
  const { overlay, onCancel } = open("내용");
  expect(fireEvent.mouseDown(overlay)).toBe(false);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("창 대화상자와 진행 중 대화상자는 덮개 바깥을 눌러도 취소하지 않는다", () => {
  const modal = open("내용", { windowModal: true });
  expect(fireEvent.mouseDown(modal.overlay)).toBe(true);
  expect(modal.onCancel).not.toHaveBeenCalled();
  cleanup();
  const busy = open("내용", { busy: true });
  expect(fireEvent.mouseDown(busy.overlay)).toBe(true);
  expect(busy.onCancel).not.toHaveBeenCalled();
});
