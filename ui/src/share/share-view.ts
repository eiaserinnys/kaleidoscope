import { useEffect, type RefObject } from "react";
import { SHARE_DEBOUNCE_MS } from "../contract/limits";
import type { AppCommentImage, AppCommentRect, Rect, VisibleView, WindowGeometry } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import * as errors from "../contract/shell-errors";
import { clientShare } from "../runtime/client-runtime";
import { isFullyVisible, revealWebSurface, webSurfaceBounds } from "../blocks/web-surface-layer";
import { describeVisible, limitShareText } from "./visible";
import { registerControlWindow } from "./window-control";
import { ownedOverlays } from "./overlay-owner";

const SHARE_ISOLATE_BUDGET_MS = 2_500;
const RAF_TIMEOUT_MS = 100;
// 격리를 푼 배치가 화면에 나가기를 기다리는 상한. 네이티브 덮개 자동 해제(5초)보다 짧다.
const RESTORE_LIMIT_MS = 1_000;
const RESTORE_FRAMES = 3;

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

/**
 * 덮개를 걷기 전에 격리를 푼 배치가 실제로 화면에 나가기를 기다린다. 격리 속성을 지운 같은 작업에서 불러야 한다.
 * rAF 콜백은 다음 프레임을 그릴 차례가 왔다는 신호이지 화면에 나갔다는 신호가 아니다. 메인 스레드가 한 번 막히면
 * 두세 번의 콜백이 몰려 돌고, 그 사이 복원 프레임은 아직 합성과 표시 전이라 덮개를 걷으면 격리 배치가 보였다(카드 #1032).
 * 그래서 복원과 같은 프레임에 표식 글자를 넣고, 그 프레임이 표시된 뒤에 오는 Element Timing 항목을 받은 뒤 걷는다.
 * Element Timing이 없는 환경은 실제 프레임 세 번을 기다린다. 화면이 가려져 있거나 프레임이 오지 않으면 상한에서 넘어간다.
 */
function restoredOnScreen(): Promise<void> {
  if (document.visibilityState === "hidden") return Promise.resolve();
  const supported = typeof PerformanceObserver === "undefined" ? [] : PerformanceObserver.supportedEntryTypes ?? [];
  if (!supported.includes("element")) return restoredFrames();
  restoreSequence += 1;
  const identifier = `ks-share-restore-${restoreSequence}`;
  const marker = document.createElement("span");
  marker.setAttribute("elementtiming", identifier);
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = ".";
  marker.style.cssText = "position:fixed;left:0;top:0;font:2px/2px sans-serif;pointer-events:none;user-select:none;z-index:2147483647";
  document.body.append(marker);
  return new Promise((resolve) => {
    let finished = false;
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => (entry as PerformanceEntry & { identifier?: string }).identifier === identifier)) finish();
    });
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(limit);
      observer.disconnect();
      marker.remove();
      resolve();
    };
    const limit = setTimeout(finish, RESTORE_LIMIT_MS);
    observer.observe({ type: "element", buffered: true });
  });
}

