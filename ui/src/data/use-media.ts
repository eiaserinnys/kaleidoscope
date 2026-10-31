import { useEffect, useState } from "react";
import type { MediaRef } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { useWindowData } from "./window-data";

type MediaResult = { status: "loading" } | { status: "ready"; url: string } | { status: "failed"; message: string };

export function useMedia(media: MediaRef | null, maxPx: number): MediaResult & { retry: () => void } {
  const data = useWindowData();
  const requestSize = Math.ceil(maxPx * (globalThis.devicePixelRatio || 1));
  const key = media ? JSON.stringify([media, requestSize]) : "";
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; value: MediaResult }>({ key: "", attempt: -1, value: { status: "loading" } });
  useEffect(() => {
    if (!media) return;
    let active = true;
    let request = data.mediaCache.get(key);
    if (!request) {
      request = data.store.call({ op: "data.media", window_id: data.windowId, media, max_px: requestSize })
        .then((reply) => `data:${reply.media.mime};base64,${reply.media.data_base64}`);
      data.mediaCache.set(key, request);
      const cachedRequest = request;
      void request.catch(() => { if (data.mediaCache.get(key) === cachedRequest) data.mediaCache.delete(key); });
    }
    void request.then(
      (url) => { if (active) setResult({ key, attempt, value: { status: "ready", url } }); },
      (error: unknown) => { if (active) setResult({ key, attempt, value: { status: "failed", message: toCoreError(error).message } }); },
    );
    return () => { active = false; };
  }, [data, key, requestSize, attempt]);
  const value = result.key === key && result.attempt === attempt ? result.value : { status: "loading" as const };
  return { ...value, retry: () => setAttempt((current) => current + 1) };
}
