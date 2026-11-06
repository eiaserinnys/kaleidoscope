import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ItemMenuEntry } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { openContextMenu, writeMenuClipboard } from "../components/context-menu";
import { Dialog } from "../components/dialog";
import { DataState } from "../components/data-state";
import { isUnclaimedFocus } from "../components/focus-rescue";
import type { MenuEntry } from "../components/menu";
import { ItemScopeProvider, useItemScope } from "../data/item-scope";
import { useBinding, useWindowData } from "../data/window-data";

type Pending = { entry: ItemMenuEntry; index: number; item: JsonValue; key: string; anchor: HTMLElement; container: HTMLElement | null; rowIndex: string | undefined; tree: boolean };

function restoreAfterAction({ anchor, container, rowIndex, tree }: Pending) {
  // 동작을 기다리는 사이 사용자가 옮긴 초점은 그대로 둔다.
  if (!isUnclaimedFocus(document.activeElement) || !container?.isConnected) return;
  const row = (index: number) => container.querySelector<HTMLElement>(tree
    ? `[role="treeitem"][data-index="${index}"]`
    : `[data-focus-index="${index}"]`);
  const target = anchor.isConnected ? anchor : rowIndex === undefined ? null : row(Number(rowIndex)) ?? row(Number(rowIndex) - 1);
  target?.focus({ preventScroll: true });
}

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
  const restoreAnchor = useRef<HTMLElement | null>(null);
  const stopRestore = useRef<() => void>(() => {});
  useLayoutEffect(() => () => stopRestore.current(), []);
  useLayoutEffect(() => {
    if (!pending && restoreAnchor.current) {
      restoreAnchor.current.focus({ preventScroll: true });
      restoreAnchor.current = null;
    }
  }, [pending]);
  const run = useCallback((entry: Pending) => {
    const scope = { item: entry.item, parent_item: parent?.item, key: entry.key, index: 0, instance: entry.anchor, parentScope: parent ?? undefined };
    return data.act(`${pointer}/item_menu/${entry.index}/on_select`, entry.key, entry.item, undefined, scope);
  }, [data, parent, pointer]);
  const open = useCallback((event: MouseEvent | ReactMouseEvent<HTMLElement> | undefined, anchor: HTMLElement, item: JsonValue | undefined, key: string, copyLabel: string, copyText: string) => {
    anchor.focus({ preventScroll: true });
    const container = anchor.closest<HTMLElement>('.ks-data-view, [role="tree"]');
    const tree = anchor.getAttribute("role") === "treeitem";
    const rowIndex = tree ? anchor.dataset.index : anchor.dataset.focusIndex;
    const menu: MenuEntry[] = item === undefined ? [] : (entries ?? []).map((entry, index) => ({
      id: `item-menu-${index}`, label: entry.label, danger: entry.danger,
      onSelect: () => {
        const chosen = { entry, index, item, key, anchor, container, rowIndex, tree };
        if (entry.confirm) setPending(chosen); else void run(chosen);
      },
    }));
    const copy: MenuEntry = { id: "item-menu-copy", label: copyLabel, onSelect: () => { void writeMenuClipboard(copyText, copyLabel); } };
    const separator: MenuEntry = { id: "item-menu-separator", type: "separator" };
    if (menu.length && entries?.[0]?.danger) menu.unshift(copy, separator);
    else {
      if (menu.length) menu.push(separator);
      menu.push(copy);
    }
    if (event) openContextMenu(event, menu, { anchor });
    else {
      const rect = anchor.getBoundingClientRect();
      openContextMenu(new MouseEvent("contextmenu", { cancelable: true }), menu, { anchor, anchorPoint: { x: rect.left, y: rect.bottom }, keyboard: true });
    }
  }, [entries, run]);
  const close = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    if (!pending) return;
    stopRestore.current();
    let stopped = false;
    let frame: number | undefined;
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      clearTimeout(timer);
    };
    stopRestore.current = stop;
    void run(pending).then(() => {
      if (stopped) return;
      frame = requestAnimationFrame(() => {
        restoreAfterAction(pending);
        if (!pending.anchor.isConnected || !pending.container?.isConnected) { stop(); return; }
        // 명령 응답보다 상태 이벤트가 늦으면 실제 행 제거를 한 번 기다린다.
        observer = new MutationObserver(() => {
          if (pending.anchor.isConnected) return;
          stop();
          restoreAfterAction(pending);
        });
        observer.observe(pending.container, { childList: true, subtree: true });
        timer = setTimeout(stop, 3000);
      });
    });
    restoreAnchor.current = pending.anchor;
    setPending(null);
  }, [pending, run]);
  return { open, dialog: pending ? <ItemScopeProvider value={{ item: pending.item, parent_item: parent?.item, key: pending.key, index: 0, instance: pending.anchor }}><Confirmation pending={pending} pointer={pointer} onCancel={close} onConfirm={confirm} /></ItemScopeProvider> : null };
}
