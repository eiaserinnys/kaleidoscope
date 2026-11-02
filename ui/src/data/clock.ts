import { useEffect, useState } from "react";
import type { Clock } from "../contract/contract";

export function isClock(value: unknown): value is Clock {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && typeof (value as Clock).position === "number"
    && typeof (value as Clock).sampled_at === "number"
    && typeof (value as Clock).rate === "number"
    && typeof (value as Clock).running === "boolean"
    && typeof (value as Clock).duration === "number";
}

export function clockPosition(clock: Clock, now: number): number {
  return Math.max(0, Math.min(clock.duration, clock.position + (clock.running ? (now - clock.sampled_at) / 1000 * clock.rate : 0)));
}

export function formatClockTime(seconds: number): string {
  const hundredths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const wholeSeconds = Math.floor(hundredths % 6000 / 100);
  const centiseconds = hundredths % 100;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function useClockPosition(clock: Clock | null, visible: boolean): number {
  const [position, setPosition] = useState(clock?.position ?? 0);
  useEffect(() => {
    if (!clock) { setPosition(0); return; }
    const update = () => setPosition(clockPosition(clock, performance.timeOrigin + performance.now()));
    update();
    if (!visible || !clock.running) return;
    let frame = 0;
    const draw = () => { update(); frame = requestAnimationFrame(draw); };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [clock, visible]);
  return clock && clock.running && visible ? position : clock?.position ?? 0;
}
