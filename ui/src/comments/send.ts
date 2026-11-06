import type { AppCommentSummary } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { sendToDefaultAgent } from "../shell/send-message";
import { commentMessage, pendingComments, replyMessage } from "./message";
import { appCommentStore } from "./store";

export async function sendComments({ store, appId, appName, windowId }: { store: ShellStore; appId: string; appName: string; windowId: string }) {
  const data = appCommentStore(store, appId);
  const items = pendingComments(await data.all());
  if (!items.length) return;
  const threads = await Promise.all(items.map((item) => data.thread(item.id)));
  await sendToDefaultAgent({ store, fromWindowId: windowId, requestId: crypto.randomUUID(), text: commentMessage(appName, threads) });
  await store.call({ op: "comment.mark_sent", app_id: appId, ids: items.map((item) => item.id) });
}

export async function sendCommentReply(store: ShellStore, windowId: string, item: AppCommentSummary, text: string) {
  if (item.sent_at) await sendToDefaultAgent({ store, fromWindowId: windowId, requestId: crypto.randomUUID(), text: replyMessage(store.getSnapshot()?.shared.apps.find((app) => app.id === item.app_id)?.name ?? item.app_id, item, text) });
}
