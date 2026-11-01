const active = new Map<string, Set<() => Promise<boolean>>>();

export function registerSandboxFlush(windowId: string, flush: () => Promise<boolean>): () => void {
  const entries = active.get(windowId) ?? new Set();
  entries.add(flush);
  active.set(windowId, entries);
  return () => { entries.delete(flush); if (!entries.size) active.delete(windowId); };
}

export async function flushSandboxes(windowId?: string): Promise<boolean> {
  const entries = windowId ? [active.get(windowId) ?? new Set()] : [...active.values()];
  const results = await Promise.all(entries.flatMap((group) => [...group].map((flush) => flush())));
  return results.every(Boolean);
}
