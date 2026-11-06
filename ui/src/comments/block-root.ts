import { useContext } from "react";
import { BlockRenderContext } from "../render/render-probe";
export type BlockRootProps = { "data-ks-block"?: string; "data-ks-block-type"?: string };
export function useBlockRootProps(): BlockRootProps {
  const identity = useContext(BlockRenderContext);
  return identity ? { "data-ks-block": identity.pointer, "data-ks-block-type": identity.type } : {};
}
