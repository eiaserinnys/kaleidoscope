export interface DesktopIconShortcut {
  id: string;
  desktop_id: string;
  app_id: string;
  column: number;
  row: number;
}

export interface DesktopIconCell {
  column: number;
  row: number;
}

export interface DesktopIconPlacement extends DesktopIconCell {
  shortcut: DesktopIconShortcut;
}

export interface DesktopIconGridMetrics {
  columnWidth: number;
  rowHeight: number;
  gap: number;
}

/**
 * 저장된 좌표를 지킨다. 범위 안의 좌표를 먼저 놓고, 겹치거나 범위 밖인
 * 바로가기만 아이디 순서로 열을 당긴 뒤 행 우선 다음 빈 칸에 놓는다.
 * 저장 좌표 자체는 바꾸지 않으므로 창 폭이 다시 넓어지면 원래 자리로 돌아온다.
 */
export function layoutDesktopIcons(shortcuts: readonly DesktopIconShortcut[], columns: number): DesktopIconPlacement[] {
  const width = Math.max(1, Math.floor(columns));
  const ordered = [...shortcuts].sort((left, right) => compareIds(left.id, right.id));
  const placed = new Map<string, DesktopIconCell>();
  const occupied = new Set<string>();

  for (const shortcut of ordered) {
    if (shortcut.column < 0 || shortcut.column >= width || shortcut.row < 0) continue;
    const cell = { column: shortcut.column, row: shortcut.row };
    if (occupied.has(cellKey(cell))) continue;
    occupied.add(cellKey(cell));
    placed.set(shortcut.id, cell);
  }

  for (const shortcut of ordered) {
    if (placed.has(shortcut.id)) continue;
    let cell = {
      column: clamp(shortcut.column, 0, width - 1),
      row: Math.max(0, shortcut.row),
    };
    while (occupied.has(cellKey(cell))) cell = nextCell(cell, width);
    occupied.add(cellKey(cell));
    placed.set(shortcut.id, cell);
  }

  return ordered.map((shortcut) => ({ shortcut, ...placed.get(shortcut.id)! }));
}

/** 읽는 순서(행, 열, 아이디)로 정렬한다. 포커스 이동과 탭 순서가 이 순서를 쓴다. */
export function readingOrder(placements: readonly DesktopIconPlacement[]): DesktopIconPlacement[] {
  return [...placements].sort((left, right) =>
    left.row - right.row || left.column - right.column || compareIds(left.shortcut.id, right.shortcut.id));
}

/** 놓으려는 칸에서 가장 가까운 빈 칸을 맨해튼 거리로 찾는다. 옮기는 타일의 기존 칸은 비워 둔다. */
export function nearestFreeCell(
  placements: readonly DesktopIconPlacement[],
  target: DesktopIconCell,
  columns: number,
  excludeShortcutId?: string,
): DesktopIconCell {
  const width = Math.max(1, Math.floor(columns));
  const start = { column: clamp(target.column, 0, width - 1), row: Math.max(0, target.row) };
  const occupied = new Set<string>();
  let maxRow = start.row;
  for (const placement of placements) {
    if (placement.shortcut.id === excludeShortcutId) continue;
    occupied.add(cellKey(placement));
    maxRow = Math.max(maxRow, placement.row);
  }
  if (!occupied.has(cellKey(start))) return start;

  let best = start;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let row = 0; row <= maxRow + 1; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const cell = { column, row };
      if (occupied.has(cellKey(cell))) continue;
      const distance = Math.abs(column - start.column) + Math.abs(row - start.row);
      if (distance < bestDistance || (distance === bestDistance && (row < best.row || (row === best.row && column < best.column)))) {
        best = cell;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** 끌어 놓은 타일의 중심이 가리키는 칸을 계산한다. */
export function cellFromRect(
  rect: { left: number; top: number; width: number; height: number },
  grid: { left: number; top: number },
  metrics: DesktopIconGridMetrics,
  columns: number,
): DesktopIconCell {
  const width = Math.max(1, Math.floor(columns));
  const stepX = metrics.columnWidth + metrics.gap;
  const stepY = metrics.rowHeight + metrics.gap;
  const centerX = rect.left + rect.width / 2 - grid.left;
  const centerY = rect.top + rect.height / 2 - grid.top;
  return {
    column: clamp(Math.floor(centerX / stepX), 0, width - 1),
    row: Math.max(0, Math.floor(centerY / stepY)),
  };
}

function nextCell(cell: DesktopIconCell, columns: number): DesktopIconCell {
  return cell.column + 1 < columns
    ? { column: cell.column + 1, row: cell.row }
    : { column: 0, row: cell.row + 1 };
}

function cellKey(cell: DesktopIconCell): string {
  return `${cell.column}:${cell.row}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
