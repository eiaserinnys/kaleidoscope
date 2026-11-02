import { useEffect, type RefObject } from "react";
import { SHARE_DEBOUNCE_MS } from "../contract/limits";
import type { VisibleView } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { clientShare } from "../runtime/client-runtime";
import { isFullyVisible, revealWebSurface } from "../blocks/web-surface-layer";
import { describeVisible, limitShareText } from "./visible";

const SHARE_ISOLATE_BUDGET_MS = 2_500;
const RAF_TIMEOUT_MS = 100;

interface ActiveShareView {
  element: HTMLElement;
  send: () => Promise<void>;
  last: VisibleView | null;
}

const active = new Map<string, ActiveShareView>();

export async function flushShareViews(): Promise<void> {
  await Promise.allSettled(Array.from(active.values(), (entry) => entry.send()));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve();
    }, RAF_TIMEOUT_MS);
    requestAnimationFrame(() => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function twoFrames(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

export async function prepareShareForSend(store: ShellStore): Promise<void> {
  await flushShareViews();
  const targets = Array.from(active.entries()).filter(([, entry]) =>
    entry.element.getClientRects().length > 0
      && entry.last?.visual === true
      && entry.last.occluded,
  );
  if (targets.length === 0) return;

  let frozen = false;
  try {
    const reply = await store.call({ op: "share.freeze" });
    frozen = reply.op === "share.freeze" && reply.frozen;
  } catch {
    return;
  }
  if (!frozen) return;

  const root = document.documentElement;
  const started = performance.now();
  try {
    root.dataset.shareIsolating = "true";
    for (const [windowId, entry] of targets) {
      if (performance.now() - started >= SHARE_ISOLATE_BUDGET_MS) break;
      const frame = entry.element.closest<HTMLElement>(".ks-window");
      if (!frame) continue;
      frame.dataset.shareTarget = "true";
      let restoreWeb: () => Promise<void> = async () => undefined;
      try {
        restoreWeb = await revealWebSurface(windowId, store);
        await twoFrames();
        try {
          await store.call({ op: "share.capture", window_id: windowId });
        } catch {
          // 캡처 실패는 글만 보내고 다음 창으로 진행한다.
        }
      } catch {
        // 캡처 준비 실패는 글만 보내고 다음 창으로 진행한다.
      } finally {
        try { await restoreWeb(); } catch { /* 복원 실패도 나머지 대상과 해제를 막지 않는다. */ }
        delete frame.dataset.shareTarget;
      }
    }
  } finally {
    for (const frame of document.querySelectorAll<HTMLElement>(".ks-window[data-share-target]")) {
      delete frame.dataset.shareTarget;
    }
    delete root.dataset.shareIsolating;
    try { await twoFrames(); } catch { /* 프레임 대기 실패도 해제를 막지 않는다. */ }
    try {
      await store.call({ op: "share.unfreeze" });
    } catch {
      // 네이티브 watchdog이 화면 고정을 해제한다.
    }
  }
}

export function useShareView({ windowId, root, enabled, store }: { windowId: string; root: RefObject<HTMLElement | null>; enabled: boolean; store: ShellStore }) {
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = "";
    let pending: Promise<void> = Promise.resolve();
    let alive = true;
    const entry: ActiveShareView = { element, send: async () => undefined, last: null };
    const send = () => {
      clearTimeout(timer); timer = undefined;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return pending;
      const description = describeVisible(element);
      const view: VisibleView = {
        ...description,
        occluded: !isFullyVisible(element),
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
      let key = "";
      pending = pending.catch(() => undefined).then(async () => {
        const client = await clientShare(store, windowId, view.visual);
        if (client?.text) view.text = limitShareText([view.text, client.text].filter(Boolean).join("\n"));
        if (!view.image_base64 && client?.image) view.image_base64 = client.image;
        key = JSON.stringify(view);
        if (!alive || key === lastKey) return;
        lastKey = key;
        try {
          await store.call({ op: "share.view", window_id: windowId, view });
          entry.last = view;
        } catch {
          if (lastKey === key) lastKey = "";
        }
      }).catch(() => { if (key && lastKey === key) lastKey = ""; });
      return pending;
    };
    entry.send = send;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void send(); }, SHARE_DEBOUNCE_MS); };
    const scheduleOnce = () => { if (!timer) timer = setTimeout(() => { void send(); }, SHARE_DEBOUNCE_MS); };
    const onScroll = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains("ks-timeline-scroll")) scheduleOnce();
      else schedule();
    };
    const observer = new MutationObserver((records) => {
      const changes = records.filter((record) => !(record.type === "attributes" && record.target instanceof HTMLElement && (
        (record.attributeName === "style" && record.target.classList.contains("ks-timeline-playhead")) ||
        (record.attributeName === "aria-valuenow" && record.target.classList.contains("ks-timeline-ruler"))
      )));
      if (!changes.length) return;
      if (changes.some((record) => record.type === "attributes" && record.attributeName === "data-share-seq")) scheduleOnce();
      else schedule();
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    const frameObserver = new MutationObserver(schedule);
    const frame = element.closest<HTMLElement>(".ks-window");
    if (frame) frameObserver.observe(frame, { attributes: true, attributeFilter: ["style", "data-minimized"] });
    const frameLayout = element.parentElement?.parentElement;
    if (frameLayout && frameLayout !== frame) frameObserver.observe(frameLayout, { attributes: true, attributeFilter: ["style"] });
    const canvasObserver = new MutationObserver(schedule);
    const canvas = element.closest(".ks-desktop-canvas");
    if (canvas) canvasObserver.observe(canvas, { attributes: true, attributeFilter: ["hidden"] });
    const resize = new ResizeObserver(schedule); resize.observe(element);
    element.addEventListener("scroll", onScroll, true);
    element.addEventListener("input", schedule, true);
    window.addEventListener("resize", schedule);
    active.set(windowId, entry);
    void send();
    return () => {
      alive = false; clearTimeout(timer);
      if (active.get(windowId) === entry) active.delete(windowId);
      observer.disconnect(); frameObserver.disconnect(); canvasObserver.disconnect(); resize.disconnect();
      element.removeEventListener("scroll", onScroll, true); element.removeEventListener("input", schedule, true); window.removeEventListener("resize", schedule);
    };
  }, [enabled, root, store, windowId]);
}
