import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import type { Block } from "../contract/contract";
import { useBinding, useWindowData } from "../data/window-data";
import { useShareDescriber } from "../share/visible";

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
  const data = useWindowData();
  const generation = useSyncExternalStore(data.subscribeClient, data.getClientGeneration, data.getClientGeneration);
  const root = useRef<HTMLDivElement>(null);
  const rect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const ratio = useBinding(`${pointer}/aspect_ratio`, block.aspect_ratio ?? null);
  const aspect = ratio.status === "ready" && typeof ratio.value === "number" && Number.isFinite(ratio.value) && ratio.value > 0 ? ratio.value : undefined;
  const description = useBinding(`${pointer}/description`, block.description ?? null);
  const text = description.status === "ready" && typeof description.value === "string" ? description.value : "";
  useShareDescriber(root, () => ({ text, visual: true }));
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const element = document.createElement("canvas");
    host.appendChild(element);
    if (!element.transferControlToOffscreen) { data.setNotice("이 환경은 캔버스 전송을 지원하지 않습니다"); element.remove(); return; }
    let attachedGeneration: number | undefined;
    const update = () => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const next = canvasRect(bounds.width, bounds.height, aspect, block.fit ?? "contain");
      rect.current = next;
      Object.assign(element.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
      const dpr = surfaceDpr(next.width, next.height, window.devicePixelRatio || 1);
      if (attachedGeneration === undefined) {
        element.width = Math.max(1, Math.round(next.width * dpr));
        element.height = Math.max(1, Math.round(next.height * dpr));
        attachedGeneration = data.attachSurface(block.surface, element.transferControlToOffscreen(), next.width, next.height, dpr);
      } else data.resizeSurface(block.surface, attachedGeneration, next.width, next.height, dpr);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => { observer.disconnect(); if (attachedGeneration !== undefined) data.detachSurface(block.surface, attachedGeneration); element.remove(); };
  }, [block.surface, aspect, block.fit, data, generation]);

  const pointerEvent = (phase: "down" | "move" | "up" | "cancel", event: PointerEvent<HTMLDivElement>) => {
    if (!block.on_pointer || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const point = canvasPoint(rect.current, event.clientX - bounds.left, event.clientY - bounds.top);
    if (phase === "down" && !point) return;
    if (phase === "down") event.currentTarget.setPointerCapture(event.pointerId);
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left - rect.current.x) / rect.current.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top - rect.current.y) / rect.current.height));
    void data.act(`${pointer}/on_pointer`, { phase, pointer_id: event.pointerId, x, y, buttons: event.buttons, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey });
  };
  return <div ref={root} className="ks-canvas" role="img" aria-label={text || "캔버스"} style={{ "--ks-canvas-ratio": aspect } as CSSProperties}
    onPointerDown={(event) => pointerEvent("down", event)} onPointerMove={(event) => pointerEvent("move", event)}
    onPointerUp={(event) => pointerEvent("up", event)} onPointerCancel={(event) => pointerEvent("cancel", event)} />;
}
