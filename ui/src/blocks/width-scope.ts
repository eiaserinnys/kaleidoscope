import { createContext } from "react";

// 폭 조건이 창 대신 자신을 담은 고정 영역을 재야 할 때만 제공한다.
export const WidthScope = createContext<HTMLElement | null | undefined>(undefined);
