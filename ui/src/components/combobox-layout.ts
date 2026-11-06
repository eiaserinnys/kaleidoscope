import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { InputOption } from "../blocks/input-options";
import { computeAnchoredPosition } from "./anchored-overlay";

type Layout = { far: boolean; above: boolean; style: CSSProperties };

export function useComboboxLayout(anchor: HTMLElement | null, surface: RefObject<HTMLDivElement | null>, options: InputOption[], loading: boolean, close: () => void, description: string | undefined): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null);
  const choices = useRef({ options, loading });
  const measureNow = useRef<(() => void) | null>(null);
  choices.current = { options, loading };
  useLayoutEffect(() => {
    if (!anchor) { setLayout(null); return; }
    const host = anchor.closest<HTMLElement>(".ks-data-window[data-window-id]");
    let openedAbove: boolean | undefined;
    let openedGeometry = "";
    let measuredOptions: InputOption[] | undefined;
    let measuredWidth = "";
    let descriptionHeight = 0;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      // 스크롤 영역을 벗어난 입력에 포털 목록만 남기지 않는다.
      for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        if (parent.clientHeight > 0 && /(auto|scroll|hidden|clip)/.test(css.overflowY)) {
          const r = parent.getBoundingClientRect();
          const top = r.top + parent.clientTop;
          if (rect.bottom <= top || rect.top >= top + parent.clientHeight) { close(); return; }
        }
        if (parent === host) break;
      }
      const css = getComputedStyle(anchor);
      const token = (name: string) => Number.parseFloat(css.getPropertyValue(name)) || 0;
      const inset = token("--ks-space-3"), offset = token("--ks-space-2");
      const pane = token("--ks-pane-min-size"), line = token("--ks-line-width");
      const bounds = host?.getBoundingClientRect();
      const left = Math.max(bounds?.left ?? 0, 0);
      const right = Math.min(bounds?.right ?? window.innerWidth, window.innerWidth);
      const width = Math.min(Math.max(rect.width, pane), Math.max(right - left - 2 * inset, 0));
      const position = computeAnchoredPosition({ rect: { left: rect.left - left, right: rect.right - left, top: rect.top, bottom: rect.bottom }, width, height: 0, viewportWidth: right - left, viewportHeight: window.innerHeight, inset, offset, alignEndOnOverflow: true });
      position.left += left;
      const far = position.left + width + line + 2 * pane > right - inset;
      const { options, loading } = choices.current;
      const body = token("--ks-type-body") * token("--ks-line-body");
      const meta = token("--ks-type-meta") * token("--ks-line-body");
      const rowHeight = (option?: InputOption) => Math.max(token("--ks-control-height"), body + (option && option.label !== option.value ? meta : 0) + 2 * offset);
      const padding = 2 * token("--ks-space-1");
      const total = loading ? 3 * rowHeight() : options.reduce((sum, o) => sum + rowHeight(o), 0);
      const listHeight = Math.min(total + padding, 2 * pane);
      // 그릴 폭과 배치에서 실제 설명 높이를 재고 최대 높이를 더하지 않는다.
      surface.current?.style.setProperty("--ks-combobox-list-width", width + "px");
      surface.current?.classList.toggle("is-far", far);
      const description = surface.current?.querySelector<HTMLElement>(".ks-combobox-description");
      const measurementWidth = [width, far].join(":");
      if (options !== measuredOptions || measurementWidth !== measuredWidth) {
        descriptionHeight = 0;
        if (description && surface.current) {
          // 같은 폭에서 모든 설명이 쓸 공간을 미리 재고 활성 행과 무관하게 예약한다.
          const probe = description.cloneNode(false) as HTMLElement;
          probe.removeAttribute("id"); probe.setAttribute("aria-hidden", "true");
          Object.assign(probe.style, { position: "absolute", visibility: "hidden", height: "auto", maxHeight: "none", pointerEvents: "none" });
          surface.current.append(probe);
          for (const text of new Set(options.map(option => option.description).filter(Boolean))) {
            probe.textContent = text!;
            descriptionHeight = Math.max(descriptionHeight, Math.min(probe.scrollHeight, far ? pane : 2 * pane));
          }
          probe.remove();
        }
        measuredOptions = options; measuredWidth = measurementWidth;
      }
      const required = far ? listHeight + descriptionHeight + (description ? line : 0) : Math.max(listHeight, descriptionHeight);
      const minimumList = Math.min(3, options.length || 3) * rowHeight(options[0]) + padding;
      const minimum = far ? minimumList + descriptionHeight + (description ? line : 0) : Math.max(minimumList, descriptionHeight);
      let top = Math.max(bounds?.top ?? 0, 0) + inset;
      let bottom = Math.min(bounds?.bottom ?? window.innerHeight, window.innerHeight) - inset;
      // 칸 자리와 설명을 뺀 실제 여유가 세 행보다 작으면 쉘 범위를 쓴다.
      if (Math.max(bottom - rect.bottom - offset, rect.top - offset - top) < minimum) {
        top = inset; bottom = window.innerHeight - inset;
      }
      const below = Math.max(bottom - rect.bottom - offset, 0);
      const aboveSpace = Math.max(rect.top - offset - top, 0);
      const geometry = [rect.top, rect.bottom, top, bottom, width].join(":");
      // 검색 결과만 바뀌면 방향을 지키고, 칸이 움직이면 새 여유로 다시 고른다.
      if (geometry !== openedGeometry) { openedAbove = undefined; openedGeometry = geometry; }
      const above = openedAbove ?? (below < required && aboveSpace > below);
      openedAbove = above;
      const available = above ? aboveSpace : below;
      const descriptionLimit = Math.max(0, Math.min(descriptionHeight, far ? available - Math.min(listHeight, rowHeight() + padding) - line : available));
      setLayout({ far, above, style: {
        left: position.left,
        top: above ? undefined : Math.max(rect.bottom + offset, top),
        bottom: above ? window.innerHeight - Math.min(rect.top - offset, bottom) : undefined,
        maxHeight: available,
        "--ks-combobox-description-limit": descriptionLimit + "px",
        "--ks-combobox-list-width": width + "px",
      } as CSSProperties });
    };
    measureNow.current = measure;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    if (host) observer.observe(host);
    if (surface.current) observer.observe(surface.current);
    return () => {
      measureNow.current = null;
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchor, surface, close]);
  useLayoutEffect(() => { measureNow.current?.(); }, [anchor, description, options, loading]);
  return layout;
}
