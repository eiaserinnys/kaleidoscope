import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { FrameSelection } from "../blocks/html-bridge/frame-protocol";
import { Target } from "../blocks/html-document/parts";

afterEach(cleanup);

it("선택한 글의 경로에 글을 담은 요소를 표시하고 고를 수 있다", async () => {
  const selection = {
    n: 3, name: "p.summary.lead", ancestors: [{ n: 1, label: "body" }, { n: 2, label: "section.hero" }],
    anchor: { kind: "text", tag: "p", quote: { exact: "결정과 할 일" } },
  } as unknown as FrameSelection;
  const choose = vi.fn();
  render(<Target selection={selection} choose={choose} />);
  const path = within(screen.getByRole("navigation", { name: "부모 경로" }));
  expect(path.getByRole("button", { name: "section.hero" })).toBeTruthy();
  await userEvent.click(path.getByRole("button", { name: "p.summary" }));
  expect(choose).toHaveBeenCalledWith(3);
  await userEvent.click(path.getByRole("button", { name: "전체 경로" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "body" }));
  expect(choose).toHaveBeenCalledWith(1);
});
