import { useLayoutEffect, useRef, type RefObject } from "react";
import { isUnclaimedFocus } from "../components/focus-rescue";

/** 창의 조작으로 대화가 비었을 때만 입력으로 돌아간다. 그 사이 사용자가 옮긴 초점은 지킨다. */
export function useChatResetFocus(input: RefObject<HTMLTextAreaElement | null>, generation: number, empty: boolean, ready: boolean, canFocus: () => boolean) {
  const currentGeneration = useRef(generation);
  const canFocusRef = useRef(canFocus);
  const action = useRef<{ button: HTMLElement; generation: number } | null>(null);
  currentGeneration.current = generation;
  canFocusRef.current = canFocus;

  useLayoutEffect(() => {
    const host = input.current?.closest(".ks-data-window");
    if (!host) return;
    const remember = (target: EventTarget | null) => {
      const button = target instanceof Element ? target.closest<HTMLElement>("button") : null;
      action.current = button && host.contains(button)
        && button.closest(".ks-data-toolbar, .ks-data-section-actions")
        && !button.closest(".ks-agent-chat, [data-ks-overlay]")
        ? { button, generation: currentGeneration.current } : null;
    };
    const onPointer = (event: PointerEvent) => remember(event.target);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") remember(event.target);
      else action.current = null;
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [input]);

  useLayoutEffect(() => {
    const pending = action.current;
    if (!pending || pending.generation === generation) return;
    if (!empty) { action.current = null; return; }
    if (!ready) return;
    action.current = null;
    if (canFocusRef.current() && (document.activeElement === pending.button || isUnclaimedFocus(document.activeElement))) {
      input.current?.focus({ preventScroll: true });
    }
  }, [generation, empty, ready, input]);
}
