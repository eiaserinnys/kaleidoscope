import { useEffect, useRef, useState } from "react";
import type { Crop, MediaRef } from "../contract/contract";
import { useMedia } from "../data/use-media";
import { DataIcon } from "./data-icons";

export function isMedia(value: unknown): value is MediaRef {
  return typeof value === "object" && value !== null && "permission" in value && typeof value.permission === "string" && "path" in value && typeof value.path === "string";
}
export function cropStyle(crop: Crop | undefined) {
  return crop && crop.w > 0 && crop.h > 0 ? { width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${-100 * crop.x / crop.w}%`, top: `${-100 * crop.y / crop.h}%` } : undefined;
}
export function MediaThumbnail({ media, size, className = "" }: { media: MediaRef | null; size: number; className?: string }) {
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
  const url = useMedia(measured ? media : null, measured || size);
  const style = cropStyle(media?.crop);
  return <span ref={ref} className={`ks-media-thumbnail ${className}`}>{url ? <img alt="" src={url} style={style} /> : <DataIcon name="image" size="empty" />}</span>;
}
