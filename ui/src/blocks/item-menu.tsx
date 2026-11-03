import { useCallback, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ItemMenuEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { openContextMenu, writeMenuClipboard } from "../components/context-menu";
import { Dialog } from "../components/dialog";
import { DataState } from "../components/data-state";
import type { MenuEntry } from "../components/menu";
import { ItemScopeProvider, useItemScope } from "../data/item-scope";
import { useBinding, useWindowData } from "../data/window-data";

type Pending = { entry: ItemMenuEntry; index: number; item: JsonValue; key: string; anchor: HTMLElement };

function Confirmation({ pending, pointer, onCancel, onConfirm }: { pending: Pending; pointer: string; onCancel: () => void; onConfirm: () => void }) {
  const body = useBinding(`${pointer}/item_menu/${pending.index}/confirm/body`, pending.entry.confirm?.body ?? null);
  const host = pending.anchor.closest<HTMLElement>(".ks-data-window");
  const confirm = pending.entry.confirm;
  if (!host || !confirm) return null;
  const content = confirm.body === undefined ? undefined : body.status === "ready" ? (typeof body.value === "string" ? body.value : JSON.stringify(body.value)) : <DataState value={body} compact />;
  return <Dialog host={host} title={confirm.title} ok={confirm.ok ?? pending.entry.label} danger={pending.entry.danger} body={content} onCancel={onCancel} onConfirm={onConfirm} />;
}

export function useItemMenu(entries: ItemMenuEntry[] | undefined, pointer: string) {
  const data = useWindowData();
  const parent = useItemScope();
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useCallback((entry: Pending) => {
    const scope = { item: entry.item, parent_item: parent?.item, key: entry.key, index: 0, instance: entry.anchor };
    void data.act(`${pointer}/item_menu/${entry.index}/on_select`, entry.key, entry.item, undefined, scope);
  }, [data, parent, pointer]);
  const open = useCallback((event: MouseEvent | ReactMouseEvent<HTMLElement> | undefined, anchor: HTMLElement, item: JsonValue | undefined, key: string, copyLabel: string, copyText: string) => {
    anchor.focus({ preventScroll: true });
    const menu: MenuEntry[] = item === undefined ? [] : (entries ?? []).map((entry, index) => ({
      id: `item-menu-${index}`, label: entry.label, danger: entry.danger,
      onSelect: () => {
        const chosen = { entry, index, item, key, anchor };
        if (entry.confirm) setPending(chosen); else run(chosen);
      },
    }));
    if (menu.length) menu.push({ id: "item-menu-separator", type: "separator" });
    menu.push({ id: "item-menu-copy", label: copyLabel, onSelect: () => { void writeMenuClipboard(copyText, copyLabel); } });
    if (event) openContextMenu(event, menu, { anchor });
    else {
      const rect = anchor.getBoundingClientRect();
      openContextMenu(new MouseEvent("contextmenu", { cancelable: true }), menu, { anchor, anchorPoint: { x: rect.left, y: rect.bottom }, keyboard: true });
    }
  }, [entries, run]);
  const close = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    if (!pending) return;
    run(pending);
    pending.anchor.focus({ preventScroll: true });
    setPending(null);
  }, [pending, run]);
  return { open, dialog: pending ? <ItemScopeProvider value={{ item: pending.item, parent_item: parent?.item, key: pending.key, index: 0, instance: pending.anchor }}><Confirmation pending={pending} pointer={pointer} onCancel={close} onConfirm={confirm} /></ItemScopeProvider> : null };
}
