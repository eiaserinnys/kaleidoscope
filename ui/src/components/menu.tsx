import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ownerOf } from "../share/overlay-owner";
import { useAnchoredOverlay } from "./anchored-overlay";
import { focusByInput } from "./focus-rescue";
import { preserveWindowActionFocus, windowActionActive } from "../share/action-context";

export interface MenuItem {
  type?: "item";
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  skipInitialFocus?: boolean;
  checked?: boolean;
  description?: string;
  shortcut?: string;
  leading?: ReactNode;
}

export interface MenuHeading {
  id: string;
  type: "heading";
  label: string;
}

export interface MenuSeparator {
  id: string;
  type: "separator";
}

export type MenuEntry = MenuItem | MenuSeparator | MenuHeading;

export interface MenuProps {
  anchor: HTMLElement;
  anchorPoint?: { x: number; y: number };
  keyboardRect?: { left: number; top: number; bottom: number };
  items: MenuEntry[];
  onClose: () => void;
}

export function Menu({ anchor, anchorPoint, keyboardRect, items, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const position = useAnchoredOverlay(anchor, menuRef, { anchorPoint, keyboardRect });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const owner = ownerOf(anchor);
    const checked = menu?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (menu && checked) menu.scrollTop = checked.offsetTop - (menu.clientHeight - checked.offsetHeight) / 2;
    const initial = itemRefs.current.filter((_, index) => {
      const entry = items[index];
      return entry && entry.type !== "separator" && entry.type !== "heading" && !entry.skipInitialFocus;
    });
    const focusTarget = checked && !checked.disabled
      ? checked
      : initial.find((item) => item && !item.disabled && !item.classList.contains("ks-menu-item-danger"))
        ?? initial.find((item) => item && !item.disabled);
    if (!owner || !preserveWindowActionFocus(owner)) {
      if (checked) { if (focusTarget) focusByInput(focusTarget, { preventScroll: true }); }
      else if (focusTarget) focusByInput(focusTarget);
      else if (menu && items.some((entry) => entry.type !== "separator" && entry.type !== "heading" && entry.skipInitialFocus)) focusByInput(menu);
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const targetOwner = target instanceof Element ? ownerOf(target) : undefined;
      if (!event.isTrusted && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
      if (menuRef.current?.contains(target) || (anchorPoint === undefined && keyboardRect === undefined && anchor.contains(target))) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const targetOwner = event.target instanceof Element ? ownerOf(event.target) : undefined;
      if (!event.isTrusted && targetOwner && windowActionActive(targetOwner) && targetOwner !== owner) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        if (!owner || !preserveWindowActionFocus(owner)) focusByInput(anchor);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const enabled = itemRefs.current
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item && !item.disabled);
      if (enabled.length === 0) return;
      event.preventDefault();
      const current = enabled.findIndex(({ item }) => item === (!event.isTrusted && targetOwner && windowActionActive(targetOwner) ? event.target : document.activeElement));
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + delta + enabled.length) % enabled.length;
      if (!owner || !preserveWindowActionFocus(owner)) enabled[next].item?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, anchorPoint, keyboardRect, onClose]);

  return createPortal(
    <div
      aria-orientation="vertical"
      className="ks-anchored-overlay ks-menu"
      data-ks-overlay
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
        const owner = ownerOf(anchor);
        if (!owner || !preserveWindowActionFocus(owner)) focusByInput(anchor);
      }}
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => item.type === "separator" ? (
        <div aria-orientation="horizontal" className="ks-menu-separator" key={item.id} role="separator" />
      ) : item.type === "heading" ? (
        <div className="ks-menu-group-heading" key={item.id} role="presentation">{item.label}</div>
      ) : (
        <button
          aria-current={item.checked ? "true" : undefined}
          className={`ks-menu-item${item.danger ? " ks-menu-item-danger" : ""}${item.description ? " has-description" : ""}`}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            const owner = ownerOf(anchor);
            if (!owner || !preserveWindowActionFocus(owner)) focusByInput(anchor);
            item.onSelect?.();
            onClose();
          }}
          ref={(element) => {
            const index = items.indexOf(item);
            itemRefs.current[index] = element;
          }}
          role="menuitem"
          aria-keyshortcuts={item.shortcut?.replace(/\bCtrl\b/g, "Control")}
          type="button"
        >
          {item.leading ? <span className="ks-menu-item-leading">{item.leading}</span> : null}
          <span className="ks-menu-item-copy"><span className="ks-menu-item-label">{item.label}</span>{item.description ? <span className="ks-menu-item-description">{item.description}</span> : null}</span>
          {item.checked ? <span aria-hidden="true" className="ks-menu-check">✓</span> : item.shortcut ? <span aria-hidden="true" className="ks-menu-shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
