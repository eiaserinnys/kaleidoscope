import { useSyncExternalStore } from "react";

class CommentSession {
  private active = false;
  private listeners = new Set<() => void>();
  get = () => this.active;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(active: boolean) { if (this.active === active) return; this.active = active; this.listeners.forEach((listener) => listener()); }
}

const sessions = new Map<string, CommentSession>();
export function commentSession(windowId: string): CommentSession {
  let session = sessions.get(windowId);
  if (!session) { session = new CommentSession(); sessions.set(windowId, session); }
  return session;
}
export function forgetCommentSession(windowId: string) { sessions.delete(windowId); }
export function useCommentSession(windowId: string): boolean {
  const session = commentSession(windowId);
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}
