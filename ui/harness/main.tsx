import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { App, AppDefinition, AppVersion, AppWindow, ShellSnapshot } from "../src/contract/contract";
import {
  AppWindowContent,
  createFakeTransport,
  createHttpTransport,
  createShellStore,
  useShellSnapshot,
  type FakeTransport,
} from "@kaleidoscope/ui";
import "@kaleidoscope/ui/styles.css";
import "./harness.css";
import galleryJson from "../../examples/block-gallery.json";
import sampleOne from "./assets/landscape.png";
import sampleTwo from "./assets/shapes.png";
import sampleTone from "./assets/tone.wav";
import mdEditorJson from "../../apps/md-editor.json";
import mdViewerJson from "../../apps/md-viewer.json";
import workspacePasJson from "../../examples/workspace-pas.json";
import { dataViewsApp } from "./data-views-app";
import { dataLayoutApp } from "./data-layout-app";
import pluginsDocument from "./create-plugins.txt?raw";
import { exposeDocsHarness, galleryForDocs } from "./docs-media-test";

const mdEditor = mdEditorJson as AppDefinition;
const mdViewer = mdViewerJson as AppDefinition;
const workspacePas = workspacePasJson as unknown as AppDefinition;
const storageDocument: AppDefinition = {
  id: "storage-document", name: "저장소 문서", requires: { blocks: 6, modules: { storage: 1 } },
  permissions: [], state: {},
  storage: { entries: [{ id: "memo", key: "memo", kind: "md", default: "# 기본 문서", label: "문서", presentation: "hidden" }] },
  ui: { type: "split", direction: "row", sizes: [50, 50], children: [
    { type: "markdown_editor", document: { entry: "memo" } },
    { type: "markdown_view", document: { entry: "memo" } },
  ] },
};
const galleryParams = new URLSearchParams(window.location.search);
const gallery = galleryForDocs(galleryJson as AppDefinition, galleryParams.has("long-log"), galleryParams.has("crop-image"), galleryParams.has("video-controls"));
const conversationMode = new URLSearchParams(window.location.search).get("conversation");
if (conversationMode) workspacePas.agent = {
  protocol: "conversation-v1", permission: "conversation", base_path: "api", namespace: "test", profile: "test", collection: "test", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "", instructions_template: "", thread_entry: "thread",
};
const definitions = [mdEditor, mdViewer, workspacePas, dataLayoutApp, gallery, dataViewsApp, storageDocument];
const timestamp = "2026-10-28T00:00:00Z";

