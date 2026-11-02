import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { HtmlHeader } from "../blocks/html-document/header";

afterEach(cleanup);

it("새 리비전은 넓은 창에서 도착 단추로, 좁은 창에서 리비전 메뉴로 연다", async () => {
  const choose = vi.fn();
  const model = {
    active: { name: "랜딩 시안", rev: 3 }, latest: 4, dirty: true, narrow: false,
    docs: [{ name: "랜딩 시안", revisions: [1, 2, 3, 4] }], thread: { revisions: {} },
    comments: [], selection: null, mode: "select", face: "comments", undo: [[]], redo: [],
    setMode: vi.fn(), setFace: vi.fn(), choose, undoEdit: vi.fn(), redoEdit: vi.fn(), saveRevision: vi.fn(),
  } as unknown as ComponentProps<typeof HtmlHeader>["model"];
  const user = userEvent.setup();
  const { rerender } = render(<HtmlHeader model={model} />);
  expect(screen.getByRole("button", { name: "리비전" }).textContent).toBe("v3");
  expect(screen.getByRole("button", { name: "v4 도착, 이동" })).toBeTruthy();
  rerender(<HtmlHeader model={{ ...model, narrow: true }} />);
  expect(screen.queryByRole("button", { name: "v4 도착, 이동" })).toBeNull();
  const revision = screen.getByRole("button", { name: "리비전" });
  expect(revision.textContent).toBe("v3/ 4");
  await user.click(revision);
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "v4" }));
  expect(choose).toHaveBeenCalledWith("랜딩 시안", 4);
});
