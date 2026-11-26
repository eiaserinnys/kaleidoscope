import type { FileRef } from "../contract/contract";

export function resolveFilePath(file: FileRef, stateValue: unknown): string | null {
  if (typeof file.path === "string") return file.path;
  return typeof stateValue === "string" ? stateValue : null;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
