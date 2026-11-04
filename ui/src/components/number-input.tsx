import { useEffect, useImperativeHandle, useRef, type PointerEvent, type Ref } from "react";
import { ChevronDown, ChevronUp } from "./icons";
import { IconButton } from "./primitives";

const SPIN_DELAY_MS = 400;
const SPIN_INTERVAL_MS = 80;

export function steppedNumber(value: number, step: number, multiplier: number): number {
  const decimalPlaces = (number: number) => {
    const [coefficient, exponent = "0"] = number.toString().split("e");
    return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
  };
  const digits = Math.min(20, Math.max(decimalPlaces(value), decimalPlaces(step)));
  return Number((value + step * multiplier).toFixed(digits));
}

export function SpinButtons({ ref, increment, onEnd, atMin, atMax, readOnly, visible }: {
  ref: Ref<{ end: () => boolean }>; increment: (direction: 1 | -1, held: boolean) => boolean; onEnd: () => void; atMin: boolean; atMax: boolean; readOnly: boolean; visible: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumeClick = useRef(false);
  const held = useRef(false);
  const incrementRef = useRef(increment);
  incrementRef.current = increment;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const stop = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const end = () => { const wasHeld = held.current; held.current = false; stop(); if (wasHeld) onEndRef.current(); return wasHeld; };
  useImperativeHandle(ref, () => ({ end }));
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) end(); };
    window.addEventListener("blur", end);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); window.removeEventListener("blur", end); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  useEffect(() => { if (!visible || readOnly) end(); }, [visible, readOnly]);
  const start = (event: PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.button !== 0) return;
    event.preventDefault();
    end();
    held.current = true;
    consumeClick.current = true;
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture?.(event.pointerId);
    const button = event.currentTarget;
    if (!incrementRef.current(direction, true)) return;
    const repeat = () => {
      if (!button.isConnected || button.closest("[hidden], [inert]")) { end(); return; }
      if (incrementRef.current(direction, true)) timer.current = setTimeout(repeat, SPIN_INTERVAL_MS);
      else stop();
    };
    timer.current = setTimeout(repeat, SPIN_DELAY_MS);
  };
  const button = (direction: 1 | -1) => {
    const label = direction === 1 ? "늘리기" : "줄이기";
    return <IconButton aria-label={label} title="" tabIndex={-1} variant="embedded" disabled={readOnly || (direction === 1 ? atMax : atMin)}
      onPointerDown={(event) => start(event, direction)} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
      onClick={(event) => { if (event.detail !== 0 && consumeClick.current) { consumeClick.current = false; return; } consumeClick.current = false; incrementRef.current(direction, false); }}>
      {direction === 1 ? <ChevronUp size="inline" /> : <ChevronDown size="inline" />}
    </IconButton>;
  };
  return <span className="ks-number-spin">{button(1)}{button(-1)}</span>;
}
