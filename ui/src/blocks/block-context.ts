import type { AppDefinition, AppWindow, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

export interface BlockContext {
  store: ShellStore;
  snapshot: ShellSnapshot;
  window: AppWindow;
  definition: AppDefinition;
}
