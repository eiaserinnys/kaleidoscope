import { describe, expect, it } from "vitest";
import type { AppCommentThread } from "../contract/contract";
import { commentMessage, pendingComments, replyMessage } from "../comments/message";

const comment = (overrides: Partial<AppCommentThread> = {}): AppCommentThread => ({
  id: "comment-id", app_id: "app-id", number: 3, created_app_version: 2,
  created_definition_digest: "sha256:abc", created_shell_version: "1", origin: { kind: "personal" },
  source_window_id: "window", anchor: { schema_version: 1, kind: "row", pointer: "/ui", normalized_type: "table", row_identity: "row-1" },
  text: "고쳐 주세요", reply_count: 1, replies: [{ id: "reply", author: "user", text: "덧붙임", created_at: "now" }],
  resolved: false, unread_reply: false, created_at: "now", updated_at: "now", revision: 1, ...overrides,
});

describe("앱 커멘트 전송 글", () => {
  it("해결 안 된 미전송 커멘트만 고른다", () => {
    expect(pendingComments([comment(), comment({ id: "resolved", resolved: true }), comment({ id: "sent", sent_at: "now" })]).map((item) => item.id)).toEqual(["comment-id"]);
  });
  it("사람이 읽는 앱, 판, 번호와 자리만 보내고 내부 값은 숨긴다", () => {
    const item = comment({ id: "a11fa111-1111-4111-8111-111111111111", anchor: { schema_version: 1, kind: "row", pointer: "/ui/children/1", row_identity: "secret-row", element: { tag: "div", description: "표 4행 “Goodbye from Salon”" } } });
    const result = commentMessage("앱", [item]);
    expect(result).toBe('[앱 화면 커멘트] 앱(개인 앱) 2판\n\n3번 · 표 4행 “Goodbye from Salon” : 고쳐 주세요\n나: 덧붙임\n\n자리와 그림은 list_app_comments(app_id="app-id")로 읽습니다.');
    for (const value of [item.id, "sha256:", "/ui/", "secret-row", "get_app_comment"]) expect(result).not.toContain(value);
    expect(result.match(/app-id/g)).toHaveLength(1);
    const reply = replyMessage("앱", item, "답글");
    expect(reply).toBe('[앱 화면 커멘트 답글] 앱 3번 : 답글\n\n자리와 그림은 list_app_comments(app_id="app-id")로 읽습니다.');
    for (const value of [item.id, "sha256:", "/ui/", "secret-row", "get_app_comment"]) expect(reply).not.toContain(value);
  });
  it("긴 요청은 500자로 자르고 잘림을 알린다", () => {
    const result = commentMessage("앱", [comment({ text: "가".repeat(501) })]);
    expect(result).toContain("가".repeat(500) + "… (잘림)");
    expect(result).not.toContain("가".repeat(501));
  });
  it("행 없는 글 자리는 블록 전체 설명보다 인용을 먼저 쓴다", () => {
    const result = commentMessage("앱", [comment({ anchor: { schema_version: 1, kind: "text", normalized_type: "text", element: { tag: "p", description: "블록 전체 글" }, quote: { exact: "고른 글", prefix: "", suffix: "" } } })]);
    expect(result).toContain("3번 · 글 “고른 글” :");
    expect(result).not.toContain("블록 전체 글");
  });
});
