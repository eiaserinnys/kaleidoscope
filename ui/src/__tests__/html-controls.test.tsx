import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createAnchor, resolveAnchor } from "../blocks/html-bridge/anchor";
import { CommentFace } from "../blocks/html-document/comments";
import { anchorRevision, applyThreadChange, type Thread, type ThreadChange } from "../blocks/html-document/thread";
import { Button } from "../components/primitives";
import { Select } from "../components/select-toggle";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("공용 버튼의 제목과 선택 상자의 앞뒤 내용을 표시한다", () => {
  render(<><Button title="되돌리기 Ctrl+Z">되돌리기</Button><Select label="그림자" value="small" onChange={vi.fn()} groups={[{ options: [{ value: "small", label: "작게" }] }]} className="ks-html-prop" prefix={<span>그림자</span>} suffix="단위" /></>);
  expect(screen.getByRole("button", { name: "되돌리기" }).getAttribute("title")).toBe("되돌리기 Ctrl+Z");
  const select = screen.getByRole("button", { name: "그림자" });
  expect(select.classList.contains("ks-html-prop")).toBe(true);
  expect(select.textContent).toContain("그림자");
  expect(select.textContent).toContain("단위");
});

it("작업본에서 고아를 B로 옮긴 뒤 원래 순서로 돌아가도 A에 붙지 않는다", async () => {
  if (!globalThis.CSS) vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/([^a-zA-Z0-9_-])/g, "\\$1") });
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  const original = parse("<main><p>첫 번째 문단 A입니다</p><p>두 번째 문단 B입니다</p></main>");
  const draft = parse("<main><p>첫 번째 문단 A입니다</p><p>두 번째 문단 B입니다</p></main>");
  const main = draft.querySelector("main")!;
  main.prepend(main.lastElementChild!);
  const anchor = createAnchor(main.firstElementChild!);
  const comment = { id: "orphan", rev: 1, status: "needs_agent_review" as const, anchor: createAnchor(original.querySelector("p")!), comment: "옮길 커멘트", created_at: "now", resolved_rev: null, replies: [] };
  const thread: Thread = { revisions: {}, comments: [comment] };
  const change = vi.fn(async (_change: ThreadChange) => true);
  const model = {
    selection: { n: 1, anchor }, active: { name: "시안", rev: 1 }, dirty: true, saving: false,
    comments: [comment], results: { orphan: "orphan" }, activeComment: "orphan", reviewComments: [],
    root: { current: null }, send: vi.fn(), setActiveComment: vi.fn(), openComment: vi.fn(), writeChange: change,
  } as unknown as ComponentProps<typeof CommentFace>["model"];
  const user = userEvent.setup();
  const { rerender } = render(<CommentFace model={model} />);
  await user.click(screen.getByRole("button", { name: "여기로 옮기기" }));
  expect(change).toHaveBeenCalledWith({ kind: "anchor", id: "orphan", anchor, anchor_rev: 0 });
  const moved = applyThreadChange(thread, change.mock.calls[0][0]).comments[0];
  const result = resolveAnchor(original, moved.anchor, anchorRevision(moved) === 1);
  expect(result.element).toBe(original.querySelectorAll("p")[1]);
  expect(result.element).not.toBe(original.querySelectorAll("p")[0]);
  change.mockClear();
  rerender(<CommentFace model={{ ...model, dirty: false }} />);
  await user.click(screen.getByRole("button", { name: "여기로 옮기기" }));
  expect(change).toHaveBeenCalledWith({ kind: "anchor", id: "orphan", anchor, anchor_rev: 1 });
});
