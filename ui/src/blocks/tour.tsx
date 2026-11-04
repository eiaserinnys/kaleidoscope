import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Block, TourStep } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { Button } from "../components/primitives";
import { BindingFailureNotice } from "../components/data-state";
import { registerTourShortcuts } from "../runtime/shortcuts";
import { getAnchorElement, subscribeAnchor } from "./anchor-registry";
import { nearestScrollable, revealIn } from "./scroll-nearest";

export type TourBlockData = Extract<Block, { type: "tour" }>;
export type TourCloseResult = "completed" | "skipped";

interface TourPlacement {
  left: number;
  top: number;
  targetLeft: number;
  targetTop: number;
  targetWidth: number;
  targetHeight: number;
}

export function moveTourStep(data: ReturnType<typeof useWindowData>, pointer: string, key: string) {
  return data.act(`${pointer}/on_step`, key);
}

export function closeTour(data: ReturnType<typeof useWindowData>, pointer: string, result: TourCloseResult) {
  return data.act(`${pointer}/on_close`, result);
}

export function TourBlock({ block, context, pointer }: { block: TourBlockData; context: BlockContext; pointer: string }) {
  const data = useWindowData();
  const open = useBinding(`${pointer}/open`, block.open);
  const current = useBinding(`${pointer}/step`, block.step);
  const isOpen = open.status === "ready" && open.value === true;
  const rawKey = current.status === "ready" && typeof current.value === "string" ? current.value : "";
  const foundIndex = block.steps.findIndex((step) => step.key === rawKey);
  const index = foundIndex >= 0 ? foundIndex : 0;
  const step = block.steps[index] ?? null;
  const stepKey = step?.target ?? "";
  const subscribe = useCallback((listener: () => void) =>
    stepKey ? subscribeAnchor(context.window.id, stepKey, listener) : () => {}, [context.window.id, stepKey]);
  const getSnapshot = useCallback(() => stepKey ? getAnchorElement(context.window.id, stepKey) : null, [context.window.id, stepKey]);
  const target = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const title = useBinding(`${pointer}/steps/${index}/title`, step?.title ?? null);
  const body = useBinding(`${pointer}/steps/${index}/body`, step?.body ?? null);
  const previousLabel = useBinding(`${pointer}/labels/previous`, block.labels?.previous ?? null);
  const nextLabel = useBinding(`${pointer}/labels/next`, block.labels?.next ?? null);
  const doneLabel = useBinding(`${pointer}/labels/done`, block.labels?.done ?? null);
  const skipLabel = useBinding(`${pointer}/labels/skip`, block.labels?.skip ?? null);
  const titleText = title.status === "ready" && title.value !== null ? display(title.value) : "";
  const bodyText = body.status === "ready" && body.value !== null ? display(body.value) : "";
  const previousText = boundLabel(previousLabel, "이전");
  const nextText = boundLabel(nextLabel, "다음");
  const doneText = boundLabel(doneLabel, "끝내기");
  const skipText = boundLabel(skipLabel, "건너뛰기");
  const host = target?.closest<HTMLElement>(".ks-data-window") ?? null;
  const overlay = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const lastScrollTarget = useRef<Element | null>(null);
  const [placement, setPlacement] = useState<TourPlacement | null>(null);

  const reposition = useCallback(() => {
    const overlayElement = overlay.current;
    const cardElement = card.current;
    if (!isOpen || !step || !target || !host || !overlayElement || !cardElement) {
      setPlacement(null);
      return;
    }
    let targetRect = target.getBoundingClientRect();
    const clip = host.querySelector<HTMLElement>(".ks-data-window-body")?.getBoundingClientRect() ?? host.getBoundingClientRect();
    const outside = targetRect.left < clip.left || targetRect.right > clip.right || targetRect.top < clip.top || targetRect.bottom > clip.bottom;
    if (target.getClientRects().length === 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      setPlacement(null);
      return;
    }
    if (outside && lastScrollTarget.current !== target) {
      lastScrollTarget.current = target;
      if (target instanceof HTMLElement) {
        for (const horizontal of [false, true]) {
          let parent = target.parentElement;
          while (parent) {
            const scroller = nearestScrollable(parent, horizontal);
            if (!scroller) break;
            revealIn(target, scroller, horizontal);
            parent = scroller.parentElement;
          }
        }
      }
      targetRect = target.getBoundingClientRect();
    } else if (!outside) {
      lastScrollTarget.current = null;
    }

    const overlayRect = overlayElement.getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(host).getPropertyValue("--ks-space-2")) || 0;
    const belowSpace = overlayRect.bottom - targetRect.bottom;
    const aboveSpace = targetRect.top - overlayRect.top;
    const side = belowSpace >= cardRect.height + gap || belowSpace >= aboveSpace ? "below" : "above";
    const rawTop = side === "below"
      ? targetRect.bottom - overlayRect.top + gap
      : targetRect.top - overlayRect.top - gap - cardRect.height;
    const frame = host.parentElement?.getBoundingClientRect() ?? host.getBoundingClientRect();
    const fit = (value: number, overlaySize: number, cardSize: number, start: number, end: number) => {
      const lower = Math.max(0, start);
      const upper = Math.min(overlaySize - cardSize, end - cardSize);
      return lower <= upper ? Math.max(lower, Math.min(value, upper)) : Math.max(start, Math.min(value, end - cardSize));
    };
    const next: TourPlacement = {
      left: fit(targetRect.left - overlayRect.left, overlayElement.clientWidth, cardRect.width, frame.left - overlayRect.left, frame.right - overlayRect.left),
      top: fit(rawTop, overlayElement.clientHeight, cardRect.height, frame.top - overlayRect.top, frame.bottom - overlayRect.top),
      targetLeft: targetRect.left - overlayRect.left,
      targetTop: targetRect.top - overlayRect.top,
      targetWidth: targetRect.width,
      targetHeight: targetRect.height,
    };
    setPlacement((previous) => previous && Object.keys(next).every((key) =>
      Math.abs(previous[key as keyof TourPlacement] - next[key as keyof TourPlacement]) < 0.5) ? previous : next);
  }, [host, isOpen, step, target]);

  useLayoutEffect(() => {
    if (!isOpen || !step || !target || !host) {
      setPlacement(null);
      return;
    }
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(target);
    observer.observe(host);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [host, isOpen, reposition, step, target, titleText, bodyText]);

  useEffect(() => {
    if (!isOpen || !step) return;
    return registerTourShortcuts(context, {
      previous: () => { const previous = block.steps[index - 1]; if (previous) void moveTourStep(data, pointer, previous.key); },
      next: () => { const next = block.steps[index + 1]; if (next) void moveTourStep(data, pointer, next.key); else void closeTour(data, pointer, "completed"); },
      close: () => { void closeTour(data, pointer, "skipped"); },
    });
  }, [isOpen, step, target, host, context, block.steps, index, data, pointer]);

  if (!isOpen || !step || !target || !host) return null;
  const isLast = index === block.steps.length - 1;
  const nextStep = block.steps[index + 1];
  const previousStep = block.steps[index - 1];
  const onClose = (result: TourCloseResult) => { void closeTour(data, pointer, result); };
  const onStep = (next: TourStep | undefined) => { if (next) void moveTourStep(data, pointer, next.key); };

  return createPortal(<div className="ks-tour-overlay" data-ks-overlay ref={overlay}>
    {placement ? <div className="ks-tour-spotlight" style={{
      left: placement.targetLeft,
      top: placement.targetTop,
      width: placement.targetWidth,
      height: placement.targetHeight,
    }} /> : null}
    <section
      aria-labelledby={`${pointer.replaceAll("/", "-")}-tour-title`}
      className="ks-tour-card"
      ref={card}
      role="region"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}
    >
      <div className="ks-tour-step-count">{index + 1} / {block.steps.length}</div>
      <h2 className="ks-tour-title" id={`${pointer.replaceAll("/", "-")}-tour-title`}>{titleText}</h2>
      <BindingFailureNotice value={title} />
      {bodyText ? <div className="ks-tour-body">{bodyText}</div> : null}
      <div className="ks-tour-actions">
        <Button disabled={!previousStep} onClick={() => onStep(previousStep)}>{previousText}</Button>
        {isLast
          ? <Button variant="emphasis" onClick={() => onClose("completed")}>{doneText}</Button>
          : <Button variant="emphasis" onClick={() => onStep(nextStep)}>{nextText}</Button>}
        <Button onClick={() => onClose("skipped")}>{skipText}</Button>
      </div>
      <BindingFailureNotice value={previousLabel} />
      <BindingFailureNotice value={nextLabel} />
      <BindingFailureNotice value={doneLabel} />
      <BindingFailureNotice value={skipLabel} />
    </section>
  </div>, host);
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function boundLabel(value: ReturnType<typeof useBinding>, fallback: string): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : fallback;
}
