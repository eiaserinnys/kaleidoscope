import { useBlockRootProps } from "../comments/block-root";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, MediaRef } from "../contract/contract";
import { useBinding } from "../data/window-data";
import { useMedia } from "../data/use-media";
import { DataState, useFolderPick } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { cropStyle, isMedia } from "../components/media-thumbnail";
import { Button, EmptyState, ErrorId, IconButton } from "../components/primitives";
import { PreviewContext } from "./preview-context";
import { openContextMenu, writeMenuImage } from "../components/context-menu";
import { capturePointer } from "../share/pointer-capture";

type Data = Extract<Block, { type: "image" }>;
export function imageRequestSize(width: number, height: number, ratio: number, zoom: number): number {
  const wanted = Math.max(width, height) * ratio * zoom;
  return [512, 1024, 2048, 4096].find((size) => size >= wanted) ?? 4096;
}
export function ImageBlock({ block, pointer }: { block: Data; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const binding = useBinding(`${pointer}/src`, block.src);
  const preview = useContext(PreviewContext);
  const bindingError = binding.status === "failed" ? `${binding.message} (${binding.id})` : binding.status === "login_required" ? "로그인이 필요합니다" : null;
  useEffect(() => { if (binding.status !== "ready") preview?.(bindingError); }, [preview, binding.status, bindingError]);
  if (binding.status === "loading") return <div {...blockRoot} className="ks-image-view"><ImageLoading /></div>;
  if (binding.status !== "ready") return preview ? <div {...blockRoot} className="ks-image-view"><PreviewFailure error={bindingError ?? "이미지를 불러오지 못했습니다"} /></div>
    : <div {...blockRoot} className="ks-image-view is-failed"><DataState value={binding} /></div>;
  return <ImageView media={isMedia(binding.value) ? binding.value : null} fit={block.fit ?? "contain"} zoomable={!!block.zoom && !preview} />;
}
function ImageLoading() {
  return <div className="ks-data-progress is-indeterminate" role="progressbar" aria-label="이미지를 불러오는 중"><span className="ks-data-progress-value" /></div>;
}
function PreviewFailure({ error }: { error: string }) {
  return <span title={error} role="img" aria-label={error}><DataIcon name="triangle-alert" size="inline" /></span>;
}
function ImageView({ media, fit, zoomable }: { media: MediaRef | null; fit: "contain" | "cover"; zoomable: boolean }) {
  const blockRoot = useBlockRootProps();
  const preview = useContext(PreviewContext);
  const folder = useFolderPick();
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [overflowKey, setOverflowKey] = useState("");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleKey = useRef("");
  const key = media ? JSON.stringify(media) : "";
  // 그림이 바뀐 직후의 첫 렌더는 아직 이전 배율을 들고 있다. 그 배율로는 작은 판을 보이지 않는다.
  useEffect(() => { scaleKey.current = key; setScale(1); setOffset({ x: 0, y: 0 }); folder.clear(); }, [key]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setSize({ width: rect.width, height: rect.height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const dpr = globalThis.devicePixelRatio || 1;
  const bucket = imageRequestSize(size.width, size.height, dpr, scale);
  // useMedia는 전달 크기에 기기의 픽셀 비율을 곱한다.
  // 확대 중에는 더 큰 판이 오기 전까지 이전 판을 그대로 보여 준다.
  const result = useMedia(size.width && size.height ? media : null, bucket / dpr, { showSmaller: scale > 1 && scaleKey.current === key });
  const adjust = (next: number, x = 0, y = 0) => {
    const target = Math.max(1, Math.min(8, next));
    if (target === 1) setOffset({ x: 0, y: 0 });
    else setOffset((old) => ({ x: x - (x - old.x) * target / scale, y: y - (y - old.y) * target / scale }));
    setScale(target);
  };
  useEffect(() => {
    const element = host.current; if (!element || !zoomable || !media) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
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
    drag.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; capturePointer(event);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => { if (drag.current) setOffset({ x: drag.current.offsetX + event.clientX - drag.current.x, y: drag.current.offsetY + event.clientY - drag.current.y }); };
  const crop = media && "crop" in media ? media.crop : undefined;
  const cropWidth = crop && crop.w > 0 && crop.h > 0 ? crop.w : 1;
  const cropHeight = crop && crop.w > 0 && crop.h > 0 ? crop.h : 1;
  const sourceWidth = natural.width * cropWidth, sourceHeight = natural.height * cropHeight;
  const factor = sourceWidth && sourceHeight ? (fit === "cover" ? Math.max(size.width / sourceWidth, size.height / sourceHeight) : Math.min(size.width / sourceWidth, size.height / sourceHeight)) : 0;
  const compact = size.height < 200;
  const failure = result.status === "failed" ? folder.error ?? result.error : null;
  const previewError = failure ? `${failure.message} (${failure.id})` : null;
  useEffect(() => { preview?.(previewError); }, [preview, previewError]);
  const layoutKey = JSON.stringify([key, size.width, size.height, failure?.id, failure?.message]);
  const short = size.width < 258 || (size.width < 300 && size.height < 200) || overflowKey === layoutKey;
  const chooseFolder = result.status === "failed" && result.error.id === "FILE_ACCESS_FOLDER_NOT_CHOSEN" && media && "permission" in media;
  const action = chooseFolder ? <Button data-ks-user-consent onClick={(event) => { if (event.nativeEvent.isTrusted) folder.pick(media.permission, result.retry); }}>폴더 선택</Button> : <Button onClick={result.retry}>다시 받기</Button>;
  useLayoutEffect(() => {
    if (!failure || short || !host.current) return;
    const bounds = host.current.getBoundingClientRect();
    const elements = host.current.querySelectorAll(".ks-empty-state-text, .ks-empty-state-action, .ks-empty-state-icon");
    if ([...elements].some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5 || rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5;
    })) setOverflowKey(layoutKey);
  }, [failure, short, layoutKey]);
  return <div {...blockRoot} className={`ks-image-view${zoomable ? " is-zoomable" : ""}${result.status === "failed" ? " is-failed" : ""}`} ref={host} style={media && sourceWidth && sourceHeight ? { "--ks-image-ratio": sourceWidth / sourceHeight, ...(result.status !== "failed" && Math.max(natural.width, natural.height) < bucket ? { "--ks-image-natural-height": `${sourceHeight}px` } : {}) } as React.CSSProperties : undefined} tabIndex={!preview && media && result.status === "ready" ? 0 : undefined} onContextMenu={preview ? undefined : (event) => {
    const image = host.current?.querySelector(".ks-image-frame img");
    if (!(image instanceof HTMLImageElement) || (event.target !== event.currentTarget && event.target !== image)) return;
    openContextMenu(event, [{ id: "image-copy", label: "이미지 복사", onSelect: () => { void writeMenuImage(image, "이미지 복사"); } }]);
  }} onKeyDown={onKeyDown} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => { if (zoomable) adjust(1); }}>
    {!media ? <EmptyState icon={<DataIcon name="image" size="empty" />} />
      : result.status === "loading" ? <ImageLoading />
      : result.status === "failed" ? preview ? <PreviewFailure error={previewError!} /> : short
        ? <EmptyState text={<><span title={failure!.message}>이미지를 불러오지 못했습니다</span>{failure!.id ? <> <ErrorId id={failure!.id} /></> : null}</>} action={action} />
        : chooseFolder ? <div className={compact ? "ks-data-state-compact" : "ks-data-state"}><EmptyState icon={<DataIcon name="triangle-alert" size={compact ? "inline" : "empty"} />} text={<>{failure!.message}{failure!.id ? <> <ErrorId id={failure!.id} /></> : null}</>} action={action} /></div>
        : <DataState value={{ status: "failed", id: result.error.id, message: result.error.message, retry: [] }} compact={compact} onRetry={result.retry} />
      : <div className="ks-image-frame" style={{ width: sourceWidth * factor, height: sourceHeight * factor, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}><img alt="" src={result.url} style={cropStyle(crop)} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} draggable={false} /></div>}
    {zoomable && media && result.status === "ready" ? <div className="ks-image-controls" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <IconButton aria-label="축소" onClick={() => adjust(scale * 0.8)} disabled={scale <= 1}><DataIcon name="zoom-out" /></IconButton>
      <IconButton aria-label="확대" onClick={() => adjust(scale * 1.25)} disabled={scale >= 8}><DataIcon name="zoom-in" /></IconButton>
      <IconButton aria-label="맞춤" onClick={() => adjust(1)} disabled={scale === 1}><DataIcon name="maximize-2" /></IconButton>
    </div> : null}
  </div>;
}
