import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  openContextMenu, useIconGridColumns, useShellSelector,
  type CoreReply, type CoreRequest, type MenuEntry, type ShellStore,
} from "@kaleidoscope/ui";
import { LauncherTile } from "./app-launcher";
import {
  cellFromRect, layoutDesktopIcons, nearestFreeCell, readingOrder,
  type DesktopIconCell, type DesktopIconPlacement, type DesktopIconShortcut,
} from "./desktop-icon-layout";
import { DESKTOP_USABLE_PADDING, usableWindowArea } from "./window-geometry";

const DRAG_THRESHOLD = 4;
const DRAG_CLICK_SUPPRESS_MS = 400;
const EMPTY_SHORTCUTS: readonly DesktopIconShortcut[] = [];
const EMPTY_APPS: NonNullable<ReturnType<ShellStore["getSnapshot"]>>["shared"]["apps"] = [];

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  /** 바탕 영역 경계 안에 타일을 붙잡아 두는 변위 한계. */
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

interface FocusAfterRemove {
  id: string;
  cell: DesktopIconCell;
}

export const DesktopIcons = memo(function DesktopIcons({ store, desktopId, area, onCall, onOpenApp }: {
  store: ShellStore;
  desktopId: string;
  area: { width: number; height: number };
  onCall: (request: CoreRequest) => Promise<CoreReply | undefined>;
  onOpenApp: (appId: string) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const placementsRef = useRef<DesktopIconPlacement[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(0);
  const focusAfterRemoveRef = useRef<FocusAfterRemove | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ id: string; cell: DesktopIconCell } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const rowHeightRef = useRef(0);
  rowHeightRef.current = rowHeight;

  const shortcuts = useShellSelector(store, (snapshot) =>
    snapshot?.shared.desktop_shortcuts?.filter((shortcut) => shortcut.desktop_id === desktopId) ?? EMPTY_SHORTCUTS,
  sameShortcutReferences);
  const apps = useShellSelector(store, (snapshot) => snapshot?.shared.apps ?? EMPTY_APPS);
  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const visible = useMemo(
    () => shortcuts.length && appById.size ? shortcuts.filter((shortcut) => appById.has(shortcut.app_id)) : EMPTY_SHORTCUTS,
    [appById, shortcuts],
  );
  const usable = usableWindowArea(area);
  const columns = useIconGridColumns(grid, visible.length > 0 && usable.width > 0 && usable.height > 0);
  const placements = useMemo(() => {
    const placed = layoutDesktopIcons(visible, columns).map((item) =>
      pendingMove && item.shortcut.id === pendingMove.id ? { ...item, ...pendingMove.cell } : item);
    return readingOrder(placed);
  }, [columns, pendingMove, visible]);
  placementsRef.current = placements;

  const registerTile = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) tiles.current.set(id, element);
    else tiles.current.delete(id);
  }, []);

  const select = useCallback((id: string) => {
    if (performance.now() < suppressClickRef.current) return;
    setSelectedId(id);
  }, []);
  const open = useCallback((appId: string) => {
    if (performance.now() < suppressClickRef.current) return;
    onOpenApp(appId);
  }, [onOpenApp]);
  const contextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, shortcutId: string) => {
    setSelectedId(shortcutId);
    const entries: MenuEntry[] = [{
      id: "desktop-shortcut-remove",
      label: "바탕화면에서 빼기",
      onSelect: () => {
        const placed = placementsRef.current.find((item) => item.shortcut.id === shortcutId);
        focusAfterRemoveRef.current = { id: shortcutId, cell: placed ? { column: placed.column, row: placed.row } : { column: 0, row: 0 } };
        void onCall({ op: "desktop.shortcut.remove", shortcut_id: shortcutId });
      },
    }];
    openContextMenu(event, entries);
  }, [onCall]);

  const pointerDown = useCallback((id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    setSelectedId(id);
    const bounds = layer.current?.getBoundingClientRect();
    const tile = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      minDx: bounds ? bounds.left - tile.left : -Infinity,
      maxDx: bounds ? bounds.right - tile.right : Infinity,
      minDy: bounds ? bounds.top - tile.top : -Infinity,
      maxDy: bounds ? bounds.bottom - tile.bottom : Infinity,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);
  const pointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
      current.moved = true;
    }
    event.preventDefault();
    setDrag({
      id: current.id,
      dx: clampBetween(event.clientX - current.startX, current.minDx, current.maxDx),
      dy: clampBetween(event.clientY - current.startY, current.minDy, current.maxDy),
    });
  }, []);
  const pointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!current.moved) return;
    event.preventDefault();
    suppressClickRef.current = performance.now() + DRAG_CLICK_SUPPRESS_MS;
    setDrag(null);
    const gridElement = grid.current;
    const element = tiles.current.get(current.id);
    if (!gridElement || !element) return;
    const metrics = readGridMetrics(gridElement, rowHeightRef.current);
    if (metrics.columnWidth <= 0 || metrics.rowHeight <= 0) return;
    const target = nearestFreeCell(
      placementsRef.current,
      cellFromRect(element.getBoundingClientRect(), gridElement.getBoundingClientRect(), metrics, columns),
      columns,
      current.id,
    );
    const placed = placementsRef.current.find((item) => item.shortcut.id === current.id);
    if (placed && placed.column === target.column && placed.row === target.row) return;
    setPendingMove({ id: current.id, cell: target });
    void onCall({ op: "desktop.shortcut.move", shortcut_id: current.id, column: target.column, row: target.row }).then((reply) => {
      const confirmed = reply?.op === "desktop.shortcut.move" && reply.shortcut.id === current.id
        && reply.shortcut.column === target.column && reply.shortcut.row === target.row;
      if (!confirmed) setPendingMove((pending) => pending?.id === current.id ? null : pending);
    });
  }, [columns, onCall]);
  const pointerCancel = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDrag(null);
  }, []);

  useLayoutEffect(() => {
    const gridElement = grid.current;
    const elements = [...tiles.current.values()];
    if (!gridElement || !elements.length) return;
    // 고정 행 높이는 타일을 그 높이에 줄여 맞추므로, 잠시 auto로 되돌려 자연 높이를 잰다.
    const previous = gridElement.style.gridAutoRows;
    gridElement.style.gridAutoRows = "auto";
    const next = Math.ceil(Math.max(...elements.map((element) => element.getBoundingClientRect().height)));
    gridElement.style.gridAutoRows = previous;
    if (next > 0 && next !== rowHeight) setRowHeight(next);
  }, [placements, rowHeight, usable.width, usable.height]);

  useLayoutEffect(() => {
    const removed = focusAfterRemoveRef.current;
    if (!removed) return;
    if (placements.some((item) => item.shortcut.id === removed.id)) {
      focusAfterRemoveRef.current = null;
      return;
    }
    focusAfterRemoveRef.current = null;
    const next = placements.find((item) =>
      item.row > removed.cell.row || (item.row === removed.cell.row && item.column > removed.cell.column));
    const targetId = next?.shortcut.id ?? placements[placements.length - 1]?.shortcut.id;
    setSelectedId(targetId ?? null);
    const target = targetId ? tiles.current.get(targetId) : undefined;
    if (target) {
      target.focus();
      target.scrollIntoView?.({ block: "nearest" });
    } else if (!targetId) {
      document.querySelector<HTMLElement>(".ks-app-launcher-button")?.focus();
    }
  }, [placements]);

  useEffect(() => {
    if (!pendingMove) return;
    const stored = shortcuts.find((shortcut) => shortcut.id === pendingMove.id);
    if (!stored || (stored.column === pendingMove.cell.column && stored.row === pendingMove.cell.row)) setPendingMove(null);
  }, [pendingMove, shortcuts]);

  useEffect(() => {
    if (selectedId && !placements.some((item) => item.shortcut.id === selectedId)) setSelectedId(null);
  }, [placements, selectedId]);

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (layer.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".ks-menu")) return;
      setSelectedId(null);
    };
    document.addEventListener("pointerdown", pointer);
    return () => document.removeEventListener("pointerdown", pointer);
  }, []);

  useEffect(() => {
    if (!drag) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dragRef.current = null;
      suppressClickRef.current = performance.now() + DRAG_CLICK_SUPPRESS_MS;
      setDrag(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drag]);

  const rovingId = selectedId && placements.some((item) => item.shortcut.id === selectedId)
    ? selectedId
    : placements[0]?.shortcut.id;

  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-desktop-shortcut-id]")
      : null;
    if (!target) return;
    const index = placements.findIndex((item) => tiles.current.get(item.shortcut.id) === target);
    if (index < 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.repeat) return;
      const id = placements[index].shortcut.id;
      setSelectedId(id);
      onOpenApp(placements[index].shortcut.app_id);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      setSelectedId(placements[index].shortcut.id);
      return;
    }
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(index + 1, placements.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
    else if (event.key === "ArrowDown") next = Math.min(index + columns, placements.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - columns, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = placements.length - 1;
    else return;
    event.preventDefault();
    const nextId = placements[next]?.shortcut.id;
    if (!nextId) return;
    setSelectedId(nextId);
    const element = tiles.current.get(nextId);
    element?.focus();
    element?.scrollIntoView?.({ block: "nearest" });
  };

  if (!visible.length || usable.width <= 0 || usable.height <= 0) return null;

  // 층은 격자보다 사방으로 안쪽 여백만큼 크게 잡아 클리핑 경계를 바탕 영역 가장자리에 둔다.
  // 안쪽 여백이 격자의 시작 좌표와 폭을 예전 그대로 유지한다.
  return <div
    className="ks-desktop-icons"
    ref={layer}
    style={{
      left: 0,
      top: 0,
      width: area.width,
      height: DESKTOP_USABLE_PADDING * 2 + usable.height,
      padding: DESKTOP_USABLE_PADDING,
    }}
  >
    <div
      className="ks-icon-grid ks-desktop-icon-grid"
      onKeyDown={keyDown}
      ref={grid}
      style={{
        gridAutoRows: rowHeight > 0 ? `${rowHeight}px` : undefined,
        gridTemplateColumns: `repeat(${columns}, calc(var(--ks-space-6) * 3 + var(--ks-space-2)))`,
      }}
    >
      {placements.map((item) => {
        const app = appById.get(item.shortcut.app_id);
        if (!app) return null;
        const dragged = drag?.id === item.shortcut.id ? drag : null;
        return <DesktopIconEntry
          app={app}
          dragged={dragged}
          key={item.shortcut.id}
          onContextMenu={contextMenu}
          onDoubleClick={open}
          onLostPointerCapture={pointerCancel}
          onPointerCancel={pointerCancel}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onSelect={select}
          placement={item}
          register={registerTile}
          selected={item.shortcut.id === selectedId}
          store={store}
          tabIndex={item.shortcut.id === rovingId ? 0 : -1}
        />;
      })}
    </div>
  </div>;
});

