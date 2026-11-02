import { afterEach, describe, expect, it, vi } from "vitest";
import { createThrottledSend } from "../data/throttled-send";
import { isWindowVisible } from "../data/window-state";
import { makeTestSnapshot } from "./fixtures";

afterEach(() => vi.useRealTimers());

describe("createThrottledSend", () => {
  it("sends the first value immediately and only the latest value at the interval", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const throttled = createThrottledSend(send, 100);

    for (let value = 0; value < 10; value += 1) {
      throttled.send(value);
      vi.advanceTimersByTime(10);
    }

    expect(send.mock.calls).toEqual([[0], [9]]);
  });

  it("flushes a pending value immediately and does not send it twice", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const throttled = createThrottledSend(send, 100);

    throttled.send("first");
    throttled.send("latest");
    throttled.flush();
    vi.advanceTimersByTime(100);

    expect(send.mock.calls).toEqual([["first"], ["latest"]]);
  });
});

describe("isWindowVisible", () => {
  it("requires an unminimized window on the active workspace desktop", () => {
    const snapshot = makeTestSnapshot();
    const window = snapshot.shared.windows[0];
    expect(isWindowVisible(snapshot, window.id)).toBe(true);

    window.minimized = true;
    expect(isWindowVisible(snapshot, window.id)).toBe(false);
    window.minimized = false;
    window.desktop_id = "desktop-elsewhere";
    expect(isWindowVisible(snapshot, window.id)).toBe(false);
    window.desktop_id = "desktop-1";
    snapshot.device.active_workspace_id = "workspace-elsewhere";
    expect(isWindowVisible(snapshot, window.id)).toBe(false);
    expect(isWindowVisible(snapshot, "missing-window")).toBe(false);
  });
});
