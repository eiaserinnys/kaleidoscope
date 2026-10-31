import type { CSSProperties } from "react";
import type { Block, MetricItem } from "../contract/contract";
import { Badge, isBadge } from "../components/badge";
import { DataState } from "../components/data-state";
import { isMedia, MediaThumbnail } from "../components/media-thumbnail";
import { useBinding } from "../data/window-data";
import { asArray, isObject, NoItems } from "./data-view-common";

function isMetric(value: unknown): value is MetricItem {
  return isObject(value) && typeof value.label === "string" &&
    (typeof value.value === "string" || (typeof value.value === "number" && Number.isFinite(value.value)));
}

export function MetricsBlock({ block, pointer }: { block: Extract<Block, { type: "metrics" }>; pointer: string }) {
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState value={value} />;
  const items = asArray(value.value).filter(isMetric);
  if (!items.length) return <NoItems />;
  const groups: Array<{ featured: boolean; items: MetricItem[] }> = [];
  for (const item of items) {
    const featured = Boolean(item.featured) || items.length === 1;
    const last = groups.at(-1);
    if (!featured && last && !last.featured) last.items.push(item);
    else groups.push({ featured, items: [item] });
  }
  const tile = (item: MetricItem, index: number) => {
    const featured = Boolean(item.featured) || items.length === 1;
    const hasMedia = isMedia(item.image);
    return <div key={typeof item.key === "string" ? item.key : index} className={`ks-metric-card tone-${item.tone ?? "default"}${item.align === "end" ? " is-align-end" : ""}${featured ? " is-featured" : ""}${hasMedia ? " has-media" : ""}`}>
      {hasMedia && <MediaThumbnail className="ks-metric-media" media={item.image!} size={featured ? 48 : 32} />}
      <div className="ks-metric-content">
        <div className="ks-metric-label">{item.label}</div>
        <div className="ks-metric-value-row"><span className="ks-metric-value">{String(item.value)}{typeof item.unit === "string" && <span className="ks-metric-unit">{item.unit}</span>}</span>{isBadge(item.badge) && <Badge value={item.badge} />}</div>
        {typeof item.subtext === "string" && item.subtext && <div className="ks-metric-subvalue">{item.subtext}</div>}
      </div>
    </div>;
  };
  return <div className="ks-metrics-container"><div className={`ks-metrics${items.length === 1 || block.columns === 1 ? " is-single" : ""}`} style={{ "--ks-metrics-columns": block.columns } as CSSProperties}>
    {groups.map((group, index) => group.featured ? tile(group.items[0], index) : <div className="ks-metrics-grid" key={index} style={block.columns ? { "--ks-metrics-columns": Math.min(block.columns, group.items.length) } as CSSProperties : undefined}>{group.items.map(tile)}</div>)}
  </div></div>;
}
