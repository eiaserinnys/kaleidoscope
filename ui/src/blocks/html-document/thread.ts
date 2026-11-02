import type { HtmlAnchor } from "../html-bridge/frame-protocol";

export type CommentStatus = "needs_agent_review" | "needs_user_reply" | "resolved";
export interface Reply { id: string; role: "user" | "agent"; rev: number; body: string; created_at: string }
export interface Comment { id: string; rev: number; anchor_rev?: number; status: CommentStatus; anchor: HtmlAnchor; comment: string; created_at: string; resolved_rev: number | null; replies: Reply[] }
export interface RevisionMeta { title?: string; note?: string; author: "user" | "agent"; base_rev: number; edits: unknown[] }
export interface Thread { revisions: Record<string, RevisionMeta>; comments: Comment[] }
export type ThreadChange =
  | { kind: "add"; comment: Comment }
  | { kind: "delete"; id: string }
  | { kind: "reply"; id: string; reply: Reply }
  | { kind: "status"; id: string; status: CommentStatus; resolved_rev: number | null }
  | { kind: "anchor"; id: string; anchor: HtmlAnchor; anchor_rev: number }
  | { kind: "revision"; rev: number; meta: RevisionMeta };

export function listRevisions(paths: string[]): { name: string; revisions: number[] }[] {
  const docs = new Map<string, number[]>();
  for (const path of paths) {
    const match = /^([^/]+)\/r([1-9]\d*)\.html$/.exec(path);
    if (!match) continue;
    const numbers = docs.get(match[1]) ?? [];
    numbers.push(Number(match[2]));
    docs.set(match[1], numbers);
  }
  return [...docs].map(([name, revisions]) => ({ name, revisions: revisions.sort((a, b) => a - b) })).sort((a, b) => a.name.localeCompare(b.name));
}

export function anchorRevision(comment: Comment): number { return comment.anchor_rev ?? comment.rev; }
export function anchorRevisionFor(rev: number, dirty: boolean): number { return dirty ? 0 : rev; }

export function applyThreadChange(thread: Thread, change: ThreadChange): Thread {
  if (change.kind === "revision") return { ...thread, revisions: { ...thread.revisions, [change.rev]: change.meta } };
  if (change.kind === "add") return { ...thread, comments: [...thread.comments, change.comment] };
  if (change.kind === "delete") return { ...thread, comments: thread.comments.filter((item) => item.id !== change.id) };
  return { ...thread, comments: thread.comments.map((item) => {
    if (item.id !== change.id) return item;
    switch (change.kind) {
      case "reply": return { ...item, status: "needs_agent_review", replies: [...item.replies, change.reply] };
      case "status": return { ...item, status: change.status, resolved_rev: change.resolved_rev };
      case "anchor": return { ...item, anchor: change.anchor, anchor_rev: change.anchor_rev };
    }
  }) };
}
