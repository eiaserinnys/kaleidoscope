const pending = new WeakMap<Element, () => Promise<void>>();
export function registerPendingFlush(element: Element, flush: () => Promise<void>): () => void {
  pending.set(element, flush);
  return () => { if (pending.get(element) === flush) pending.delete(element); };
}
export async function flushPending(element: Element): Promise<void> {
  const flush = pending.get(element);
  if (flush) { pending.delete(element); await flush(); }
}
