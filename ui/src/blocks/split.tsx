import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { renderBlock } from "../render/render-block";
import { SplitPaneContext } from "./split-pane-context";

type SplitBlockData = Extract<Block, { type: "split" }>;

function buildTemplate(weights: number[], collapsed: Set<number>): string {
  return weights.flatMap((weight, index) => index === 0
    ? [collapsed.has(index) ? "var(--ks-icon-button-size)" : `minmax(var(--ks-pane-min-size), ${weight}fr)`]
    : ["var(--ks-line-width)", collapsed.has(index) ? "var(--ks-icon-button-size)" : `minmax(var(--ks-pane-min-size), ${weight}fr)`]).join(" ");
}

function readSplitSizes(element: HTMLElement) {
  const styles = getComputedStyle(element);
  return {
    handleSize: Number.parseFloat(styles.getPropertyValue("--ks-line-width")),
    minPaneSize: Number.parseFloat(styles.getPropertyValue("--ks-pane-min-size")),
  };
}

export function SplitBlock({ block, context, pointer = "/ui" }: { block: SplitBlockData; context: BlockContext; pointer?: string }) {
  return <SplitPanes direction={block.direction} sizes={block.sizes}>
    {block.children.map((child, index) => renderBlock(child, context, `${pointer}/children/${index}`))}
  </SplitPanes>;
}

export function SplitPanes({ direction, sizes, children }: { direction: SplitBlockData["direction"]; sizes?: number[]; children: ReactNode[] }) {
  const [weights, setWeights] = useState(() => sizes ? [...sizes] : children.map(() => 1));
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    coordinate: number;
    pairWidth: number;
    startLeft: number;
    pairWeight: number;
    minPaneSize: number;
  } | null>(null);
  const template = useMemo(() => buildTemplate(weights, collapsed), [weights, collapsed]);
  const sizesKey = sizes?.join(",") ?? `equal-${children.length}`;
  const style: CSSProperties = direction === "row"
    ? { gridTemplateColumns: template }
    : { gridTemplateRows: template };

  useEffect(() => {
    setWeights(sizes ? [...sizes] : children.map(() => 1));
  }, [sizesKey, children.length]);

  function updatePair(index: number, leftWeight: number, rightWeight: number) {
    setWeights((current) => current.map((weight, weightIndex) => {
      if (weightIndex === index) return leftWeight;
      if (weightIndex === index + 1) return rightWeight;
      return weight;
    }));
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, index: number) {
    if (collapsed.has(index) || collapsed.has(index + 1)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !containerRef.current) return;
    const { handleSize, minPaneSize } = readSplitSizes(containerRef.current);
    const dimension = direction === "row" ? rect.width : rect.height;
    const available = dimension - (children.length - 1) * handleSize;
    const pairWeight = weights[index] + weights[index + 1];
    const pairWidth = available * pairWeight / weights.reduce((sum, weight) => sum + weight, 0);
    if (pairWidth < minPaneSize * 2) return;
    dragRef.current = {
      index,
      coordinate: direction === "row" ? event.clientX : event.clientY,
      pairWidth,
      startLeft: pairWidth * weights[index] / pairWeight,
      pairWeight,
      minPaneSize,
    };
    if ("setPointerCapture" in event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const coordinate = direction === "row" ? event.clientX : event.clientY;
    const leftSize = Math.max(drag.minPaneSize, Math.min(drag.pairWidth - drag.minPaneSize, drag.startLeft + coordinate - drag.coordinate));
    const leftWeight = drag.pairWeight * leftSize / drag.pairWidth;
    updatePair(drag.index, leftWeight, drag.pairWeight - leftWeight);
  }

  function endDrag() {
    dragRef.current = null;
  }

  function resizeByKey(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (collapsed.has(index) || collapsed.has(index + 1)) return;
    const decrement = direction === "row" ? "ArrowLeft" : "ArrowUp";
    const increment = direction === "row" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrement && event.key !== increment) return;
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !containerRef.current) return;
    const { handleSize, minPaneSize } = readSplitSizes(containerRef.current);
    const dimension = direction === "row" ? rect.width : rect.height;
    const available = dimension - (children.length - 1) * handleSize;
    const pairWeight = weights[index] + weights[index + 1];
    const pairWidth = available * pairWeight / weights.reduce((sum, weight) => sum + weight, 0);
    if (pairWidth < minPaneSize * 2) return;
    const currentLeft = pairWidth * weights[index] / pairWeight;
    const delta = event.key === increment ? handleSize : -handleSize;
    const nextLeft = Math.max(minPaneSize, Math.min(pairWidth - minPaneSize, currentLeft + delta));
    const leftWeight = pairWeight * nextLeft / pairWidth;
    updatePair(index, leftWeight, pairWeight - leftWeight);
  }

  return (
    <div
      className={`ks-split ks-split-${direction}`}
      onPointerCancel={endDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      ref={containerRef}
      style={style}
    >
      {children.map((child, index) => (
        <div className="ks-split-pane" key={index}>
          <SplitPaneContext.Provider value={{
            collapsed: collapsed.has(index),
            toggle: () => setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index); else next.add(index);
              return next;
            }),
          }}>
            {child}
          </SplitPaneContext.Provider>
        </div>
      )).flatMap((child, index) => index === 0
        ? [child]
        : [
          <div
            aria-label="분할 크기 조절"
            aria-orientation={direction === "row" ? "vertical" : "horizontal"}
            className="ks-split-handle"
            key={`handle-${index - 1}`}
            onKeyDown={(event) => resizeByKey(event, index - 1)}
            onPointerDown={(event) => beginDrag(event, index - 1)}
            role="separator"
            tabIndex={collapsed.has(index - 1) || collapsed.has(index) ? -1 : 0}
          />,
          child,
        ])}
    </div>
  );
}
