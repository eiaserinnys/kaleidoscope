import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type NumberFieldProps = {
  label: string; prop: string; value: string; step?: number; min?: number; max?: number; unit?: string; span?: string; box?: string;
  preview: (prop: string, value: string) => void; commit: (prop: string, value: string) => void;
};
const unitless = new Set(["font-weight", "line-height", "opacity"]);
const round = (value: number) => Number(value.toFixed(3));

function cssValue(prop: string, value: string) {
  const text = value.trim();
  if (!text || text === "자동") return prop === "line-height" ? "normal" : "";
  if (prop === "opacity" && /^[-+]?(?:\d+\.?\d*|\.\d+)%$/.test(text)) return String(Number.parseFloat(text) / 100);
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return text;
  const number = Number(text);
  if (prop === "opacity") return String(number / 100);
  return unitless.has(prop) ? String(number) : `${number}px`;
}

export function NumberField({ label, prop, value, step = 1, min, max, unit, span = "", box, preview, commit }: NumberFieldProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false); const cancelled = useRef(false);
  const drag = useRef<{ x: number; base: number; value: string; moved: boolean } | null>(null);
  useEffect(() => { if (!focused.current && !drag.current) { setDraft(value); setInvalid(false); } }, [value]);
  const clamp = (n: number) => round(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  const valid = (text: string) => {
    const parsed = Number(text);
    if (text.trim() && Number.isFinite(parsed) && (parsed < (min ?? -Infinity) || parsed > (max ?? Infinity))) return false;
    const css = cssValue(prop, text);
    return !css || typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports(prop, css);
  };
  const apply = (text: string) => {
    if (!valid(text)) { setInvalid(true); setDraft(value); return; }
    setInvalid(false); commit(prop, cssValue(prop, text));
  };
  const onDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const parsed = Number.parseFloat(draft);
    drag.current = { x: event.clientX, base: Number.isFinite(parsed) ? parsed : prop === "line-height" ? 1.2 : 0, value: draft, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!box) event.preventDefault();
  };
  const onMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current; if (!state) return;
    const delta = event.clientX - state.x;
    if (!state.moved && Math.abs(delta) <= (box ? 4 : 0)) return;
    state.moved = true;
    state.value = String(clamp(state.base + delta * step * (event.shiftKey ? 10 : 1)));
    setDraft(state.value); preview(prop, cssValue(prop, state.value));
  };
  const onUp = () => {
    const state = drag.current; if (!state) return;
    drag.current = null;
    if (state.moved) apply(state.value); else input.current?.focus();
  };
  const onCancel = () => { if (!drag.current) return; drag.current = null; setDraft(value); preview(prop, cssValue(prop, value)); };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const base = Number.parseFloat(draft); const delta = event.key === "ArrowUp" ? 1 : -1;
      const next = String(clamp((Number.isFinite(base) ? base : 0) + delta * step * (event.shiftKey ? 10 : 1)));
      setDraft(next); apply(next);
    } else if (event.key === "Enter") { event.preventDefault(); apply(draft); event.currentTarget.blur(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(value); setInvalid(false); event.currentTarget.blur(); }
  };
  const field = <input ref={input} className={box} aria-label={label} aria-invalid={invalid || undefined} value={draft} onFocus={() => { focused.current = true; cancelled.current = false; }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { focused.current = false; if (!cancelled.current && !drag.current) apply(draft); }} onKeyDown={onKey} {...(box ? { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel } : {})} />;
  if (box) return field;
  return <label className={`ks-html-prop is-number ${span}`}><span className="ks-html-prop-label" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>{label}</span>{field}{unit ? <span className="ks-html-prop-unit">{unit}</span> : null}</label>;
}

export function hexColor(value: string): string | null {
  const color = value.trim().toLowerCase();
  if (!color || color === "transparent" || color === "none" || /rgba\([^)]*,\s*0\s*\)$/.test(color)) return null;
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`;
  const numbers = color.match(/[\d.]+/g);
  if (!numbers || numbers.length < 3) return null;
  if (numbers.length >= 4 && Number(numbers[3]) === 0) return null;
  return `#${numbers.slice(0, 3).map((item) => Math.max(0, Math.min(255, Number(item))).toString(16).padStart(2, "0")).join("")}`;
}

type ColorProps = { label: string; prop: string; value: string; span?: string; readOnly?: string; focus: (prop: string) => void; commit: (prop: string, value: string) => void };
export function ColorField({ label, prop, value, span = "", readOnly, focus, commit }: ColorProps) {
  const textId = useId();
  const color = hexColor(value); const [draft, setDraft] = useState(color ?? "없음"); const [invalid, setInvalid] = useState(false);
  const focused = useRef(false); const cancelled = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(color ?? "없음"); }, [color]);
  const apply = (text: string) => {
    const next = text.trim() === "없음" ? "transparent" : text.trim();
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports(prop, next)) { setInvalid(true); setDraft(color ?? "없음"); return; }
    setInvalid(false); commit(prop, next);
  };
  return <label className={`ks-html-prop ${span}`} data-color={prop} htmlFor={textId}>{label ? <span className="ks-html-prop-label">{label}</span> : null}<input aria-label={`${label || "글자 색"} 선택`} className={`ks-html-swatch${!color || readOnly ? " is-empty" : ""}`} type="color" value={color ?? "#000000"} disabled={Boolean(readOnly)} onFocus={() => focus(prop)} onChange={(event) => { setDraft(event.target.value); commit(prop, event.target.value); }} /><input id={textId} aria-label={label || "글자 색"} aria-invalid={invalid || undefined} readOnly={Boolean(readOnly)} value={readOnly ?? draft} onFocus={() => { focused.current = true; cancelled.current = false; focus(prop); }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { focused.current = false; if (!readOnly && !cancelled.current) apply(draft); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(draft); event.currentTarget.blur(); } else if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; setDraft(color ?? "없음"); setInvalid(false); event.currentTarget.blur(); } }} /></label>;
}
