import { createContext, useContext } from "react";
import type { Block } from "../contract/contract";

interface BlockRenderIdentity { windowId: string; pointer: string; type: Block["type"]; instance?: object }

export const BlockRenderContext = createContext<BlockRenderIdentity | null>(null);

export const renderProbe: {
  current: ((windowId: string, pointer: string, type: Block["type"]) => void) | null;
} = { current: null };

const pending = new Set<string>();
const instances = new WeakMap<object, number>();
let nextInstance = 0;

export function useBlockRenderProbe() {
  const identity = useContext(BlockRenderContext);
  const callback = renderProbe.current;
  if (!identity || !callback) return;
  if (identity.instance && !instances.has(identity.instance)) instances.set(identity.instance, ++nextInstance);
  const key = `${identity.windowId}\0${identity.pointer}\0${identity.instance ? instances.get(identity.instance) : ""}`;
  if (pending.has(key)) return;
  pending.add(key);
  callback(identity.windowId, identity.pointer, identity.type);
  queueMicrotask(() => pending.delete(key));
}
