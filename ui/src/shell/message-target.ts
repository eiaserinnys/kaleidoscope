import type { AppDefinition, SharedState } from "../contract/contract";
import { BUILTIN_DEFAULT_MESSAGE_APP_IDS } from "../contract/limits";
import { useShellSelector, type ShellStore } from "../core/shell-store";

export type MessageReceiver = "conversation" | "client";
export type MessageApp = { id: string; name: string; version: number; receiver: MessageReceiver };

export function messageReceiver(definition: AppDefinition): MessageReceiver | null {
  if (definition.agent) return "conversation";
  if (definition.client?.capabilities?.includes("receive_message")) return "client";
  return null;
}

export function messageApps(state: SharedState): MessageApp[] {
  return state.apps.flatMap((app) => {
    const definition = state.app_versions.find((version) => version.app_id === app.id && version.version === app.current_version)?.definition;
    const receiver = definition && messageReceiver(definition);
    return definition && receiver ? [{ id: app.id, name: definition.name, version: app.current_version, receiver }] : [];
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function defaultMessageApp(state: SharedState): MessageApp | null {
  const apps = messageApps(state);
  const selected = apps.find((app) => app.id === state.preferences?.default_message_app_id);
  if (selected) return selected;
  for (const id of BUILTIN_DEFAULT_MESSAGE_APP_IDS as readonly string[]) {
    const builtin = apps.find((app) => app.id === id);
    if (builtin) return builtin;
  }
  return null;
}

export function useDefaultMessageApp(store: ShellStore): { id: string; name: string } | null {
  return useShellSelector(store, (snapshot) => {
    const app = snapshot && defaultMessageApp(snapshot.shared);
    return app ? { id: app.id, name: app.name } : null;
  }, (left, right) => left === right || Boolean(left && right && left.id === right.id && left.name === right.name));
}
