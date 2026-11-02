import { Fragment, useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, ChevronDown, ChevronRight, X } from "../../components/icons";
import { Menu } from "../../components/menu";
import { IconButton } from "../../components/primitives";
import type { FrameSelection } from "../html-bridge/frame-protocol";

export function Target({ selection, choose }: { selection: FrameSelection; choose: (n: number | null) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const ancestors = selection.ancestors ?? [];
  const quote = selection.anchor.kind === "text";
  const name = selection.name ?? selection.anchor.tag;
  const crumbName = name.includes("#") ? name : name.split(".").slice(0, 2).join(".");
  const path = quote ? [...ancestors, { n: selection.n, label: crumbName }] : ancestors;
  const shown = path.length > 2 ? path.slice(-2) : path;
  return <div className="ks-html-target">
    <nav className="ks-html-crumbs" aria-label="부모 경로">
      {path.length > 2 ? <><button type="button" className="ks-html-crumb" aria-label="전체 경로" onClick={(event) => setAnchor(event.currentTarget)}>…</button><span aria-hidden="true">›</span></> : null}
      {shown.map((item) => <Fragment key={item.n}><button type="button" className="ks-html-crumb" onClick={() => choose(item.n)}>{item.label}</button><span aria-hidden="true">›</span></Fragment>)}
    </nav>
    <div className={`ks-html-target-name${quote ? " is-quote" : ""}`}>{quote ? `“${selection.anchor.quote?.exact ?? ""}”` : selection.name ?? selection.anchor.label}</div>
    <IconButton aria-label="선택 해제" onClick={() => choose(null)}><X size="inline" /></IconButton>
    {anchor ? <Menu anchor={anchor} onClose={close} items={ancestors.map((item) => ({ id: String(item.n), label: item.label, onSelect: () => choose(item.n) }))} /> : null}
  </div>;
}

export function Group({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return <section className="ks-html-group"><button type="button" className="ks-data-section-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size="inline" /> : <ChevronRight size="inline" />}<span className="ks-data-section-heading"><span className="ks-data-section-title">{title}</span>{count !== undefined ? <span className="ks-data-section-meta">{count}</span> : null}</span></button>{open ? children : null}</section>;
}

export function Compose({ label, onSubmit, onEscape, focus }: { label: string; onSubmit: (text: string) => Promise<boolean>; onEscape: () => void; focus?: boolean }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const ref = useCallback((element: HTMLTextAreaElement | null) => { input.current = element; if (element && focus) element.focus(); }, [focus]);
  const submit = async () => { if (value.trim() && await onSubmit(value)) { setValue(""); input.current?.focus(); } };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (value) setValue(""); else onEscape(); }
  };
  return <div className="ks-html-compose"><textarea ref={ref} aria-label={label} className="ks-text-input ks-agent-chat-input" rows={1} placeholder={label} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={keyDown} /><IconButton aria-label="보내기" disabled={!value.trim()} onClick={() => void submit()}><ArrowUp /></IconButton></div>;
}
