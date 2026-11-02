import { useCallback, useEffect, useMemo, useRef } from "react";

export function useFrameCoalesced<T>(apply: (value: T) => void) {
  const applyRef = useRef(apply);
  const pending = useRef<{ value: T } | null>(null);
  const frame = useRef<number | null>(null);
  applyRef.current = apply;

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const cancel = useCallback(() => {
    cancelFrame();
    pending.current = null;
  }, [cancelFrame]);

  const flush = useCallback(() => {
    cancelFrame();
    const scheduled = pending.current;
    pending.current = null;
    if (scheduled) applyRef.current(scheduled.value);
  }, [cancelFrame]);

  const schedule = useCallback((value: T) => {
    pending.current = { value };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const scheduled = pending.current;
      pending.current = null;
      if (scheduled) applyRef.current(scheduled.value);
    });
  }, []);

  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ schedule, flush, cancel }), [schedule, flush, cancel]);
}
