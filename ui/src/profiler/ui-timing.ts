import type { UiFrameSample, UiInputSample } from "../contract/contract";

const EVENT_NAMES = new Set(["keydown", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "pointerdown"]);
const MAX_INPUTS = 200;
const MAX_FRAMES = 50;
const REPORT_INTERVAL_MS = 2_000;

interface EventTimingEntry extends PerformanceEntry {
  name: string;
  target: EventTarget | null;
  processingStart: number;
  processingEnd: number;
}

interface FrameScript {
  duration: number;
  forcedStyleAndLayoutDuration: number;
  invoker?: string;
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  blockingDuration: number;
  renderStart: number;
  firstUIEventTimestamp: number;
  scripts: FrameScript[];
}

export function toInputSample(
  entry: Pick<EventTimingEntry, "name" | "startTime" | "processingStart" | "processingEnd" | "duration">,
  target: string,
  appId: string | null,
  responding: boolean,
): UiInputSample {
  return {
    event: entry.name,
    target,
    app_id: appId,
    responding,
    wait_ms: entry.processingStart - entry.startTime,
    processing_ms: entry.processingEnd - entry.processingStart,
    paint_ms: Math.max(0, entry.startTime + entry.duration - entry.processingEnd),
  };
}

export function toFrameSample(entry: Pick<LongAnimationFrameEntry, "duration" | "blockingDuration" | "renderStart" | "startTime" | "firstUIEventTimestamp" | "scripts">): UiFrameSample {
  const topScript = entry.scripts.reduce<FrameScript | null>((longest, script) => !longest || script.duration > longest.duration ? script : longest, null);
  return {
    ms: entry.duration,
    blocking_ms: entry.blockingDuration,
    script_ms: entry.scripts.reduce((sum, script) => sum + script.duration, 0),
    forced_layout_ms: entry.scripts.reduce((sum, script) => sum + script.forcedStyleAndLayoutDuration, 0),
    render_ms: entry.renderStart === 0 ? 0 : entry.startTime + entry.duration - entry.renderStart,
    top_script: topScript?.invoker ?? null,
    input: entry.firstUIEventTimestamp > 0,
  };
}

export function startUiTiming(report: (inputs: UiInputSample[], frames: UiFrameSample[]) => void | Promise<unknown>, isResponding: () => boolean): () => void {
  if (typeof PerformanceObserver === "undefined") return () => undefined;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const inputs: UiInputSample[] = [];
  const frames: UiFrameSample[] = [];
  const observers: PerformanceObserver[] = [];
  let stopped = false;

  if (supported.includes("event")) {
    const observer = makeObserver((entries) => {
      for (const entry of entries) {
        const timing = entry as EventTimingEntry;
        if (!EVENT_NAMES.has(timing.name)) continue;
        const target = timing.target;
        if (!(target instanceof Element)) continue;
        const appId = target.closest("[data-ks-app-id]")?.getAttribute("data-ks-app-id") ?? null;
        inputs.push(toInputSample(timing, target.tagName.toLowerCase(), appId, isResponding()));
        if (inputs.length > MAX_INPUTS) inputs.shift();
      }
    });
    if (observer) {
      try { observer.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit); observers.push(observer); }
      catch { observer.disconnect(); }
    }
  }

  if (supported.includes("long-animation-frame")) {
    const observer = makeObserver((entries) => {
      for (const entry of entries) {
        frames.push(toFrameSample(entry as LongAnimationFrameEntry));
        if (frames.length > MAX_FRAMES) frames.shift();
      }
    });
    if (observer) {
      try { observer.observe({ type: "long-animation-frame" } as PerformanceObserverInit); observers.push(observer); }
      catch { observer.disconnect(); }
    }
  }

  if (observers.length === 0) return () => undefined;
  const timer = window.setInterval(() => {
    if (stopped || (!inputs.length && !frames.length)) return;
    const batchInputs = inputs.splice(0, MAX_INPUTS);
    const batchFrames = frames.splice(0, MAX_FRAMES);
    try {
      const result = report(batchInputs, batchFrames);
      if (result && typeof result.then === "function") void result.catch(() => undefined);
    } catch {
      // Sampling must not affect input handling if the core is unavailable.
    }
  }, REPORT_INTERVAL_MS);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    for (const observer of observers) observer.disconnect();
  };
}

function makeObserver(callback: (entries: PerformanceEntry[]) => void): PerformanceObserver | null {
  try {
    return new PerformanceObserver((list) => callback(list.getEntries()));
  } catch {
    return null;
  }
}
