import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ownerOf, registerOverlay } from "../share/overlay-owner";

type Point = { x: number; y: number };
type KeyboardRect = { left: number; top: number; bottom: number };
type PositionOptions = { rect: Pick<DOMRect, "left" | "top" | "bottom"> & Partial<Pick<DOMRect, "right">>; offset?: number; alignEndOnOverflow?: boolean; width: number; height: number; viewportWidth: number; viewportHeight: number; inset: number; anchorPoint?: Point; keyboardRect?: KeyboardRect; preferAbove?: boolean };

export function computeAnchoredPosition({ rect, width, height, viewportWidth, viewportHeight, inset, anchorPoint, keyboardRect, preferAbove = false, offset = 0, alignEndOnOverflow = false }: PositionOptions) {
  const below = (keyboardRect?.bottom ?? anchorPoint?.y ?? rect.bottom) + offset;
  const above = (keyboardRect?.top ?? anchorPoint?.y ?? rect.top) - height - offset;
  const anchorLeft = keyboardRect?.left ?? anchorPoint?.x ?? rect.left;
  const left = alignEndOnOverflow && rect.right !== undefined && anchorLeft + width > viewportWidth - inset
    ? rect.right - width : anchorLeft;
  const fitsBelow = below >= inset && below + height <= viewportHeight - inset;
  const fitsAbove = above >= inset && (keyboardRect !== undefined || anchorPoint !== undefined || rect.top <= viewportHeight - inset);
  const top = preferAbove ? (fitsAbove ? above : fitsBelow ? below : viewportHeight - inset - height)
    : (fitsBelow ? below : fitsAbove ? above : viewportHeight - inset - height);
  return {
    left: Math.min(Math.max(left, inset), Math.max(viewportWidth - width - inset, inset)),
    top: Math.min(Math.max(top, inset), Math.max(viewportHeight - height - inset, inset)),
  };
}

export function useAnchoredOverlay(anchor: HTMLElement | null, surface: RefObject<HTMLElement | null>, options: { anchorPoint?: Point; keyboardRect?: KeyboardRect; preferAbove?: boolean; observe?: boolean; offsetToken?: string; alignEndOnOverflow?: boolean; verticalAnchor?: HTMLElement } = {}) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const { anchorPoint, keyboardRect, preferAbove, observe, offsetToken, alignEndOnOverflow, verticalAnchor } = options;
  useLayoutEffect(() => {
    const element = surface.current;
    if (!anchor || !element) return;
    const owner = ownerOf(anchor);
    const unregister = owner ? registerOverlay(element, owner, anchor) : undefined;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const inset = Number.parseFloat(style.getPropertyValue("--ks-space-3")) || 0;
      const offset = offsetToken ? Number.parseFloat(style.getPropertyValue(offsetToken)) || 0 : 0;
      const rect = anchor.getBoundingClientRect();
      const verticalRect = verticalAnchor?.getBoundingClientRect();
      const positionRect = verticalRect ? { left: rect.left, right: rect.right, top: verticalRect.top, bottom: verticalRect.bottom } : rect;
      setPosition(computeAnchoredPosition({ rect: positionRect, width: bounds.width, height: bounds.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, inset, anchorPoint, keyboardRect, preferAbove, offset, alignEndOnOverflow }));
    };
    measure();
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const observer = observe && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (observe) {
      observer?.observe(anchor); observer?.observe(element);
      // 창 안쪽을 끄는 것처럼 웹 뷰포트가 그대로인 크기 변화도 있다. 기준 요소의 크기가 그대로여도
      // 창이 바뀌면 자리를 다시 재야 메뉴가 옛 좌표에 남지 않는다.
      const windowRoot = anchor.closest<HTMLElement>(".ks-window");
      if (windowRoot && windowRoot !== anchor) observer?.observe(windowRoot);
      if (verticalAnchor && verticalAnchor !== anchor) observer?.observe(verticalAnchor);
      window.addEventListener("resize", schedule);
      window.addEventListener("scroll", schedule, true);
    }
    return () => {
      unregister?.(); observer?.disconnect();
      window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchor, surface, anchorPoint, keyboardRect, preferAbove, observe, offsetToken, alignEndOnOverflow, verticalAnchor]);
  return position;
}

export function AnchoredOverlay({ anchor, children, className, id, onPointerEnter, onPointerLeave }: { anchor: HTMLElement; children: ReactNode; className: string; id: string; onPointerEnter?: React.PointerEventHandler<HTMLDivElement>; onPointerLeave?: React.PointerEventHandler<HTMLDivElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useAnchoredOverlay(anchor, ref, { preferAbove: true, observe: true, offsetToken: "--ks-space-2", alignEndOnOverflow: true });
  const below = position.top >= anchor.getBoundingClientRect().bottom;
  return createPortal(<div id={id} ref={ref} role="tooltip" data-ks-overlay className={`ks-anchored-overlay ${className}${below ? " is-below" : ""}`} style={position} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}><div className="ks-tooltip-content">{children}</div></div>, document.body);
}
