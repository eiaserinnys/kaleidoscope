import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { capturePointer } from "../../share/pointer-capture";
import { DIVIDER_WIDTH, DOCUMENT_MIN, fitSideWidths, SIDE_MIN } from "./metrics";

type Side = "left" | "right";

export function DocumentLayout({ selecting, compact, face, locked, left, document, right }: {
  selecting: boolean; compact: boolean; face: "props" | "comments" | null; locked: boolean;
  left: ReactNode; document: ReactNode; right: ReactNode;
}) {
  const [widths, setWidths] = useState({ left: 256, right: 256 });
  const content = useRef<HTMLDivElement>(null); const contentWidth = useRef(0);
  const leftRef = useRef<HTMLElement>(null); const rightRef = useRef<HTMLElement>(null);
  const drag = useRef<{ side: Side; x: number; width: number } | null>(null);
  const wide = selecting && !compact;
  const leftVisible = selecting && (wide || face === "props");
  const rightVisible = selecting && (wide || face === "comments");
  useLayoutEffect(() => { if (!wide) drag.current = null; }, [wide]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([item]) => {
      const width = item.contentRect.width;
      if (width <= 0) return;
      contentWidth.current = width;
      setWidths((value) => fitSideWidths(value, width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const resize = (side: Side, desired: number) => {
    const total = contentWidth.current || content.current?.getBoundingClientRect().width || 0;
    setWidths((value) => {
      const other = side === "left" ? value.right : value.left;
      const max = Math.max(SIDE_MIN, total - other - DOCUMENT_MIN - DIVIDER_WIDTH * 2);
      return { ...value, [side]: Math.max(SIDE_MIN, Math.min(max, desired)) };
    });
  };
  const start = (event: PointerEvent<HTMLDivElement>, side: Side) => {
    if (event.button !== 0) return;
    const current = (side === "left" ? leftRef : rightRef).current?.getBoundingClientRect().width || widths[side];
    drag.current = { side, x: event.clientX, width: current };
    capturePointer(event); event.preventDefault();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    if (!event.buttons) { drag.current = null; return; }
    const { side, x, width } = drag.current;
    resize(side, width + (event.clientX - x) * (side === "left" ? 1 : -1));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>, side: Side) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); event.stopPropagation();
    const current = (side === "left" ? leftRef : rightRef).current?.getBoundingClientRect().width || widths[side];
    resize(side, current + (event.key === "ArrowRight" ? 8 : -8) * (side === "left" ? 1 : -1));
  };
  const handle = (side: Side, label: string) => wide ? <div className="ks-split-handle ks-html-divider" role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0} onKeyDown={(event) => key(event, side)} onPointerDown={(event) => start(event, side)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} /> : null;
  return <div className={`ks-html-content${compact ? " is-compact" : ""}`} ref={content}>
    <aside ref={leftRef} className="ks-html-rail is-properties" hidden={!leftVisible} inert={locked} style={{ flexBasis: widths.left }}>{left}</aside>
    {handle("left", "속성과 문서 사이 크기 조절")}
    <div className="ks-html-document">{document}</div>
    {handle("right", "문서와 커멘트 사이 크기 조절")}
    <aside ref={rightRef} className="ks-html-rail is-comments" hidden={!rightVisible} inert={locked} style={{ flexBasis: widths.right }}>{right}</aside>
  </div>;
}
