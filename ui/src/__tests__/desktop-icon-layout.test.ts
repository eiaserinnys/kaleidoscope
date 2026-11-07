import { describe, expect, it } from "vitest";
import {
  cellFromRect,
  layoutDesktopIcons,
  nearestFreeCell,
  readingOrder,
  type DesktopIconShortcut,
} from "../../../app/src/shell/desktop-icon-layout";

function shortcut(id: string, column: number, row: number): DesktopIconShortcut {
  return { id, desktop_id: "desktop-1", app_id: id, column, row };
}

function placement(shortcuts: readonly DesktopIconShortcut[], columns: number, id: string) {
  const found = layoutDesktopIcons(shortcuts, columns).find((item) => item.shortcut.id === id);
  if (!found) throw new Error(`배치되지 않음: ${id}`);
  return { column: found.column, row: found.row };
}

describe("바탕화면 아이콘 배치", () => {
  it("같은 칸을 가리키는 바로가기는 아이디 순서로 다음 빈 칸에 놓는다", () => {
    const shortcuts = [shortcut("b", 0, 0), shortcut("a", 0, 0)];
    expect(placement(shortcuts, 3, "a")).toEqual({ column: 0, row: 0 });
    expect(placement(shortcuts, 3, "b")).toEqual({ column: 1, row: 0 });
  });

  it("현재 열 수 밖의 열은 안쪽 열로 당겨 놓는다", () => {
    expect(placement([shortcut("a", 5, 0)], 3, "a")).toEqual({ column: 2, row: 0 });
  });

  it("범위 안의 저장 좌표를 범위 밖 바로가기보다 먼저 지킨다", () => {
    const shortcuts = [shortcut("a", 2, 0), shortcut("b", 0, 0), shortcut("c", 1, 0)];
    expect(placement(shortcuts, 2, "a")).toEqual({ column: 0, row: 1 });
    expect(placement(shortcuts, 2, "b")).toEqual({ column: 0, row: 0 });
    expect(placement(shortcuts, 2, "c")).toEqual({ column: 1, row: 0 });
  });

  it("줄였다 늘리면 저장된 자리로 돌아간다", () => {
    const shortcuts = [shortcut("a", 0, 0), shortcut("b", 5, 1)];
    expect(placement(shortcuts, 6, "b")).toEqual({ column: 5, row: 1 });
    expect(placement(shortcuts, 2, "b")).toEqual({ column: 1, row: 1 });
    expect(placement(shortcuts, 6, "b")).toEqual({ column: 5, row: 1 });
  });

  it("한 행을 넘는 아이콘은 다음 행으로 이어 놓고 모든 칸이 겹치지 않는다", () => {
    const shortcuts = Array.from({ length: 7 }, (_, index) => shortcut(`app-${index}`, 0, 0));
    const layout = layoutDesktopIcons(shortcuts, 2);
    expect(new Set(layout.map((item) => `${item.column}:${item.row}`)).size).toBe(7);
    expect(Math.max(...layout.map((item) => item.row))).toBe(3);
    expect(readingOrder(layout).map((item) => `${item.column}:${item.row}`)).toEqual([
      "0:0", "1:0", "0:1", "1:1", "0:2", "1:2", "0:3",
    ]);
  });

  it("가장 가까운 빈 칸을 고르고 옮기는 타일의 기존 칸은 비워 둔다", () => {
    const layout = layoutDesktopIcons([shortcut("a", 0, 0), shortcut("b", 1, 0)], 3);
    expect(nearestFreeCell(layout, { column: 0, row: 0 }, 3)).toEqual({ column: 0, row: 1 });
    expect(nearestFreeCell(layout, { column: 0, row: 0 }, 3, "a")).toEqual({ column: 0, row: 0 });
    expect(nearestFreeCell(layout, { column: 9, row: 4 }, 3)).toEqual({ column: 2, row: 4 });
  });

  it("끌어 놓은 타일의 중심이 가리키는 칸을 계산한다", () => {
    const grid = { left: 12, top: 12 };
    const metrics = { columnWidth: 104, rowHeight: 106, gap: 4 };
    expect(cellFromRect({ left: 12, top: 12, width: 104, height: 106 }, grid, metrics, 4)).toEqual({ column: 0, row: 0 });
    expect(cellFromRect({ left: 12 + 108 * 2, top: 12 + 110 * 3, width: 104, height: 106 }, grid, metrics, 4)).toEqual({ column: 2, row: 3 });
    expect(cellFromRect({ left: 12 + 108 * 9, top: 12, width: 104, height: 106 }, grid, metrics, 4)).toEqual({ column: 3, row: 0 });
  });
});
