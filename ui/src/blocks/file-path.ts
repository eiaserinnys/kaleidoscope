import type { AppWindow, FileRef } from "../contract/contract";

export function resolveFilePath(file: FileRef, window: AppWindow): string | null {
  if (typeof file.path === "string") return file.path;
  const value = window.state[file.path.state];
  return typeof value === "string" ? value : null;
}
