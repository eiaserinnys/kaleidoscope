import { createContext } from "react";

export const SplitPaneContext = createContext<{
  collapsed: boolean;
  toggle: () => void;
} | null>(null);