function restoredFrames(): Promise<void> {
  return new Promise((resolve) => {
    let left = RESTORE_FRAMES;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(limit);
      resolve();
    };
    const limit = setTimeout(finish, RESTORE_LIMIT_MS);
    const tick = () => {
      if (finished) return;
      left -= 1;
      if (left <= 0) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

let prepareTail: Promise<void> = Promise.resolve();
let restoreSequence = 0;

export function captureWindowForControl(store: ShellStore, windowId: string, requestId: string, rootElement?: HTMLElement): Promise<{ image_base64: string; geometry: WindowGeometry }> {
  return captureIsolated(store, windowId, () => rootElement ?? active.get(windowId)?.element, false, async (bounds) => {
    const reply = await store.call({ op: "window.control.capture", request_id: requestId, window_id: windowId, bounds });
    if (reply.op !== "window.control.capture") throw toCoreError("창 캡처 응답이 올바르지 않습니다.");
    return { image_base64: reply.image_base64, geometry: reply.geometry };
  });
}

export function captureWindowForComment(store: ShellStore, windowId: string, contentElement: HTMLElement, targetRect: AppCommentRect): Promise<AppCommentImage> {
  return captureIsolated(store, windowId, () => contentElement, true, async (bounds) => {
    const reply = await store.call({ op: "comment.capture", window_id: windowId, bounds, surface_bounds: webSurfaceBounds(windowId, store), target_rect: targetRect });
    if (reply.op !== "comment.capture") throw errors.COMMENT_CAPTURE_IMAGE_UNAVAILABLE();
    return reply.image;
  });
}

function captureIsolated<T>(store: ShellStore, windowId: string, getElement: () => HTMLElement | undefined, comment: boolean, capture: (bounds: Rect) => Promise<T>): Promise<T> {
  const run = prepareTail.then(async () => {
    const element = getElement();
    const frame = element?.closest<HTMLElement>(".ks-window");
    const rect = element?.getBoundingClientRect();
    if (!element || !frame || (comment && !element.isConnected)) throw comment ? errors.COMMENT_CAPTURE_WINDOW_NOT_FOUND() : errors.SHELL_WINDOW_CONTROL_TARGET_HIDDEN({ target: "창" });
    if (!rect?.width || !rect.height) throw comment ? errors.COMMENT_CAPTURE_IMAGE_UNAVAILABLE() : errors.SHELL_WINDOW_CONTROL_TARGET_HIDDEN({ target: "창" });
    const frozen = await store.call({ op: "share.freeze" }).catch((error: unknown) => { throw comment ? errors.COMMENT_CAPTURE_FREEZE_FAILED() : error; });
    if (frozen.op !== "share.freeze" || !frozen.frozen) throw comment ? errors.COMMENT_CAPTURE_FREEZE_FAILED() : toCoreError("창 화면을 고정할 수 없습니다.");
    const root = document.documentElement;
    const overlays = ownedOverlays(windowId);
    let restoreWeb: () => Promise<void> = async () => undefined;
    try {
      root.dataset.shareIsolating = "true";
      frame.dataset.shareTarget = "true";
      for (const overlay of overlays) overlay.setAttribute("data-share-target", "true");
      restoreWeb = await revealWebSurface(windowId, store);
      await twoFrames();
      const current = element.getBoundingClientRect();
      const bounds = { x: Math.round(current.x), y: Math.round(current.y), width: Math.round(current.width), height: Math.round(current.height) };
      return await capture(bounds);
    } finally {
      try { await restoreWeb(); } catch { /* 화면 고정 해제는 계속한다. */ }
      delete frame.dataset.shareTarget;
      for (const overlay of overlays) overlay.removeAttribute("data-share-target");
      delete root.dataset.shareIsolating;
      try { await restoredOnScreen(); } finally { await store.call({ op: "share.unfreeze" }); }
    }
  });
  prepareTail = run.then(() => undefined, () => undefined);
  return run;
}

export function prepareShareForSend(store: ShellStore): Promise<void> {
  const run = prepareTail.then(() => prepareOnce(store)).catch(() => undefined);
  prepareTail = run;
  return run;
}

async function prepareOnce(store: ShellStore): Promise<void> {
  await flushShareViews();
  const targets = Array.from(active.entries()).filter(([, entry]) =>
    entry.element.getClientRects().length > 0
      && entry.last?.visual === true
      && entry.last.occluded,
  );
  if (targets.length === 0) return;

  await twoFrames();

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
    try { await restoredOnScreen(); } catch { /* 표시 대기 실패도 해제를 막지 않는다. */ }
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
    const unregisterControl = registerControlWindow(windowId, element, store);
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
      unregisterControl();
      if (active.get(windowId) === entry) active.delete(windowId);
      observer.disconnect(); frameObserver.disconnect(); canvasObserver.disconnect(); resize.disconnect();
      element.removeEventListener("scroll", onScroll, true); element.removeEventListener("input", schedule, true); window.removeEventListener("resize", schedule);
    };
  }, [enabled, root, store, windowId]);
}
