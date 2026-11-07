import { useEffect, useReducer } from "react";
import { holdsUserFocus } from "@kaleidoscope/ui";

/** 창 안의 입력에 초점이 있어 사용자가 글을 쓰는 중인가. */
export function writingInWindow(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && Boolean(active.closest(".ks-desktop-area")) && holdsUserFocus(active);
}

/**
 * 사용자가 창 안에서 글을 쓰는 동안 대화상자 열기를 미룬다.
 * 초점이 입력을 떠나면 다시 그려 대화상자를 연다.
 */
export function useHoldWhileWriting(wanted: boolean): boolean {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  // 첫 그리기부터 붙잡아야 대화상자가 초점을 가져가지 않는다. 효과에서 정하면 한 번은 열린다.
  const hold = wanted && writingInWindow();
  useEffect(() => {
    if (!hold) return;
    let timer = 0;
    // 입력에서 입력으로 옮기는 사이의 빈틈을 세지 않는다.
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(bump, 0); };
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, [hold]);
  return hold;
}
