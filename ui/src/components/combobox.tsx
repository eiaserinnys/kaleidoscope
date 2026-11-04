import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";
import { keepRovingRow, useVirtualRows, VirtualSurface, DEFAULT_VIRTUAL_ROW_ESTIMATE } from "../blocks/data-view-common";
import { filterInputOptions, type InputOption } from "../blocks/input-options";
import { ownerOf } from "../share/overlay-owner";
import { windowActionActive } from "../share/action-context";
import { registerSelectOptions } from "../share/select-options";
import { computeAnchoredPosition, useAnchoredOverlay } from "./anchored-overlay";

type Props = {
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  inputRef: RefObject<HTMLInputElement | null>;
  options: InputOption[];
  ready: boolean;
  loading?: boolean;
  visible: boolean;
  optionsOnly?: boolean;
  onChoose: (value: string) => void;
  onCommit: () => boolean;
  onEditingEnd: () => void;
};

export function Combobox({ inputProps, inputRef, options, ready, loading = false, visible, optionsOnly = false, onChoose, onCommit, onEditingEnd }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const descriptionId = `${id}-description`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const composing = useRef(false);
  const chooseRef = useRef(onChoose);
  chooseRef.current = onChoose;
  const commitRef = useRef(onCommit);
  const endRef = useRef(onEditingEnd);
  commitRef.current = onCommit;
  endRef.current = onEditingEnd;
  const text = String(inputProps.value ?? "");
  const filtered = useMemo(() => filterInputOptions(options, query), [options, query]);
  const shown = open ? filtered : options;
  const surface = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const popupVisible = open && (loading || optionsOnly || filtered.length > 0);
  const position = useAnchoredOverlay(popupVisible ? anchor : null, surface, { offsetToken: "--ks-space-2", alignEndOnOverflow: true });
  const layout = useComboboxLayout(open ? anchor : null, options, loading);
  const optionKey = useCallback((index: number) => filtered[index].index, [filtered]);
  const { scroll, virtual } = useVirtualRows(filtered.length, DEFAULT_VIRTUAL_ROW_ESTIMATE, undefined, false, optionKey);
  const index = active === null ? -1 : filtered.findIndex((option) => option.index === active);
  keepRovingRow(virtual, index);
  const rows = virtual.getVirtualItems();
  const activeOption = index < 0 ? undefined : filtered[index];
  const activeId = activeOption && rows.some((row) => row.index === index) ? `${id}-option-${activeOption.index}` : undefined;
  useLayoutEffect(() => { if (open && index >= 0) virtual.scrollToIndex(index, { align: "auto" }); }, [open, index, virtual]);
  const choose = useCallback((option: InputOption) => { chooseRef.current(option.value); setOpen(false); setQuery(""); setActive(null); }, []);
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    return registerSelectOptions(element, shown.map(({ label, value }) => ({ label, value, disabled: Boolean(inputProps.readOnly) || !ready })), (selected) => { const option = shown[selected]; if (option) choose(option); });
  }, [inputRef, shown, choose, inputProps.readOnly, ready]);
  useEffect(() => { if (!visible || inputProps.readOnly) setOpen(false); }, [visible, inputProps.readOnly]);
  useEffect(() => {
    if (!open || !anchor) return;
    const owner = ownerOf(anchor);
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetOwner = target instanceof Element ? ownerOf(target) : undefined;
      if (!event.isTrusted && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
      if (!anchor.contains(target) && !surface.current?.contains(target)) {
        if (surface.current?.contains(document.activeElement)) { commitRef.current(); endRef.current(); }
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, anchor]);
  const show = () => {
    if ((!ready && !loading) || inputProps.readOnly) return;
    setAnchor(inputRef.current); setQuery(""); setActive(options.find((option) => option.value === text)?.index ?? null); setOpen(true);
  };
  const changeActive = (direction: number) => {
    if (!ready) return;
    if (!open) { setAnchor(inputRef.current); setQuery(""); setOpen(true); const current = options.findIndex((option) => option.value === text); const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : Math.max(0, Math.min(options.length - 1, current + direction)); setActive(options[next]?.index ?? null); virtual.scrollToIndex(next, { align: "auto" }); return; }
    const next = index < 0 ? (direction > 0 ? 0 : filtered.length - 1) : Math.max(0, Math.min(filtered.length - 1, index + direction));
    setActive(filtered[next]?.index ?? null); if (filtered[next]) virtual.scrollToIndex(next, { align: "auto" });
  };
  return <>
    <input {...inputProps} ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={popupVisible} aria-controls={popupVisible ? listId : undefined} aria-activedescendant={popupVisible ? activeId : undefined}
      onFocus={(event) => { inputProps.onFocus?.(event); show(); }}
      onClick={(event) => { inputProps.onClick?.(event); if (!open) show(); }}
      onBlur={(event) => { if (!surface.current?.contains(event.relatedTarget as Node | null)) { inputProps.onBlur?.(event); setOpen(false); } }}
      onChange={(event) => { inputProps.onChange?.(event); if (ready && !inputProps.readOnly) { setAnchor(inputRef.current); const value = event.currentTarget.value; if (!composing.current || filterInputOptions(options, value).length) setQuery(value); setActive(null); setOpen(true); } }}
      onCompositionStart={(event) => { composing.current = true; inputProps.onCompositionStart?.(event); }}
      onCompositionEnd={(event) => { composing.current = false; inputProps.onCompositionEnd?.(event); if (ready && !inputProps.readOnly) { setQuery(event.currentTarget.value); setActive(null); } }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || inputProps.readOnly) { inputProps.onKeyDown?.(event); return; }
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (event.altKey && event.key === "ArrowDown") show(); else changeActive(event.key === "ArrowDown" ? 1 : -1); return; }
        if (event.key === "Enter") {
          if (open && activeOption) { event.preventDefault(); choose(activeOption); return; }
          if (!onCommit()) { event.preventDefault(); return; }
        }
        if (event.key === "Tab") { onCommit(); setOpen(false); }
        inputProps.onKeyDown?.(event);
      }} />
    {popupVisible && anchor && createPortal(<div ref={surface} data-ks-overlay className={`ks-anchored-overlay ks-combobox-popup${layout?.far ? " is-far" : ""}${layout?.above ? " is-above" : ""}`} style={{ ...position, ...layout?.style, ...(!layout ? { visibility: "hidden" } : {}) }} onBlur={(event) => {
      if (event.relatedTarget === anchor || surface.current?.contains(event.relatedTarget as Node | null)) return;
      onCommit(); onEditingEnd(); setOpen(false);
    }}>
      <div className="ks-combobox-list" role="listbox" id={listId} ref={scroll}>
        {loading ? <div className="ks-data-skeleton ks-combobox-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div> : filtered.length ? <VirtualSurface virtual={virtual}>{rows.map((row) => {
          const option = filtered[row.index];
          return <OptionRow key={option.index} option={option} id={`${id}-option-${option.index}`} top={row.start} selected={text === option.value} active={option.index === active} size={filtered.length} position={row.index + 1} descriptionId={descriptionId} measure={virtual.measureElement} onActive={setActive} onChoose={choose} />;
        })}</VirtualSurface> : <div className="ks-combobox-empty">일치 없음</div>}
      </div>
      {activeOption?.description && <><div className="ks-combobox-separator" /><div className="ks-combobox-description" id={descriptionId} tabIndex={-1}>{activeOption.description}</div></>}
    </div>, document.body)}
  </>;
}

