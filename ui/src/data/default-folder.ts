import type { AppDefinition, CoreError, DefaultFolderResult, KnownFolder } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";

export const knownFolderNames: Record<KnownFolder, string> = {
  desktop: "바탕 화면", documents: "문서", downloads: "다운로드", pictures: "사진", music: "음악", videos: "동영상",
};

export type DefaultFolderPrompt = Exclude<DefaultFolderResult, { status: "ready" }> | { status: "failed"; error: CoreError };

export class DefaultFolderPreparation {
  private values = new Map<string, DefaultFolderPrompt>();
  private listeners = new Map<string, Set<() => void>>();

  get = (permission: string) => this.values.get(permission);
  subscribe = (permission: string, listener: () => void) => {
    let listeners = this.listeners.get(permission);
    if (!listeners) { listeners = new Set(); this.listeners.set(permission, listeners); }
    listeners.add(listener);
    return () => { listeners?.delete(listener); if (!listeners?.size) this.listeners.delete(permission); };
  };
  set = (permission: string, result: DefaultFolderResult | DefaultFolderPrompt) => {
    if (result.status === "ready") this.values.delete(permission);
    else this.values.set(permission, result);
    this.listeners.get(permission)?.forEach((listener) => listener());
  };

  async prepare(store: ShellStore, windowId: string, definition: AppDefinition, current: () => boolean) {
    for (const permission of definition.permissions) {
      if (permission.module !== "files" || !permission.default_folder) continue;
      try {
        const reply = await store.call({ op: "files.prepare_default_folder", window_id: windowId, permission: permission.id });
        if (!current()) return;
        this.set(permission.id, reply.result);
      } catch (error) {
        if (!current()) return;
        this.set(permission.id, { status: "failed", error: toCoreError(error) });
      }
    }
  }
}
