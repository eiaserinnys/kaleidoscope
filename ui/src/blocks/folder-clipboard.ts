import type { ShellStore } from "../core/shell-store";

export interface ShellClipboard {
  root: string;
  paths: string[];
  mode: "copy" | "cut";
}

const clipboardByStore = new WeakMap<ShellStore, ShellClipboard>();
export const clipboardListeners = new WeakMap<ShellStore, Set<(clipboard: ShellClipboard | null) => void>>();

export function getClipboard(store: ShellStore): ShellClipboard | null {
  return clipboardByStore.get(store) ?? null;
}

export function setClipboard(store: ShellStore, clipboard: ShellClipboard | null) {
  if (clipboard) clipboardByStore.set(store, clipboard);
  else clipboardByStore.delete(store);
  for (const listener of clipboardListeners.get(store) ?? []) listener(clipboard);
}
