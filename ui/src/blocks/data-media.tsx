import { useBlockRootProps } from "../comments/block-root";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { Block, MediaPlayback, MediaRef } from "../contract/contract";
import { useBinding, useWindowData } from "../data/window-data";
import { DataState, useFolderPick } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { isMedia } from "../components/media-thumbnail";
import { Button, IconButton, Notice } from "../components/primitives";
import { toCoreError } from "../core/core-transport";
import * as shellErrors from "../contract/shell-errors";

type Data = Extract<Block, { type: "media" }>;
export function formatMediaTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function MediaBlock({ block, pointer }: { block: Data; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const binding = useBinding(`${pointer}/src`, block.src);
  if (binding.status !== "ready") return <DataState rootProps={blockRoot} value={binding} />;
  return <MediaPlayer src={isMedia(binding.value) ? binding.value : null} kind={block.kind} autoplay={!!block.autoplay} />;
}
function MediaPlayer({ src, kind, autoplay }: { src: MediaRef | null; kind?: "audio" | "video"; autoplay: boolean }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const folder = useFolderPick();
  const [attempt, setAttempt] = useState(0);
  const generation = useSyncExternalStore(data.subscribeMedia, data.getMediaGeneration, data.getMediaGeneration);
  const key = src ? JSON.stringify(src) : "";
  useEffect(() => { folder.clear(); }, [key]);
  const sourceKey = JSON.stringify([key, generation]);
  const [loaded, setLoaded] = useState<{ key: string; playback: MediaPlayback; url: string; mime: string } | null>(null);
  const [error, setError] = useState<ReturnType<typeof toCoreError> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const element = useRef<HTMLMediaElement | null>(null);
  const requestedKey = useRef(sourceKey);
  requestedKey.current = sourceKey;
  useEffect(() => {
    let active = true;
    setLoaded(null); setError(null); setPlaying(false); setTime(0); setDuration(0);
    let release: (() => void) | undefined;
    if (src) {
      const lease = data.acquirePlayback(src, generation);
      release = lease.release;
      void lease.request.then((playback) => {
        const mime = playback.kind === "inline" ? playback.media.mime : playback.mime;
        const url = playback.kind === "inline" ? `data:${mime};base64,${playback.media.data_base64}` : playback.url;
        if (active && requestedKey.current === sourceKey) setLoaded({ key: sourceKey, playback, url, mime });
      }).catch((reason: unknown) => { if (active && requestedKey.current === sourceKey) setError(toCoreError(reason)); });
    }
    return () => { active = false; release?.(); };
  }, [data, key, generation, attempt]);
  const current = loaded?.key === sourceKey ? loaded : null;
  useEffect(() => {
    const el = element.current;
    if (!current || !el) return;
    return () => { currentSourceKey.current = null; el.pause(); el.removeAttribute("src"); el.load(); };
  }, [current]);
  const video = (kind ?? (current?.mime.startsWith("video/") ? "video" : "audio")) === "video";
  const playbackError = () => { setError(shellErrors.SHELL_MEDIA_PLAYBACK_UNSUPPORTED()); setPlaying(false); setTime(0); setDuration(0); };
  // 늦게 온 재생 실패는 재생을 시작한 미디어가 아직 현재 원본일 때만 알린다.
  // URL은 캐시되므로 서로 다른 원본이 같은 데이터 URL을 가질 수 있다.
  const currentSourceKey = useRef<string | null>(null);
  currentSourceKey.current = current?.key ?? null;
  const onMediaError = () => {
    if (!current) return;
    const started = current.key;
    if (current.playback.kind === "inline") { playbackError(); return; }
    void data.store.call({ op: "data.media.status", window_id: data.windowId, handle: current.playback.handle })
      .then((reply) => {
        if (currentSourceKey.current !== started) return;
        if (reply.error) { setError(reply.error); setPlaying(false); setTime(0); setDuration(0); }
        else playbackError();
      }).catch(() => { if (currentSourceKey.current === started) playbackError(); });
  };
  const play = (el: HTMLMediaElement) => {
    const started = currentSourceKey.current;
    void el.play().catch((reason: unknown) => {
      if (element.current !== el || currentSourceKey.current !== started) return;
      if (!(reason && typeof reason === "object" && "name" in reason && reason.name === "NotAllowedError")) playbackError();
    });
  };
  useEffect(() => { if (current && autoplay && element.current) play(element.current); }, [current, autoplay]);
  const toggle = () => { const el = element.current; if (!el || error) return; if (el.paused) play(el); else el.pause(); };
  const seek = (next: number) => { if (element.current) element.current.currentTime = Math.max(0, Math.min(duration, next)); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (event.key === " ") toggle(); else seek(time + (event.key === "ArrowLeft" ? -5 : 5));
    }
  };
  const props = { crossOrigin: current?.playback.kind === "stream" ? "anonymous" as const : undefined, src: current?.url, onError: onMediaError, onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setTime(e.currentTarget.currentTime), onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0), onVolumeChange: (e: React.SyntheticEvent<HTMLMediaElement>) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); } };
  return <div {...blockRoot} className={`ks-media-player${video ? " is-video" : ""}`} style={video && ratio ? { "--ks-media-ratio": ratio } as React.CSSProperties : undefined}>
    {video ? <video ref={(el) => { element.current = el; }} {...props} onLoadedMetadata={(event) => { const { videoWidth, videoHeight } = event.currentTarget; if (videoWidth > 0 && videoHeight > 0) setRatio(videoWidth / videoHeight); }} /> : <audio ref={(el) => { element.current = el; }} {...props} />}
    {error ? <Notice role="alert" errorId={(folder.error ?? error).id} actions={error.id === "FILE_ACCESS_FOLDER_NOT_CHOSEN" && src && "permission" in src ? [<Button key="pick" data-ks-user-consent onClick={(event) => { if (event.nativeEvent.isTrusted) folder.pick(src.permission, () => setAttempt((value) => value + 1)); }}>폴더 선택</Button>] : undefined}>{(folder.error ?? error).message}</Notice> : null}
    <div className="ks-media-controls-container">
      <div className="ks-media-controls" onKeyDown={onKeyDown}>
        <div className="ks-media-main">
          <IconButton aria-label={playing ? "일시 정지" : "재생"} disabled={!current || !!error} onClick={toggle}><DataIcon name={playing ? "pause" : "play"} /></IconButton>
          <input aria-label="재생 위치" className="ks-media-range ks-media-seek" type="range" min="0" max={duration || 0} step="any" value={Math.min(time, duration)} disabled={!current || !!error || !duration} onChange={(e) => seek(Number(e.target.value))} style={{ "--ks-range-progress": `${duration ? time / duration * 100 : 0}%` } as React.CSSProperties} />
        </div>
        <div className="ks-media-secondary">
          <span className="ks-media-time">{formatMediaTime(time)} / {formatMediaTime(duration)}</span>
          <IconButton aria-label={muted ? "소리 켜기" : "소리 끄기"} disabled={!current || !!error} onClick={() => { if (element.current) element.current.muted = !element.current.muted; }}><DataIcon name={muted ? "volume-x" : "volume-2"} /></IconButton>
          <input aria-label="소리 크기" className="ks-media-range ks-media-volume" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} disabled={!current || !!error} onChange={(e) => { if (element.current) { element.current.volume = Number(e.target.value); element.current.muted = false; } }} style={{ "--ks-range-progress": `${muted ? 0 : volume * 100}%` } as React.CSSProperties} />
        </div>
      </div>
    </div>
  </div>;
}
