const elements = new Map<string, Element>();
const listeners = new Map<string, Set<() => void>>();

function registryKey(windowId: string, id: string): string {
  return `${windowId}\0${id}`;
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

export function getAnchorElement(windowId: string, id: string): Element | null {
  return elements.get(registryKey(windowId, id)) ?? null;
}

export function subscribeAnchor(windowId: string, id: string, listener: () => void): () => void {
  const key = registryKey(windowId, id);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
  };
}

export function setAnchorElement(windowId: string, id: string, element: Element | null) {
  const key = registryKey(windowId, id);
  if (elements.get(key) === element) return;
  if (element) elements.set(key, element);
  else elements.delete(key);
  notify(key);
}

export function removeAnchorElement(windowId: string, id: string, element: Element | null) {
  if (!element) return;
  const key = registryKey(windowId, id);
  if (elements.get(key) === element) setAnchorElement(windowId, id, null);
}
