import { expect, it } from "vitest";
import { applyThreadChange, listRevisions, type Thread } from "../blocks/html-document/thread";

it("문서 파일 이름에서 리비전을 얻고 스레드 변경을 최신 값에 다시 적용한다", () => {
  expect(listRevisions(["시안/r1.html", "시안/r3.html", "시안/thread.json", "다른/r9.html"])).toEqual([{ name: "다른", revisions: [9] }, { name: "시안", revisions: [1, 3] }]);
  const current: Thread = { revisions: {}, comments: [{ id: "one", rev: 1, status: "needs_agent_review", anchor: {} as never, comment: "첫 글", created_at: "now", resolved_rev: null, replies: [] }] };
  const next = applyThreadChange(current, { kind: "reply", id: "one", reply: { id: "r", role: "user", rev: 3, body: "답글", created_at: "now" } });
  expect(next.comments[0].replies[0].body).toBe("답글");
  expect(current.comments[0].replies).toHaveLength(0);
});
