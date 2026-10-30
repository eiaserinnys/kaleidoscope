import { useEffect, type RefObject } from "react";
import { SHARE_DEBOUNCE_MS } from "../contract/limits";
import type { VisibleView } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { describeVisible } from "./visible";

const active = new Set<() => Promise<void>>();
export async function flushShareViews(): Promise<void> {
  await Promise.allSettled(Array.from(active, (flush) => flush()));
}

export function useShareView({ windowId, root, enabled, store }: { windowId: string; root: RefObject<HTMLElement | null>; enabled: boolean; store: ShellStore }) {
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    let pending: Promise<void> = Promise.resolve();
    let alive = true;
    const send = () => {
      clearTimeout(timer); timer = undefined;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || element.closest("[hidden]")) return pending;
      const description = describeVisible(element);
      const view: VisibleView = { ...description, bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
      const key = JSON.stringify(view);
      if (key === last) return pending;
      last = key;
      pending = pending.catch(() => undefined).then(async () => {
        if (alive) await store.call({ op: "share.view", window_id: windowId, view });
      }).catch(() => { if (last === key) last = ""; });
      return pending;
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void send(); }, SHARE_DEBOUNCE_MS); };
    const observer = new MutationObserver(schedule);
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    const frameObserver = new MutationObserver(schedule);
    if (element.parentElement?.parentElement) frameObserver.observe(element.parentElement.parentElement, { attributes: true, attributeFilter: ["style"] });
    const canvasObserver = new MutationObserver(schedule);
    const canvas = element.closest(".ks-desktop-canvas");
    if (canvas) canvasObserver.observe(canvas, { attributes: true, attributeFilter: ["hidden"] });
    const resize = new ResizeObserver(schedule); resize.observe(element);
    element.addEventListener("scroll", schedule, true);
    element.addEventListener("input", schedule, true);
    window.addEventListener("resize", schedule);
    active.add(send);
    void send();
    return () => {
      alive = false; clearTimeout(timer); active.delete(send); observer.disconnect(); frameObserver.disconnect(); canvasObserver.disconnect(); resize.disconnect();
      element.removeEventListener("scroll", schedule, true); element.removeEventListener("input", schedule, true); window.removeEventListener("resize", schedule);
    };
  }, [enabled, root, store, windowId]);
}
