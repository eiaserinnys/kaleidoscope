import { describe, expect, it, vi } from "vitest";
import { commentSession, forgetCommentSession } from "../comments/session";
import type { TargetDescription } from "../comments/target";

describe("창 커멘트 상태", () => {
  it("창별로 독립적이며 같은 창은 다시 찾아도 상태를 유지한다", () => {
    const first = commentSession("window-a");
    const other = commentSession("window-b");
    const changed = vi.fn();
    const dispose = other.subscribe(changed);
    first.set(true);
    expect(commentSession("window-a").get()).toBe(true);
    expect(other.get()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    first.set(false);
    dispose();
  });
  it("앱 판이 바뀌면 쓰던 글은 남기고 자리와 그림을 다시 고르게 한다", () => {
    const session = commentSession("draft-version");
    const target = { anchor: { kind: "block", schema_version: 1 }, path: "블록", element: document.createElement("div"), rect: null } as TargetDescription;
    session.set(true);
    session.pick(1, target);
    session.updateDraft({ text: "남길 초안", image: { meta: { width: 1, height: 1, byte_size: 3, capture_surface: "window_body", target_rect: { x: 0, y: 0, width: 0, height: 0 } }, image_base64: "AAA" } });
    const next = session.getDraft(2)!;
    expect(next.text).toBe("남길 초안");
    expect(next.target).toBeNull();
    expect(next.image).toBeUndefined();
    expect(next.targetChanged).toBe(true);
    session.pick(2, target);
    expect(session.getDraft(2)?.text).toBe("남길 초안");
    expect(session.getDraft(2)?.targetChanged).toBe(false);
    forgetCommentSession("draft-version");
  });
});

describe("스냅샷에서 사라진 창의 커멘트 정리", () => {
  it("판 변경은 초안을 유지하고 창 제거는 DOM과 PNG를 놓는다", async () => {
    const { createFakeTransport } = await import("../core/fake-transport");
    const { createShellStore } = await import("../core/shell-store");
    const { makeTestSeed } = await import("./fixtures");
    const seed = makeTestSeed();
    const transport = createFakeTransport(seed);
    const store = createShellStore(transport);
    await store.ready;
    const id = seed.snapshot.shared.windows[0].id;
    const session = commentSession(id);
    session.set(true);
    session.pick(1, { element: document.createElement("div") } as TargetDescription);
    session.updateDraft({ text: "남긴 글" });
    const changed = structuredClone(seed.snapshot);
    changed.shared.windows[0].app_version += 1;
    transport.emit({ event: "state.changed", snapshot: changed });
    expect(commentSession(id)).toBe(session);
    expect(session.getDraft(2)?.text).toBe("남긴 글");
    changed.shared.windows = [];
    transport.emit({ event: "state.changed", snapshot: structuredClone(changed) });
    expect(commentSession(id)).not.toBe(session);
    expect(commentSession(id).getDraft(2)).toBeUndefined();
    forgetCommentSession(id);
    store.dispose();
  });
});
