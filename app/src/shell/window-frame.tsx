import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { IconButton, X, type CoreReply, type CoreRequest, type AppWindow, type Rect } from "@kaleidoscope/ui";
import { fitWindowRect, usableWindowArea } from "./window-geometry";

export interface WindowFrameProps {
  area: { width: number; height: number };
  appName: string;
  isTop: boolean;
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  window: AppWindow;
  children: ReactNode;
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

export function WindowFrame({ area, appName, isTop, onCall, window: appWindow, children }: WindowFrameProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const displayRect = fitWindowRect(preview ?? appWindow.rect, area);

  useEffect(() => {
    const pending = previewRef.current;
    if (gestureRef.current || !pending || pending.x !== appWindow.rect.x || pending.y !== appWindow.rect.y
      || pending.width !== appWindow.rect.width || pending.height !== appWindow.rect.height) return;
    previewRef.current = null;
    setPreview(null);
  }, [appWindow.rect.x, appWindow.rect.y, appWindow.rect.width, appWindow.rect.height]);

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
      void onCall({ op: "window.set_rect", window_id: appWindow.id, rect: next }).then((reply) => {
        if (!reply && !gestureRef.current && previewRef.current === next) {
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
            <X />
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

function tokenPixels(name: string, element: HTMLElement | null): number {
  if (!element || typeof getComputedStyle !== "function") return 0;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return Number.parseFloat(value) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
