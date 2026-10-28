import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { IconButton, type ShellStore, type AppWindow, type Rect } from "@kaleidoscope/ui";
import { CloseIcon } from "./icons";

export interface WindowFrameProps {
  area: { width: number; height: number };
  appName: string;
  isTop: boolean;
  onCall: ShellStore["call"];
  window: AppWindow;
  children: ReactNode;
}

type Gesture = {
  kind: "move" | "east" | "south" | "corner";
  pointerId: number;
  startX: number;
  startY: number;
  // 화면에 그린 rect를 조작 기준으로 쓰고, 이동은 저장된 크기를 보존한다.
  startRect: Rect;
};

const MIN_WIDTH = "--ks-window-min-width";
const MIN_HEIGHT = "--ks-window-min-height";
const VISIBLE_WIDTH = "--ks-window-visible-width";

export function WindowFrame({ area, appName, isTop, onCall, window: appWindow, children }: WindowFrameProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const displayRect = preview ?? clampSavedRect(appWindow.rect, area, titleRef.current);
  const bottomEdge = displayRect.y + displayRect.height >= area.height;

  const beginGesture = (kind: Gesture["kind"], event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startRect = previewRef.current ?? displayRect;
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
      const visibleWidth = tokenPixels(VISIBLE_WIDTH, titleRef.current);
      next = clampWindowPosition({
        ...gesture.startRect,
        x: gesture.startRect.x + dx,
        y: gesture.startRect.y + dy,
      }, area, visibleWidth);
    } else {
      const minWidth = tokenPixels(MIN_WIDTH, titleRef.current);
      const minHeight = tokenPixels(MIN_HEIGHT, titleRef.current);
      const maxHeight = Math.max(minHeight, area.height - gesture.startRect.y);
      next = {
        ...gesture.startRect,
        width: gesture.kind === "south" ? gesture.startRect.width : Math.max(minWidth, Math.round(gesture.startRect.width + dx)),
        height: gesture.kind === "east"
          ? gesture.startRect.height
          : clamp(Math.round(gesture.startRect.height + dy), minHeight, maxHeight),
      };
    }

    previewRef.current = next;
    setPreview(next);
  };

  const finishGesture = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const next = previewRef.current ?? gesture.startRect;
    previewRef.current = null;
    setPreview(null);
    const changed = gesture.kind === "move"
      ? next.x !== gesture.startRect.x || next.y !== gesture.startRect.y
      : gesture.kind === "east"
        ? next.width !== gesture.startRect.width
        : gesture.kind === "south"
          ? next.height !== gesture.startRect.height
          : next.width !== gesture.startRect.width || next.height !== gesture.startRect.height;
    if (changed) {
      const rect = gesture.kind === "move"
        ? { ...appWindow.rect, x: next.x, y: next.y }
        : gesture.kind === "east"
          ? { ...appWindow.rect, width: next.width }
          : gesture.kind === "south"
            ? { ...appWindow.rect, height: next.height }
            : { ...appWindow.rect, width: next.width, height: next.height };
      void onCall({ op: "window.set_rect", window_id: appWindow.id, rect });
    }
  };

  const cancelGesture = (event: PointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    previewRef.current = null;
    setPreview(null);
  };

  return (
    <section
      className={`ks-window${preview ? " ks-window-gesturing" : ""}${bottomEdge ? " ks-window-bottom-edge" : ""}`}
      data-testid={`app-window-${appWindow.app_id}`}
      onPointerDownCapture={() => {
        if (!isTop) void onCall({ op: "window.raise", window_id: appWindow.id });
      }}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelGesture}
      style={{
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        zIndex: appWindow.z,
      }}
    >
      <div className="ks-window-frame">
        <header
          className={`ks-window-titlebar${isTop ? " ks-window-titlebar-active" : ""}`}
          onPointerDown={(event) => {
            if (event.target instanceof Element && event.target.closest("button")) return;
            beginGesture("move", event);
          }}
          ref={titleRef}
        >
          <span className="ks-window-title" title={appName}>{appName}</span>
          <IconButton
            aria-label="창 닫기"
            onClick={() => void onCall({ op: "window.close", window_id: appWindow.id })}
            title="창 닫기"
          >
            <CloseIcon />
          </IconButton>
        </header>
        <div className="ks-window-content">{children}</div>
      </div>
      <div
        aria-hidden="true"
        className="ks-window-resize-east"
        onPointerDown={(event) => beginGesture("east", event)}
      />
      <div
        aria-hidden="true"
        className="ks-window-resize-south"
        onPointerDown={(event) => beginGesture("south", event)}
      />
      <div
        aria-hidden="true"
        className="ks-window-resize-corner"
        onPointerDown={(event) => beginGesture("corner", event)}
      />
    </section>
  );
}

function clampSavedRect(rect: Rect, area: { width: number; height: number }, element: HTMLElement | null): Rect {
  const drawnRect = {
    ...rect,
    width: Math.min(rect.width, area.width),
    height: Math.min(rect.height, area.height),
  };
  return clampWindowPosition(
    drawnRect,
    area,
    tokenPixels(VISIBLE_WIDTH, element),
  );
}

function clampWindowPosition(
  rect: Rect,
  area: { width: number; height: number },
  visibleWidth: number,
): Rect {
  const minX = Math.min(0, visibleWidth - rect.width);
  const maxX = Math.max(area.width - visibleWidth, 0);
  const maxY = Math.max(area.height - rect.height, 0);
  return {
    ...rect,
    x: Math.round(clamp(rect.x, minX, maxX)),
    y: Math.round(clamp(rect.y, 0, maxY)),
  };
}

function tokenPixels(name: string, element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
