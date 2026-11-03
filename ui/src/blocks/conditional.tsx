import { useLayoutEffect, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant } from "../data/window-data";
import { renderBlock } from "../render/render-block";

export type WhenBlockData = Extract<Block, { type: "when" }>;

export function WhenBlock({ block, context, pointer }: { block: WhenBlockData; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/value`, block.value ?? null);
  const hasWidthCondition = block.min_width !== undefined || block.max_width !== undefined;
  const [widthMatches, setWidthMatches] = useState(!hasWidthCondition);
  const widthMatchesRef = useRef(!hasWidthCondition);
  useLayoutEffect(() => {
    if (!hasWidthCondition) {
      widthMatchesRef.current = true;
      setWidthMatches(true);
      return;
    }
    const host = Array.from(document.querySelectorAll<HTMLElement>(".ks-data-window[data-window-id]"))
      .find((element) => element.dataset.windowId === context.window.id);
    const body = host?.querySelector<HTMLElement>(".ks-data-window-body");
    const update = (width: number) => {
      const matches = (block.min_width === undefined || width >= block.min_width)
        && (block.max_width === undefined || width <= block.max_width);
      if (widthMatchesRef.current === matches) return;
      widthMatchesRef.current = matches;
      setWidthMatches(matches);
    };
    if (!body) return;
    update(body.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === body);
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [block.max_width, block.min_width, context.window.id, hasWidthCondition]);
  const valueMatches = block.value === undefined || (value.status === "ready" && value.value === true);
  const visible = valueMatches && widthMatches;
  const childPointer = `${pointer}/child`;
  useDormant(childPointer, !visible);
  return visible ? renderBlock(block.child, context, childPointer) : null;
}
