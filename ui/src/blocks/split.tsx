import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { renderBlock } from "../render/render-block";

type SplitBlockData = Extract<Block, { type: "split" }>;

function initialWeights(block: SplitBlockData): number[] {
  if (block.sizes) return [...block.sizes];
  return block.children.map(() => 1);
}

function buildTemplate(weights: number[]): string {
  return weights.flatMap((weight, index) => index === 0
    ? [`minmax(var(--ks-pane-min-size), ${weight}fr)`]
    : ["var(--ks-line-width)", `minmax(var(--ks-pane-min-size), ${weight}fr)`]).join(" ");
}

function readSplitSizes(element: HTMLElement) {
  const styles = getComputedStyle(element);
  return {
    handleSize: Number.parseFloat(styles.getPropertyValue("--ks-line-width")),
    minPaneSize: Number.parseFloat(styles.getPropertyValue("--ks-pane-min-size")),
  };
}

export function SplitBlock({ block, context }: { block: SplitBlockData; context: BlockContext }) {
  const [weights, setWeights] = useState(() => initialWeights(block));
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    coordinate: number;
    pairWidth: number;
    startLeft: number;
    pairWeight: number;
    minPaneSize: number;
  } | null>(null);
  const template = useMemo(() => buildTemplate(weights), [weights]);
  const sizesKey = block.sizes?.join(",") ?? `equal-${block.children.length}`;
  const style: CSSProperties = block.direction === "row"
    ? { gridTemplateColumns: template }
    : { gridTemplateRows: template };

  useEffect(() => {
    setWeights(initialWeights(block));
  }, [sizesKey, block.children.length]);

  function updatePair(index: number, leftWeight: number, rightWeight: number) {
    setWeights((current) => current.map((weight, weightIndex) => {
      if (weightIndex === index) return leftWeight;
      if (weightIndex === index + 1) return rightWeight;
      return weight;
    }));
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>, index: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !containerRef.current) return;
    const { handleSize, minPaneSize } = readSplitSizes(containerRef.current);
    const dimension = block.direction === "row" ? rect.width : rect.height;
    const available = dimension - (block.children.length - 1) * handleSize;
    const pairWeight = weights[index] + weights[index + 1];
    const pairWidth = available * pairWeight / weights.reduce((sum, weight) => sum + weight, 0);
    if (pairWidth < minPaneSize * 2) return;
    dragRef.current = {
      index,
      coordinate: block.direction === "row" ? event.clientX : event.clientY,
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
    const coordinate = block.direction === "row" ? event.clientX : event.clientY;
    const leftSize = Math.max(drag.minPaneSize, Math.min(drag.pairWidth - drag.minPaneSize, drag.startLeft + coordinate - drag.coordinate));
    const leftWeight = drag.pairWeight * leftSize / drag.pairWidth;
    updatePair(drag.index, leftWeight, drag.pairWeight - leftWeight);
  }

  function endDrag() {
    dragRef.current = null;
  }

  function resizeByKey(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const decrement = block.direction === "row" ? "ArrowLeft" : "ArrowUp";
    const increment = block.direction === "row" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrement && event.key !== increment) return;
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !containerRef.current) return;
    const { handleSize, minPaneSize } = readSplitSizes(containerRef.current);
    const dimension = block.direction === "row" ? rect.width : rect.height;
    const available = dimension - (block.children.length - 1) * handleSize;
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
      className={`ks-split ks-split-${block.direction}`}
      onPointerCancel={endDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      ref={containerRef}
      style={style}
    >
      {block.children.map((child, index) => (
        <div className="ks-split-pane" key={index}>
          {renderBlock(child, context)}
        </div>
      )).flatMap((child, index) => index === 0
        ? [child]
        : [
          <div
            aria-label="분할 크기 조절"
            aria-orientation={block.direction === "row" ? "vertical" : "horizontal"}
            className="ks-split-handle"
            key={`handle-${index - 1}`}
            onKeyDown={(event) => resizeByKey(event, index - 1)}
            onPointerDown={(event) => beginDrag(event, index - 1)}
            role="separator"
            tabIndex={0}
          />,
          child,
        ])}
    </div>
  );
}
