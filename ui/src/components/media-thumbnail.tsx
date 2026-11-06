import { useEffect, useMemo, useRef, useState } from "react";
import type { Crop, MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { DataIcon } from "./data-icons";
import { IconImage, iconImageFromData } from "./app-icon";
import { ICON_SIZE, ImageOff } from "./icons";

export function isMedia(value: unknown): value is MediaRef {
  return typeof value === "object" && value !== null && (("asset" in value && typeof value.asset === "string") || ("permission" in value && typeof value.permission === "string" && "path" in value && typeof value.path === "string"));
}
export function cropStyle(crop: Crop | undefined) {
  return crop && crop.w > 0 && crop.h > 0 ? { width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${-100 * crop.x / crop.w}%`, top: `${-100 * crop.y / crop.h}%` } : undefined;
}
export function MediaThumbnail({ media, size, className = "", icon = false }: { media: MediaRef | null; size: number; className?: string; icon?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const pixels = Math.ceil(Math.max(rect.width, rect.height) * (globalThis.devicePixelRatio || 1));
      setMeasured(pixels ? [64, 128, 256, 512, 1024].find((step) => step >= pixels) ?? pixels : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const result = useMedia(measured ? media : null, measured ? measured / (globalThis.devicePixelRatio || 1) : size);
  const url = result.status === "ready" ? result.url : null;
  const image = useMemo(() => {
    if (!icon || !url || !media) return null;
    const [header, base64] = url.split(",");
    const mime = header.slice(5, -7);
    return "asset" in media || mime === "image/svg+xml" ? iconImageFromData(mime, base64) : null;
  }, [icon, url, media]);
  const style = cropStyle(media?.crop);
  return <span ref={ref} style={icon && image ? { color: "inherit" } : undefined} className={`ks-media-thumbnail${media && "asset" in media ? " is-asset" : ""}${image ? " is-icon-image" : ""}${media ? ` is-${result.status}` : ""} ${className}`} title={result.status === "failed" ? `${result.error.message} ${result.error.id ?? ""}` : undefined}>{!media ? <DataIcon name="image" size="empty" /> : result.status === "loading" ? icon ? <i aria-hidden="true" className="ks-icon-skeleton-icon" style={{ width: ICON_SIZE.tile, height: ICON_SIZE.tile }} /> : null : result.status === "failed" ? <ImageOff size="empty" /> : image ? <IconImage image={image} size="tile" /> : <img alt="" src={result.url} style={style} draggable={false} />}</span>;
}
