import { useEffect } from "react";
import { describeTarget, type TargetDescription } from "./target";
import { frameSurfaces } from "./frame";

export function targetAt(content: HTMLElement, element: HTMLElement, x: number, y: number): TargetDescription | null {
  const block = element.closest<HTMLElement>("[data-ks-block]");
  const type = block?.dataset.ksBlockType ?? "";
  const frame = block && frameSurfaces(block, type).find((surface) => {
    const rect = surface.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
  const rect = frame?.getBoundingClientRect();
  const relative = rect && rect.width && rect.height ? { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height } : undefined;
  return describeTarget(frame ?? element, content, relative);
}

export function useCommentPick(content: HTMLElement | null, enabled: boolean, pick: (target: TargetDescription) => void, hover: (target: HTMLElement | null) => void) {
  useEffect(() => {
    if (!content || !enabled) return;
    let frame = 0;
    let down: HTMLElement | null = null;
    const htmlTarget = (target: EventTarget | null) => target instanceof HTMLElement ? target : target instanceof Element ? target.closest<HTMLElement>("button, [data-ks-block]") : null;
    const move = (event: PointerEvent) => {
      const target = htmlTarget(event.target);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => hover(target));
    };
    const leave = () => hover(null);
    const start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = htmlTarget(event.target);
      event.stopPropagation();
      if (down?.closest("button, input, textarea, select, [role=button], [role=tab]")) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || !down) return;
      event.stopPropagation();
      const element = htmlTarget(event.target) ?? down;
      const target = targetAt(content, element, event.clientX, event.clientY);
      if (target) pick(target);
      down = null;
    };
    const stop = (event: Event) => { event.stopPropagation(); if (event.type !== "mousedown") event.preventDefault(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement) {
        const r = event.target.getBoundingClientRect();
        const target = targetAt(content, event.target, r.left + r.width / 2, r.top + r.height / 2);
        if (target) pick(target);
      }
    };
    content.addEventListener("pointermove", move, true); content.addEventListener("pointerleave", leave);
    content.addEventListener("pointerdown", start, true); content.addEventListener("pointerup", up, true);
    content.addEventListener("mousedown", stop, true); content.addEventListener("click", stop, true); content.addEventListener("dblclick", stop, true);
    content.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); hover(null); content.removeEventListener("pointermove", move, true); content.removeEventListener("pointerleave", leave); content.removeEventListener("pointerdown", start, true); content.removeEventListener("pointerup", up, true); content.removeEventListener("mousedown", stop, true); content.removeEventListener("click", stop, true); content.removeEventListener("dblclick", stop, true); content.removeEventListener("keydown", key, true); };
  }, [content, enabled, pick, hover]);
}
