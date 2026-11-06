import { useEffect, useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from "react";
import { ICON_SIZE } from "./icons";
import { CountBadge } from "./badge";

type IconTileProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  icon: ReactNode;
  name: string;
  selected?: boolean;
  badge?: number;
};

export function IconTile({ icon, name, selected, badge = 0, className = "", ...props }: IconTileProps) {
  const label = props["aria-label"] ?? name;
  return <button type="button" {...props} aria-label={badge >= 1 ? `${label}, 알림 ${badge}개` : props["aria-label"]} className={`ks-icon-tile${selected ? " is-selected" : ""} ${className}`}>
    <span className="ks-icon-tile-icon ks-badge-anchor">{icon}<CountBadge count={badge} /></span><span className="ks-icon-tile-name">{name}</span>
  </button>;
}

export function useIconGridColumns(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const resize = () => {
      const style = getComputedStyle(element);
      const space6 = Number.parseFloat(style.getPropertyValue("--ks-space-6")) || ICON_SIZE.tile;
      const space2 = Number.parseFloat(style.getPropertyValue("--ks-space-2")) || ICON_SIZE.tile / 4;
      const gap = Number.parseFloat(style.getPropertyValue("--ks-space-1")) || ICON_SIZE.tile / 8;
      const width = element.clientWidth - (Number.parseFloat(style.paddingInlineStart) || 0) - (Number.parseFloat(style.paddingInlineEnd) || 0);
      setColumns(Math.max(1, Math.floor((width + gap) / (space6 * 3 + space2 + gap))));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);
  return columns;
}

export function IconTileSkeleton({ count, status = true }: { count: number; status?: boolean }) {
  return <div className="ks-icon-grid ks-icon-skeleton-grid" role={status ? "status" : undefined} aria-label={status ? "불러오는 중" : undefined} aria-hidden={status ? undefined : true}>
    {Array.from({ length: count }, (_, index) => <div className="ks-icon-tile ks-icon-tile-skeleton" aria-hidden="true" key={index}>
      <i className="ks-icon-skeleton-icon" style={{ width: ICON_SIZE.tile, height: ICON_SIZE.tile }} /><span className="ks-icon-skeleton-name"><i /></span>
    </div>)}
  </div>;
}
