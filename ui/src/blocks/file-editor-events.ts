import { useEffect } from "react";
import type { FileRef } from "../contract/contract";
import { patchWindowState, readWindowState } from "../data/window-state";
import type { BlockContext } from "./block-context";
import { FileEditorSession, pathWithin } from "./file-editor-session";

export function useFileEditorEvents(session: FileEditorSession, context: BlockContext, file: FileRef, root: string | null) {
  const stateKey = typeof file.path === "string" ? null : file.path.state;
  useEffect(() => {
    session.setResource(root === null ? null : { kind: "file", root });
    return context.store.subscribeEvents((event) => {
      if (event.event !== "files.changed" || event.root !== root) return;
      for (const change of event.changes) {
        const path = session.getSnapshot().path;
        if (!change.from || path === null || !pathWithin(path, change.from)) continue;
        if (change.to) {
          const opening = !session.getSnapshot().loaded;
          const next = session.retarget(change.from, change.to);
          if (next !== null && opening && !stateKey) void session.open(next);
          if (next !== null && stateKey && readWindowState(context)[stateKey] === path) void patchWindowState(context, { [stateKey]: next });
        } else {
          const dirty = session.getSnapshot().dirty;
          session.removed();
          if (!dirty && stateKey && readWindowState(context)[stateKey] === path) void patchWindowState(context, { [stateKey]: null });
        }
      }
    });
  }, [context, root, session, stateKey]);
}
