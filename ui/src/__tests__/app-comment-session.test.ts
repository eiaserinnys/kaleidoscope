import { describe, expect, it, vi } from "vitest";
import { commentSession } from "../comments/session";

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
});
