import type { CoreError, CoreEvent, CoreReply, CoreRequest } from "../contract/contract";
import * as shellErrors from "../contract/shell-errors";

export type RequestFor<K extends CoreRequest["op"]> = Extract<CoreRequest, { op: K }>;
export type ReplyFor<K extends CoreRequest["op"]> = Extract<CoreReply, { op: K }>;
export type CoreBytesRequest = { op: "files.read_bytes" | "export.write" | "client.http_read" | "client.blob_put" | "process.write"; window_id: string; handle: string; offset?: number };

export interface CoreTransport {
  call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  nativeFiles?: boolean;
  bytes?(request: CoreBytesRequest, body?: ArrayBuffer): Promise<ArrayBuffer>;
}

const errorCodes: Record<CoreError["code"], true> = {
  invalid_request: true,
  unauthorized: true,
  not_found: true,
  invalid_app_definition: true,
  unsupported_app: true,
  permission_denied: true,
  not_granted: true,
  path_outside_root: true,
  conflict: true,
  login_required: true,
  binding_conflict: true,
  io: true,
  server: true,
  unavailable: true,
  invalid_name: true,
  file_busy: true,
  trash_unavailable: true,
};

export function isCoreError(value: unknown): value is CoreError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CoreError>;
  return typeof candidate.code === "string"
    && errorCodes[candidate.code as CoreError["code"]] === true
    && typeof candidate.message === "string"
    && Array.isArray(candidate.details);
}

export function toCoreError(reason: unknown): CoreError {
  if (isCoreError(reason)) return reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "object" && reason !== null && "message" in reason && typeof reason.message === "string"
      ? reason.message
      : String(reason);
  return shellErrors.SHELL_CALL_UNEXPECTED_FAILURE({ reason: message });
}
