import type { AppWindow } from "../contract/contract";
import { CLIENT_PING_TIMEOUT_SECS } from "../contract/limits";
import * as shellErrors from "../contract/shell-errors";
import { isCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";
import { deliverClientMessage } from "../runtime/client-runtime";
import { defaultMessageApp, messageReceiver } from "./message-target";

function waitForWindow(store: ShellStore, windowId: string, app: string): Promise<void> {
  if (store.getSnapshot()?.shared.windows.some((window) => window.id === windowId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(shellErrors.SHELL_MESSAGE_SEND_WINDOW_NOT_SHOWN({ app })); }, CLIENT_PING_TIMEOUT_SECS * 1000);
    const check = () => {
      if (!store.getSnapshot()?.shared.windows.some((window) => window.id === windowId)) return;
      clearTimeout(timer); unsubscribe(); resolve();
    };
    const unsubscribe = store.subscribe(check);
    check();
  });
}

async function reveal(store: ShellStore, window: AppWindow, workspaceId: string): Promise<void> {
  const device = store.getSnapshot()?.device;
  if (device?.active_workspace_id !== workspaceId || device.active_desktop_ids[workspaceId] !== window.desktop_id) {
    await store.call({ op: "desktop.activate", desktop_id: window.desktop_id });
  }
  await store.call({ op: "window.raise", window_id: window.id });
}

export async function sendToDefaultAgent({ store, fromWindowId, requestId, text }: { store: ShellStore; fromWindowId: string; requestId: string; text: string }): Promise<{ appId: string; windowId: string; created: boolean }> {
  const snapshot = store.getSnapshot();
  const source = snapshot?.shared.windows.find((window) => window.id === fromWindowId);
  const desktop = snapshot?.shared.desktops.find((item) => item.id === source?.desktop_id);
  const workspace = snapshot?.shared.workspaces.find((item) => item.id === desktop?.workspace_id);
  if (!snapshot || !source || !desktop || !workspace) throw shellErrors.SHELL_MESSAGE_SEND_SOURCE_MISSING();
  const app = defaultMessageApp(snapshot.shared);
  if (!app) throw shellErrors.SHELL_MESSAGE_SEND_NO_RECEIVER();

  let target = snapshot.shared.windows.filter((window) => window.app_id === app.id &&
    snapshot.shared.desktops.some((item) => item.id === window.desktop_id && item.workspace_id === desktop.workspace_id))
    .sort((left, right) => Number(right.desktop_id === desktop.id) - Number(left.desktop_id === desktop.id) || right.z - left.z)[0];
  const created = !target;
  if (!target) {
    const reply = await store.call({ op: "window.open", desktop_id: desktop.id, app_id: app.id });
    target = reply.window;
    await waitForWindow(store, target.id, app.name);
  }
  const state = store.getSnapshot();
  const current = state?.shared.windows.find((window) => window.id === target.id);
  if (!current) throw shellErrors.SHELL_MESSAGE_RECEIVER_CLOSED({ app: app.name });
  const definition = state?.shared.app_versions.find((version) => version.app_id === current.app_id && version.version === current.app_version)?.definition;
  if (!definition) throw shellErrors.SHELL_APP_VERSION_NOT_FOUND();
  const receiver = messageReceiver(definition);
  if (!receiver) throw shellErrors.SHELL_MESSAGE_SEND_NO_RECEIVER();
  if (receiver === "conversation") {
    try {
      await store.call({ op: "conversation.send", window_id: current.id, request_id: requestId, text, attachments: [] });
    } catch (error) {
      if (!isCoreError(error) || error.id !== "CONV_SEND_THREAD_NOT_FOUND") throw error;
      await reveal(store, current, desktop.workspace_id);
      throw shellErrors.SHELL_MESSAGE_SEND_NOT_CONFIGURED({ app: app.name });
    }
  } else {
    const result = await deliverClientMessage(store, current.id, { request_id: requestId, text });
    if (result.status === "not_ready") {
      await reveal(store, current, desktop.workspace_id);
      throw shellErrors.SHELL_MESSAGE_SEND_NOT_READY({ app: app.name, reason: result.reason });
    }
  }
  return { appId: app.id, windowId: current.id, created };
}
