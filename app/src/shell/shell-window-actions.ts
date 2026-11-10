import type { AppWindow, CoreReply, CoreRequest, Desktop, ShellSnapshot, ShellStore, Workspace } from "@kaleidoscope/ui";
import type { SystemWindowState } from "./system-window";

export function selectWorkspace(snapshot: ShellSnapshot): Workspace | undefined {
  return snapshot.shared.workspaces.find((workspace) => workspace.id === snapshot.device.active_workspace_id)
    ?? snapshot.shared.workspaces[0];
}

export function selectDesktop(snapshot: ShellSnapshot, workspace: Workspace): Desktop | undefined {
  const desktops = snapshot.shared.desktops.filter((desktop) => desktop.workspace_id === workspace.id).sort((a, b) => a.position - b.position);
  return desktops.find((desktop) => desktop.id === snapshot.device.active_desktop_ids[workspace.id]) ?? desktops[0];
}

type Call = (request: CoreRequest) => Promise<CoreReply | undefined>;
type Target = { kind: "app"; window: AppWindow } | { kind: "system"; state: SystemWindowState };

// 사용자가 다른 창이나 데스크톱을 고르면 가려지는 창의 입력칸이 초점을 쥐고 있지 않게 한다.
// 초점이 없으면 맨 위가 된 창의 window-focus가 그 창의 마지막 초점이나 첫 내용으로 옮긴다.
function releaseActiveFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function sameTarget(a: Target, b: Target): boolean {
  if (a.kind === "system" || b.kind === "system") return a.kind === "system" && b.kind === "system";
  return a.window.id === b.window.id;
}

export function createShellWindowActions(store: ShellStore, call: Call, getSystemWindow: () => SystemWindowState | undefined) {
  const current = () => {
    const snapshot = store.getSnapshot();
    const workspace = snapshot && selectWorkspace(snapshot);
    const desktop = snapshot && workspace && selectDesktop(snapshot, workspace);
    const windows = snapshot?.shared.windows.filter((window) => window.desktop_id === desktop?.id) ?? [];
    const system = getSystemWindow();
    return { snapshot, workspace, desktop, windows, system };
  };
  const targets = (windows: AppWindow[], system?: SystemWindowState): Target[] => [
    ...windows.map((window): Target => ({ kind: "app", window })),
    ...(system ? [{ kind: "system" as const, state: system }] : []),
  ];
  const visible = (target: Target) => target.kind === "app" ? !target.window.minimized : !target.state.minimized;
  const top = (windows: AppWindow[], system?: SystemWindowState): Target | undefined => {
    if (system?.isTop) return { kind: "system", state: system };
    const window = windows.filter((item) => !item.minimized).reduce<AppWindow | undefined>((best, item) => !best || item.z > best.z ? item : best, undefined);
    return window ? { kind: "app", window } : undefined;
  };
  const apply = async (target: Target, op: "minimize" | "maximize" | "restore" | "raise"): Promise<boolean> => {
    if (target.kind === "system") { target.state[op](); return true; }
    return Boolean(await call({ op: `window.${op}`, window_id: target.window.id }));
  };
  return {
    async desktop(direction: -1 | 1) {
      const { snapshot, workspace, desktop } = current();
      if (!snapshot || !workspace || !desktop) return;
      const desktops = snapshot.shared.desktops.filter((item) => item.workspace_id === workspace.id).sort((a, b) => a.position - b.position);
      if (desktops.length < 2) return;
      const index = desktops.findIndex((item) => item.id === desktop.id);
      const next = desktops[(index + direction + desktops.length) % desktops.length];
      if (next.id === desktop.id) return;
      releaseActiveFocus();
      await call({ op: "desktop.activate", desktop_id: next.id });
    },
    async workspace(direction: -1 | 1) {
      const { snapshot, workspace } = current();
      if (!snapshot || !workspace) return;
      const workspaces = snapshot.shared.workspaces;
      if (workspaces.length < 2) return;
      const index = workspaces.findIndex((item) => item.id === workspace.id);
      const next = workspaces[(index + direction + workspaces.length) % workspaces.length];
      if (next.id === workspace.id) return;
      releaseActiveFocus();
      await call({ op: "workspace.activate", workspace_id: next.id });
    },
    async minimizeAll() {
      const { windows, system } = current();
      for (const target of targets(windows, system).filter(visible)) if (!await apply(target, "minimize")) return;
    },
    async restoreAll() {
      const { windows, system } = current();
      const ordered = targets(windows, system).filter((target) => !visible(target)).sort((a, b) => {
        const az = a.kind === "app" ? a.window.z : a.state.z;
        const bz = b.kind === "app" ? b.window.z : b.state.z;
        return az - bz || (a.kind === b.kind ? 0 : a.kind === "system" ? -1 : 1);
      });
      let previous: AppWindow | undefined;
      for (const target of ordered) {
        if (target.kind === "system") {
          if (previous) {
            const updated = previous;
            const reached = () => (store.getSnapshot()?.shared.windows.find((window) => window.id === updated.id)?.z ?? -Infinity) >= updated.z;
            if (!reached()) await new Promise<void>((resolve) => {
              const unsubscribe = store.subscribe(() => { if (reached()) { unsubscribe(); resolve(); } });
            });
          }
          target.state.raise();
        } else {
          const reply = await call({ op: "window.raise", window_id: target.window.id });
          if (!reply || reply.op !== "window.raise") return;
          previous = reply.window;
        }
      }
    },
    async minimizeCurrent() {
      const { windows, system } = current();
      const target = top(windows, system);
      if (target) await apply(target, "minimize");
    },
    async toggleMaximizeCurrent() {
      const { windows, system } = current();
      const target = top(windows, system);
      if (!target) return;
      const maximized = target.kind === "app" ? target.window.maximized : target.state.maximized;
      await apply(target, maximized ? "restore" : "maximize");
    },
    async cycleWindow(direction: -1 | 1) {
      const { windows, system } = current();
      const list = targets(windows, system).filter(visible);
      if (list.length < 2) return;
      const active = top(windows, system);
      const index = active ? list.findIndex((item) => sameTarget(item, active)) : -1;
      const next = list[(index + direction + list.length) % list.length];
      if (active && sameTarget(next, active)) return;
      releaseActiveFocus();
      await apply(next, "raise");
    },
  };
}

export type ShellWindowActions = ReturnType<typeof createShellWindowActions>;
