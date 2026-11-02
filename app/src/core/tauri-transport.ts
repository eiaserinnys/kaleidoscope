import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toCoreError, type CoreEvent, type CoreRequest, type CoreTransport, type ReplyFor, type RequestFor } from "@kaleidoscope/ui";

export function createTauriTransport(): CoreTransport {
  return {
    nativeFiles: true,
    async bytes(request, body) {
      try { return await invoke<ArrayBuffer>("core_bytes", body ?? new ArrayBuffer(0), { headers: { "x-ks-operation": request.op, "x-ks-window": request.window_id, "x-ks-handle": encodeURIComponent(request.handle), "x-ks-offset": String(request.offset ?? 0) } }); }
      catch (error) { throw toCoreError(error); }
    },
    async call<K extends CoreRequest["op"]>(request: RequestFor<K>): Promise<ReplyFor<K>> {
      try {
        return await invoke<ReplyFor<K>>("core", { request });
      } catch (error) {
        throw toCoreError(error);
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
