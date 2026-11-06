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
      const descriptionHeight = description ? Math.min(description.scrollHeight, far ? pane : 2 * pane) : 0;
      const required = far ? listHeight + descriptionHeight + (description ? line : 0) : Math.max(listHeight, descriptionHeight);
      const minimum = Math.min(3, options.length || 3) * rowHeight(options[0]) + padding + 2 * inset + 2 * offset;
      const useWindow = bounds && bounds.height >= minimum;
      const top = Math.max(useWindow ? bounds.top : 0, 0) + inset;
      const bottom = Math.min(useWindow ? bounds.bottom : window.innerHeight, window.innerHeight) - inset;
      const below = Math.max(bottom - rect.bottom - offset, 0);
      const aboveSpace = Math.max(rect.top - offset - top, 0);
      const geometry = [rect.top, rect.bottom, top, bottom, width].join(":");
      // 검색 결과만 바뀌면 방향을 지키고, 칸이 움직이면 새 여유로 다시 고른다.
      if (geometry !== openedGeometry) { openedAbove = undefined; openedGeometry = geometry; }
      const above = openedAbove ?? (below < required && aboveSpace > below);
      openedAbove = above;
      const available = above ? aboveSpace : below;
      const descriptionLimit = Math.max(0, Math.min(descriptionHeight, available - Math.min(listHeight, rowHeight() + padding) - line));
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
