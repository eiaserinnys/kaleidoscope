import { describe, expect, it, vi } from "vitest";
import type { ShellStore } from "../core/shell-store";
import { appCommentStore } from "../comments/store";

describe("앱 커멘트 목록", () => {
  it("보는 동안에만 첫 쪽을 읽고 다음 쪽은 요청할 때 읽는다", async () => {
    const call = vi.fn(async (request: { cursor?: string }) => ({ op: "comment.list", items: [], next_cursor: request.cursor ? undefined : "next", app_revision: 1 }));
    const store = { call } as unknown as ShellStore;
    const comments = appCommentStore(store, "app");
    expect(call).not.toHaveBeenCalled();
    await comments.load(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(comments.snapshot().nextCursor).toBe("next");
    await comments.more();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith({ op: "comment.list", app_id: "app", cursor: "next" });
  });
});
