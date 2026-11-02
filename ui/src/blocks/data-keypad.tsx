import { useEffect, useRef, type CSSProperties } from "react";
import type { Block, KeypadButton } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataIcon } from "../components/data-icons";
import { DataState } from "../components/data-state";
import { Button } from "../components/primitives";
import { useBinding, useWindowData } from "../data/window-data";
import { registerGridShortcuts } from "../runtime/shortcuts";
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
    if (!root.current) return;
    return registerGridShortcuts(context, root.current, buttons, press, () => pointerFocus.current, () => { pointerFocus.current = false; });
  }, [buttons, context.store, context.window.id, context.window.desktop_id, data, pointer]);
  return <div ref={root} className="ks-keypad" onPointerDownCapture={() => { pointerFocus.current = true; }} style={{ "--ks-keypad-columns": block.columns } as CSSProperties}>
    {buttons.map((button) => <div key={button.key} className={`ks-keypad-cell is-${button.variant ?? "default"}`} data-key={button.key} data-shortcut={button.shortcut} style={{ "--ks-keypad-span": button.span ?? 1 } as CSSProperties}>
      <Button variant={button.variant === "primary" ? "emphasis" : "default"} disabled={button.disabled} onClick={() => press(button)}>
        {button.icon && <DataIcon name={button.icon} />}<span>{button.label}</span>{button.sublabel && <span className="ks-keypad-sublabel">{button.sublabel}</span>}
      </Button>
    </div>)}
  </div>;
}
