import { useBlockRootProps } from "../comments/block-root";
import { useLayoutEffect, useRef } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { renderBlock } from "../render/render-block";
import { removeAnchorElement, setAnchorElement } from "./anchor-registry";

export type AnchorBlockData = Extract<Block, { type: "anchor" }>;

export function AnchorBlock({ block, context, pointer }: { block: AnchorBlockData; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let first: Element | null = null;
    const sync = () => {
      const next = element.firstElementChild;
      if (next === first) return;
      first = next;
      setAnchorElement(context.window.id, block.id, first);
    };
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true });
    sync();
    return () => {
      observer.disconnect();
      removeAnchorElement(context.window.id, block.id, first);
    };
  }, [block.id, context.window.id]);

  return <div {...blockRoot} ref={root} className="ks-anchor" style={{ display: "contents" }}>{renderBlock(block.child, context, `${pointer}/child`)}</div>;
}
