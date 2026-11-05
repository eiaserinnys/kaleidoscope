import { useLayoutEffect, useRef, useState } from "react";
import type { Badge as BadgeValue, Block, PropertyField } from "../contract/contract";
import { Badge, isBadge, validColor } from "../components/badge";
import { DataState } from "../components/data-state";
import { useBinding } from "../data/window-data";
import { MarkdownText } from "./markdown-text";
import { display } from "./data-layout";
import { asArray, dateText } from "./data-view-common";

function PropertyBadges({ badges }: { badges: BadgeValue[] }) {
  const group = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState<boolean[]>([]);
  useLayoutEffect(() => {
    const element = group.current!;
    const measure = () => {
      const next = [...element.querySelectorAll<HTMLElement>(":scope > .ks-badge")].map(badge => badge.scrollWidth > badge.clientWidth);
      setClipped(previous => previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [badges]);
  return <span className="ks-view-badges" ref={group}>{badges.map((badge, index) => <Badge value={badge} tooltip={clipped[index]} key={index} />)}</span>;
}

function Property({ field, pointer }: { field: PropertyField; pointer: string }) {
  const label = useBinding(`${pointer}/label`, field.label);
  const value = useBinding(`${pointer}/value`, field.value);
  if (value.status === "ready" && (value.value === null || value.value === "")) return null;
  const labelContent = label.status === "ready" ? display(label.value) : <DataState value={label} compact />;
  let content;
  if (value.status === "loading") content = <div className="ks-property-loading" role="status" aria-label="불러오는 중" />;
  else if (value.status !== "ready") content = <DataState value={value} compact />;
  else if (field.format === "swatches") {
    const colors = Array.isArray(value.value) ? value.value.filter(validColor) : [];
    content = <span className="ks-property-swatches">{colors.map((color, index) => <span key={index} className="ks-property-swatch" style={{ backgroundColor: color }} role="img" aria-label={color} title={color} />)}</span>;
  }
  else if (field.format === "badge") {
    const badges = asArray(value.value);
    content = <PropertyBadges badges={badges.filter(isBadge)} />;
  } else if (field.format === "markdown") content = <MarkdownText>{display(value.value)}</MarkdownText>;
  else if (field.format === "code") content = <code>{display(value.value)}</code>;
  else if (field.format === "date") content = dateText(value.value);
  else content = display(value.value);
  return <><dt>{labelContent}</dt><dd>{content}</dd></>;
}
export function PropertiesBlock({ block, pointer }: { block: Extract<Block, { type: "properties" }>; pointer: string }) {
  return <div className="ks-properties-container"><dl className={`ks-properties${block.layout === "rows" ? " is-rows" : ""}`}>{block.fields.map((field, index) => <Property key={index} field={field} pointer={`${pointer}/fields/${index}`} />)}</dl></div>;
}