const DesktopIconEntry = memo(function DesktopIconEntry({ store, app, placement, selected, tabIndex, dragged, register, onSelect, onDoubleClick, onContextMenu, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {
  store: ShellStore;
  app: NonNullable<ReturnType<ShellStore["getSnapshot"]>>["shared"]["apps"][number];
  placement: DesktopIconPlacement;
  selected: boolean;
  tabIndex: number;
  dragged: { dx: number; dy: number } | null;
  register: (id: string, element: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onDoubleClick: (appId: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, shortcutId: string) => void;
  onPointerDown: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}) {
  return <LauncherTile
    app={app}
    aria-pressed={selected}
    className="is-desktop"
    data-column={placement.column}
    data-desktop-shortcut-id={placement.shortcut.id}
    data-row={placement.row}
    draggable={false}
    onContextMenu={(event) => onContextMenu(event, placement.shortcut.id)}
    onDoubleClick={() => onDoubleClick(app.id)}
    onDragStart={(event) => event.preventDefault()}
    onLostPointerCapture={onLostPointerCapture}
    onPointerCancel={onPointerCancel}
    onPointerDown={(event) => onPointerDown(placement.shortcut.id, event)}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onClick={() => onSelect(placement.shortcut.id)}
    ref={(element) => register(placement.shortcut.id, element)}
    selected={selected}
    store={store}
    style={{
      gridColumn: String(placement.column + 1),
      gridRow: String(placement.row + 1),
      transform: dragged ? `translate(${dragged.dx}px, ${dragged.dy}px)` : undefined,
      zIndex: dragged ? 1 : undefined,
    }}
    tabIndex={tabIndex}
  />;
});

function clampBetween(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readGridMetrics(grid: HTMLElement, rowHeight: number) {
  const style = getComputedStyle(grid);
  const space6 = Number.parseFloat(style.getPropertyValue("--ks-space-6")) || 0;
  const space2 = Number.parseFloat(style.getPropertyValue("--ks-space-2")) || 0;
  const gap = Number.parseFloat(style.getPropertyValue("--ks-space-1")) || Number.parseFloat(style.rowGap) || 0;
  return { columnWidth: space6 * 3 + space2, rowHeight, gap };
}

function sameShortcutReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left === right || (left.length === right.length && left.every((item, index) => item === right[index]));
}
