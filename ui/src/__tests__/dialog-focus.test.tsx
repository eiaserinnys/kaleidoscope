import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StrictMode, useState } from "react";
import { Dialog } from "../components/dialog";
import { isUnclaimedFocus } from "../components/focus-rescue";

afterEach(cleanup);

function show(body: React.ReactNode, options: { danger?: boolean; showCancel?: boolean } = {}) {
  render(<Dialog host={document.body} title="확인" body={body} ok="확인" onCancel={() => {}} onConfirm={() => {}} {...options} />);
  return screen.getByRole("dialog");
}

it("확정 대화상자는 사용할 수 있는 첫 입력에 초점을 둔다", () => {
  const dialog = show(<><input type="hidden" /><input disabled /><input readOnly /><div hidden><input /></div><input aria-label="이름" defaultValue="보존" /></>);
  const input = within(dialog).getByRole("textbox", { name: "이름" }) as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(input.selectionEnd);
});

it.each([true, false])("입력이 없는 위험 여부 %s 확인은 취소에 초점을 둔다", (danger) => {
  const dialog = show("확인하시겠습니까?", { danger });
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" }));
});

it("취소가 없는 대화상자는 입력이 있으면 입력, 없으면 닫기에 초점을 둔다", () => {
  const first = show(<input aria-label="찾기" />, { showCancel: false });
  expect(document.activeElement).toBe(within(first).getByRole("textbox", { name: "찾기" }));
  cleanup();
  const second = show("내용", { showCancel: false });
  expect(document.activeElement).toBe(within(second).getByRole("button", { name: "확인" }));
});

function FocusDialog({ enabled = true, version = 0 }: { enabled?: boolean; version?: number }) {
  const [open, setOpen] = useState(false);
  return <><button aria-disabled={open || undefined} onClick={() => setOpen(true)}>열기</button><span>{version}</span>
    {enabled && open ? <Dialog host={document.body} title="확인" ok="확정" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} /> : null}
  </>;
}

it("부모가 다시 그려도 처음 연 요소로 취소 뒤 돌아간다", () => {
  const view = render(<StrictMode><FocusDialog /></StrictMode>);
  const opener = screen.getByRole("button", { name: "열기" });
  opener.focus(); fireEvent.click(opener);
  view.rerender(<StrictMode><FocusDialog version={1} /></StrictMode>);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.activeElement).toBe(opener);
});

it("확정으로 닫으면 연 요소로 돌아간다", () => {
  render(<FocusDialog />);
  const opener = screen.getByRole("button", { name: "열기" });
  opener.focus(); fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "확정" }));
  expect(document.activeElement).toBe(opener);
});

it("조건부 부모와 함께 사라져도 연 요소로 돌아간다", () => {
  const view = render(<FocusDialog />);
  const opener = screen.getByRole("button", { name: "열기" });
  opener.focus(); fireEvent.click(opener);
  view.rerender(<FocusDialog enabled={false} />);
  expect(document.activeElement).toBe(opener);
});

it("대화상자는 알림 슬롯을 본문 스크롤과 바닥 단추 사이에 두고 닫을 때 놓는다", () => {
  let slot: HTMLDivElement | null = null;
  render(<Dialog host={document.body} title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={() => {}} onConfirm={() => {}} noticeSlotRef={(element) => { slot = element; }} />);
  const dialog = screen.getByRole("dialog");
  const element = dialog.querySelector<HTMLDivElement>(".ks-dialog-notice-slot");
  expect(element).toBeTruthy();
  expect(element!.previousElementSibling?.classList.contains("ks-dialog-scroll")).toBe(true);
  expect(element!.nextElementSibling?.classList.contains("ks-dialog-actions")).toBe(true);
  expect(slot).toBe(element);
  cleanup();
  expect(slot).toBeNull();
});

it("대화상자가 처음 주는 초점은 쉘이 준 초점으로 표시한다", () => {
  const dialog = show(<input aria-label="이름" />);
  const input = within(dialog).getByRole("textbox", { name: "이름" });
  expect(document.activeElement).toBe(input);
  expect(isUnclaimedFocus(input)).toBe(true);
});
