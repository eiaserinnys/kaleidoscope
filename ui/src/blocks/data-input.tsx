import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Block, SelectOption } from "../contract/contract";
import { ICON_NAMES } from "../contract/limits";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { DataState } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { Dialog } from "../components/dialog";
import { X } from "../components/icons";
import { Select, Toggle } from "../components/select-toggle";
import { Button, IconButton } from "../components/primitives";
import { display } from "./data-layout";
import { asArray } from "./data-view-common";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }
const bindingName = (value: unknown, fallback: string) => {
  if (value && typeof value === "object") {
    if ("state" in value && typeof value.state === "string") return value.state;
    if ("client" in value && typeof value.client === "string") return value.client;
  }
  return fallback;
};

export function InputBlock({ block, pointer }: Props<"input">) {
  const data = useWindowData();
  const multiline = Boolean(block.multiline || (block.rows ?? 0) >= 2);
  const bound = useBinding(`${pointer}/value`, block.value);
  const current = bound.status === "ready" ? bound.value : null;
  const [draft, setDraft] = useState(current == null ? "" : String(current));
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const edited = useRef(false);
  const pending = useRef(0);
  const latest = useRef({ current, focused });
  const requestSequence = useRef(0);
  const latestFailed = useRef(false);
  latest.current = { current, focused };
  useEffect(() => {
    if (!focused && pending.current === 0) setDraft(current == null ? "" : String(current));
  }, [current, focused]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!textarea.current || (block.rows ?? 0) >= 2) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [draft, block.rows]);
  const eventValue = (value: string): JsonValue => block.kind === "number" ? (value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value)) : value;
  const send = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current += 1;
    const sequence = ++requestSequence.current;
    void data.act(`${pointer}/on_change`, eventValue(value)).then((success) => {
      if (sequence === requestSequence.current) latestFailed.current = !success;
    }).finally(() => {
      pending.current -= 1;
      if (pending.current === 0 && !latestFailed.current && !latest.current.focused) {
        const value = latest.current.current;
        setDraft(value == null ? "" : String(value));
      }
    });
  };
  const change = (value: string) => { edited.current = true; setDraft(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => send(value), 300); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !block.on_submit || event.nativeEvent.isComposing || composing.current || (multiline && !event.ctrlKey)) return;
    event.preventDefault();
    void data.act(`${pointer}/on_submit`, eventValue(draft));
  };
  const props = { className: "ks-text-input", placeholder: block.placeholder, value: draft,
    onFocus: () => setFocused(true), onBlur: () => { setFocused(false); if (edited.current) { edited.current = false; send(draft); } },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.currentTarget.value), onKeyDown: keyDown,
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
  };
  const input = <div className={`ks-data-input${block.kind === "search" ? " is-search" : ""}${(block.rows ?? 0) >= 2 ? " has-rows" : ""}`}>
    {block.kind === "search" ? <span className="ks-data-input-search"><DataIcon name="search" size="inline" /></span> : null}
    {multiline ? <textarea {...props} ref={textarea} rows={block.rows ?? 1} /> : <input {...props} type={block.kind === "number" ? "number" : "text"} />}
    {block.kind === "search" && draft ? <span className="ks-data-input-clear"><IconButton aria-label="지우기" onClick={() => { change(""); send(""); }}><X size="inline" /></IconButton></span> : null}
  </div>;
  return block.label ? <label className="ks-field ks-input-field"><span className="ks-field-label" data-ks-share-skip="">{block.label}</span>{input}</label> : input;
}

function validOption(value: unknown): value is SelectOption {
  return typeof value === "string" || (typeof value === "object" && value !== null && "label" in value && typeof value.label === "string" && "value" in value);
}

function validGroup(value: unknown): value is { name: string; options: unknown[] } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "options" in value && Array.isArray(value.options);
}

export function SliderBlock({ block, pointer }: Props<"slider">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  const raw = Number((value.status === "ready" ? value.value : null) ?? block.min);
  const current = Number.isFinite(raw) ? raw : block.min;
  const [draft, setDraft] = useState(current);
  useEffect(() => { setDraft(current); }, [current]);
  return <label className="ks-field ks-slider-field">
    {block.label ? <span className="ks-field-label" data-ks-share-skip="">{block.label}</span> : null}
    <input type="range" className="ks-slider" aria-label={block.label ?? bindingName(block.value, "슬라이더")} min={block.min} max={block.max} step={block.step ?? 1} value={draft}
      onChange={(event) => { const next = Number(event.currentTarget.value); setDraft(next); void data.act(`${pointer}/on_change`, next); }} />
    <span className="ks-slider-value" data-ks-share-skip="">{draft}</span>
  </label>;
}

