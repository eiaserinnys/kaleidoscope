import { afterEach, describe, expect, it, vi } from "vitest";
import { createSerialSend, createThrottledSend } from "../data/throttled-send";
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

  it("keeps the interval after a trailing send during continuous input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sent: Array<{ value: number; at: number }> = [];
    const throttled = createThrottledSend((value: number) => sent.push({ value, at: Date.now() }), 100);

    throttled.send(0);
    vi.advanceTimersByTime(50);
    throttled.send(1);
    vi.advanceTimersByTime(50);
    throttled.send(2);
    vi.advanceTimersByTime(50);
    throttled.send(3);
    vi.advanceTimersByTime(50);

    expect(sent).toEqual([{ value: 0, at: 0 }, { value: 1, at: 100 }, { value: 3, at: 200 }]);
  });

  it("keeps a pending value for the next allowed interval after flush", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const throttled = createThrottledSend(send, 100);

    throttled.send("first");
    throttled.send("latest");
    throttled.flush();
    expect(send.mock.calls).toEqual([["first"]]);
    vi.advanceTimersByTime(99);
    expect(send.mock.calls).toEqual([["first"]]);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(100);

    expect(send.mock.calls).toEqual([["first"], ["latest"]]);
  });
});

describe("createSerialSend", () => {
  it("waits for the active send and keeps only the latest pending value", async () => {
    let finishFirst!: () => void;
    let startLatest!: () => void;
    const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const latestStarted = new Promise<void>((resolve) => { startLatest = resolve; });
    const send = vi.fn((value: string) => {
      if (value === "first") return firstPending;
      if (value === "latest") startLatest();
      return Promise.resolve();
    });
    const serial = createSerialSend(send);

    serial("first");
    serial("old");
    serial("latest");
    expect(send.mock.calls).toEqual([["first"]]);

    finishFirst();
    await latestStarted;
    expect(send.mock.calls).toEqual([["first"], ["latest"]]);
  });

  it("continues with the next value after a send rejects", async () => {
    let rejectFirst!: (error: Error) => void;
    let startNext!: () => void;
    const firstPending = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const nextStarted = new Promise<void>((resolve) => { startNext = resolve; });
    const send = vi.fn((value: string) => {
      if (value === "first") return firstPending;
      startNext();
      return Promise.resolve();
    });
    const serial = createSerialSend(send);

    serial("first");
    serial("next");
    rejectFirst(new Error("expected test rejection"));

    await nextStarted;
    expect(send.mock.calls).toEqual([["first"], ["next"]]);
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
