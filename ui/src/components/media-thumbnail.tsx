import { useEffect, useMemo, useRef, useState } from "react";
import type { Crop, MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { DataIcon } from "./data-icons";
import { IconImage, iconImageFromData } from "./app-icon";

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
    const measure = () => { const rect = element.getBoundingClientRect(); setMeasured(Math.ceil(Math.max(rect.width, rect.height))); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const result = useMedia(measured ? media : null, measured || size);
  const url = result.status === "ready" ? result.url : null;
  const image = useMemo(() => {
    if (!icon || !url) return null;
    const [header, base64] = url.split(",");
    return iconImageFromData(header.slice(5, -7), base64);
  }, [icon, url]);
  const style = cropStyle(media?.crop);
  return <span ref={ref} style={icon ? { color: "inherit" } : undefined} className={`ks-media-thumbnail${media && "asset" in media ? " is-asset" : ""} ${className}`}>{result.status === "ready" ? image ? <IconImage image={image} size="tile" /> : <img alt="" src={result.url} style={style} /> : <DataIcon name="image" size="empty" />}</span>;
}
