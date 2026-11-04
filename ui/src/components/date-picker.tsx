import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ownerOf } from "../share/overlay-owner";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";
import { useAnchoredOverlay } from "./anchored-overlay";
import { CalendarGrid } from "./calendar-grid";
import { DataIcon } from "./data-icons";
import { IconButton } from "./primitives";

type Props = { inputProps: InputHTMLAttributes<HTMLInputElement>; inputRef: RefObject<HTMLInputElement | null>; value: string | null; min: string | null; max: string | null; locale: string; label: string; visible: boolean; onChoose: (value: string) => void; onEditingEnd: () => void };
export function DatePicker({ inputProps, inputRef, value, min, max, locale, label, visible, onChoose, onEditingEnd }: Props) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const position = useAnchoredOverlay(anchor, surface, { observe: true });
  const close = (restore: boolean) => {
    setAnchor(null);
    const owner = inputRef.current && ownerOf(inputRef.current);
    if (restore && (!owner || !preserveWindowActionFocus(owner))) inputRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => { if (!visible || inputProps.readOnly) setAnchor(null); }, [visible, inputProps.readOnly]);
  useEffect(() => {
    if (!anchor) return;
    const owner = ownerOf(anchor);
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetOwner = target instanceof Element ? ownerOf(target) : undefined;
      if (!event.isTrusted && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
      if (!surface.current?.contains(target) && target !== anchor) { onEditingEnd(); close(false); }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [anchor, onEditingEnd]);
  const show = () => { if (!inputProps.readOnly) setAnchor(inputRef.current); };
  return <>
    <input {...inputProps} ref={inputRef} type="text" onBlur={(event) => { if (!surface.current?.contains(event.relatedTarget as Node | null)) inputProps.onBlur?.(event); }} onKeyDown={(event) => { if (event.altKey && event.key === "ArrowDown" && !inputProps.readOnly) { event.preventDefault(); show(); return; } inputProps.onKeyDown?.(event); }} />
    <span className="ks-data-input-clear"><IconButton aria-label="날짜 선택" title="" aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? id : undefined} disabled={inputProps.readOnly} onPointerDown={(event) => event.preventDefault()} onClick={show}><DataIcon name="calendar" size="inline" /></IconButton></span>
    {anchor && createPortal(<div id={id} ref={surface} data-ks-overlay className="ks-anchored-overlay ks-calendar-popup" role="dialog" aria-modal="true" aria-label={label || "날짜 선택"} style={position} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(surface.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])') ?? [])];
      if (!focusable.length) { event.preventDefault(); return; }
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === focusable.length - 1)) { event.preventDefault(); (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus(); }
    }}>
      <CalendarGrid anchor={anchor} value={value} min={min} max={max} locale={locale} onChoose={(next) => { onChoose(next); close(true); }} />
    </div>, document.body)}
  </>;
}
