import type { AppDefinition, Rect } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

export interface WindowIdentity { id: string; app_id: string; app_version: number; desktop_id: string }

export interface BlockContext {
  store: ShellStore;
  window: WindowIdentity;
  definition: AppDefinition;
  newWindowRect?: () => Rect | undefined;
}
