import type { ShellStore } from "@kaleidoscope/ui";

export async function importAppDefinition(store: ShellStore, desktopId: string, definitionJson: string): Promise<void> {
  const snapshot = store.getSnapshot();
  const reply = await store.call({ op: "app.import", definition_json: definitionJson });
  if (reply.op !== "app.import") {
    throw { code: "io", message: "앱 가져오기 응답이 올바르지 않습니다", details: [] };
  }

  const alreadyOpen = snapshot?.shared.windows.some((window) =>
    window.desktop_id === desktopId && window.app_id === reply.app.id,
  ) ?? false;
  if (!alreadyOpen) {
    await store.call({ op: "window.open", desktop_id: desktopId, app_id: reply.app.id });
  }
}
