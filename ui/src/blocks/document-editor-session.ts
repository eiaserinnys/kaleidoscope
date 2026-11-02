import type { ShellStore } from "../core/shell-store";
import { createDocumentEditorTarget, FileEditorSession } from "./file-editor-session";

// 탭이나 접힌 구역에서 블록이 내려가도 창이 열린 동안 초안을 보존한다.
const sessions = new WeakMap<ShellStore, Map<string, FileEditorSession>>();

export function documentEditorSession(store: ShellStore, windowId: string, entry: string): FileEditorSession {
  let byKey = sessions.get(store);
  if (!byKey) { byKey = new Map(); sessions.set(store, byKey); }
  const key = JSON.stringify([windowId, entry]);
  const existing = byKey.get(key);
  if (existing) return existing;
  const session = new FileEditorSession(createDocumentEditorTarget(store, windowId, entry));
  byKey.set(key, session);
  const refresh = () => { void session.refreshOnFocus(); };
  const unsubscribeEvents = store.subscribeEvents((event) => {
    if (event.event !== "storage.update" || event.window_id !== windowId) return;
    if (event.update.kind === "snapshot" || (event.update.kind === "changed" && event.update.changed.item.entry_id === entry)) refresh();
  });
  let linkState = store.getSnapshot()?.link.state;
  const unsubscribeState = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    if (snapshot && !snapshot.shared.windows.some((item) => item.id === windowId)) {
      unsubscribeEvents();
      unsubscribeState();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      byKey.delete(key);
      session.dispose();
      return;
    }
    const next = snapshot?.link.state;
    if (next === "connected" && linkState !== "connected") refresh();
    linkState = next;
  });
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  return session;
}
