type Owner = { windowId: string; anchor?: Element };
const owners = new WeakMap<Element, Owner>();
const overlays = new Map<string, Set<WeakRef<Element>>>();

export function registerOverlay(element: Element, windowId: string, anchor?: Element): () => void {
  owners.set(element, { windowId, anchor });
  const entries = overlays.get(windowId) ?? new Set<WeakRef<Element>>();
  const ref = new WeakRef(element);
  entries.add(ref);
  overlays.set(windowId, entries);
  return () => { owners.delete(element); entries.delete(ref); if (!entries.size) overlays.delete(windowId); };
}

export function overlayOwner(element: Element): Owner | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const owner = owners.get(node);
    if (owner) return owner;
  }
  return undefined;
}

export function ownerOf(element: Element): string | undefined {
  return overlayOwner(element)?.windowId ?? element.closest<HTMLElement>(".ks-data-window[data-window-id]")?.dataset.windowId;
}

export function ownedOverlays(windowId: string): Element[] {
  return [...(overlays.get(windowId) ?? [])].flatMap((ref) => {
    const element = ref.deref();
    return element?.isConnected ? [element] : [];
  });
}

export function inConsent(element: Element): boolean {
  if (element.closest("[data-ks-user-consent]")) return true;
  const anchor = overlayOwner(element)?.anchor;
  return Boolean(anchor && inConsent(anchor));
}
