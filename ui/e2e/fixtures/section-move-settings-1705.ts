import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { makeTestSeed } from "../../src/__tests__/fixtures";
import { createFakeTransport } from "../../src/core/fake-transport";
import { createShellStore } from "../../src/core/shell-store";
import { AppWindowContent } from "../../src/render/app-window-content";
import type { AppDefinition } from "../../src/contract/contract";
import settings from "./settings-tree/storage-settings.json";
import "../../src/styles/index.css";

const seed = makeTestSeed({ definitions: [settings as AppDefinition] });
const store = createShellStore(createFakeTransport(seed));
createRoot(document.getElementById("root")!).render(createElement(AppWindowContent, {
  store,
  windowId: seed.snapshot.shared.windows[0].id,
  settingsOpen: true,
  settingsVisited: true,
}));
