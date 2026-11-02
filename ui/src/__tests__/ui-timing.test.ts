import { afterEach, describe, expect, it, vi } from "vitest";
import { startUiTiming, toFrameSample, toInputSample } from "../profiler/ui-timing";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("UI timing samples", () => {
  it("splits event wait, processing, and paint phases without negative paint time", () => {
    const sample = toInputSample({
      name: "compositionupdate",
      startTime: 10,
      processingStart: 13,
      processingEnd: 19,
      duration: 12,
    }, "TEXTAREA", "workspace-pas", true);

    expect(sample).toEqual({
      event: "compositionupdate",
      target: "TEXTAREA",
      app_id: "workspace-pas",
      responding: true,
      wait_ms: 3,
      processing_ms: 6,
      paint_ms: 3,
    });
    expect(toInputSample({ name: "input", startTime: 0, processingStart: 2, processingEnd: 8, duration: 5 }, "TEXTAREA", null, false).paint_ms).toBe(0);
  });

  it("summarizes LoAF scripts, forced layout, rendering, and input involvement", () => {
    expect(toFrameSample({
      duration: 58,
      blockingDuration: 18,
      startTime: 100,
      renderStart: 145,
      firstUIEventTimestamp: 102,
      scripts: [
        { duration: 11, forcedStyleAndLayoutDuration: 2, invoker: "timer" },
        { duration: 17, forcedStyleAndLayoutDuration: 4, invoker: "event handler" },
      ],
    })).toEqual({ ms: 58, blocking_ms: 18, script_ms: 28, forced_layout_ms: 6, render_ms: 13, top_script: "event handler", input: true });
  });

  it("batches input and frame observations into one report every two seconds", () => {
    vi.useFakeTimers();
    const observers: FakeObserver[] = [];
    class FakeObserver {
      static supportedEntryTypes = ["event", "long-animation-frame"];
      callback: PerformanceObserverCallback;
      options: PerformanceObserverInit[] = [];
      disconnected = false;
      constructor(callback: PerformanceObserverCallback) { this.callback = callback; observers.push(this); }
      observe(options: PerformanceObserverInit) { this.options.push(options); }
      disconnect() { this.disconnected = true; }
      emit(entries: PerformanceEntry[]) {
        this.callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, this as unknown as PerformanceObserver);
      }
    }
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    const report = vi.fn();
    const stop = startUiTiming(report, () => true);
    const wrapper = document.createElement("div");
    wrapper.dataset.ksAppId = "workspace-pas";
    const textarea = document.createElement("textarea");
    wrapper.append(textarea);
    const event = { name: "compositionupdate", entryType: "event", startTime: 10, processingStart: 13, processingEnd: 19, duration: 22, target: textarea } as unknown as PerformanceEntry;
    const ignored = { name: "click", entryType: "event", startTime: 10, processingStart: 13, processingEnd: 19, duration: 22, target: textarea } as unknown as PerformanceEntry;
    const frame = { name: "long-animation-frame", entryType: "long-animation-frame", startTime: 10, duration: 58, blockingDuration: 18, renderStart: 45, firstUIEventTimestamp: 12, scripts: [] } as unknown as PerformanceEntry;
    observers[0].emit([event, ignored]);
    observers[1].emit([frame]);

    expect(observers[0].options).toEqual([{ type: "event", durationThreshold: 16 }]);
    expect(observers[1].options).toEqual([{ type: "long-animation-frame" }]);
    vi.advanceTimersByTime(1_999);
    expect(report).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject([{ event: "compositionupdate", target: "textarea", app_id: "workspace-pas", responding: true }]);
    expect(report.mock.calls[0][0]).toHaveLength(1);
    expect(report.mock.calls[0][1]).toHaveLength(1);
    stop();
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });

  it("silently skips unsupported performance entry types", () => {
    class UnsupportedObserver {
      static supportedEntryTypes: string[] = [];
      constructor(_callback: PerformanceObserverCallback) {}
    }
    vi.stubGlobal("PerformanceObserver", UnsupportedObserver);
    expect(() => startUiTiming(vi.fn(), () => false)()).not.toThrow();
  });
});
