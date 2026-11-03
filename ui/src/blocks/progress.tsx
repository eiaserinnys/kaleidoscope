import type { Block } from "../contract/contract";
import { DataState } from "../components/data-state";
import { useBinding } from "../data/window-data";

interface Props { block: Extract<Block, { type: "progress" }>; pointer: string }

export function progressIndicator(current: number | null, max: number, text: string | null) {
  const ratio = current === null || max <= 0 ? 0 : current / max;
  return <div className={`ks-data-progress${current === null ? " is-indeterminate" : ""}`} role="progressbar"
    aria-label={text ?? "진행률"} aria-valuemin={0} aria-valuemax={max}
    aria-valuenow={current ?? undefined} aria-valuetext={current === null ? "미정" : undefined}>
    <span className="ks-data-progress-value" style={current === null ? undefined : { transform: `scaleX(${ratio})` }} />
  </div>;
}

export function ProgressBlock({ block, pointer }: Props) {
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  if (value.status !== "ready") return <DataState value={value} compact />;
  const text = label.status === "ready" && label.value !== null
    ? typeof label.value === "string" ? label.value : JSON.stringify(label.value) ?? "null"
    : null;
  const current = typeof value.value === "number" && Number.isFinite(value.value)
    ? Math.max(0, Math.min(block.max, value.value))
    : null;
  return <div className="ks-data-progress-field">
    {text ? <span className="ks-data-progress-label">{text}</span> : null}
    {progressIndicator(current, block.max, text)}
  </div>;
}
