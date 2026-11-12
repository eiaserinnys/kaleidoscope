import { useEffect, useMemo, useRef, useState } from "react";
import type { Crop, MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { DataIcon } from "./data-icons";
import { IconImage, iconImageFromData } from "./app-icon";
import { ICON_SIZE, ImageOff } from "./icons";

export function isMedia(value: unknown): value is MediaRef {
  return typeof value === "object" && value !== null && (("asset" in value && typeof value.asset === "string") || ("blob" in value && typeof value.blob === "string") || ("app_icon" in value && typeof value.app_icon === "string") || ("permission" in value && typeof value.permission === "string" && "path" in value && typeof value.path === "string"));
}
export function cropStyle(crop: Crop | undefined) {
  return crop && crop.w > 0 && crop.h > 0 ? { width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${-100 * crop.x / crop.w}%`, top: `${-100 * crop.y / crop.h}%` } : undefined;
}
export function MediaThumbnail({ media, className = "", icon = false, fallback }: { media: MediaRef | null; className?: string; icon?: boolean; fallback?: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const assetLike = !!media && ("asset" in media || "app_icon" in media);
  const [measured, setMeasured] = useState({ size: 0, assetLike });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const dpr = globalThis.devicePixelRatio || 1;
      let pixels = Math.ceil(Math.max(rect.width, rect.height) * dpr);
      if (pixels && !assetLike) pixels = Math.max(Math.ceil(pixels * 1.5), Math.ceil(128 * dpr));
      const size = pixels ? [64, 128, 256, 512, 1024].find((step) => step >= pixels) ?? pixels : 0;
      setMeasured((old) => old.size === size && old.assetLike === assetLike ? old : { size, assetLike });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [assetLike]);
  const result = useMedia(media, measured.assetLike === assetLike ? measured.size / (globalThis.devicePixelRatio || 1) : 0, { showSmaller: true });
  const url = result.status === "ready" ? result.url : null;
  const image = useMemo(() => {
    if (!icon || !url || !media) return null;
    const [header, base64] = url.split(",");
    const mime = header.slice(5, -7);
    return assetLike || mime === "image/svg+xml" ? iconImageFromData(mime, base64) : null;
  }, [icon, url, media, assetLike]);
  const style = cropStyle(media && "crop" in media ? media.crop : undefined);
  // 앱 아이콘을 그릴 수 없으면 넘겨받은 그림을 그대로 돌려준다. 실패 표시 span을 감싸면
  // 아이콘을 선언하지 않은 칸과 바탕과 크기가 달라진다.
  if (media && result.status === "failed" && "app_icon" in media && fallback !== undefined) return <>{fallback}</>;
  return <span ref={ref} style={icon && image ? { color: "inherit" } : undefined} className={`ks-media-thumbnail${assetLike ? " is-asset" : ""}${image ? " is-icon-image" : ""}${media ? ` is-${result.status}` : ""} ${className}`} title={result.status === "failed" ? `${result.error.message} ${result.error.id ?? ""}` : undefined}>{!media ? <DataIcon name="image" size="empty" /> : result.status === "loading" ? icon ? <i aria-hidden="true" className="ks-icon-skeleton-icon" style={{ width: ICON_SIZE.tile, height: ICON_SIZE.tile }} /> : null : result.status === "failed" ? <ImageOff size="empty" /> : image ? <IconImage image={image} size="tile" /> : <img alt="" src={result.url} style={style} draggable={false} />}</span>;
}
