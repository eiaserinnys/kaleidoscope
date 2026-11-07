import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { Dialog } from "../components/dialog";
import { isUnclaimedFocus } from "../components/focus-rescue";
import { registerOverlay } from "../share/overlay-owner";

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

it("다른 창 입력에 초점이 있으면 새로 뜬 대화상자가 그 초점을 가져오지 않는다", () => {
  const other = document.createElement("div");
  other.className = "ks-data-window";
  const outside = document.createElement("input");
  outside.setAttribute("aria-label", "다른 입력");
  other.appendChild(outside);
  document.body.appendChild(other);
  const host = document.createElement("div");
  host.className = "ks-data-window";
  document.body.appendChild(host);
  outside.focus();
  render(<Dialog host={host} title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={() => {}} onConfirm={() => {}} />);
  expect(document.activeElement).toBe(outside);
  cleanup();
  other.remove();
  host.remove();
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

it("다른 창 입력에서 누른 Escape는 이 창의 대화상자를 닫지 않는다", () => {
  const hostB = document.createElement("div");
  hostB.className = "ks-data-window";
  hostB.dataset.windowId = "window-b";
  const outside = document.createElement("input");
  outside.setAttribute("aria-label", "다른 입력");
  hostB.appendChild(outside);
  document.body.appendChild(hostB);
  outside.focus();
  const hostA = document.createElement("div");
  hostA.className = "ks-data-window";
  hostA.dataset.windowId = "window-a";
  document.body.appendChild(hostA);
  const onCancel = vi.fn();
  render(<Dialog host={hostA} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  expect(document.activeElement).toBe(outside);
  fireEvent.keyDown(outside, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  cleanup();
  hostA.remove();
  hostB.remove();
});

it("대화상자가 둘 열려 있으면 Escape는 초점이 있는 창의 대화상자만 닫는다", () => {
  const hostA = document.createElement("div");
  hostA.className = "ks-data-window";
  hostA.dataset.windowId = "window-a";
  document.body.appendChild(hostA);
  const hostB = document.createElement("div");
  hostB.className = "ks-data-window";
  hostB.dataset.windowId = "window-b";
  document.body.appendChild(hostB);
  const cancelA = vi.fn();
  const cancelB = vi.fn();
  render(<>
    <Dialog host={hostA} windowId="window-a" title="가" body={<input aria-label="가 입력" />} ok="확인" onCancel={cancelA} onConfirm={() => {}} />
    <Dialog host={hostB} windowId="window-b" title="나" body={<input aria-label="나 입력" />} ok="확인" onCancel={cancelB} onConfirm={() => {}} />
  </>);
  const inputA = within(hostA).getByRole("textbox", { name: "가 입력" });
  inputA.focus();
  fireEvent.keyDown(inputA, { key: "Escape" });
  expect(cancelA).toHaveBeenCalledTimes(1);
  expect(cancelB).not.toHaveBeenCalled();
  cleanup();
  hostA.remove();
  hostB.remove();
});

it("임자가 없는 쉘 전체 대화상자는 Escape로 닫힌다", () => {
  const onCancel = vi.fn();
  render(<Dialog host={document.body} title="업데이트" body="새 판이 있습니다." ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  const outside = document.createElement("button");
  outside.textContent = "쉘 단추";
  document.body.appendChild(outside);
  outside.focus();
  fireEvent.keyDown(outside, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  outside.remove();
});

it("항목 메뉴 덮개에서 누른 Escape는 그 메뉴가 속한 창의 대화상자를 닫는다", () => {
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  document.body.appendChild(host);
  const menu = document.createElement("div");
  const item = document.createElement("button");
  item.textContent = "이름 바꾸기";
  menu.appendChild(item);
  document.body.appendChild(menu);
  const unregister = registerOverlay(menu, "window-a");
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="이름 바꾸기" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(item, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  cleanup();
  unregister();
  host.remove();
  menu.remove();
});

it("다른 창의 항목 메뉴 덮개에서 누른 Escape는 이 창의 대화상자를 닫지 않는다", () => {
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  document.body.appendChild(host);
  const menu = document.createElement("div");
  const item = document.createElement("button");
  item.textContent = "다른 창 항목";
  menu.appendChild(item);
  document.body.appendChild(menu);
  const unregister = registerOverlay(menu, "window-b");
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="이름 바꾸기" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(item, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  cleanup();
  unregister();
  host.remove();
  menu.remove();
});

it("임자가 없는 바닥 요소에서 누른 Escape는 임자가 있는 창의 대화상자를 닫지 않는다", () => {
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  document.body.appendChild(host);
  const outside = document.createElement("button");
  outside.textContent = "쉘 단추";
  document.body.appendChild(outside);
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(outside, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  cleanup();
  host.remove();
  outside.remove();
});

it("창 제목 줄 단추에 초점이 있어도 Escape는 그 창의 대화상자를 닫는다", () => {
  const frame = document.createElement("div");
  frame.className = "ks-window-frame ks-window-frame-active";
  const shell = document.createElement("section");
  shell.className = "ks-window";
  shell.dataset.windowId = "window-a";
  const titleButton = document.createElement("button");
  titleButton.textContent = "창 닫기";
  shell.appendChild(titleButton);
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  shell.appendChild(host);
  frame.appendChild(shell);
  document.body.appendChild(frame);
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(titleButton, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  cleanup();
  frame.remove();
});

it("태스크바 항목에 초점이 있으면 Escape는 그 항목의 창 대화상자를 닫지 않는다", () => {
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  document.body.appendChild(host);
  const taskbar = document.createElement("nav");
  taskbar.className = "ks-taskbar";
  const item = document.createElement("button");
  item.className = "ks-taskbar-window";
  item.dataset.windowId = "window-a";
  taskbar.appendChild(item);
  document.body.appendChild(taskbar);
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(item, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  cleanup();
  host.remove();
  taskbar.remove();
});

it("맨 위 창의 대화상자는 바닥에서 누른 Escape로 닫힌다", () => {
  const frame = document.createElement("div");
  frame.className = "ks-window-frame ks-window-frame-active";
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  frame.appendChild(host);
  document.body.appendChild(frame);
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  cleanup();
  frame.remove();
});

it("가려진 창의 대화상자는 바닥에서 누른 Escape로 닫히지 않는다", () => {
  const frame = document.createElement("div");
  frame.className = "ks-window-frame";
  const host = document.createElement("div");
  host.className = "ks-data-window";
  host.dataset.windowId = "window-a";
  frame.appendChild(host);
  document.body.appendChild(frame);
  const onCancel = vi.fn();
  render(<Dialog host={host} windowId="window-a" title="확인" body={<input aria-label="이름" />} ok="확인" onCancel={onCancel} onConfirm={() => {}} />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
  cleanup();
  frame.remove();
});

it("바닥에서 누른 Escape는 맨 위 창의 대화상자만 닫는다", () => {
  const frames = ["window-a", "window-b"].map((windowId, index) => {
    const frame = document.createElement("div");
    frame.className = `ks-window-frame${index === 1 ? " ks-window-frame-active" : ""}`;
    const host = document.createElement("div");
    host.className = "ks-data-window";
    host.dataset.windowId = windowId;
    frame.appendChild(host);
    document.body.appendChild(frame);
    return { windowId, host, frame };
  });
  const cancelA = vi.fn();
  const cancelB = vi.fn();
  render(<>
    <Dialog host={frames[0].host} windowId="window-a" title="가" body={<input aria-label="가 입력" />} ok="확인" onCancel={cancelA} onConfirm={() => {}} />
    <Dialog host={frames[1].host} windowId="window-b" title="나" body={<input aria-label="나 입력" />} ok="확인" onCancel={cancelB} onConfirm={() => {}} />
  </>);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(cancelA).not.toHaveBeenCalled();
  expect(cancelB).toHaveBeenCalledTimes(1);
  cleanup();
  frames.forEach(({ frame }) => frame.remove());
});
