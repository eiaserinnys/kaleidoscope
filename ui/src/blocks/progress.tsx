import type { CSSProperties } from "react";
import { useBlockRootProps } from "../comments/block-root";
import type { Block } from "../contract/contract";
import { BindingFailureNotice, DataState } from "../components/data-state";
import { useBinding } from "../data/window-data";

interface Props { block: Extract<Block, { type: "progress" }>; pointer: string }

interface PaceOptions { segments?: number | null; marker?: number | null; color?: string }

/**
 * 바를 같은 폭의 `segments`칸으로 나누는 칸막이의 마스크. 칸막이마다 트랙과 채움을 함께
 * 투명하게 오려 내고, 틈은 `--ks-line-width`다. 칸 수가 2 미만이면 마스크를 쓰지 않는다.
 */
export function progressDividerMask(segments: number) {
  if (!Number.isInteger(segments) || segments < 2) return null;
  const stops: string[] = [];
  for (let index = 1; index < segments; index += 1) {
    stops.push(`#000 0 calc(100% / ${segments} * ${index} - var(--ks-line-width) / 2)`);
    stops.push(`transparent 0 calc(100% / ${segments} * ${index} + var(--ks-line-width) / 2)`);
  }
  stops.push("#000 0");
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export function progressIndicator(current: number | null, max: number, text: string | null, pace?: PaceOptions) {
  const ratio = current === null || max <= 0 ? 0 : current / max;
  const mask = pace?.segments == null ? null : progressDividerMask(pace.segments);
  const marker = pace?.marker ?? null;
  const bar = <div className={`ks-data-progress${current === null ? " is-indeterminate" : ""}${mask ? " is-segmented" : ""}`} role="progressbar"
    aria-label={text ?? "진행률"} aria-valuemin={0} aria-valuemax={max}
    aria-valuenow={current ?? undefined} aria-valuetext={current === null ? "미정" : undefined}
    style={mask ? { "--ks-progress-mask": mask } as CSSProperties : undefined}>
    <span className="ks-data-progress-value" style={current === null ? undefined : { transform: `scaleX(${ratio})`, backgroundColor: pace?.color }} />
  </div>;
  if (!mask && marker === null) return bar;
  return <div className="ks-data-progress-pace">
    {bar}
    {marker === null ? null : <span className="ks-data-progress-marker" aria-hidden="true" style={{ left: `${marker * 100}%` }} />}
  </div>;
}

export function ProgressBlock({ block, pointer }: Props) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const marker = useBinding(`${pointer}/marker`, block.marker ?? null);
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} compact />;
  const text = label.status === "ready" && label.value !== null
    ? typeof label.value === "string" ? label.value : JSON.stringify(label.value) ?? "null"
    : null;
  const current = typeof value.value === "number" && Number.isFinite(value.value)
    ? Math.max(0, Math.min(block.max, value.value))
    : null;
  const raw = typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  const color = raw !== null && block.danger_at != null && raw >= block.danger_at ? "var(--ks-color-danger)"
    : raw !== null && block.warning_at != null && raw >= block.warning_at ? "var(--ks-color-warning)" : undefined;
  // 커서는 0..max 밖이면 끝으로 붙이고, 수가 아니면 그리지 않는다.
  const markerValue = block.max > 0 && marker.status === "ready"
    && typeof marker.value === "number" && Number.isFinite(marker.value)
    ? Math.max(0, Math.min(1, marker.value / block.max))
    : null;
  return <div {...blockRoot} className="ks-data-progress-field">
    {text ? <span className="ks-data-progress-label">{text}</span> : null}
    {progressIndicator(current, block.max, text, { segments: block.segments ?? null, marker: markerValue, color })}
    <BindingFailureNotice value={label} />
    <BindingFailureNotice value={marker} />
  </div>;
}
