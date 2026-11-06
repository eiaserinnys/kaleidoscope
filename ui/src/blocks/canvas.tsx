import { useBlockRootProps } from "../comments/block-root";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import type { Block } from "../contract/contract";
import { useBinding, useWindowData } from "../data/window-data";
import { createSerialSend } from "../data/throttled-send";
import { useShareDescriber } from "../share/visible";
import { capturePointer } from "../share/pointer-capture";
import * as shellErrors from "../contract/shell-errors";
import { progressIndicator } from "./progress";

type Rect = { x: number; y: number; width: number; height: number };
type CanvasBlockData = Extract<Block, { type: "canvas" }>;

export function canvasRect(width: number, height: number, aspect: number | undefined, fit: "contain" | "cover"): Rect {
  if (!aspect || width <= 0 || height <= 0) return { x: 0, y: 0, width, height };
  const byWidth = width / aspect;
  const useWidth = fit === "contain" ? byWidth <= height : byWidth >= height;
  const w = useWidth ? width : height * aspect;
  const h = useWidth ? byWidth : height;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function canvasPoint(rect: Rect, x: number, y: number): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) return null;
  return { x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height };
}

export function surfaceDpr(width: number, height: number, dpr: number) {
  return Math.min(2, dpr, Math.sqrt(8_294_400 / Math.max(1, width * height)));
}

export function CanvasBlock({ block, pointer }: { block: CanvasBlockData; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const surfaceValue = useBinding(`${pointer}/surface`, block.surface);
  const surface = surfaceValue.status === "ready" && typeof surfaceValue.value === "string" ? surfaceValue.value : "";
  const generation = useSyncExternalStore(data.subscribeClient, data.getClientGeneration, data.getClientGeneration);
  const serialSend = useMemo(() => createSerialSend((value: Record<string, string | number | boolean>) => data.act(`${pointer}/on_pointer`, value)), [data, pointer]);
  const root = useRef<HTMLDivElement>(null);
  const rect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const ratio = useBinding(`${pointer}/aspect_ratio`, block.aspect_ratio ?? null);
  const aspect = ratio.status === "ready" && typeof ratio.value === "number" && Number.isFinite(ratio.value) && ratio.value > 0 ? ratio.value : undefined;
  const aspectRef = useRef(aspect);
  const updateSurface = useRef<(() => void) | null>(null);
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<Record<string, string | number | boolean> | null>(null);
  const description = useBinding(`${pointer}/description`, block.description ?? null);
  const loading = useBinding(`${pointer}/loading`, block.loading ?? false);
  const isLoading = loading.status === "ready" && loading.value === true;
  const text = description.status === "ready" && typeof description.value === "string" ? description.value : "";
  useShareDescriber(root, () => ({ text, visual: true }));
  const flushMove = () => {
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = null;
    const pending = pendingMove.current;
    pendingMove.current = null;
    if (pending) serialSend(pending, { coalesce: true });
  };
  useEffect(() => () => flushMove(), [data, pointer, serialSend]);
  useEffect(() => {
    const host = root.current;
    if (!host || !surface) return;
    const element = document.createElement("canvas");
    host.appendChild(element);
    if (!element.transferControlToOffscreen) { data.setNotice(shellErrors.SHELL_CANVAS_TRANSFER_UNSUPPORTED()); element.remove(); return; }
    let attachedGeneration: number | undefined;
    let attempted = false;
    let intersecting = typeof IntersectionObserver === "undefined";
    const update = () => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const next = canvasRect(bounds.width, bounds.height, aspectRef.current, block.fit ?? "contain");
      rect.current = next;
      Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
      const dpr = surfaceDpr(next.width, next.height, window.devicePixelRatio || 1);
      if (!attempted) {
        attempted = true;
        element.width = Math.max(1, Math.round(next.width * dpr));
        element.height = Math.max(1, Math.round(next.height * dpr));
        attachedGeneration = data.attachSurface(surface, element.transferControlToOffscreen(), next.width, next.height, dpr, intersecting);
      } else if (attachedGeneration !== undefined) data.resizeSurface(surface, attachedGeneration, next.width, next.height, dpr);
    };
    updateSurface.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      intersecting = entries[0]?.isIntersecting ?? false;
      if (attachedGeneration !== undefined) data.setSurfaceVisible(surface, attachedGeneration, intersecting);
    });
    intersection?.observe(host);
    return () => { updateSurface.current = null; observer.disconnect(); intersection?.disconnect(); if (attachedGeneration !== undefined) data.detachSurface(surface, attachedGeneration); element.remove(); };
  }, [surface, block.fit, data, generation]);
  useLayoutEffect(() => {
    if (aspectRef.current === aspect) return;
    aspectRef.current = aspect;
    updateSurface.current?.();
  }, [aspect]);

  const pointerEvent = (phase: "down" | "move" | "up" | "cancel", event: PointerEvent<HTMLDivElement>) => {
    if (!block.on_pointer || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const point = canvasPoint(rect.current, event.clientX - bounds.left, event.clientY - bounds.top);
    if (phase === "down" && !point) return;
    if (phase === "down") capturePointer(event);
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left - rect.current.x) / rect.current.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top - rect.current.y) / rect.current.height));
    const value = { phase, pointer_id: event.pointerId, x, y, buttons: event.buttons, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
    if (phase === "move") {
      pendingMove.current = value;
      if (moveFrame.current === null) moveFrame.current = requestAnimationFrame(flushMove);
      return;
    }
    flushMove();
    serialSend(value, { coalesce: false });
  };
  const label = text || "캔버스";
  return <div {...blockRoot} ref={root} className="ks-canvas" role="img" aria-label={isLoading ? `${label}, 불러오는 중` : label} aria-busy={isLoading || undefined} style={{ "--ks-canvas-ratio": aspect ? Math.max(aspect, 1) : undefined, "--ks-canvas-native-ratio": aspect } as CSSProperties}
    onPointerDown={(event) => pointerEvent("down", event)} onPointerMove={(event) => pointerEvent("move", event)}
    onPointerUp={(event) => pointerEvent("up", event)} onPointerCancel={(event) => pointerEvent("cancel", event)}>
    {isLoading ? <div className="ks-canvas-loading" aria-hidden="true">{progressIndicator(null, 1, null)}</div> : null}
  </div>;
}
