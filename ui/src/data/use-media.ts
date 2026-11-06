import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CoreError, MediaRef } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { recoveryVisible, useWindowData } from "./window-data";
import { useShellSelector } from "../core/shell-store";
import { BlockRenderContext } from "../render/render-probe";

type MediaResult = { status: "loading" } | { status: "ready"; url: string } | { status: "failed"; error: CoreError };
// 실패 표시는 재요청 중에도 남으므로, 실패한 요청과 진행 중인 요청을 구분한다.
const failedRequests = new WeakSet<Promise<string>>();

export function useMedia(media: MediaRef | null, maxPx: number, options?: { showSmaller?: boolean }): MediaResult & { retry: () => void } {
  const showSmaller = options?.showSmaller ?? false;
  const data = useWindowData();
  const identity = useContext(BlockRenderContext);
  const visible = useShellSelector(data.store, (snapshot) => recoveryVisible(snapshot, data.windowId));
  const dormant = useSyncExternalStore(data.subscribeDormant, () => identity ? data.isDormant(identity.pointer, identity.instance) : false, () => false);
  const generation = useSyncExternalStore(data.subscribeMedia, data.getMediaGeneration, data.getMediaGeneration);
  const requestSize = Math.ceil(maxPx * (globalThis.devicePixelRatio || 1) - 1e-9);
  const key = media ? JSON.stringify(media) : "";
  const [attempt, setAttempt] = useState(0);
  const failedOnMount = useRef("");
  const [result, setResult] = useState<{ key: string; attempt: number; size: number; value: MediaResult }>({ key: "", attempt: -1, size: 0, value: { status: "loading" } });
  useEffect(() => {
    if (!media || !requestSize || !visible || dormant) return;
    let cached = data.mediaCache.get(key);
    if (!cached && result.key === key && result.attempt === attempt && result.size >= requestSize && result.value.status === "ready") return;
    let active = true;
    const failureKey = JSON.stringify([key, attempt, generation]);
    const failedRequest = cached?.failed && failedRequests.has(cached.request);
    if (!cached || (failedRequest ? failedOnMount.current !== failureKey : cached.size < requestSize)) {
      if (!cached) {
        cached = { size: requestSize, request: Promise.resolve("") };
        data.mediaCache.set(key, cached);
      }
      const entry = cached;
      const request = data.store.call({ op: "data.media", window_id: data.windowId, media, max_px: requestSize })
        .then((reply) => `data:${reply.media.mime};base64,${reply.media.data_base64}`);
      entry.size = requestSize;
      entry.request = request;
      void request.then((url) => {
        if (data.mediaCache.get(key) !== entry) return;
        if (!entry.ready || entry.ready.size < requestSize) entry.ready = { url, size: requestSize };
        delete entry.failed;
      }, (error: unknown) => {
        failedRequests.add(request);
        if (data.mediaCache.get(key) !== entry || entry.request !== request) return;
        if (entry.ready) {
          entry.size = entry.ready.size;
          entry.request = Promise.resolve(entry.ready.url);
          delete entry.failed;
        } else entry.failed = toCoreError(error);
      });
    }
    const { request, size } = cached;
    void request.then(
      (url) => { if (active) setResult((old) => old.key === key && old.attempt === attempt && old.value.status === "ready" && old.size > size ? old : { key, attempt, size, value: { status: "ready", url } }); },
      (error: unknown) => { if (active) {
        failedOnMount.current = failureKey;
        const ready = data.mediaCache.get(key)?.ready;
        setResult((old) => old.key === key && old.attempt === attempt && old.value.status === "ready" && (showSmaller || old.size >= requestSize) ? old
          : ready && (showSmaller || ready.size >= requestSize) ? { key, attempt, size: ready.size, value: { status: "ready", url: ready.url } }
          : { key, attempt, size, value: { status: "failed", error: toCoreError(error) } });
      } },
    );
    return () => { active = false; };
  }, [data, key, requestSize, attempt, generation, visible, dormant, showSmaller]);
  const cached = data.mediaCache.get(key);
  const value = result.key === key && result.attempt === attempt ? result.value.status === "ready" && !showSmaller && result.size < requestSize ? { status: "loading" as const } : result.value
    : result.key === key && result.attempt !== attempt ? { status: "loading" as const }
    : cached?.ready && (showSmaller || cached.ready.size >= requestSize) ? { status: "ready" as const, url: cached.ready.url }
    : cached?.failed ? { status: "failed" as const, error: cached.failed }
    : { status: "loading" as const };
  return { ...value, retry: () => setAttempt((current) => current + 1) };
}
