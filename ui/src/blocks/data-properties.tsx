import type { Block, PropertyField } from "../contract/contract";
import { Badge, isBadge } from "../components/badge";
import { DataState } from "../components/data-state";
import { useBinding } from "../data/window-data";
import { MarkdownText } from "./markdown-text";
import { display } from "./data-layout";
import { asArray, dateText } from "./data-view-common";

function Property({ field, pointer }: { field: PropertyField; pointer: string }) {
  const value = useBinding(pointer, field.value);
  if (value.status === "ready" && (value.value === null || value.value === "")) return null;
  let content;
  if (value.status === "loading") content = <div className="ks-property-loading" role="status" aria-label="불러오는 중" />;
  else if (value.status !== "ready") content = <DataState value={value} compact />;
  else if (field.format === "badge") {
    const badges = asArray(value.value);
    content = <span className="ks-view-badges">{badges.filter(isBadge).map((badge, i) => <Badge value={badge} key={i} />)}</span>;
  } else if (field.format === "markdown") content = <MarkdownText>{display(value.value)}</MarkdownText>;
  else if (field.format === "code") content = <code>{display(value.value)}</code>;
  else if (field.format === "date") content = dateText(value.value);
  else content = display(value.value);
  return <><dt>{field.label}</dt><dd>{content}</dd></>;
}
export function PropertiesBlock({ block, pointer }: { block: Extract<Block, { type: "properties" }>; pointer: string }) {
  return <div className="ks-properties-container"><dl className="ks-properties">{block.fields.map((field, index) => <Property key={index} field={field} pointer={`${pointer}/fields/${index}/value`} />)}</dl></div>;
}
