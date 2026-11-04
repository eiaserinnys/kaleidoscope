export const SIDE_MIN = 240;
export const DOCUMENT_MIN = 360;
export const DIVIDER_WIDTH = 1;
export const THREE_COLUMN_MIN = SIDE_MIN * 2 + DOCUMENT_MIN + DIVIDER_WIDTH * 2;

export type SideWidths = { left: number; right: number };

export function fitSideWidths(widths: SideWidths, total: number): SideWidths {
  const available = Math.max(0, total - THREE_COLUMN_MIN);
  const leftExtra = Math.max(0, widths.left - SIDE_MIN);
  const rightExtra = Math.max(0, widths.right - SIDE_MIN);
  const extra = leftExtra + rightExtra;
  if (extra <= available) return widths;
  return { left: SIDE_MIN + available * leftExtra / extra, right: SIDE_MIN + available * rightExtra / extra };
}
