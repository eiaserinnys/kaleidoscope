import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useHoldWhileWriting, writingInWindow } from "../../../app/src/shell/use-hold-while-writing";

afterEach(cleanup);

function Probe({ wanted }: { wanted: boolean }) {
  const hold = useHoldWhileWriting(wanted);
  return <span data-testid="state">{hold ? "hold" : "open"}</span>;
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function mountShell() {
  const area = document.createElement("div");
  area.className = "ks-desktop-area";
  area.innerHTML = '<textarea aria-label="메모"></textarea><textarea aria-label="설명"></textarea><button type="button">보내기</button>';
  document.body.appendChild(area);
  const shellBar = document.createElement("div");
  shellBar.className = "ks-shell-bar";
  shellBar.innerHTML = '<input aria-label="찾기" /><button type="button">업데이트</button>';
  document.body.appendChild(shellBar);
  return {
    area,
    shellBar,
    note: area.querySelector<HTMLTextAreaElement>('[aria-label="메모"]')!,
    description: area.querySelector<HTMLTextAreaElement>('[aria-label="설명"]')!,
    send: area.querySelector<HTMLButtonElement>("button")!,
    search: shellBar.querySelector<HTMLInputElement>('[aria-label="찾기"]')!,
    update: shellBar.querySelector<HTMLButtonElement>("button")!,
  };
}

it("창 안 입력에 초점이 있을 때만 쓰는 중으로 본다", () => {
  const shell = mountShell();
  shell.note.focus();
  expect(writingInWindow()).toBe(true);
  shell.send.focus();
  expect(writingInWindow()).toBe(false);
  shell.search.focus();
  expect(writingInWindow()).toBe(false);
  shell.update.focus();
  expect(writingInWindow()).toBe(false);
  (document.activeElement as HTMLElement | null)?.blur();
  expect(writingInWindow()).toBe(false);
});

it("쓰는 중에는 첫 그리기부터 붙잡고, 초점이 입력을 떠나면 놓는다", async () => {
  const shell = mountShell();
  shell.note.focus();
  render(<Probe wanted />);
  expect(screen.getByTestId("state").textContent).toBe("hold");
  await act(async () => { shell.send.focus(); });
  await settle();
  expect(screen.getByTestId("state").textContent).toBe("open");
});

it("입력 사이를 옮기는 동안에는 대화상자를 열지 않는다", async () => {
  const shell = mountShell();
  shell.note.focus();
  render(<Probe wanted />);
  expect(screen.getByTestId("state").textContent).toBe("hold");
  await act(async () => { shell.note.blur(); shell.description.focus(); });
  await settle();
  expect(screen.getByTestId("state").textContent).toBe("hold");
  await act(async () => { shell.description.blur(); shell.note.focus(); });
  await settle();
  expect(screen.getByTestId("state").textContent).toBe("hold");
  await act(async () => { shell.note.blur(); shell.search.focus(); });
  await settle();
  expect(screen.getByTestId("state").textContent).toBe("open");
});

it("붙잡을 필요가 없으면 쓰는 중이어도 열지 않는다", () => {
  const shell = mountShell();
  shell.note.focus();
  render(<Probe wanted={false} />);
  expect(screen.getByTestId("state").textContent).toBe("open");
});
