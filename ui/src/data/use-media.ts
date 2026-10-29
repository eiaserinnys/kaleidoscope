import { useEffect, useState } from "react";
import type { MediaRef } from "../contract/contract";
import { useWindowData } from "./window-data";

export function useMedia(media: MediaRef | null, maxPx: number): string | null {
  const data = useWindowData();
  const requestSize = Math.ceil(maxPx * (globalThis.devicePixelRatio || 1));
  const key = media ? JSON.stringify([media.permission, media.path, Object.entries(media.query ?? {}).sort(), requestSize]) : "";
  const [result, setResult] = useState<{ key: string; url: string | null }>({ key: "", url: null });
  useEffect(() => {
    if (!media) return;
    let active = true;
    let request = data.mediaCache.get(key);
    if (!request) {
      request = data.store.call({ op: "data.media", window_id: data.windowId, media, max_px: requestSize })
        .then((reply) => `data:${reply.media.mime};base64,${reply.media.data_base64}`).catch(() => null);
      data.mediaCache.set(key, request);
    }
    void request.then((url) => { if (active) setResult({ key, url }); });
    return () => { active = false; };
  }, [data, key, requestSize]);
  return result.key === key ? result.url : null;
}
