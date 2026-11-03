import { createContext } from "react";

export const PreviewContext = createContext<((error: string | null) => void) | null>(null);
