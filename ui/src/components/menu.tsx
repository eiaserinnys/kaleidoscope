import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  type?: "item";
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  description?: string;
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
  items: MenuEntry[];
  onClose: () => void;
}

export function Menu({ anchor, items, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    const menuWidth = menu?.getBoundingClientRect().width ?? 0;
    const viewportInset = menu
      ? Number.parseFloat(getComputedStyle(menu).getPropertyValue("--ks-space-3")) || 0
      : 0;
    const maxLeft = Math.max(window.innerWidth - menuWidth - viewportInset, viewportInset);
    const menuHeight = menu?.getBoundingClientRect().height ?? 0;
    const belowTop = rect.bottom;
    const aboveTop = rect.top - menuHeight;
    const fitsBelow = belowTop >= viewportInset
      && belowTop + menuHeight <= window.innerHeight - viewportInset;
    const fitsAbove = aboveTop >= viewportInset && rect.top <= window.innerHeight - viewportInset;
    setPosition({
      left: Math.min(Math.max(rect.left, viewportInset), maxLeft),
      top: fitsBelow
        ? belowTop
        : fitsAbove
          ? aboveTop
          : Math.max(viewportInset, window.innerHeight - viewportInset - menuHeight),
    });
    itemRefs.current.find((item) => item && !item.disabled)?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchor.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const enabled = itemRefs.current
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item && !item.disabled);
      if (enabled.length === 0) return;
      event.preventDefault();
      const current = enabled.findIndex(({ item }) => item === document.activeElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + delta + enabled.length) % enabled.length;
      enabled[next].item?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      aria-orientation="vertical"
      className="ks-menu"
      data-ks-overlay
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
        anchor.focus();
      }}
      ref={menuRef}
      role="menu"
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
            item.onSelect?.();
            onClose();
          }}
          ref={(element) => {
            const index = items.indexOf(item);
            itemRefs.current[index] = element;
          }}
          role="menuitem"
          type="button"
        >
          <span className="ks-menu-item-copy"><span className="ks-menu-item-label">{item.label}</span>{item.description ? <span className="ks-menu-item-description">{item.description}</span> : null}</span>
          {item.checked ? <span aria-hidden="true" className="ks-menu-check">✓</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
