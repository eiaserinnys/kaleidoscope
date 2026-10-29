import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  createFakeTransport,
  createShellStore,
} from "@kaleidoscope/ui";
import { Shell } from "./shell/shell";
import type { App, AppDefinition, AppVersion, AppWindow, LinkStatus, ShellSnapshot } from "../../ui/src/contract/contract";
import "@kaleidoscope/ui/styles.css";
import "./index.css";
import "./shell.css";
import mdEditorJson from "../../examples/md-editor.json";
import mdViewerJson from "../../examples/md-viewer.json";

const timestamp = "2026-10-28T00:00:00Z";
const definitions = [mdEditorJson, mdViewerJson] as AppDefinition[];
const apps: App[] = definitions.map((definition) => ({
  id: definition.id,
  name: definition.name,
  current_version: 1,
  created_at: timestamp,
  updated_at: timestamp,
}));
const appVersions: AppVersion[] = definitions.map((definition) => ({
  app_id: definition.id,
  version: 1,
  definition,
  created_at: timestamp,
}));
const windows: AppWindow[] = definitions.map((definition, index) => ({
  id: `${definition.id}-window`,
  desktop_id: "desktop-1",
  app_id: definition.id,
  app_version: 1,
  rect: { x: 48 + index * 32, y: 48 + index * 32, width: 720, height: 520 },
  z: index + 1,
  state: { current_file: null },
  created_at: timestamp,
  updated_at: timestamp,
}));

function linkStatus(state: string | null): LinkStatus {
  switch (state) {
    case "pairing": return {
      state: "pairing",
      server_url: "https://kaleidoscope.example",
      user_code: "K7PQ-4XMR",
      expires_at: "2026-10-29T00:10:00Z",
    };
    case "connected": return {
      state: "connected",
      server_url: "https://kaleidoscope.example",
      device_name: "Office PC",
    };
    case "offline": return {
      state: "offline",
      server_url: "https://kaleidoscope.example",
      device_name: "Office PC",
      reason: "서버 응답 없음",
    };
    case "revoked": return { state: "revoked", server_url: "https://kaleidoscope.example" };
    default: return { state: "unlinked" };
  }
}

const snapshot: ShellSnapshot = {
  shared: {
    apps,
    app_versions: appVersions,
    workspaces: [{ id: "workspace-1", name: "kaleidoscope", created_at: timestamp, updated_at: timestamp }],
    desktops: [{ id: "desktop-1", workspace_id: "workspace-1", name: "작업", position: 0, created_at: timestamp, updated_at: timestamp }],
    windows,
  },
  device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: [] },
  supported: { blocks: 1, modules: { files: 1 } },
  link: linkStatus(new URLSearchParams(window.location.search).get("link")),
};

const store = createShellStore(createFakeTransport({
  snapshot,
  folder: { root_path: "/fake/docs", root_name: "문서" },
  files: { "README.md": "# kaleidoscope\n\n쉘 화면 캡처용 문서입니다.\n" },
}));

function Harness() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("menu") !== "open") return;
    void store.ready.then(() => document.querySelector<HTMLButtonElement>(".ks-shell-actions button:last-of-type")?.click());
  }, []);
  return <Shell store={store} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
