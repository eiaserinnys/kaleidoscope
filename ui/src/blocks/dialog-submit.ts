import { createContext, useContext } from "react";

/**
 * dialog 블록 본문의 한 줄 input이 Enter로 부르는 확정. 확정 단추를 누른 것과 같아 confirm_disabled와 진행 중 판정을 따른다.
 * on_confirm이 없는 대화상자와 대화상자 밖에서는 null이다.
 */
export const DialogSubmitContext = createContext<(() => void) | null>(null);

export function useDialogSubmit(): (() => void) | null {
  return useContext(DialogSubmitContext);
}
