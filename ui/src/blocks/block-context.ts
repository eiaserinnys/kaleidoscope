import type { AppDefinition, AppWindow, Rect, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";

export interface WindowIdentity { id: string; app_id: string; app_version: number; desktop_id: string }

export interface BlockContext {
  store: ShellStore;
  window: WindowIdentity;
  definition: AppDefinition;
  newWindowRect?: () => Rect | undefined;
}

/** agent-chat, agent-session 전용, #890 머지 뒤 제거 */
export type LegacyBlockContext = BlockContext & { snapshot: ShellSnapshot; window: AppWindow };
