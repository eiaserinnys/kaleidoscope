import type { ShellStore } from "../../core/shell-store";
import { toCoreError } from "../../core/core-transport";
import { applyThreadChange, type Thread, type ThreadChange } from "./thread";

export const emptyThread = (): Thread => ({ revisions: {}, comments: [] });
export async function readThread(store: ShellStore, windowId: string, entry: string, name: string): Promise<{ thread: Thread; revision: string | null }> {
  try {
    const result = await store.call({ op: "storage.get", window_id: windowId, entry, doc: `${name}/thread.json` });
    if (result.op !== "storage.get") throw new Error("커멘트 문서를 읽을 수 없습니다");
    const thread = JSON.parse(String(result.result.content)) as Thread;
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
  throw new Error("커멘트를 저장하지 못했습니다");
}
