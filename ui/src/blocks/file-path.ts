import type { FileRef } from "../contract/contract";

export function resolveFilePath(file: FileRef, stateValue: unknown): string | null {
  if (typeof file.path === "string") return file.path;
  return typeof stateValue === "string" ? stateValue : null;
}
