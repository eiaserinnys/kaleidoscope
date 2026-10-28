import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CoreError, CoreEvent, CoreReply, CoreRequest } from "../../../ui/src/contract/contract";

export type RequestFor<K extends CoreRequest["op"]> = Extract<CoreRequest, { op: K }>;
export type ReplyFor<K extends CoreRequest["op"]> = Extract<CoreReply, { op: K }>;

export interface CoreTransport {
  call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
}

function isCoreError(value: unknown): value is CoreError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && Array.isArray(candidate.details);
}

export function createTauriTransport(): CoreTransport {
  return {
    async call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>> {
      try {
        return await invoke<ReplyFor<K>>("core", { request });
      } catch (error) {
        if (isCoreError(error)) throw error;
        throw { code: "io", message: String(error), details: [] } satisfies CoreError;
      }
    },

    subscribe(listener) {
      let cancelled = false;
      let unlisten: (() => void) | undefined;

      void listen<CoreEvent>("core-event", (event) => {
        if (!cancelled) listener(event.payload);
      }).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      });

      return () => {
        cancelled = true;
        unlisten?.();
        unlisten = undefined;
      };
    },
  };
}
