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
  startRect: Rect;
};

const MIN_WIDTH = "--ks-window-min-width";
const MIN_HEIGHT = "--ks-window-min-height";
const TITLE_HEIGHT = "--ks-control-height";
const VISIBLE_WIDTH = "--ks-window-visible-width";

export function WindowFrame({ area, appName, isTop, onCall, window: appWindow, children }: WindowFrameProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const displayRect = preview ?? clampSavedRect(appWindow.rect, area, titleRef.current);

  const beginGesture = (kind: Gesture["kind"], event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startRect = previewRef.current ?? clampSavedRect(appWindow.rect, area, titleRef.current);
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
      const titleHeight = tokenPixels(TITLE_HEIGHT, titleRef.current);
      const visibleWidth = tokenPixels(VISIBLE_WIDTH, titleRef.current);
      next = clampWindowPosition({
        ...gesture.startRect,
        x: gesture.startRect.x + dx,
        y: gesture.startRect.y + dy,
      }, area, titleHeight, visibleWidth);
    } else {
      const minWidth = tokenPixels(MIN_WIDTH, titleRef.current);
      const minHeight = tokenPixels(MIN_HEIGHT, titleRef.current);
      next = {
        ...gesture.startRect,
        width: gesture.kind === "south" ? gesture.startRect.width : Math.max(minWidth, Math.round(gesture.startRect.width + dx)),
        height: gesture.kind === "east" ? gesture.startRect.height : Math.max(minHeight, Math.round(gesture.startRect.height + dy)),
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
    if (!sameRect(next, gesture.startRect)) {
      void onCall({ op: "window.set_rect", window_id: appWindow.id, rect: next });
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
      className={`ks-window${preview ? " ks-window-gesturing" : ""}`}
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
  return clampWindowPosition(
    rect,
    area,
    tokenPixels(TITLE_HEIGHT, element),
    tokenPixels(VISIBLE_WIDTH, element),
  );
}

function clampWindowPosition(
  rect: Rect,
  area: { width: number; height: number },
  titleHeight: number,
  visibleWidth: number,
): Rect {
  const minX = Math.min(0, visibleWidth - rect.width);
  const maxX = Math.max(area.width - visibleWidth, 0);
  const maxY = Math.max(area.height - titleHeight, 0);
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

function sameRect(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
