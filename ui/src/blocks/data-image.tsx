import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, MediaRef } from "../contract/contract";
import { useBinding } from "../data/window-data";
import { useMedia } from "../data/use-media";
import { DataState } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { cropStyle, isMedia } from "../components/media-thumbnail";
import { EmptyState, IconButton } from "../components/primitives";

type Data = Extract<Block, { type: "image" }>;
export function imageRequestSize(width: number, height: number, ratio: number, zoom: number): number {
  const wanted = Math.max(width, height) * ratio * zoom;
  return [512, 1024, 2048, 4096].find((size) => size >= wanted) ?? 4096;
}
export function ImageBlock({ block, pointer }: { block: Data; pointer: string }) {
  const binding = useBinding(`${pointer}/src`, block.src);
  if (binding.status !== "ready") return <DataState value={binding} />;
  return <ImageView media={isMedia(binding.value) ? binding.value : null} fit={block.fit ?? "contain"} zoomable={!!block.zoom} />;
}
function ImageView({ media, fit, zoomable }: { media: MediaRef | null; fit: "contain" | "cover"; zoomable: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const key = media ? JSON.stringify(media) : "";
  useEffect(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, [key]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setSize({ width: rect.width, height: rect.height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const dpr = globalThis.devicePixelRatio || 1;
  const bucket = imageRequestSize(size.width, size.height, dpr, scale);
  // useMedia는 전달 크기에 기기의 픽셀 비율을 곱한다.
  const url = useMedia(size.width && size.height ? media : null, bucket / dpr);
  const adjust = (next: number, x = 0, y = 0) => {
    const target = Math.max(1, Math.min(8, next));
    if (target === 1) setOffset({ x: 0, y: 0 });
    else setOffset((old) => ({ x: x - (x - old.x) * target / scale, y: y - (y - old.y) * target / scale }));
    setScale(target);
  };
  useEffect(() => {
    const element = host.current; if (!element || !zoomable || !media) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = element.getBoundingClientRect();
      adjust(scale * (event.deltaY < 0 ? 1.25 : 0.8), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    element.addEventListener("wheel", wheel, { passive: false }); return () => element.removeEventListener("wheel", wheel);
  }, [scale, zoomable, key]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!zoomable || !media) return;
    if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); adjust(event.key === "0" ? 1 : scale * (event.key === "-" ? 0.8 : 1.25)); }
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!zoomable || scale <= 1 || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => { if (drag.current) setOffset({ x: drag.current.offsetX + event.clientX - drag.current.x, y: drag.current.offsetY + event.clientY - drag.current.y }); };
  const crop = media?.crop;
  const cropWidth = crop && crop.w > 0 && crop.h > 0 ? crop.w : 1;
  const cropHeight = crop && crop.w > 0 && crop.h > 0 ? crop.h : 1;
  const sourceWidth = natural.width * cropWidth, sourceHeight = natural.height * cropHeight;
  const factor = sourceWidth && sourceHeight ? (fit === "cover" ? Math.max(size.width / sourceWidth, size.height / sourceHeight) : Math.min(size.width / sourceWidth, size.height / sourceHeight)) : 0;
  return <div className={`ks-image-view${zoomable ? " is-zoomable" : ""}`} ref={host} tabIndex={zoomable && media ? 0 : undefined} onKeyDown={onKeyDown} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => { if (zoomable) adjust(1); }}>
    {media && url ? <div className="ks-image-frame" style={{ width: sourceWidth * factor, height: sourceHeight * factor, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}><img alt="" src={url} style={cropStyle(crop)} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} draggable={false} /></div> : <EmptyState icon={<DataIcon name="image" size="empty" />} />}
    {zoomable && media ? <div className="ks-image-controls" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <IconButton aria-label="축소" onClick={() => adjust(scale * 0.8)} disabled={scale <= 1}><DataIcon name="zoom-out" /></IconButton>
      <IconButton aria-label="확대" onClick={() => adjust(scale * 1.25)} disabled={scale >= 8}><DataIcon name="zoom-in" /></IconButton>
      <IconButton aria-label="맞춤" onClick={() => adjust(1)} disabled={scale === 1}><DataIcon name="maximize-2" /></IconButton>
    </div> : null}
  </div>;
}