function makeWindow(definition: AppDefinition, id: string, z: number): AppWindow {
  return {
    id,
    desktop_id: "desktop-1",
    app_id: definition.id,
    app_version: 1,
    rect: { x: 0, y: 0, width: 640, height: 520 },
    z,
    state: { ...definition.state },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

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

const initialSnapshot: ShellSnapshot = {
  shared: {
    apps,
    app_versions: appVersions,
    workspaces: [{ id: "workspace-1", name: "kaleidoscope", created_at: timestamp, updated_at: timestamp }],
    desktops: [{ id: "desktop-1", workspace_id: "workspace-1", name: "작업", position: 0, created_at: timestamp, updated_at: timestamp }],
  windows: [makeWindow(mdEditor, "editor-window", 1), makeWindow(mdViewer, "viewer-window", 2), makeWindow(workspacePas, "pas-window", 3), makeWindow(dataLayoutApp, "data-window", 4), makeWindow(gallery, "gallery-window", 5), makeWindow(dataViewsApp, "views-window", 6), makeWindow(storageDocument, "storage-window", 7)],
  },
  device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: [], pc_access: [], local_agent_access: [] },
  supported: { blocks: 1, modules: { files: 1 } },
  link: { state: "unlinked" },
  sharing: [],
  update: { state: "unavailable" },
};

const sampleDocument = `# kaleidoscope 작업 메모

이 문서는 편집기와 읽기 화면의 줄바꿈, 제목 위계, 한국어 본문을 확인하기 위한 예시입니다. 문장을 길게 두어도 오른쪽 패널을 밀어내지 않고 읽기 폭 안에서 자연스럽게 이어집니다.

## 진행 중인 일

| 항목 | 상태 | 다음 동작 |
| --- | --- | --- |
| 블록 렌더러 | 구현 중 | 파일을 골라 편집 |
| 마크다운 보기 | 준비됨 | 표와 코드 확인 |

### 짧은 코드 예시

    const workspace = "kaleidoscope";
    console.log(workspace);

[프로젝트 안내](https://example.com) · ![표식 아이콘](marker.png)
`;

const previewDocument = `# Create plugins

> Create custom plugins to extend Claude Code with skills, agents, hooks, and MCP servers.

Plugins let you extend Claude Code with custom functionality that can be shared across projects and teams. This guide covers creating your own plugins with skills, agents, hooks, and MCP servers.

Looking to install existing plugins? See [Discover and install plugins](/en/discover-plugins). For complete technical specifications, see [Plugins reference](/en/plugins-reference).

## When to use plugins vs standalone configuration

Claude Code supports two ways to add custom skills, agents, and hooks:

| Approach | Skill names | Best for |
| :--- | :--- | :--- |
| **Standalone** (\`.claude/\` directory) | \`/hello\` | Personal workflows, project-specific customizations, quick experiments |
| **Plugins** (directories with a \`.claude-plugin/plugin.json\`) | \`/plugin-name:hello\` | Sharing with teammates, distributing to community, versioned releases, reusable across projects |

**Use standalone configuration when:**

* You're customizing Claude Code for a single project
* The configuration is personal and doesn't need to be shared
* You're experimenting with skills or hooks before packaging them

### Example

\`\`\`sh
claude --plugin-dir ./my-plugin
\`\`\`
`;

const reclickDocument = `# 다시 누르기 시험

## 제목 줄 글자

> 인용 줄 안의 글자들

본문에 [안내 링크](https://example.com/a/very/long/path) 뒤의 글자들이 있다.

    첫째 코드 줄
    둘째 코드 줄

끝.

| 항목 | 상태 |
| --- | --- |
| 하나 | 둘 |
| **굵은 글자** | \`코드 낱말\` |
`;

const params = new URLSearchParams(window.location.search);
const pasMode = params.get("pas");
const previewAppId = params.get("preview") || "md-editor";
const previewOnly = params.has("preview");
const mdViewerSnapshot: ShellSnapshot = params.has("md-ready")
  ? {
    ...initialSnapshot,
    shared: {
      ...initialSnapshot.shared,
      windows: initialSnapshot.shared.windows.map((item) => item.id === "viewer-window"
        ? { ...item, state: { ...item.state, current_file: "Kaleidoscope.md" } }
        : item),
    },
    device: {
      ...initialSnapshot.device,
      grants: [{ window_id: "viewer-window", permission: "docs", root_path: "/fake/docs", root_name: "문서", granted_at: timestamp }],
    },
  }
  : initialSnapshot;
const connectedSnapshot: ShellSnapshot = {
  ...mdViewerSnapshot,
  link: { state: "connected", server_url: "https://kaleidoscope.example", device_name: "개발 PC" },
};
const demoSnapshot: ShellSnapshot = conversationMode ? connectedSnapshot : ["ready", "empty", "loading", "load-error", "send-error"].includes(pasMode ?? "")
  ? connectedSnapshot
  : pasMode === "offline"
    ? { ...mdViewerSnapshot, link: { state: "offline", server_url: "https://kaleidoscope.example", device_name: "개발 PC", reason: "서버에 닿지 않습니다" } }
    : mdViewerSnapshot;
const fakeTransport = createFakeTransport({
  snapshot: demoSnapshot,
  data: { sources: { pictures: { value: [{ kind: "file", name: "landscape.png", path: "landscape.png", size: 2048, modified: timestamp }, { kind: "file", name: "shapes.png", path: "shapes.png", size: 1024, modified: timestamp }] }, sounds: { value: [{ kind: "file", name: "tone.wav", path: "tone.wav", ext: "wav", size: 128044, modified: timestamp }, { kind: "file", name: "tone-second.wav", path: "tone-second.wav", ext: "wav", size: 128044, modified: timestamp }] }, sample: { value: { message: "데이터를 불러왔습니다" }, delayMs: 1000 }, failed: { error: "데이터를 받지 못했습니다" } }, callError: "요청을 처리하지 못했습니다" },
  media: { "landscape.png": sampleOne, "shapes.png": sampleTwo, "tone.wav": sampleTone, "tone-second.wav": sampleTone },
  folder: { root_path: "/fake/docs", root_name: "문서" },
  conversation: conversationMode || pasMode ? {
    thread: conversationMode === "start" || conversationMode === "login-start" || pasMode === "empty" ? null : { id: "fake-thread", external: { namespace: "test", key: "workspace-1" }, title: "작업", model: { id: "argon", label: "Argon" }, created_at: timestamp, archived: false },
    items: [{ id: "1", kind: "assistant", text: "기존 기록", at: timestamp, attachments: [] }],
    olderPages: [[{ id: "0", kind: "user", text: "이전 기록", at: timestamp, attachments: [] }], [{ id: "older", kind: "assistant", text: "더 이전 기록", at: timestamp, attachments: [] }]],
    models: [{ id: "argon", label: "Argon", available: true }, { id: "disabled", label: "Sol", available: false, reason: "사용 불가" }],
    loginRequired: conversationMode === "login" || conversationMode === "login-start", conflict: conversationMode === "conflict", delayMs: pasMode === "loading" ? 5000 : conversationMode ? 350 : 0,
    getError: pasMode === "load-error" ? "작업 PAS를 불러오지 못했습니다" : undefined,
    sendError: pasMode === "send-error" ? "메시지를 보내지 못했습니다" : undefined,
    sendDelayMs: Number(params.get("send-delay")) || undefined,
    draft: conversationMode === "draft" ? { request_id: "draft-id", text: "복원된 초안", attachments: [{ name: "메모.txt", mime: "text/plain", data_base64: "aGVsbG8=" }], failed: false } : undefined,
  } : undefined,
  files: {
    "settings.json": "{\r\n  \"theme\": \"system\"\r\n}\r\n",
    "README.md": "# 첫 문서\n\n편집과 자동 저장을 확인합니다.\n",
    "Kaleidoscope.md": sampleDocument,
    "Create-plugins.md": pluginsDocument,
    "Create-plugins-preview.md": previewDocument,
    "large.md": `${"Long paragraph with **bold** and [link](/example).\n\n".repeat(20000)}`,
    "notes/meeting.md": "# 회의 메모\n\n다음 내용을 이어 씁니다.\n",
    "notes/line-endings.md": "첫 줄\r\n둘째 줄\r\n",
    "notes/READ-ME.MD": "# 대문자 확장자\n",
    "notes/skip.txt": "트리에서 숨길 파일입니다",
    "reclick.md": reclickDocument,
  },
});

const coreUrl = new URLSearchParams(window.location.search).get("core");
const transport = coreUrl ? createHttpTransport(coreUrl) : fakeTransport;
const store = createShellStore(transport);
if (!coreUrl) {
  exposeDocsHarness(fakeTransport, store);
  Object.assign(window, { conversationHarness: { emit: fakeTransport.emit, calls: fakeTransport.getCalls } });
}

function Harness() {
  const remoteEdits = useRef(0);
  const snapshot = useShellSnapshot(store);
  const editorWindow = snapshot?.shared.windows.find((item) => item.app_id === "md-editor");
  const viewerWindow = snapshot?.shared.windows.find((item) => item.app_id === "md-viewer");
  const dataWindow = snapshot?.shared.windows.find((item) => item.app_id === "data-controls");
  const viewsWindow = snapshot?.shared.windows.find((item) => item.app_id === "data-views-test");
  const galleryWindow = snapshot?.shared.windows.find((item) => item.app_id === "block-gallery");
  const pasWindow = snapshot?.shared.windows.find((item) => item.app_id === "workspace-pas" || (coreUrl && snapshot.shared.app_versions.some((version) => version.app_id === item.app_id && version.version === item.app_version && version.definition.agent)));
  const storageWindow = snapshot?.shared.windows.find((item) => item.app_id === "storage-document");

  return (
    <main className="ks-harness">
      <header className="ks-harness-header">
        <h1>kaleidoscope</h1>
        <span>블록 검수 창</span>
      </header>
      <div className={`ks-harness-apps${previewOnly ? " is-preview" : ""}`}>
        <section aria-label="md-editor" className={`ks-harness-window${previewOnly && previewAppId !== "md-editor" ? " is-hidden" : ""}`} data-app-id="md-editor" data-testid="app-window-md-editor">
          <header className="ks-harness-window-header">md-editor</header>
          <div className="ks-harness-window-content">
            {editorWindow
              ? <AppWindowContent store={store} windowId={editorWindow.id} />
              : <div className="ks-harness-loading">불러오는 중</div>}
          </div>
        </section>
        <section aria-label="md-viewer" className={`ks-harness-window${previewOnly && previewAppId !== "md-viewer" ? " is-hidden" : ""}`} data-app-id="md-viewer" data-testid="app-window-md-viewer">
          <header className="ks-harness-window-header">md-viewer</header>
          <div className="ks-harness-window-content">
            {viewerWindow
              ? <AppWindowContent store={store} windowId={viewerWindow.id} />
              : <div className="ks-harness-loading">불러오는 중</div>}
          </div>
        </section>
        <section aria-label="workspace-pas" className={`ks-harness-window${previewOnly && previewAppId !== "workspace-pas" ? " is-hidden" : ""}`} data-app-id="workspace-pas" data-testid="app-window-workspace-pas">
          <header className="ks-harness-window-header">workspace-pas</header>
          <div className="ks-harness-window-content">
            {pasWindow
              ? <AppWindowContent store={store} windowId={pasWindow.id} />
              : <div className="ks-harness-loading">불러오는 중</div>}
          </div>
        </section>
        <section aria-label="data-controls" className={`ks-harness-window${previewOnly && previewAppId !== "data-controls" ? " is-hidden" : ""}`} data-app-id="data-controls" data-testid="app-window-data-controls">
          <header className="ks-harness-window-header">범용 블록</header>
          <div className="ks-harness-window-content">{dataWindow ? <AppWindowContent store={store} windowId={dataWindow.id} /> : null}</div>
        </section>
        <section aria-label="block-gallery" className={`ks-harness-window${previewAppId !== "block-gallery" ? " is-hidden" : ""}`} data-app-id="block-gallery" data-testid="app-window-block-gallery">
          <header className="ks-harness-window-header">블록 견본</header>
          <div className="ks-harness-window-content">{galleryWindow ? <AppWindowContent store={store} windowId={galleryWindow.id} /> : null}</div>
        </section>
        <section aria-label="data-views-test" className={`ks-harness-window${previewAppId !== "data-views-test" ? " is-hidden" : ""}`} data-app-id="data-views-test" data-testid="app-window-data-views-test">
          <header className="ks-harness-window-header">보기 시험</header>
          <div className="ks-harness-window-content">{viewsWindow ? <AppWindowContent store={store} windowId={viewsWindow.id} /> : null}</div>
        </section>
        <section aria-label="storage-document" className={`ks-harness-window${previewAppId !== "storage-document" ? " is-hidden" : ""}`} data-app-id="storage-document" data-testid="app-window-storage-document">
          <header className="ks-harness-window-header">저장소 문서</header>
          <div className="ks-harness-window-content">{storageWindow && previewAppId === "storage-document" ? <AppWindowContent store={store} windowId={storageWindow.id} /> : null}</div>
        </section>
      </div>
      {!coreUrl && previewAppId === "storage-document" ? <button onClick={async () => {
        const { result } = await fakeTransport.call({ op: "storage.get", window_id: "storage-window", entry: "memo" });
        remoteEdits.current += 1;
        await fakeTransport.call({ op: "storage.write", window_id: "storage-window", entry: "memo", content: `# 다른 기기의 문서 ${remoteEdits.current}`, expected_revision: result.revision });
      }}>다른 기기에서 수정</button> : null}
      {!coreUrl && !(previewOnly && (previewAppId === "data-controls" || previewAppId === "block-gallery" || previewAppId === "data-views-test")) ? <FakeFilePanel transport={fakeTransport} /> : null}
    </main>
  );
}

function FakeFilePanel({ transport: files }: { transport: FakeTransport }) {
  const [currentFiles, setCurrentFiles] = useState(files.getFiles());

  useEffect(() => files.subscribeFiles(() => setCurrentFiles(files.getFiles())), [files]);

  return (
    <details className="ks-harness-dev-panel" data-testid="fake-files-panel">
      <summary>가상 파일</summary>
      <pre>{Object.entries(currentFiles).map(([path, contents]) => `${path}\n${contents}`).join("\n")}</pre>
    </details>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
