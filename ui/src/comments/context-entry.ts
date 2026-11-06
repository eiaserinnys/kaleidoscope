import type { MenuEntry } from "../components/menu";

type Pick = (target: HTMLElement, point: { x: number; y: number }) => void;
const entries = new WeakMap<HTMLElement, Pick>();

export function registerCommentEntry(content: HTMLElement, pick: Pick) {
  entries.set(content, pick);
  return () => { if (entries.get(content) === pick) entries.delete(content); };
}

export function commentMenuEntry(target: HTMLElement, point: { x: number; y: number }): MenuEntry | undefined {
  const content = target.closest<HTMLElement>(".ks-window-content");
  const pick = content && entries.get(content);
  return pick ? { id: "app-comment", label: "커멘트 달기…", skipInitialFocus: true, onSelect: () => pick(target, point) } : undefined;
}
