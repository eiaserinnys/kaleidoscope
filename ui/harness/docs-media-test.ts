import type { AppDefinition } from "../src/contract/contract";
import type { FakeTransport } from "../src/core/fake-transport";
import type { ShellStore } from "../src/core/shell-store";

export function galleryForDocs(definition: AppDefinition, longLog: boolean, crop: boolean, video: boolean): AppDefinition {
  if (!longLog && !crop && !video) return definition;
  const gallery = structuredClone(definition);
  if (gallery.ui.type !== "tabs") return gallery;
  if (longLog) {
    const code = gallery.ui.tabs.find((tab) => tab.label === "코드")?.child;
    if (code?.type === "split" && code.children[0].type === "code") {
      gallery.state.log = Array.from({ length: 20000 }, (_, index) => `줄 ${index}`).join("\n");
      code.children[0].value = { state: "log" };
      code.children[0].follow = true;
    }
  }
  if (crop) {
    const media = gallery.ui.tabs.find((tab) => tab.label === "미디어")?.child;
    const right = media?.type === "split" ? media.children[1] : null;
    const image = right?.type === "split" ? right.children[0] : null;
    if (image?.type === "image") image.src = { permission: "media", path: "landscape.png", crop: { x: 0.25, y: 0, w: 0.5, h: 1 } };
  }
  if (video) {
    const media = gallery.ui.tabs.find((tab) => tab.label === "미디어")?.child;
    const right = media?.type === "split" ? media.children[1] : null;
    const player = right?.type === "split" ? right.children[1] : null;
    if (player?.type === "media") { player.kind = "video"; player.src = { permission: "media", path: "tone.wav" }; }
  }
  return gallery;
}

export function exposeDocsHarness(transport: FakeTransport, store: ShellStore) {
  const target = window as unknown as { __ksHarness: FakeTransport; __ksSetLog: (text: string) => Promise<unknown> };
  target.__ksHarness = transport;
  target.__ksSetLog = async (text) => {
    const window = store.getSnapshot()?.shared.windows.find((item) => item.id === "gallery-window");
    if (!window) throw new Error("견본 창이 없습니다");
    await store.call({ op: "window.set_state", window_id: window.id, state: { ...window.state, log: text } });
  };
}
