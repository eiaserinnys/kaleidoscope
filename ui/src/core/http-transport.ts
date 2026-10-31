import type { CoreError, CoreEvent, CoreRequest } from "../contract/contract";
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
        if (url.protocol !== "http:" && url.protocol !== "https:") throw { code: "invalid_request", message: "주소가 올바르지 않습니다", details: [] } satisfies CoreError;
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
          : { code: "io", message: "코어 오류 응답을 읽을 수 없습니다", details: [] } satisfies CoreError;
      }
      if (!response.ok) {
        throw { code: "io", message: `코어 요청 실패 (${response.status})`, details: [] } satisfies CoreError;
      }
      return await response.json() as ReplyFor<K>;
    } catch (error) {
      throw toCoreError(error);
    }
  }

  return {
    call,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
