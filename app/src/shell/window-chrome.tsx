import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from "react";
import { IconButton, Maximize2, Minus, Minimize2, X, openContextMenu, type MenuEntry, type Rect } from "@kaleidoscope/ui";
import { fitWindowRect, usableWindowArea } from "./window-geometry";

export interface WindowChromeProps {
  area: { width: number; height: number }; rect: Rect; maximized: boolean; minimized: boolean;
  zIndex: number; isTop: boolean; title: string; meta?: string | null; icon: ReactNode;
  titleActions?: ReactNode; menuEntries: MenuEntry[]; onRaise: () => void; onMinimize: () => void;
  onMaximize: () => void; onRestore: () => void; onClose: () => void;
  onRectCommit: (rect: Rect) => Promise<boolean>; testId: string; frameRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>; pointerGuard?: (event: PointerEvent<HTMLElement>) => boolean;
  sharing?: boolean; commenting?: boolean; children: ReactNode; overlays?: ReactNode; outerOverlays?: ReactNode;
}

type Gesture = {
  kind: "move" | "east" | "south" | "corner";
  pointerId: number;
  startX: number;
  startY: number;
  // 화면에 그린 rect를 조작과 저장의 기준으로 쓴다.
  startRect: Rect;
};

const MIN_WIDTH = "--ks-window-min-width";
const MIN_HEIGHT = "--ks-window-min-height";

export function WindowChrome({ area, rect, maximized, minimized, zIndex, isTop, title, meta, icon, titleActions, menuEntries, onRaise, onMinimize, onMaximize, onRestore, onClose, onRectCommit, testId, frameRef, contentRef, pointerGuard, sharing, commenting, children, overlays, outerOverlays }: WindowChromeProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const displayRect = maximized ? usableWindowArea(area) : fitWindowRect(preview ?? rect, area);
  useEffect(() => {
    const pending = previewRef.current;
    if (gestureRef.current || !pending || pending.x !== rect.x || pending.y !== rect.y
      || pending.width !== rect.width || pending.height !== rect.height) return;
    previewRef.current = null;
    setPreview(null);
  }, [rect.x, rect.y, rect.width, rect.height]);

  const beginGesture = (kind: Gesture["kind"], event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startRect = displayRect;
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect,
    };
    previewRef.current = startRect;
    setPreview(startRect);
  };

  const moveGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    let next: Rect;

    if (gesture.kind === "move") {
      next = fitWindowRect({
        ...gesture.startRect,
        x: gesture.startRect.x + dx,
        y: gesture.startRect.y + dy,
      }, area);
    } else {
      const minWidth = tokenPixels(MIN_WIDTH, titleRef.current);
      const minHeight = tokenPixels(MIN_HEIGHT, titleRef.current);
      const usable = usableWindowArea(area);
      const maxWidth = usable.x + usable.width - gesture.startRect.x;
      const maxHeight = usable.y + usable.height - gesture.startRect.y;
      next = {
        ...gesture.startRect,
        width: gesture.kind === "south" ? gesture.startRect.width : clamp(Math.round(gesture.startRect.width + dx), Math.min(minWidth, maxWidth), maxWidth),
        height: gesture.kind === "east"
          ? gesture.startRect.height
          : clamp(Math.round(gesture.startRect.height + dy), Math.min(minHeight, maxHeight), maxHeight),
      };
    }

    previewRef.current = next;
    setPreview(next);
  };

  const finishGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const next = fitWindowRect(previewRef.current ?? gesture.startRect, area);
    previewRef.current = next;
    const changed = gesture.kind === "move"
      ? next.x !== gesture.startRect.x || next.y !== gesture.startRect.y
      : gesture.kind === "east"
        ? next.width !== gesture.startRect.width
        : gesture.kind === "south"
          ? next.height !== gesture.startRect.height
          : next.width !== gesture.startRect.width || next.height !== gesture.startRect.height;
    if (changed) {
      void onRectCommit(next).then((accepted) => {
        if (!accepted && !gestureRef.current && previewRef.current === next) {
          previewRef.current = null;
          setPreview(null);
        }
      });
    } else {
      previewRef.current = null;
      setPreview(null);
    }
  };

  const cancelGesture = (event: PointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    previewRef.current = null;
    setPreview(null);
  };

  return <section className={`ks-window${preview ? " ks-window-gesturing" : ""}${sharing ? " ks-window-sharing" : ""}`}
    data-maximized={maximized ? "true" : "false"} data-minimized={minimized ? "true" : "false"} data-commenting={commenting || undefined}
    data-testid={testId} inert={minimized}
    onPointerDownCapture={(event) => { if (pointerGuard?.(event)) return; if (!isTop) onRaise(); }}
    onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture}
    style={{ left: displayRect.x, top: displayRect.y, width: displayRect.width, height: displayRect.height, zIndex }}>
    <div className={`ks-window-frame${isTop ? " ks-window-frame-active" : ""}`} ref={frameRef}>
      <header className={`ks-window-titlebar${isTop ? " ks-window-titlebar-active" : ""}`}
        onContextMenu={(event) => openContextMenu(event, menuEntries)}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button")) || maximized) return;
          beginGesture("move", event);
        }}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          if (maximized) onRestore(); else onMaximize();
        }} ref={titleRef}>
        {icon}
        <div className="ks-window-title-group"><span className="ks-window-title" title={title}>{title}</span>
          {meta ? <span className="ks-window-title-meta" title={meta}>{meta}</span> : null}</div>
        <div className="ks-window-title-actions">{titleActions}
          <IconButton aria-label="창 최소화" title="창 최소화" onClick={onMinimize}><Minus size="chrome" /></IconButton>
          <IconButton aria-label={maximized ? "이전 크기로 복원" : "창 최대화"} title={maximized ? "이전 크기로 복원" : "창 최대화"} onClick={maximized ? onRestore : onMaximize}>{maximized ? <Minimize2 size="chrome" /> : <Maximize2 size="chrome" />}</IconButton>
          <IconButton aria-label="창 닫기" title="창 닫기" onClick={onClose}><X size="chrome" /></IconButton>
        </div>
      </header>
      <div className="ks-window-content" ref={contentRef} tabIndex={-1}>{children}</div>
      {overlays}
    </div>
    {outerOverlays}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-east" onPointerDown={(event) => beginGesture("east", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-south" onPointerDown={(event) => beginGesture("south", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-corner" onPointerDown={(event) => beginGesture("corner", event)} /> : null}
  </section>;
}

function tokenPixels(name: string, element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
