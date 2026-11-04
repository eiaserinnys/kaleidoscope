import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";
import { keepRovingRow, useVirtualRows, VirtualSurface, DEFAULT_VIRTUAL_ROW_ESTIMATE } from "../blocks/data-view-common";
import { filterInputOptions, type InputOption } from "../blocks/input-options";
import { ownerOf } from "../share/overlay-owner";
import { windowActionActive } from "../share/action-context";
import { registerSelectOptions } from "../share/select-options";
import { useAnchoredOverlay } from "./anchored-overlay";

type Props = {
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  inputRef: RefObject<HTMLInputElement | null>;
  options: InputOption[];
  ready: boolean;
  visible: boolean;
  onChoose: (value: string) => void;
  onCommit: () => boolean;
  onEditingEnd: () => void;
};

export function Combobox({ inputProps, inputRef, options, ready, visible, onChoose, onCommit, onEditingEnd }: Props) {
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
  const position = useAnchoredOverlay(open ? anchor : null, surface, { observe: true });
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
    if (!ready || inputProps.readOnly) return;
    setAnchor(inputRef.current); setQuery(""); setActive(options.find((option) => option.value === text)?.index ?? null); setOpen(true);
  };
  const changeActive = (direction: number) => {
    if (!ready) return;
    if (!open) { setAnchor(inputRef.current); setQuery(""); setOpen(true); const current = options.findIndex((option) => option.value === text); const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : Math.max(0, Math.min(options.length - 1, current + direction)); setActive(options[next]?.index ?? null); virtual.scrollToIndex(next, { align: "auto" }); return; }
    const next = index < 0 ? (direction > 0 ? 0 : filtered.length - 1) : Math.max(0, Math.min(filtered.length - 1, index + direction));
    setActive(filtered[next]?.index ?? null); if (filtered[next]) virtual.scrollToIndex(next, { align: "auto" });
  };
  return <>
    <input {...inputProps} ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? activeId : undefined}
      onFocus={(event) => { inputProps.onFocus?.(event); show(); }}
      onClick={(event) => { inputProps.onClick?.(event); if (!open) show(); }}
      onBlur={(event) => { if (!surface.current?.contains(event.relatedTarget as Node | null)) { inputProps.onBlur?.(event); setOpen(false); } }}
      onChange={(event) => { inputProps.onChange?.(event); if (ready && !inputProps.readOnly) { setAnchor(inputRef.current); setQuery(event.currentTarget.value); setActive(null); setOpen(true); } }}
      onCompositionStart={(event) => { composing.current = true; inputProps.onCompositionStart?.(event); }}
      onCompositionEnd={(event) => { composing.current = false; inputProps.onCompositionEnd?.(event); }}
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
    {open && anchor && createPortal(<div ref={surface} data-ks-overlay className="ks-anchored-overlay ks-combobox-popup" style={position} onBlur={(event) => {
      if (event.relatedTarget === anchor || surface.current?.contains(event.relatedTarget as Node | null)) return;
      onCommit(); onEditingEnd(); setOpen(false);
    }}>
      <div className="ks-combobox-list" role="listbox" id={listId} ref={scroll}>
        {filtered.length ? <VirtualSurface virtual={virtual}>{rows.map((row) => {
          const option = filtered[row.index];
          return <OptionRow key={option.index} option={option} id={`${id}-option-${option.index}`} top={row.start} selected={text === option.value} active={option.index === active} size={filtered.length} position={row.index + 1} descriptionId={descriptionId} measure={virtual.measureElement} onActive={setActive} onChoose={choose} />;
        })}</VirtualSurface> : <div className="ks-combobox-empty">일치 없음</div>}
      </div>
      {options.some((option) => option.description) && <div className="ks-combobox-description" id={descriptionId} tabIndex={-1}>{activeOption?.description}</div>}
    </div>, document.body)}
  </>;
}

const OptionRow = memo(function OptionRow({ option, id, top, selected, active, size, position, descriptionId, measure, onActive, onChoose }: { option: InputOption; id: string; top: number; selected: boolean; active: boolean; size: number; position: number; descriptionId: string; measure: (node: Element | null) => void; onActive: (index: number) => void; onChoose: (option: InputOption) => void }) {
  return <div ref={measure} data-index={position - 1} id={id} role="option" aria-selected={selected} aria-posinset={position} aria-setsize={size} aria-describedby={active && option.description ? descriptionId : undefined} className={`ks-menu-item ks-combobox-option${active ? " is-active" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${top}px)` }} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => onActive(option.index)} onClick={() => onChoose(option)}>
    <span className="ks-menu-item-copy"><span className="ks-menu-item-label">{option.label}</span>{option.label !== option.value && <span className="ks-menu-item-description">{option.value}</span>}</span>
  </div>;
});
