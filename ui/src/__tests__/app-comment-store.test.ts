import { describe, expect, it, vi } from "vitest";
import type { ShellStore } from "../core/shell-store";
import { appCommentStore } from "../comments/store";

describe("앱 커멘트 목록", () => {
  it("보는 동안에만 첫 쪽을 읽고 다음 쪽은 요청할 때 읽는다", async () => {
    const call = vi.fn(async (request: { cursor?: string }) => ({ op: "comment.list", items: [], next_cursor: request.cursor ? undefined : "next", app_revision: 1 }));
    const store = { call, getSnapshot: () => null, subscribe: () => () => {} } as unknown as ShellStore;
    const comments = appCommentStore(store, "app");
    expect(call).not.toHaveBeenCalled();
    await comments.load(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(comments.snapshot().nextCursor).toBe("next");
    await comments.more();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith({ op: "comment.list", app_id: "app", cursor: "next" });
  });

  it("닫힌 창도 서버를 바꾸면 같은 리비전의 오래된 목록을 버린다", async () => {
    let server = "https://one.example";
    let notify = () => {};
    const call = vi.fn(async () => ({ op: "comment.list", items: [{ id: server }], app_revision: 1 }));
    const store = { call, getSnapshot: () => ({ link: { state: "connected", server_url: server } }), subscribe: (listener: () => void) => { notify = listener; return () => {}; } } as unknown as ShellStore;
    const comments = appCommentStore(store, "app");
    await comments.load(1);
    server = "https://two.example"; notify();
    expect(comments.snapshot().items).toEqual([]);
    await comments.load(1);
    expect(comments.snapshot().items[0].id).toBe(server);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("서버 전환 전에 시작된 목록 응답은 전환 뒤에 도착해도 버린다", async () => {
    let server = "https://one.example";
    let notify = () => {};
    let finish: (reply: unknown) => void = () => {};
    const call = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ op: "comment.list", items: [{ id: "new" }], app_revision: 1 });
    const store = { call, getSnapshot: () => ({ link: { state: "connected", server_url: server } }), subscribe: (listener: () => void) => { notify = listener; return () => {}; } } as unknown as ShellStore;
    const comments = appCommentStore(store, "app");
    const oldRequest = comments.load(1);
    server = "https://two.example"; notify();
    await comments.load(1);
    finish({ op: "comment.list", items: [{ id: "old" }], app_revision: 1 });
    await oldRequest;
    expect(comments.snapshot().items.map((item) => item.id)).toEqual(["new"]);
  });

  it("다음 쪽의 리비전이 다르면 첫 쪽부터 다시 받아 섞지 않는다", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ op: "comment.list", items: [{ id: "old" }], next_cursor: "next", app_revision: 1 })
      .mockResolvedValueOnce({ op: "comment.list", items: [{ id: "new-page" }], app_revision: 2 })
      .mockResolvedValueOnce({ op: "comment.list", items: [{ id: "new-first" }], app_revision: 2 });
    const comments = appCommentStore({ call, getSnapshot: () => null, subscribe: () => () => {} } as unknown as ShellStore, "app");
    await comments.load(1);
    await comments.more();
    expect(comments.snapshot().items.map((item) => item.id)).toEqual(["new-first"]);
    expect(comments.snapshot().revision).toBe(2);
    expect(call).toHaveBeenLastCalledWith({ op: "comment.list", app_id: "app" });
  });
});
