import { SHELL_APP_IMPORT_REPLY_INVALID, type Rect, type ShellStore } from "@kaleidoscope/ui";

export async function importAppDefinition(
  store: ShellStore,
  desktopId: string,
  definitionJson: string,
  rect: Rect,
): Promise<void> {
  const snapshot = store.getSnapshot();
  const reply = await store.call({ op: "app.import", definition_json: definitionJson });
  if (reply.op !== "app.import") {
    throw SHELL_APP_IMPORT_REPLY_INVALID();
  }

  const alreadyOpen = snapshot?.shared.windows.some((window) =>
    window.desktop_id === desktopId && window.app_id === reply.app.id,
  ) ?? false;
  if (!alreadyOpen) {
    await store.call({ op: "window.open", desktop_id: desktopId, app_id: reply.app.id, rect });
  }
}
