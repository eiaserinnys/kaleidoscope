import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { ICON_SIZE } from "./icons";

type IconTileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: ReactNode;
  name: string;
  selected?: boolean;
};

export function IconTile({ icon, name, selected, className = "", ...props }: IconTileProps) {
  return <button type="button" {...props} className={`ks-icon-tile${selected ? " is-selected" : ""} ${className}`}>
    {icon}<span className="ks-icon-tile-name">{name}</span>
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

export function IconTileSkeleton({ count }: { count: number }) {
  return <div className="ks-icon-grid ks-icon-skeleton-grid" role="status" aria-label="불러오는 중">
    {Array.from({ length: count }, (_, index) => <div className="ks-icon-tile ks-icon-tile-skeleton" aria-hidden="true" key={index}>
      <i className="ks-icon-skeleton-icon" /><span className="ks-icon-skeleton-name"><i /><i /></span>
    </div>)}
  </div>;
}
