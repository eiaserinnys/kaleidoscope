import { memo, useMemo, type CSSProperties } from "react";
import type { Column } from "../contract/contract";
import { badgeForeground, validColor } from "../components/badge";
import { Notice } from "../components/primitives";
import { SHELL_TABLE_CELL_CONTENT_INVALID } from "../contract/shell-errors";
import { Badges, isObject } from "./data-view-common";

function parseContent(value: unknown) {
  return value == null ? null : isObject(value) && typeof value.title === "string" &&
    (value.subtitle == null || typeof value.subtitle === "string") &&
    (value.color == null || typeof value.color === "string") ? value : undefined;
}

export function contentCellError(value: unknown, column: Column) {
  return parseContent(value) === undefined ? SHELL_TABLE_CELL_CONTENT_INVALID({ field: column.field }) : null;
}

export const ContentCell = memo(function ContentCell({ value, column }: { value: unknown; column: Column }) {
  const content = useMemo(() => parseContent(value), [value]);
  if (content === undefined) {
    const error = SHELL_TABLE_CELL_CONTENT_INVALID({ field: column.field });
    return <span className="ks-table-content is-error" title={`${error.message} ${error.id}`} aria-label={`오류: ${error.message}, ${error.id}`} style={{ "--ks-table-lines": column.max_lines ?? 3 } as CSSProperties}>
      <Notice role="alert" errorId={error.id}><span className="ks-table-error-message">{error.message}</span></Notice>
    </span>;
  }
  const color = validColor(content?.color) ? content.color : undefined;
  return <span className="ks-table-content" style={{ ...(color ? { backgroundColor: color, color: badgeForeground(color) } : {}), "--ks-table-lines": column.max_lines ?? 3 } as CSSProperties}>
    {content && <><span className="ks-table-content-title">{String(content.title)}</span>
      {typeof content.subtitle === "string" && <span className="ks-table-content-subtitle">{content.subtitle}</span>}
      <Badges values={content.badges} /></>}
  </span>;
});
