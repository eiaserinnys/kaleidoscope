import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CoreError, CoreEvent, CoreRequest, CoreTransport, ReplyFor, RequestFor } from "@kaleidoscope/ui";

function isCoreError(value: unknown): value is CoreError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string"
    && typeof candidate.message === "string"
    && Array.isArray(candidate.details);
}

export function createTauriTransport(): CoreTransport {
  return {
    nativeFiles: true,
    async bytes(request, body) {
      try { return await invoke<ArrayBuffer>("core_bytes", body ?? new ArrayBuffer(0), { headers: { "x-ks-operation": request.op, "x-ks-window": request.window_id, "x-ks-handle": request.handle, "x-ks-offset": String(request.offset ?? 0) } }); }
      catch (error) { if (isCoreError(error)) throw error; throw { code: "io", message: String(error), details: [] } satisfies CoreError; }
    },
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
