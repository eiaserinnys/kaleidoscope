import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";
import { keepRovingRow, useVirtualRows, VirtualSurface, DEFAULT_VIRTUAL_ROW_ESTIMATE } from "../blocks/data-view-common";
import { filterInputOptions, type InputOption } from "../blocks/input-options";
import { ownerOf } from "../share/overlay-owner";
import { windowActionActive } from "../share/action-context";
import { registerSelectOptions } from "../share/select-options";
import { useAnchoredOverlay } from "./anchored-overlay";
import { useComboboxLayout } from "./combobox-layout";
import { ChevronDown } from "./icons";

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
  selectedValue?: string | null;
  hideValue?: boolean;
  search?: boolean;
  onRevert?: () => void;
  clearRef?: RefObject<(() => void) | null>;
};

export function Combobox({ inputProps, inputRef, options, ready, loading = false, visible, optionsOnly = false, onChoose, onCommit, onEditingEnd, selectedValue, hideValue = false, search = false, onRevert, clearRef }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const descriptionId = `${id}-description`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const pointer = useRef(false);
  const clickedClosed = useRef(false);
  const selectAfterChoose = useRef(false);
  const autoSelected = useRef(false);
  const suppressFocus = useRef(false);
  const selectAll = (element: HTMLInputElement) => { element.select(); autoSelected.current = true; };
  const clickSelection = useRef<(() => void) | null>(null);
  const clickFrame = useRef(0);
  const cancelClickSelection = () => { cancelAnimationFrame(clickFrame.current); clickSelection.current = null; };
  useEffect(() => () => cancelAnimationFrame(clickFrame.current), []);
  const composing = useRef(false);
  const chooseRef = useRef(onChoose);
  chooseRef.current = onChoose;
  const commitRef = useRef(onCommit);
  const endRef = useRef(onEditingEnd);
  commitRef.current = onCommit;
  endRef.current = onEditingEnd;
  const text = String(inputProps.value ?? "");
  const selected = selectedValue !== undefined ? selectedValue : text;
  const filtered = useMemo(() => filterInputOptions(options, optionsOnly ? query.trim() : query), [options, query, optionsOnly]);
  const shown = open ? filtered : options;
  const surface = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const popupVisible = open && (loading || optionsOnly || filtered.length > 0);
  const position = useAnchoredOverlay(popupVisible ? anchor : null, surface, { offsetToken: "--ks-space-2", alignEndOnOverflow: true });
  const close = useCallback(() => { setOpen(false); setQuery(""); setActive(null); }, []);
  useLayoutEffect(() => {
    if (!clearRef) return;
    clearRef.current = () => {
      cancelClickSelection(); selectAfterChoose.current = false; autoSelected.current = false;
      close();
      // X가 사라질 때 초점만 돌리고, 실제로 다시 입력할 때 목록을 연다.
      suppressFocus.current = true;
      try { inputRef.current?.focus({ preventScroll: true }); }
      finally { suppressFocus.current = false; }
    };
    return () => { clearRef.current = null; };
  }, [clearRef, inputRef, close]);
  const optionKey = useCallback((index: number) => filtered[index].index, [filtered]);
  const [listInset] = useState(() => typeof document === "undefined" ? 0 : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ks-space-1")) || 0);
  const { scroll, virtual } = useVirtualRows(filtered.length, DEFAULT_VIRTUAL_ROW_ESTIMATE, undefined, false, optionKey, undefined, undefined, { start: 0, end: listInset * 2 });
  const index = active === null ? -1 : filtered.findIndex((option) => option.index === active);
  keepRovingRow(virtual, index);
  const rows = virtual.getVirtualItems();
  const activeOption = index < 0 ? undefined : filtered[index];
  const layout = useComboboxLayout(open ? anchor : null, surface, options, loading, close, activeOption?.description);
  const activeId = activeOption && rows.some((row) => row.index === index) ? `${id}-option-${activeOption.index}` : undefined;
  useLayoutEffect(() => { if (open && index >= 0) virtual.scrollToIndex(index, { align: "auto" }); }, [open, index, virtual]);
  const choose = useCallback((option: InputOption) => { selectAfterChoose.current = optionsOnly; chooseRef.current(option.value); close(); }, [optionsOnly, close]);
  useLayoutEffect(() => {
    if (!selectAfterChoose.current) return;
    selectAfterChoose.current = false;
    if (document.activeElement === inputRef.current) inputRef.current && selectAll(inputRef.current);
  }, [text, open, inputRef]);
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    return registerSelectOptions(element, shown.map(({ label, value }) => ({ label, value, disabled: Boolean(inputProps.readOnly) || !ready })), (selected) => { const option = shown[selected]; if (option) choose(option); });
  }, [inputRef, shown, choose, inputProps.readOnly, ready]);
  useEffect(() => { if (!visible || inputProps.readOnly || inputProps.disabled) setOpen(false); }, [visible, inputProps.readOnly, inputProps.disabled]);
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
    if ((!ready && !loading) || inputProps.readOnly || inputProps.disabled) return;
    setAnchor(inputRef.current); setQuery(""); setActive(options.find((option) => option.value === selected)?.index ?? null); setOpen(true);
  };
  const changeActive = (direction: number) => {
    if (!ready) return;
    if (!open) { setAnchor(inputRef.current); setQuery(""); setOpen(true); const current = options.findIndex((option) => option.value === selected); const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : Math.max(0, Math.min(options.length - 1, current + direction)); setActive(options[next]?.index ?? null); virtual.scrollToIndex(next, { align: "auto" }); return; }
    const next = index < 0 ? (direction > 0 ? 0 : filtered.length - 1) : Math.max(0, Math.min(filtered.length - 1, index + direction));
    setActive(filtered[next]?.index ?? null); if (filtered[next]) virtual.scrollToIndex(next, { align: "auto" });
  };
  return <>
    <input {...inputProps} ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={popupVisible} aria-controls={popupVisible ? listId : undefined} aria-activedescendant={popupVisible ? activeId : undefined}
      onPointerDown={(event) => { if (event.button === 0) { cancelClickSelection(); const element = event.currentTarget; if (autoSelected.current && element.selectionStart === 0 && element.selectionEnd === element.value.length) element.setSelectionRange(element.value.length, element.value.length); autoSelected.current = false; } pointer.current = true; clickedClosed.current = !open; inputProps.onPointerDown?.(event); }}
      onPointerUp={(event) => { pointer.current = false; inputProps.onPointerUp?.(event); }}
      onPointerCancel={() => { pointer.current = false; clickedClosed.current = false; }}
      onFocus={(event) => { inputProps.onFocus?.(event); if (!suppressFocus.current) { if (optionsOnly && !inputProps.readOnly && !pointer.current) selectAll(event.currentTarget); show(); } }}
      onClick={(event) => {
        inputProps.onClick?.(event);
        const element = event.currentTarget;
        const iconSize = Number.parseFloat(getComputedStyle(element).getPropertyValue("--ks-icon-button-size")) || 0;
        if (optionsOnly && !search && !inputProps.readOnly && open && !clickedClosed.current && event.clientX >= element.getBoundingClientRect().right - iconSize) { selectAfterChoose.current = true; close(); }
        else {
          if (!open) show();
          if (optionsOnly && !inputProps.readOnly && (clickedClosed.current || !open)) {
            // 기본 클릭이 기존 선택을 커서로 바꾼 뒤, 새 선택 범위가 없을 때만 고른다.
            clickSelection.current = () => {
              clickSelection.current = null;
              if (element.isConnected && document.activeElement === element && element.selectionStart === element.selectionEnd) selectAll(element);
            };
            clickFrame.current = requestAnimationFrame(() => clickSelection.current?.());
          }
        }
        pointer.current = false; clickedClosed.current = false;
      }}
      onBlur={(event) => { if (!surface.current?.contains(event.relatedTarget as Node | null)) { inputProps.onBlur?.(event); setOpen(false); } }}
      onChange={(event) => { selectAfterChoose.current = false; autoSelected.current = false; inputProps.onChange?.(event); if (ready && !inputProps.readOnly) { setAnchor(inputRef.current); const value = event.currentTarget.value; if (!composing.current || filterInputOptions(options, value).length) setQuery(value); setActive(null); setOpen(true); } }}
      onCompositionStart={(event) => { composing.current = true; selectAfterChoose.current = false; autoSelected.current = false; cancelClickSelection(); inputProps.onCompositionStart?.(event); }}
      onCompositionEnd={(event) => { composing.current = false; inputProps.onCompositionEnd?.(event); if (ready && !inputProps.readOnly) { setQuery(event.currentTarget.value); setActive(null); } }}
      onKeyDown={(event) => {
        if (event.shiftKey || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")) autoSelected.current = false;
        if (clickSelection.current) { cancelAnimationFrame(clickFrame.current); clickSelection.current(); }
        if (composing.current || event.nativeEvent.isComposing || inputProps.readOnly) { inputProps.onKeyDown?.(event); return; }
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); if (optionsOnly) { selectAfterChoose.current = true; onRevert?.(); } close(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (event.altKey && event.key === "ArrowDown") show(); else changeActive(event.key === "ArrowDown" ? 1 : -1); return; }
        if (event.key === "Enter") {
          if (open && activeOption) { event.preventDefault(); choose(activeOption); return; }
          const exact = optionsOnly && open ? filtered.length === 1 ? filtered[0] : filtered.find((option) => option.searchLabel === text.trim().toLowerCase() || option.searchValue === text.trim().toLowerCase()) : undefined;
          if (exact) { event.preventDefault(); choose(exact); return; }
          selectAfterChoose.current = optionsOnly && open; close();
          if (!onCommit()) { event.preventDefault(); return; }
        }
        if (event.key === "Tab") { onCommit(); setOpen(false); }
        inputProps.onKeyDown?.(event);
      }} />
    {optionsOnly && !search && (inputProps.disabled || !inputProps.readOnly) && <span className="ks-combobox-indicator" aria-hidden="true"><ChevronDown size="inline" /></span>}
    {popupVisible && anchor && createPortal(<div ref={surface} data-ks-overlay className={`ks-anchored-overlay ks-combobox-popup${layout?.far ? " is-far" : ""}${layout?.above ? " is-above" : ""}`} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (optionsOnly) { selectAfterChoose.current = true; onRevert?.(); } anchor.focus({ preventScroll: true }); close(); } }} style={{ ...position, ...layout?.style, ...(!layout ? { visibility: "hidden" } : {}) }} onBlur={(event) => {
      if (event.relatedTarget === anchor || surface.current?.contains(event.relatedTarget as Node | null)) return;
      onCommit(); onEditingEnd(); setOpen(false);
    }}>
      <div className="ks-combobox-list" role="listbox" id={listId} ref={scroll}>
        {loading ? <div className="ks-data-skeleton ks-combobox-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div> : filtered.length ? <VirtualSurface virtual={virtual}>{rows.map((row) => {
          const option = filtered[row.index];
          return <OptionRow key={option.index} option={option} id={`${id}-option-${option.index}`} top={row.start} selected={selected === option.value} active={option.index === active} size={filtered.length} position={row.index + 1} descriptionId={descriptionId} measure={virtual.measureElement} onActive={setActive} onChoose={choose} hideValue={hideValue} />;
        })}</VirtualSurface> : <div className="ks-combobox-empty">일치 없음</div>}
      </div>
      {activeOption?.description && <><div className="ks-combobox-separator" /><div className="ks-combobox-description" id={descriptionId} tabIndex={-1}>{activeOption.description}</div></>}
    </div>, document.body)}
  </>;
}

const OptionRow = memo(function OptionRow({ option, id, top, selected, active, size, position, descriptionId, measure, onActive, onChoose, hideValue }: { option: InputOption; id: string; top: number; selected: boolean; active: boolean; size: number; position: number; descriptionId: string; measure: (node: Element | null) => void; onActive: (index: number) => void; onChoose: (option: InputOption) => void; hideValue: boolean }) {
  return <div ref={measure} data-index={position - 1} id={id} role="option" aria-selected={selected} aria-posinset={position} aria-setsize={size} aria-describedby={active && option.description ? descriptionId : undefined} className={`ks-menu-item ks-combobox-option${active ? " is-active" : ""}`} style={{ position: "absolute", top: 0, transform: `translateY(${top}px)` }} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => onActive(option.index)} onClick={() => onChoose(option)}>
    <span className="ks-menu-item-copy"><span className="ks-menu-item-label">{option.label}</span>{!hideValue && option.label !== option.value && <span className="ks-menu-item-description">{option.value}</span>}</span>{selected && <span className="ks-menu-check" aria-hidden="true">✓</span>}
  </div>;
});
