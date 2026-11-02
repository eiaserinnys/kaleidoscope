import * as shellErrors from "../../contract/shell-errors";
import type { ShellStore } from "../../core/shell-store";
import { toCoreError } from "../../core/core-transport";
import { applyThreadChange, type Thread, type ThreadChange } from "./thread";

export const emptyThread = (): Thread => ({ revisions: {}, comments: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const invalidThread = (name: string) => shellErrors.SHELL_THREAD_READ_INVALID({ name });

function parseThread(content: string, name: string): Thread {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw invalidThread(name); }
  if (!isRecord(value)) throw invalidThread(name);
  const revisions = value.revisions === undefined ? {} : value.revisions;
  const comments = value.comments === undefined ? [] : value.comments;
  if (!isRecord(revisions) || Object.values(revisions).some((item) => !isRecord(item) || (item.title !== undefined && typeof item.title !== "string") || (item.note !== undefined && typeof item.note !== "string")) || !Array.isArray(comments)) throw invalidThread(name);
  const normalized = comments.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.comment !== "string" || typeof item.created_at !== "string" || !isRecord(item.anchor)) throw invalidThread(name);
    const anchor = item.anchor;
    if ((anchor.kind !== "element" && anchor.kind !== "text") || ["selector", "path", "tag", "text", "label"].some((key) => typeof anchor[key] !== "string") || !isRecord(anchor.attrs) || (anchor.kind === "text" && anchor.quote == null) || (anchor.quote != null && (!isRecord(anchor.quote) || ["exact", "prefix", "suffix"].some((key) => typeof (anchor.quote as Record<string, unknown>)[key] !== "string")))) throw invalidThread(name);
    const replies = item.replies === undefined ? [] : item.replies;
    if (!Array.isArray(replies) || replies.some((reply) => !isRecord(reply) || typeof reply.id !== "string" || typeof reply.body !== "string" || (reply.role !== "user" && reply.role !== "agent"))) throw invalidThread(name);
    if (item.rev !== undefined && typeof item.rev !== "number") throw invalidThread(name);
    if (item.anchor_rev !== undefined && typeof item.anchor_rev !== "number") throw invalidThread(name);
    const status = item.status === "resolved" || item.status === "needs_user_reply" ? item.status : "needs_agent_review";
    return { ...item, rev: item.rev ?? 1, status, replies, resolved_rev: item.resolved_rev ?? null };
  });
  return { revisions, comments: normalized } as Thread;
}

export async function readThread(store: ShellStore, windowId: string, entry: string, name: string): Promise<{ thread: Thread; revision: string | null }> {
  try {
    const list = await store.call({ op: "storage.list", window_id: windowId, entry });
    if (list.op !== "storage.list") throw shellErrors.SHELL_HTML_COMMENT_LIST_REPLY_INVALID();
    if (!list.result.items.some((item) => item.doc === `${name}/thread.json`)) return { thread: emptyThread(), revision: null };
    const result = await store.call({ op: "storage.get", window_id: windowId, entry, doc: `${name}/thread.json` });
    if (result.op !== "storage.get") throw shellErrors.SHELL_HTML_COMMENT_THREAD_REPLY_INVALID();
    const thread = parseThread(String(result.result.content), name);
    return { thread, revision: result.result.revision };
  } catch (reason) {
    if (toCoreError(reason).code === "not_found") return { thread: emptyThread(), revision: null };
    throw reason;
  }
}
export async function writeThreadChange(store: ShellStore, windowId: string, entry: string, name: string, change: ThreadChange): Promise<Thread> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    const current = await readThread(store, windowId, entry, name);
    const next = applyThreadChange(current.thread, change);
    try {
      await store.call({ op: "storage.write", window_id: windowId, entry, doc: `${name}/thread.json`, content: JSON.stringify(next), expected_revision: current.revision });
      return next;
    } catch (reason) {
      if (toCoreError(reason).code !== "conflict" || attempt === 2) throw reason;
    }
  }
  throw shellErrors.SHELL_HTML_COMMENT_SAVE_CONFLICT();
}
