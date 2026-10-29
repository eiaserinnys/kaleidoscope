import type { CoreError, CoreEvent, CoreReply, CoreRequest } from "../contract/contract";

export type RequestFor<K extends CoreRequest["op"]> = Extract<CoreRequest, { op: K }>;
export type ReplyFor<K extends CoreRequest["op"]> = Extract<CoreReply, { op: K }>;

export interface CoreTransport {
  call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
}

const errorCodes = new Set<CoreError["code"]>([
  "invalid_request",
  "not_found",
  "invalid_app_definition",
  "unsupported_app",
  "permission_denied",
  "not_granted",
  "path_outside_root",
  "conflict",
  "server",
  "unavailable",
  "io",
]);

export function isCoreError(value: unknown): value is CoreError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CoreError>;
  return typeof candidate.code === "string"
    && errorCodes.has(candidate.code as CoreError["code"])
    && typeof candidate.message === "string"
    && Array.isArray(candidate.details);
}

export function toCoreError(reason: unknown): CoreError {
  if (isCoreError(reason)) return reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  return { code: "io", message, details: [] };
}
