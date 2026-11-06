import { useSyncExternalStore } from "react";
import type { AppCommentImage } from "../contract/contract";
import type { TargetDescription } from "./target";

export type CommentDraft = { version: number; text: string; target: TargetDescription | null; image?: AppCommentImage; includeImage: boolean; targetChanged: boolean };

class CommentSession {
  private active = false;
  private draft?: CommentDraft;
  private listeners = new Set<() => void>();
  get = () => this.active;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(active: boolean) { if (this.active === active) return; this.active = active; if (!active) this.draft = undefined; this.listeners.forEach((listener) => listener()); }
  getDraft(version: number): CommentDraft | undefined {
    if (this.draft && this.draft.version !== version) this.draft = { ...this.draft, version, target: null, image: undefined, targetChanged: true };
    return this.draft;
  }
  pick(version: number, target: TargetDescription) {
    const current = this.getDraft(version);
    this.draft = { version, text: current?.text ?? "", target, image: undefined, includeImage: current?.includeImage ?? true, targetChanged: false };
  }
  updateDraft(patch: Partial<CommentDraft>) { if (this.draft) this.draft = { ...this.draft, ...patch }; }
  clearDraft() { this.draft = undefined; }
}

const sessions = new Map<string, CommentSession>();
export function commentSession(windowId: string): CommentSession {
  let session = sessions.get(windowId);
  if (!session) { session = new CommentSession(); sessions.set(windowId, session); }
  return session;
}
export function forgetCommentSession(windowId: string) { sessions.delete(windowId); }
export function isCommenting(windowId: string): boolean { return sessions.get(windowId)?.get() ?? false; }
export function useCommentSession(windowId: string): boolean {
  const session = commentSession(windowId);
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}
