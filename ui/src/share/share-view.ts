import { useEffect, type RefObject } from "react";
import { SHARE_DEBOUNCE_MS } from "../contract/limits";
import type { VisibleView, WindowGeometry } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import * as errors from "../contract/shell-errors";
import { clientShare } from "../runtime/client-runtime";
import { isFullyVisible, revealWebSurface } from "../blocks/web-surface-layer";
import { describeVisible, limitShareText } from "./visible";
import { registerControlWindow } from "./window-control";
import { ownedOverlays } from "./overlay-owner";

const SHARE_ISOLATE_BUDGET_MS = 2_500;
const RAF_TIMEOUT_MS = 100;
// 격리를 푼 배치가 화면에 나갈 때까지 기다리는 프레임 수와 상한. 상한은 네이티브 덮개 자동 해제(5초)보다 짧다.
const RESTORE_FRAMES = 3;
const RESTORE_FRAME_LIMIT_MS = 1_000;

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
 * 덮개를 걷기 전에 격리를 푼 배치가 실제로 그려지기를 기다린다.
 * rAF 콜백 두 번은 그 프레임이 화면에 나갔다는 보장이 아니다. 늦게 돈 메인 프레임 바로 뒤에 다음 프레임이 붙어
 * 두 번이 8ms 안에 끝난 실측이 있고, 그대로 덮개를 걷으면 격리 배치가 한두 프레임 보였다(카드 #1032).
 * 프레임마다 시한을 두면 그리기가 느릴 때 프레임 없이 끝나므로 실제 프레임 세 번을 기다리고,
 * 창이 최소화되어 프레임이 오지 않을 때만 전체 상한에서 넘어간다.
 */
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
    const limit = setTimeout(finish, RESTORE_FRAME_LIMIT_MS);
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

export function captureWindowForControl(store: ShellStore, windowId: string, requestId: string, rootElement?: HTMLElement): Promise<{ image_base64: string; geometry: WindowGeometry }> {
  const run = prepareTail.then(async () => {
    const element = rootElement ?? active.get(windowId)?.element;
    const frame = element?.closest<HTMLElement>(".ks-window");
    const rect = element?.getBoundingClientRect();
    if (!element || !frame || !rect?.width || !rect.height) throw errors.SHELL_WINDOW_CONTROL_TARGET_HIDDEN({ target: "창" });
    const frozen = await store.call({ op: "share.freeze" });
    if (frozen.op !== "share.freeze" || !frozen.frozen) throw toCoreError("창 화면을 고정할 수 없습니다.");
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
      const reply = await store.call({ op: "window.control.capture", request_id: requestId, window_id: windowId, bounds });
      if (reply.op !== "window.control.capture") throw toCoreError("창 캡처 응답이 올바르지 않습니다.");
      return { image_base64: reply.image_base64, geometry: reply.geometry };
    } finally {
      try { await restoreWeb(); } catch { /* 화면 고정 해제는 계속한다. */ }
      delete frame.dataset.shareTarget;
      for (const overlay of overlays) overlay.removeAttribute("data-share-target");
      delete root.dataset.shareIsolating;
      try { await restoredFrames(); } finally { await store.call({ op: "share.unfreeze" }); }
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
    try { await restoredFrames(); } catch { /* 프레임 대기 실패도 해제를 막지 않는다. */ }
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
