import { describe, expect, it } from "vitest";
import type { AppCommentThread } from "../contract/contract";
import { commentMessage, pendingComments } from "../comments/message";

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
  it("식별자, 자리, 답글과 수정 위치를 보내고 긴 요청은 원문 조회를 안내한다", () => {
    const result = commentMessage("앱", [comment({ text: "가".repeat(501) })]);
    expect(result).toContain("[앱 화면 커멘트]");
    for (const text of ["comment-id", "app-id", "앱", "sha256:abc", "/ui", "row-1", "덧붙임", "get_app", "upload_app", "잘림"]) expect(result).toContain(text);
    expect(result).not.toContain("가".repeat(501));
  });
  it("프레임 좌표와 반복 키를 전송 글에 남긴다", () => {
    const value = comment({ anchor: { schema_version: 1, kind: "point", pointer: "/ui", normalized_type: "canvas", repeat_chain: ["section"], frame_rel: { x: 0.25, y: 0.75 }, frame_css_width: 400, frame_css_height: 300 } });
    const result = commentMessage("앱", [value]);
    expect(result).toContain('"section"');
    expect(result).toContain('"x":0.25');
    expect(result).toContain("400×300");
  });
  it("값이 없는 반복, 행과 고른 글은 보내지 않는다", () => {
    const value = comment({ anchor: { schema_version: 1, kind: "block", pointer: "/ui", normalized_type: "text", repeat_chain: [], row_identity: "" } });
    const result = commentMessage("앱", [value]);
    expect(result).not.toContain("반복 []");
    expect(result).not.toContain('행 ""');
    expect(result).not.toContain("고른 글");
  });
});
