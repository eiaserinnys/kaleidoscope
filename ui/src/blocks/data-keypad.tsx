import { useEffect, useRef, type CSSProperties } from "react";
import type { Block, KeypadButton } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { Button } from "../components/primitives";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { asArray, isObject, NoItems } from "./data-view-common";

function isButton(value: unknown): value is KeypadButton {
  return isObject(value) && typeof value.key === "string" && value.key.length > 0 && typeof value.label === "string";
}

export function DataKeypadBlock({ block, context, pointer }: { block: Extract<Block, { type: "button_grid" }>; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/buttons`, block.buttons);
  if (value.status !== "ready") return <DataState value={value} />;
  const buttons = asArray(value.value).filter(isButton);
  if (!buttons.length) return <NoItems />;
  return <KeypadReady block={block} context={context} pointer={pointer} buttons={buttons} />;
}

function KeypadReady({ block, context, pointer, buttons }: { block: Extract<Block, { type: "button_grid" }>; context: BlockContext; pointer: string; buttons: KeypadButton[] }) {
  const data = useWindowData();
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const pointerFocus = useRef(false);
  const press = (button: KeypadButton) => {
    if (button.disabled) return;
    pending.current = pending.current.then(async () => { await data.act(`${pointer}/on_press`, button.key, button as unknown as JsonValue); });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = root.current;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Tab") { pointerFocus.current = false; return; }
      if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]') || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target?.closest('input, textarea, select, [contenteditable], .cm-editor')) return;
      const focusedButton = target?.closest("button");
      if (event.key === "Enter" && focusedButton && (!element.contains(focusedButton) || !pointerFocus.current)) return;
      const overlays = document.querySelectorAll('[role="dialog"], [role="menu"], dialog[open]');
      if ([...overlays].some((overlay) => !overlay.closest('[hidden], [inert], [aria-hidden="true"]'))) return;
      const snapshot = context.store.getSnapshot();
      const desktop = snapshot?.shared.desktops.find((item) => item.id === context.window.desktop_id);
      if (desktop && (snapshot?.device.active_workspace_id !== desktop.workspace_id || snapshot?.device.active_desktop_ids[desktop.workspace_id] !== desktop.id)) return;
      const currentWindow = snapshot?.shared.windows.find((item) => item.id === context.window.id);
      const windows = snapshot?.shared.windows.filter((item) => item.desktop_id === context.window.desktop_id) ?? [];
      if (currentWindow && windows.some((item) => item.z > currentWindow.z)) return;
      const enabledButtons = buttons.filter((item) => !item.disabled);
      const directButton = enabledButtons.find((item) => item.shortcut === event.key);
      const button = directButton ?? (event.key.length === 1
        ? enabledButtons.find((item) => Boolean(item.shortcut) && item.key.length === 1 && item.key === event.key)
        : undefined);
      if (!button) return;
      const app = element.closest(".ks-app-window-content");
      const focusedKeypad = target?.closest(".ks-keypad");
      if (focusedKeypad && focusedKeypad !== element) return;
      if (!focusedKeypad && app) {
        const enabledCells = [...app.querySelectorAll<HTMLElement>(".ks-keypad-cell[data-shortcut]")]
          .filter((cell) => !cell.querySelector<HTMLButtonElement>("button")?.disabled);
        const directMatches = enabledCells.filter((cell) => cell.dataset.shortcut === event.key);
        const candidates = directMatches.length > 0 ? directMatches : (event.key.length === 1
          ? enabledCells.filter((cell) => cell.dataset.key?.length === 1 && cell.dataset.key === event.key)
          : []);
        if (candidates.length !== 1) return;
        if (!element.contains(candidates[0])) return;
      }
      event.preventDefault();
      press(button);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [buttons, context.store, context.window.id, context.window.desktop_id, data, pointer]);
  return <div ref={root} className="ks-keypad" onPointerDownCapture={() => { pointerFocus.current = true; }} style={{ "--ks-keypad-columns": block.columns } as CSSProperties}>
    {buttons.map((button) => <div key={button.key} className={`ks-keypad-cell is-${button.variant ?? "default"}`} data-key={button.key} data-shortcut={button.shortcut} style={{ "--ks-keypad-span": button.span ?? 1 } as CSSProperties}>
      <Button variant={button.variant === "primary" ? "emphasis" : "default"} disabled={button.disabled} onClick={() => press(button)}>
        {button.icon && <DataIcon name={button.icon} />}<span>{button.label}</span>{button.sublabel && <span className="ks-keypad-sublabel">{button.sublabel}</span>}
      </Button>
    </div>)}
  </div>;
}
