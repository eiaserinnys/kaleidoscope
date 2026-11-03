import { SHELL_HTTP_EXTERNAL_SCHEME_INVALID, SHELL_HTTP_ERROR_REPLY_INVALID, SHELL_HTTP_REQUEST_FAILED } from "../contract/shell-errors";
import type { CoreEvent, CoreRequest } from "../contract/contract";
import { isCoreError, toCoreError, type CoreTransport, type ReplyFor, type RequestFor } from "./core-transport";

export function createHttpTransport(baseUrl: string): CoreTransport {
  const base = baseUrl.replace(/\/$/, "");
  const listeners = new Set<(event: CoreEvent) => void>();
  const events = new EventSource(`${base}/events`);

  events.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as CoreEvent;
      for (const listener of listeners) listener(event);
    } catch {
      // A malformed event cannot replace the shell snapshot.
    }
  };

  async function call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>> {
    try {
      if (request.op === "external.open") {
        const url = new URL((request as RequestFor<"external.open">).url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw SHELL_HTTP_EXTERNAL_SCHEME_INVALID();
        globalThis.window.open(url.href, "_blank", "noopener,noreferrer");
        return { op: "external.open" } as ReplyFor<K>;
      }
      const response = await fetch(`${base}/core`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });

      if (response.status === 400) {
        const error: unknown = await response.json();
        throw isCoreError(error)
          ? error
          : SHELL_HTTP_ERROR_REPLY_INVALID();
      }
      if (!response.ok) {
        throw { ...SHELL_HTTP_REQUEST_FAILED(), details: [`HTTP ${response.status}`] };
      }
      return await response.json() as ReplyFor<K>;
    } catch (error) {
      throw toCoreError(error);
    }
  }

  return {
    nativeFiles: true,
    call,
    async bytes(request, body) {
      const response = await fetch(`${base}/bytes`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-ks-operation": request.op, "x-ks-window": request.window_id, "x-ks-handle": encodeURIComponent(request.handle), "x-ks-offset": String(request.offset ?? 0) }, body: body ?? new ArrayBuffer(0) });
      if (!response.ok) throw toCoreError(await response.json().catch(() => `코어 바이트 요청 실패 (${response.status})`));
      return response.arrayBuffer();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
