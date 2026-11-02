import type { ShellStore } from "../core/shell-store";
import { patchWindowState, readWindowState } from "../data/window-state";
import type { BlockContext } from "./block-context";
import { createDocumentEditorTarget, FileEditorSession } from "./file-editor-session";

// 탭이나 접힌 구역에서 블록이 내려가도 창이 열린 동안 초안을 보존한다.
const sessions = new WeakMap<ShellStore, Map<string, FileEditorSession>>();

interface DocumentOptions {
  context: BlockContext;
  collection: boolean;
  stateKey: string | null;
  fixedDoc?: string;
  readOnly?: boolean;
}

export function documentEditorSession(store: ShellStore, windowId: string, entry: string, options?: DocumentOptions): FileEditorSession {
  let byKey = sessions.get(store);
  if (!byKey) { byKey = new Map(); sessions.set(store, byKey); }
  const collection = options?.collection ?? false;
  const keyFor = (fixedDoc?: string) => JSON.stringify([windowId, entry, options?.stateKey ?? null, collection, options?.readOnly ?? false, fixedDoc ?? null]);
  let key = keyFor(options?.fixedDoc);
  const existing = byKey.get(key);
  if (existing) return existing;
  const session = new FileEditorSession(createDocumentEditorTarget(store, windowId, entry, collection));
  session.setResource({ kind: "document", store, windowId, entry });
  byKey.set(key, session);
  const refresh = () => { void session.refreshOnFocus(); };
  const unsubscribeEvents = store.subscribeEvents((event) => {
    if (event.event !== "storage.update" || event.window_id !== windowId) return;
    const update = event.update;
    if (update.kind === "moved" && update.moved.entry_id === entry && collection) {
      const { from_doc: from, to_doc: to } = update.moved;
      if (session.getSnapshot().path !== from) return;
      const opening = !session.getSnapshot().loaded;
      session.retarget(from, to);
      if (options?.fixedDoc !== undefined) {
        byKey!.delete(key);
        key = keyFor(to);
        byKey!.set(key, session);
      }
      if (opening && !options?.stateKey) void session.open(to);
      if (options?.stateKey && readWindowState(options.context)[options.stateKey] === from) void patchWindowState(options.context, { [options.stateKey]: to });
      return;
    }
    if (update.kind === "changed" && update.changed.item.entry_id === entry && collection) {
      const path = session.getSnapshot().path;
      const declaration = options?.context.definition.storage?.entries.find((item) => item.id === entry);
      const snapshot = store.getSnapshot();
      const desktopId = snapshot?.shared.windows.find((item) => item.id === windowId)?.desktop_id;
      const workspace = snapshot?.shared.desktops.find((item) => item.id === desktopId)?.workspace_id;
      const prefix = declaration?.key.replace("{workspace_id}", workspace ?? "");
      if (path === null || !prefix || update.changed.item.key !== `${prefix}/${path}`) return;
      if (!update.changed.item.exists) {
        const dirty = session.getSnapshot().dirty;
        session.removed();
        if (!dirty && options?.stateKey && readWindowState(options.context)[options.stateKey] === path) void patchWindowState(options.context, { [options.stateKey]: null });
      } else refresh();
      return;
    }
    if (update.kind === "snapshot" || (update.kind === "changed" && update.changed.item.entry_id === entry)) refresh();
  });
  let linkState = store.getSnapshot()?.link.state;
  const unsubscribeState = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    if (snapshot && !snapshot.shared.windows.some((item) => item.id === windowId)) {
      unsubscribeEvents();
      unsubscribeState();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      byKey!.delete(key);
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
