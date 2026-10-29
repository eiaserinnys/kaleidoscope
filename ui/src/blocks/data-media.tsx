import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Block, MediaRef } from "../contract/contract";
import { useBinding, useWindowData } from "../data/window-data";
import { DataState } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { isMedia } from "../components/media-thumbnail";
import { IconButton, Notice } from "../components/primitives";
import { toCoreError } from "../core/core-transport";

type Data = Extract<Block, { type: "media" }>;
export function formatMediaTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function MediaBlock({ block, pointer }: { block: Data; pointer: string }) {
  const binding = useBinding(`${pointer}/src`, block.src);
  if (binding.status !== "ready") return <DataState value={binding} />;
  return <MediaPlayer src={isMedia(binding.value) ? binding.value : null} kind={block.kind} autoplay={!!block.autoplay} />;
}
function MediaPlayer({ src, kind, autoplay }: { src: MediaRef | null; kind?: "audio" | "video"; autoplay: boolean }) {
  const data = useWindowData();
  const key = src ? JSON.stringify(src) : "";
  const [loaded, setLoaded] = useState<{ key: string; url: string; mime: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const element = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setLoaded(null); setError(null); setPlaying(false); setTime(0); setDuration(0);
    if (src) void data.store.call({ op: "data.media", window_id: data.windowId, media: src }).then((reply) => {
      if (!active) return;
      const bytes = Uint8Array.from(atob(reply.media.data_base64), (char) => char.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: reply.media.mime }));
      setLoaded({ key, url, mime: reply.media.mime });
    }).catch((reason: unknown) => { if (active) setError(toCoreError(reason).message); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [data, key]);
  const current = loaded?.key === key ? loaded : null;
  const video = (kind ?? (current?.mime.startsWith("video/") ? "video" : "audio")) === "video";
  const playbackError = () => { setError("재생할 수 없는 파일입니다"); setPlaying(false); setTime(0); setDuration(0); };
  // 늦게 온 재생 실패는 그 재생을 시작한 원본(Blob URL)이 아직 지금 원본일 때만 알린다. 같은 <audio>를 다시 쓰므로
  // 요소 비교만으로는 앞 원본의 실패가 새 원본을 덮는다.
  const currentUrl = useRef<string | null>(null);
  currentUrl.current = current?.url ?? null;
  const play = (el: HTMLMediaElement) => {
    const started = currentUrl.current;
    void el.play().catch((reason: unknown) => {
      if (element.current !== el || currentUrl.current !== started) return;
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
  const props = { src: current?.url, onError: () => { if (current) playbackError(); }, onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setTime(e.currentTarget.currentTime), onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0), onVolumeChange: (e: React.SyntheticEvent<HTMLMediaElement>) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); } };
  return <div className={`ks-media-player${video ? " is-video" : ""}`}>
    {video ? <video ref={(el) => { element.current = el; }} {...props} /> : <audio ref={(el) => { element.current = el; }} {...props} />}
    {error ? <Notice role="alert">{error}</Notice> : null}
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
