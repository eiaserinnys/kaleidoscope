import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AppIcon, BUILTIN_APP_IDS, EmptyState, GroupHeading, IconTile, LayoutGrid,
  focusRescued, useAnchoredOverlay, useIconGridColumns, useShellSelector, type ShellStore,
} from "@kaleidoscope/ui";

export type LauncherSpacing = "none" | "gap";

export function AppLauncher({ store, anchor, spacing, onClose, onSelect }: {
  store: ShellStore;
  anchor: HTMLElement;
  spacing: LauncherSpacing;
  onClose: () => void;
  onSelect: (appId: string) => void;
}) {
  const apps = useShellSelector(store, (snapshot) => snapshot?.shared.apps);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [space, setSpace] = useState(() => availableSpace(anchor, spacing));
  useLayoutEffect(() => {
    const measure = () => setSpace(availableSpace(anchor, spacing));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, spacing]);
  const columns = useIconGridColumns(grid, !!apps?.length);
  const position = useAnchoredOverlay(anchor, panel, { observe: true, alignEndOnOverflow: true, preferAbove: space.preferAbove, offsetToken: spacing === "gap" ? "--ks-space-2" : undefined });
  const { groups, all } = useMemo(() => {
    const builtins = new Set<string>(BUILTIN_APP_IDS);
    const sorted = (apps ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
    const groups = [
      { name: "기본앱", apps: sorted.filter((app) => builtins.has(app.id)) },
      { name: "커스텀 앱", apps: sorted.filter((app) => !builtins.has(app.id)) },
    ].filter((group) => group.apps.length);
    return { groups, all: groups.flatMap((group) => group.apps) };
  }, [apps]);
  const focusedIndex = Math.max(0, all.findIndex((app) => app.id === focusedId));

  useEffect(() => {
    (tiles.current[0] ?? panel.current)?.focus();
    const pointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) || anchor.contains(event.target)) return;
      onClose();
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const target = anchor.isConnected ? anchor : document.querySelector<HTMLElement>('.ks-shell-bar button[aria-label^="앱 열기"]');
        if (target) focusRescued(target, { preventScroll: true });
      }, 0);
    };
    document.addEventListener("pointerdown", pointerDown);
    return () => document.removeEventListener("pointerdown", pointerDown);
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    if (focusedId && !all.some((app) => app.id === focusedId) && document.activeElement === document.body) {
      (tiles.current[0] ?? panel.current)?.focus();
      if (!all.length) setFocusedId(null);
    }
  }, [all, focusedId]);

  const closeAndFocus = () => {
    anchor.focus();
    onClose();
  };
  const moveFocus = (index: number) => {
    const tile = tiles.current[index];
    if (!tile) return;
    tile.focus();
    tile.scrollIntoView?.({ block: "nearest" });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (!all.length) return;
    let next = focusedIndex;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = all.length - 1;
    else if (event.key === "ArrowRight") next = Math.min(focusedIndex + 1, all.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(focusedIndex - 1, 0);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const groupIndex = groups.findIndex((group) => group.apps.some((app) => app.id === all[focusedIndex].id));
      const group = groups[groupIndex];
      const start = groups.slice(0, groupIndex).reduce((total, item) => total + item.apps.length, 0);
      const index = focusedIndex - start;
      const column = index % columns;
      if (event.key === "ArrowDown") {
        if (index + columns < group.apps.length) next = start + index + columns;
        else if (Math.floor(index / columns) < Math.floor((group.apps.length - 1) / columns)) next = start + group.apps.length - 1;
        else if (groups[groupIndex + 1]) next = start + group.apps.length + Math.min(column, groups[groupIndex + 1].apps.length - 1);
      } else if (index >= columns) next = start + index - columns;
      else if (groups[groupIndex - 1]) {
        const previousLength = groups[groupIndex - 1].apps.length;
        const lastRow = Math.floor((previousLength - 1) / columns) * columns;
        next = start - previousLength + Math.min(lastRow + column, previousLength - 1);
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
    moveFocus(next);
  };

  let offset = 0;
  return createPortal(<div
    aria-label="앱 열기" className="ks-anchored-overlay ks-app-launcher" data-ks-overlay
    onKeyDown={keyDown} ref={panel} role="dialog" style={{ ...position, maxHeight: `min(calc(var(--ks-pane-min-size) * 3), ${space.height}px)` }} tabIndex={-1}
  >
    {groups.length ? groups.map((group, groupIndex) => {
      const start = offset;
      offset += group.apps.length;
      return <div role="group" aria-label={group.name} key={group.name}>
        <GroupHeading title={group.name} />
        <div className="ks-icon-grid" ref={groupIndex === 0 ? grid : undefined}>
          {group.apps.map((app, index) => <LauncherTile
            store={store} app={app} key={app.id} tabIndex={start + index === focusedIndex ? 0 : -1}
            onFocus={() => setFocusedId(app.id)}
            onClick={() => { closeAndFocus(); onSelect(app.id); }}
            ref={(element) => { tiles.current[start + index] = element; }}
          />)}
        </div>
      </div>;
    }) : <EmptyState icon={<LayoutGrid size="empty" />} text="앱 없음" />}
  </div>, document.body);
}

const LauncherTile = memo(function LauncherTile({ store, app, ...props }: {
  store: ShellStore;
  app: NonNullable<ReturnType<ShellStore["getSnapshot"]>>["shared"]["apps"][number];
} & Omit<React.ComponentProps<typeof IconTile>, "icon" | "name" | "badge">) {
  const badge = useShellSelector(store, (snapshot) => snapshot?.app_badges?.[app.id] ?? 0);
  return <IconTile {...props} name={app.name} badge={badge} icon={<AppIcon store={store} appId={app.id} appVersion={app.current_version} size="tile" placeholder="skeleton" />} />;
});

function availableSpace(anchor: HTMLElement, spacing: LauncherSpacing) {
  const rect = anchor.getBoundingClientRect();
  const barBottom = document.querySelector(".ks-shell-bar")?.getBoundingClientRect().bottom ?? 0;
  const style = getComputedStyle(anchor);
  const inset = Number.parseFloat(style.getPropertyValue("--ks-space-3")) || 0;
  const gap = spacing === "gap" ? Number.parseFloat(style.getPropertyValue("--ks-space-2")) || 0 : 0;
  const below = window.innerHeight - rect.bottom - inset;
  const above = rect.top - barBottom - inset;
  const preferAbove = above > below;
  return { preferAbove, height: (preferAbove ? above : below) - gap };
}
