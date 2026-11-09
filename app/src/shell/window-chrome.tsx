import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from "react";
import { IconButton, Maximize2, Minus, Minimize2, X, openContextMenu, type MenuEntry, type Rect } from "@kaleidoscope/ui";
import { fitWindowRect, resizeWindowRect, usableWindowArea, RESIZE_EDGES, type WindowResizeEdge } from "./window-geometry";

export interface WindowChromeProps {
  area: { width: number; height: number }; rect: Rect; maximized: boolean; minimized: boolean;
  zIndex: number; isTop: boolean; title: string; meta?: string | null; icon: ReactNode;
  titleActions?: ReactNode; menuEntries: MenuEntry[]; onRaise: () => void; onMinimize: () => void;
  onMaximize: () => void; onRestore: () => void; onClose: () => void;
  onRectCommit: (rect: Rect) => Promise<boolean>; testId: string; frameRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>; pointerGuard?: (event: PointerEvent<HTMLElement>) => boolean;
  sharing?: boolean; commenting?: boolean; children: ReactNode; overlays?: ReactNode; outerOverlays?: ReactNode;
  windowId?: string;
}

type Gesture = {
  kind: "move" | WindowResizeEdge;
  pointerId: number;
  startX: number;
  startY: number;
  // 화면에 그린 rect를 조작과 저장의 기준으로 쓴다.
  startRect: Rect;
};

const MIN_WIDTH = "--ks-window-min-width";
const MIN_HEIGHT = "--ks-window-min-height";

export function WindowChrome({ area, rect, maximized, minimized, zIndex, isTop, title, meta, icon, titleActions, menuEntries, onRaise, onMinimize, onMaximize, onRestore, onClose, onRectCommit, testId, frameRef, contentRef, pointerGuard, sharing, commenting, children, overlays, outerOverlays, windowId }: WindowChromeProps) {
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
      next = resizeWindowRect(gesture.startRect, RESIZE_EDGES[gesture.kind], dx, dy, {
        width: tokenPixels(MIN_WIDTH, titleRef.current),
        height: tokenPixels(MIN_HEIGHT, titleRef.current),
      }, usableWindowArea(area));
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
    const changed = next.x !== gesture.startRect.x || next.y !== gesture.startRect.y
      || next.width !== gesture.startRect.width || next.height !== gesture.startRect.height;
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
    data-testid={testId} data-window-id={windowId} inert={minimized}
    onPointerDownCapture={(event) => {
      if (pointerGuard?.(event)) return;
      if (isTop) return;
      // 최소화와 닫기는 누르는 순간 창을 올리지 않는다. 올리기 요청이 뒤늦게 도착하면
      // 펼쳐지거나 닫으려던 창이 다시 나타난다.
      if (event.target instanceof Element && event.target.closest('[data-window-control="minimize"], [data-window-control="close"]')) return;
      // 사용자가 다른 창을 고르면 가려지는 창의 입력칸이 초점을 쥐고 있지 않게 한다.
      // 초점이 없으면 맨 위가 되는 순간 window-focus가 이 창의 마지막 초점이나 첫 내용으로 옮긴다.
      const active = document.activeElement;
      if (active instanceof HTMLElement && !event.currentTarget.contains(active)) active.blur();
      onRaise();
    }}
    onPointerMove={moveGesture} onPointerUp={finishGesture} onPointerCancel={cancelGesture}
    style={{ left: displayRect.x, top: displayRect.y, width: displayRect.width, height: displayRect.height, zIndex }}>
    <div className={`ks-window-frame${isTop ? " ks-window-frame-active" : ""}`} ref={frameRef}>
      <header className={`ks-window-titlebar${isTop ? " ks-window-titlebar-active" : ""}`}
        onContextMenu={(event) => openContextMenu(event, menuEntries)}
        onMouseDown={(event) => { if (!(event.target instanceof Element && event.target.closest("button"))) event.preventDefault(); }}
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
          <IconButton aria-label="창 최소화" data-window-control="minimize" title="창 최소화" onClick={onMinimize}><Minus size="chrome" /></IconButton>
          <IconButton aria-label={maximized ? "이전 크기로 복원" : "창 최대화"} title={maximized ? "이전 크기로 복원" : "창 최대화"} onClick={maximized ? onRestore : onMaximize}>{maximized ? <Minimize2 size="chrome" /> : <Maximize2 size="chrome" />}</IconButton>
          <IconButton aria-label="창 닫기" data-window-control="close" title="창 닫기" onClick={onClose}><X size="chrome" /></IconButton>
        </div>
      </header>
      <div className="ks-window-content" ref={contentRef} tabIndex={-1}>{children}</div>
      {overlays}
    </div>
    {outerOverlays}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-north" onPointerDown={(event) => beginGesture("north", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-south" onPointerDown={(event) => beginGesture("south", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-east" onPointerDown={(event) => beginGesture("east", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-west" onPointerDown={(event) => beginGesture("west", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-north-east" onPointerDown={(event) => beginGesture("north-east", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-north-west" onPointerDown={(event) => beginGesture("north-west", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-south-east" onPointerDown={(event) => beginGesture("south-east", event)} /> : null}
    {!maximized ? <div aria-hidden="true" className="ks-window-resize-south-west" onPointerDown={(event) => beginGesture("south-west", event)} /> : null}
  </section>;
}

function tokenPixels(name: string, element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
}