export function ColorBlock({ block, pointer }: Props<"color">) {
  const data = useWindowData();
  const bound = useBinding(`${pointer}/value`, block.value);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const value = bound.status === "ready" ? bound.value : null;
  const color = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value);
  return <label className={`ks-field ks-color-field${unavailable ? " is-disabled" : ""}`}>
    {block.label ? <span className="ks-field-label" data-ks-share-skip="">{block.label}</span> : null}
    <span className="ks-color-control"><input className="ks-color-input" type="color" aria-label={block.label ?? bindingName(block.value, "색상")} value={color} disabled={unavailable}
      onChange={(event) => { void data.act(`${pointer}/on_change`, event.currentTarget.value.toLowerCase()); }} /><span className="ks-color-code" data-ks-share-skip="">{color}</span></span>
  </label>;
}
export function SelectBlock({ block, pointer }: Props<"select">) {
  const data = useWindowData();
  const options = useBinding(`${pointer}/options`, block.options);
  const value = useBinding(`${pointer}/value`, block.value);
  if (options.status !== "ready") return <DataState value={options} compact />;
  const entries = asArray(options.value);
  const hasGroups = entries.some(validGroup);
  const toChoice = (option: SelectOption) => typeof option === "string" ? { value: option, label: option } : option;
  const groups = entries.flatMap((entry) => {
    if (validGroup(entry)) return [{ name: entry.name, options: entry.options.filter(validOption).map(toChoice) }];
    return validOption(entry) ? [{ name: "", options: [toChoice(entry)] }] : [];
  });
  const props = { value: value.status === "ready" ? value.value : null, placeholder: block.placeholder, segmented: block.style === "segmented", label: block.label, onChange: (next: JsonValue) => { void data.act(`${pointer}/on_change`, next); } };
  const select = hasGroups ? <Select {...props} groups={groups} /> : <Select {...props} items={entries.filter(validOption)} />;
  return block.label ? <label className="ks-field ks-select-field"><span className="ks-field-label" data-ks-share-skip="">{block.label}</span>{select}</label> : select;
}

export function ToggleBlock({ block, pointer }: Props<"toggle">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  return <Toggle checked={value.status === "ready" && Boolean(value.value)} label={block.label} onChange={(value) => { void data.act(`${pointer}/on_change`, value); }} />;
}

export function ButtonBlock({ block, pointer }: Props<"button">) {
  const data = useWindowData();
  const label = useBinding(`${pointer}/label`, block.label);
  const icon = useBinding(`${pointer}/icon`, block.icon ?? null);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const body = useBinding(`${pointer}/confirm/body`, block.confirm?.body ?? null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLSpanElement>(null);
  const restoreAfterAction = useRef(false);
  const close = useCallback(() => setConfirm(false), []);
  const run = async (restore: boolean) => { restoreAfterAction.current = restore; setConfirm(false); setBusy(true); await data.act(`${pointer}/on_click`, null); setBusy(false); };
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value);
  useLayoutEffect(() => {
    if (!busy && !unavailable && restoreAfterAction.current) {
      restoreAfterAction.current = false;
      opener.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
    }
  });
  const labelText = label.status === "ready" && typeof label.value === "string" ? label.value : "";
  const iconText = icon.status === "ready" && typeof icon.value === "string" ? icon.value : "";
  const contents = <>{(ICON_NAMES as readonly string[]).includes(iconText) ? <DataIcon name={iconText} /> : null}{!block.icon_only ? labelText : null}</>;
  const host = opener.current?.closest<HTMLElement>(".ks-data-window");
  return <span ref={opener} className={`ks-data-button is-${block.variant ?? "default"}`}>{block.icon_only
    ? <IconButton aria-label={labelText} disabled={busy || unavailable} onClick={() => block.confirm ? setConfirm(true) : void run(false)}>{contents}</IconButton>
    : <Button variant={block.variant === "primary" ? "emphasis" : "default"} disabled={busy || unavailable} onClick={() => block.confirm ? setConfirm(true) : void run(false)}>{contents}</Button>}
    {confirm && block.confirm && host ? <Dialog host={host} title={block.confirm.title} ok={block.confirm.ok ?? labelText} danger={block.variant === "danger"} onCancel={close} onConfirm={() => void run(true)} body={block.confirm.body === undefined ? undefined : body.status === "ready" ? display(body.value) : <DataState value={body} compact />} /> : null}
  </span>;
}
