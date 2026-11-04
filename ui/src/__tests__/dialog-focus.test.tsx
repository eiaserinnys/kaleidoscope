import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "../components/dialog";

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