type ComboboxLayout = { far: boolean; above: boolean; style: CSSProperties };

function useComboboxLayout(anchor: HTMLElement | null, options: InputOption[], loading: boolean): ComboboxLayout | null {
  const [layout, setLayout] = useState<ComboboxLayout | null>(null);
  const choices = useRef({ options, loading });
  choices.current = { options, loading };
  useLayoutEffect(() => {
    if (!anchor) { setLayout(null); return; }
    let openedAbove: boolean | undefined;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const css = getComputedStyle(anchor);
      const token = (name: string) => Number.parseFloat(css.getPropertyValue(name)) || 0;
      const inset = token("--ks-space-3");
      const offset = token("--ks-space-2");
      const pane = token("--ks-pane-min-size");
      const line = token("--ks-line-width");
      const width = Math.min(Math.max(rect.width, pane), Math.max(window.innerWidth - 2 * inset, 0));
      const position = computeAnchoredPosition({ rect, width, height: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, inset, offset, alignEndOnOverflow: true });
      const far = position.left + width + line + 2 * pane > window.innerWidth - inset;
      const { options, loading } = choices.current;
      const bodyHeight = token("--ks-type-body") * token("--ks-line-body");
      const metaHeight = token("--ks-type-meta") * token("--ks-line-body");
      const rowHeight = (option?: InputOption) => Math.max(token("--ks-control-height"), bodyHeight + (option && option.label !== option.value ? metaHeight : 0) + 2 * offset);
      const total = loading ? 3 * rowHeight() : options.reduce((sum, option) => sum + rowHeight(option), 0);
      const padding = 2 * token("--ks-space-1");
      const required = Math.min(total, 2 * pane - padding) + padding + (far && options.some((option) => Boolean(option.description)) ? pane + line : 0);
      const below = window.innerHeight - inset - rect.bottom - offset;
      const aboveSpace = rect.top - inset - offset;
      const above = openedAbove ?? (below < required && aboveSpace > below);
      openedAbove = above;
      setLayout({ far, above, style: {
        left: position.left,
        top: above ? undefined : rect.bottom + offset,
        bottom: above ? window.innerHeight - rect.top + offset : undefined,
        maxHeight: Math.max(above ? aboveSpace : below, 0),
        "--ks-combobox-list-width": `${width}px`,
      } as CSSProperties });
    };
    measure();
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchor]);
  return layout;
}

const OptionRow = memo(function OptionRow({ option, id, top, selected, active, size, position, descriptionId, measure, onActive, onChoose }: { option: InputOption; id: string; top: number; selected: boolean; active: boolean; size: number; position: number; descriptionId: string; measure: (node: Element | null) => void; onActive: (index: number) => void; onChoose: (option: InputOption) => void }) {
  return <div ref={measure} data-index={position - 1} id={id} role="option" aria-selected={selected} aria-posinset={position} aria-setsize={size} aria-describedby={active && option.description ? descriptionId : undefined} className={`ks-menu-item ks-combobox-option${active ? " is-active" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${top}px)` }} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => onActive(option.index)} onClick={() => onChoose(option)}>
    <span className="ks-menu-item-copy"><span className="ks-menu-item-label">{option.label}</span>{option.label !== option.value && <span className="ks-menu-item-description">{option.value}</span>}</span>
  </div>;
});
