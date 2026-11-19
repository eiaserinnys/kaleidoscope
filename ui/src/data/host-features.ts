import { createContext, useContext } from "react";

/**
 * 이 창을 그리는 호스트가 기기 폴더를 고를 수 있는가. 창 데이터 없이 홀로 그리는 블록은
 * 지금까지처럼 고를 수 있다고 본다.
 */
export const PickFolderAvailableContext = createContext(true);

export function usePickFolderAvailable(): boolean {
  return useContext(PickFolderAvailableContext);
}
