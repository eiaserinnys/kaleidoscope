import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createFakeTransport,
  createShellStore,
  type FakeTransport,
  type FakeWebViewSnapshot,
  type CoreRequest,
} from "@kaleidoscope/ui";
import { Shell } from "./shell/shell";
import { describeVisible } from "../../ui/src/share/visible";
import type { App, AppDefinition, AppVersion, AppWindow, LinkStatus, ShellSnapshot } from "../../ui/src/contract/contract";
import "@kaleidoscope/ui/styles.css";
import "./index.css";
import "./shell.css";
import "./harness.css";
import mdEditorJson from "../../examples/md-editor.json";
import mdViewerJson from "../../examples/md-viewer.json";
import webBrowserJson from "../../examples/web-browser.json";
import explorerJson from "../../examples/explorer.json";
import pasJson from "../../examples/workspace-pas.json";

declare global {
  interface Window {
    __kaleidoscopeHarness?: {
      getSnapshot: () => ShellSnapshot | null;
      getWebPlaces: () => Array<{ window_id: string; bounds: import("../../ui/src/contract/contract").Rect | null }>;
      getWebAttachCount: (windowId: string) => number;
      getShareCalls: () => Array<{ window_id: string; view: import("../../ui/src/contract/contract").VisibleView }>;
      getCalls: () => CoreRequest[];
      describeVisible: (root: HTMLElement) => { text: string; visual: boolean };
    };
  }
}

const timestamp = "2026-10-30T00:00:00Z";
const bottomMenuScenario = new URLSearchParams(window.location.search).has("bottom-menu");
const shareScenario = new URLSearchParams(window.location.search).get("share");
const entries = Array.from({ length: 80 }, (_, i) => ({ key: String(i + 1), title: `항목 ${i + 1}`, value: `값 ${i + 1}` }));
const shareDefinition: AppDefinition = {
  id: `share-${shareScenario}`, name: shareScenario === "table" ? "표" : "목록",
  requires: { blocks: 4, modules: {} }, permissions: [], state: { selected: "1" },
  ui: shareScenario === "table" ? { type: "table", rows: entries, columns: [{ field: "title", label: "이름" }, { field: "value", label: "값" }], selected: { state: "selected" } } : { type: "list", items: entries, selected: { state: "selected" } },
};
const definitions = [mdEditorJson, mdViewerJson, webBrowserJson, explorerJson, pasJson, ...(shareScenario === "table" || shareScenario === "list" ? [shareDefinition] : [])] as AppDefinition[];
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
const shareAppId = shareScenario === "editor" ? "md-editor" : shareScenario === "web" ? "web-browser" : `share-${shareScenario}`;
const shareWindows: AppWindow[] = [shareAppId, "workspace-pas"].map((appId, index): AppWindow => ({
  id: `${appId}-window`, desktop_id: "desktop-1", app_id: appId, app_version: 1,
  rect: { x: index ? 745 : 16, y: 16, width: 700, height: 510 }, z: index + 1,
  state: appId === "md-editor" ? { current_file: "README.md" } : appId === "web-browser" ? { url: "https://www.google.com/" } : { selected: "1" },
  created_at: timestamp, updated_at: timestamp,
}));
const windows: AppWindow[] = shareScenario ? shareWindows : bottomMenuScenario
  ? [{
    id: "explorer-window",
    desktop_id: "desktop-1",
    app_id: "explorer",
    app_version: 1,
    rect: { x: 0, y: 0, width: 720, height: 520 },
    z: 1,
    state: {},
    created_at: timestamp,
    updated_at: timestamp,
  }]
  : ["web-browser", "explorer"].map((appId) => {
    const state: AppWindow["state"] = appId === "web-browser" ? { url: "https://www.google.com/" } : {};
    return {
      id: `${appId}-window`,
      desktop_id: "desktop-1",
      app_id: appId,
      app_version: 1,
      rect: appId === "web-browser"
        ? { x: 48, y: 48, width: 720, height: 520 }
        : { x: 480, y: 170, width: 720, height: 520 },
      z: appId === "web-browser" ? 2 : 1,
      state,
      created_at: timestamp,
      updated_at: timestamp,
    };
  });

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
    desktops: [
      { id: "desktop-1", workspace_id: "workspace-1", name: "작업", position: 0, created_at: timestamp, updated_at: timestamp },
      { id: "desktop-2", workspace_id: "workspace-1", name: "두 번째 화면", position: 1, created_at: timestamp, updated_at: timestamp },
    ],
    windows,
  },
  device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: shareScenario === "editor" ? [{ window_id: "md-editor-window", permission: "docs", root_path: "/fake/docs", root_name: "문서", granted_at: timestamp }] : [] },
  supported: { blocks: 4, modules: { files: 1, web: 1 } },
  link: linkStatus(shareScenario ? "connected" : new URLSearchParams(window.location.search).get("link")),
  sharing: [],
};

const files = shareScenario === "editor" ? { "README.md": Array.from({ length: 120 }, (_, i) => `줄 ${i + 1}`).join("\n") } : bottomMenuScenario
  ? Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`z${String(index).padStart(2, "0")}.md`, `# File ${index}`]))
  : {
    "README.md": "# kaleidoscope\n\n쉘 화면 캡처용 문서입니다.\n",
    "notes/a.md": "# 첫 번째 노트\n",
    "notes/b.md": "# 두 번째 노트\n",
    "notes/todo.txt": "확인할 항목\n",
    "images/cover.png": "가짜 이미지 파일",
  };

const transport: FakeTransport = createFakeTransport({
  snapshot,
  agents: shareScenario ? { "workspace-1": { agent: { workspace_id: "workspace-1", model_preset: "test", model_label: "Test", busy: false, tool: null, created_at: timestamp }, items: [], models: [] } } : undefined,
  folder: { root_path: "/fake/docs", root_name: "문서" },
  webUnavailable: new URLSearchParams(window.location.search).get("web") === "unavailable",
  files,
});
const store = createShellStore(transport);
window.__kaleidoscopeHarness = {
  getSnapshot: store.getSnapshot,
  getWebPlaces: transport.getWebPlaces,
  getWebAttachCount: transport.getWebAttachCount,
  getShareCalls: transport.getShareCalls,
  getCalls: transport.getCalls,
  describeVisible,
};

function FakeWebViewLayer({ fakeTransport }: { fakeTransport: FakeTransport }) {
  const [views, setViews] = useState<FakeWebViewSnapshot[]>(() => fakeTransport.getWebViews());

  useEffect(() => {
    const update = () => setViews(fakeTransport.getWebViews());
    update();
    return fakeTransport.subscribeWebViews(update);
  }, [fakeTransport]);

  return (
    <div className="ks-harness-webview-layer" aria-label="가짜 웹 화면">
      {views.map((view) => view.bounds ? (
        <section
          className="ks-harness-webview"
          data-testid={`fake-webview-${view.windowId}`}
          key={view.windowId}
          style={{
            left: view.bounds.x,
            top: view.bounds.y,
            width: view.bounds.width,
            height: view.bounds.height,
          }}
        >
          <header className="ks-harness-webview-toolbar">
            <span>{view.page.title}</span>
            <span>{view.page.url}</span>
          </header>
          <div className="ks-harness-webview-page">{view.page.title}</div>
        </section>
      ) : null)}
    </div>
  );
}

function Harness() {
  return (
    <>
      <Shell store={store} />
      <FakeWebViewLayer fakeTransport={transport} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
