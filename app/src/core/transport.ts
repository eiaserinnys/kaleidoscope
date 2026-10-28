import { createHttpTransport, type CoreTransport } from "@kaleidoscope/ui";
import { createTauriTransport } from "./tauri-transport";

export function createCoreTransport(): CoreTransport | null {
  if (typeof window === "undefined") return null;
  if ("__TAURI_INTERNALS__" in window) return createTauriTransport();
  const coreUrl = new URLSearchParams(window.location.search).get("core");
  return coreUrl ? createHttpTransport(coreUrl) : null;
}
