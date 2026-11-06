import { useLayoutEffect, type RefObject } from "react";

/** 작업 표시줄의 실제 상자와 겹칠 때만 창 안쪽으로 올린다. */
export function useCommentBarPosition(content: HTMLElement, bar: RefObject<HTMLDivElement | null>, enabled: boolean, mode: boolean) {
  useLayoutEffect(() => {
    const element = bar.current;
    const win = content.closest<HTMLElement>(".ks-window");
    const desktop = win?.closest<HTMLElement>(".ks-desktop-area");
    const taskbar = desktop?.querySelector<HTMLElement>(".ks-taskbar");
    if (!enabled || !element || !win || !taskbar) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const w = win.getBoundingClientRect(), b = element.getBoundingClientRect(), t = taskbar.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(content).getPropertyValue("--ks-space-3")) || 0;
      const natural = { left: w.right - b.width, right: w.right, top: w.bottom + gap, bottom: w.bottom + gap + b.height };
      const inside = natural.left < t.right && natural.right > t.left && natural.top < t.bottom && natural.bottom > t.top;
      element.classList.toggle("is-inside", inside && mode);
      element.style.visibility = inside && !mode ? "hidden" : "";
      element.parentElement?.style.setProperty("--ks-comment-bar-reserve", inside && mode ? `${b.height + gap * 2}px` : "0px");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(win); resize.observe(taskbar); resize.observe(element);
    const mutation = new MutationObserver(schedule);
    mutation.observe(win, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener("resize", schedule); };
  }, [bar, content, enabled, mode]);
}
