import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant } from "../data/window-data";
import { renderBlock } from "../render/render-block";

export type WhenBlockData = Extract<Block, { type: "when" }>;

export function WhenBlock({ block, context, pointer }: { block: WhenBlockData; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/value`, block.value ?? null);
  const visible = block.value !== undefined && value.status === "ready" && value.value === true;
  const childPointer = `${pointer}/child`;
  useDormant(childPointer, !visible);
  return visible ? renderBlock(block.child, context, childPointer) : null;
}
