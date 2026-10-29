import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Block, SelectOption } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { DataState } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { Dialog } from "../components/dialog";
import { ChevronDown, X } from "../components/icons";
import { Menu } from "../components/menu";
import { Button, IconButton } from "../components/primitives";
import { display } from "./data-layout";
import { asArray } from "./data-view-common";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }

export function InputBlock({ block, context, pointer }: Props<"input">) {
  const data = useWindowData();
  const current = context.window.state[block.value.state];
  const [draft, setDraft] = useState(current == null ? "" : String(current));
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const pending = useRef(0);
  useEffect(() => { if (!focused && pending.current === 0) setDraft(current == null ? "" : String(current)); }, [current, focused]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [draft]);
  const eventValue = (value: string): JsonValue => block.kind === "number" ? (value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value)) : value;
  const send = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current += 1;
    void data.act(`${pointer}/on_change`, eventValue(value)).finally(() => { pending.current -= 1; });
  };
  const change = (value: string) => { setDraft(value); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => send(value), 300); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !block.on_submit || event.nativeEvent.isComposing || composing.current || (block.multiline && !event.ctrlKey)) return;
    event.preventDefault();
    void data.act(`${pointer}/on_submit`, eventValue(draft));
  };
  const props = { className: "ks-text-input", placeholder: block.placeholder, value: draft,
    onFocus: () => setFocused(true), onBlur: () => { setFocused(false); send(draft); },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.currentTarget.value), onKeyDown: keyDown,
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
  };
  return <div className={`ks-data-input${block.kind === "search" ? " is-search" : ""}`}>
    {block.kind === "search" ? <span className="ks-data-input-search"><DataIcon name="search" size="inline" /></span> : null}
    {block.multiline ? <textarea {...props} ref={textarea} rows={1} /> : <input {...props} type={block.kind === "number" ? "number" : "text"} />}
    {block.kind === "search" && draft ? <span className="ks-data-input-clear"><IconButton aria-label="지우기" onClick={() => { change(""); send(""); }}><X size="inline" /></IconButton></span> : null}
  </div>;
}

function validOption(value: unknown): value is SelectOption {
  return typeof value === "string" || (typeof value === "object" && value !== null && "label" in value && typeof value.label === "string" && "value" in value);
}
const optionValue = (option: SelectOption): JsonValue => typeof option === "string" ? option : option.value;
const optionLabel = (option: SelectOption) => typeof option === "string" ? option : option.label;
const equal = (a: JsonValue | undefined, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

export function SelectBlock({ block, context, pointer }: Props<"select">) {
  const data = useWindowData();
  const options = useBinding(`${pointer}/options`, block.options);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (options.status !== "ready") return <DataState value={options} compact />;
  const items = asArray(options.value).filter(validOption);
  const current = context.window.state[block.value.state];
  const selected = items.find((item) => equal(current, optionValue(item)));
  const select = (item: SelectOption) => { void data.act(`${pointer}/on_change`, optionValue(item)); };
  if (block.style === "segmented") return <div className="ks-data-segmented">{items.map((item, index) => <Button key={index} aria-pressed={equal(current, optionValue(item))} onClick={() => select(item)}>{optionLabel(item)}</Button>)}</div>;
  return <><Button onClick={(event) => setAnchor(event.currentTarget)}>{selected ? optionLabel(selected) : block.placeholder ?? ""}<ChevronDown size="inline" /></Button>{anchor ? <Menu anchor={anchor} onClose={close} items={items.map((item, index) => ({ id: String(index), label: optionLabel(item), checked: equal(current, optionValue(item)), onSelect: () => select(item) }))} /> : null}</>;
}

export function ToggleBlock({ block, context, pointer }: Props<"toggle">) {
  const data = useWindowData();
  const checked = Boolean(context.window.state[block.value.state]);
  return <button className="ks-data-toggle" type="button" role="switch" aria-checked={checked} onClick={() => { void data.act(`${pointer}/on_change`, !checked); }}><span className="ks-data-toggle-track"><span className="ks-data-toggle-thumb" /></span><span>{block.label}</span></button>;
}

export function ButtonBlock({ block, pointer }: Props<"button">) {
  const data = useWindowData();
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
  const contents = <>{block.icon ? <DataIcon name={block.icon} /> : null}{!block.icon_only ? block.label : null}</>;
  const host = opener.current?.closest<HTMLElement>(".ks-data-window");
  return <span ref={opener} className={`ks-data-button is-${block.variant ?? "default"}`}>{block.icon_only
    ? <IconButton aria-label={block.label} disabled={busy || unavailable} onClick={() => block.confirm ? setConfirm(true) : void run(false)}>{contents}</IconButton>
    : <Button variant={block.variant === "primary" ? "emphasis" : "default"} disabled={busy || unavailable} onClick={() => block.confirm ? setConfirm(true) : void run(false)}>{contents}</Button>}
    {confirm && block.confirm && host ? <Dialog host={host} title={block.confirm.title} ok={block.confirm.ok ?? block.label} danger={block.variant === "danger"} onCancel={close} onConfirm={() => void run(true)} body={block.confirm.body === undefined ? undefined : body.status === "ready" ? display(body.value) : <DataState value={body} compact />} /> : null}
  </span>;
}
