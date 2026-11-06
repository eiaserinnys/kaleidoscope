import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { CoreError, MediaRef } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { recoveryVisible, useWindowData } from "./window-data";
import { useShellSelector } from "../core/shell-store";
import { BlockRenderContext } from "../render/render-probe";

type MediaResult = { status: "loading" } | { status: "ready"; url: string } | { status: "failed"; error: CoreError };

export function useMedia(media: MediaRef | null, maxPx: number): MediaResult & { retry: () => void } {
  const data = useWindowData();
  const identity = useContext(BlockRenderContext);
  const visible = useShellSelector(data.store, (snapshot) => recoveryVisible(snapshot, data.windowId));
  const dormant = useSyncExternalStore(data.subscribeDormant, () => identity ? data.isDormant(identity.pointer, identity.instance) : false, () => false);
  const generation = useSyncExternalStore(data.subscribeMedia, data.getMediaGeneration, data.getMediaGeneration);
  const requestSize = Math.ceil(maxPx * (globalThis.devicePixelRatio || 1) - 1e-9);
  const key = media ? JSON.stringify(media) : "";
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; size: number; value: MediaResult }>({ key: "", attempt: -1, size: 0, value: { status: "loading" } });
  useEffect(() => {
    if (!media || !visible || dormant) return;
    let cached = data.mediaCache.get(key);
    if (!cached && result.key === key && result.attempt === attempt && result.size >= requestSize && result.value.status === "ready") return;
    let active = true;
    if (!cached || cached.size < requestSize) {
      const previous = cached;
      const request = data.store.call({ op: "data.media", window_id: data.windowId, media, max_px: requestSize })
        .then((reply) => `data:${reply.media.mime};base64,${reply.media.data_base64}`);
      cached = { size: requestSize, request };
      data.mediaCache.set(key, cached);
      const current = cached;
      void request.catch(() => {
        if (data.mediaCache.get(key) !== current) return;
        if (!previous) { data.mediaCache.delete(key); return; }
        void previous.request.then(() => {
          if (data.mediaCache.get(key) === current) data.mediaCache.set(key, previous);
        }, () => { if (data.mediaCache.get(key) === current) data.mediaCache.delete(key); });
      });
    }
    const { request, size } = cached;
    void request.then(
      (url) => { if (active) setResult((old) => old.key === key && old.attempt === attempt && old.value.status === "ready" && old.size > size ? old : { key, attempt, size, value: { status: "ready", url } }); },
      (error: unknown) => { if (active) setResult((old) => old.key === key && old.attempt === attempt && old.value.status === "ready" ? old : { key, attempt, size, value: { status: "failed", error: toCoreError(error) } }); },
    );
    return () => { active = false; };
  }, [data, key, requestSize, attempt, generation, visible, dormant]);
  const value = result.key === key && result.attempt === attempt ? result.value : { status: "loading" as const };
  return { ...value, retry: () => setAttempt((current) => current + 1) };
}
