import { describe, expect, it, vi } from "vitest";
import type { AppCommentThread } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { sendComments } from "../comments/send";
import { sendToDefaultAgent } from "../shell/send-message";

vi.mock("../shell/send-message", () => ({ sendToDefaultAgent: vi.fn() }));
const item = (id: string, resolved = false): AppCommentThread => ({ id, app_id: "app", number: 1, created_app_version: 1,
  created_definition_digest: "digest", created_shell_version: "1", origin: { kind: "personal" }, source_window_id: "window",
  anchor: { schema_version: 1, kind: "block" }, text: "고쳐 주세요", reply_count: 0, replies: [], resolved,
  unread_reply: false, created_at: "now", updated_at: "now", revision: 1 });

describe("커멘트 일괄 전송", () => {
  it("모든 쪽의 열린 미전송 항목만 보낸 다음 보냄으로 표시한다", async () => {
    const calls: string[] = [];
    const call = vi.fn(async (request: { op: string; id?: string; cursor?: string; ids?: string[] }) => {
      calls.push(request.op);
      if (request.op === "comment.list") return request.cursor ? { items: [item("two")], next_cursor: undefined } : { items: [item("one"), item("resolved", true)], next_cursor: "next" };
      if (request.op === "comment.get") return { thread: item(request.id!) };
      if (request.op === "comment.mark_sent") { expect(request.ids).toEqual(["one", "two"]); return {}; }
    });
    vi.mocked(sendToDefaultAgent).mockImplementation(async () => { calls.push("send"); return { appId: "agent", windowId: "agent-window", created: false }; });
    await sendComments({ store: { call, getSnapshot: () => null, subscribe: () => () => {} } as unknown as ShellStore, appId: "app", appName: "앱", windowId: "window" });
    expect(calls).toEqual(["comment.list", "comment.list", "comment.get", "comment.get", "send", "comment.mark_sent"]);
  });
  it("전송 실패면 보냄 표시를 하지 않는다", async () => {
    const call = vi.fn(async (request: { op: string }) => request.op === "comment.list" ? { items: [item("one")] } : { thread: item("one") });
    vi.mocked(sendToDefaultAgent).mockRejectedValueOnce({ id: "failure" });
    await expect(sendComments({ store: { call, getSnapshot: () => null, subscribe: () => () => {} } as unknown as ShellStore, appId: "app", appName: "앱", windowId: "window" })).rejects.toEqual({ id: "failure" });
    expect(call.mock.calls.some(([request]) => request.op === "comment.mark_sent")).toBe(false);
  });
});
