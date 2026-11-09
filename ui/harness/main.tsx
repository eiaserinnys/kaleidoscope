import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { App, AppDefinition, AppVersion, AppWindow, ShellSnapshot } from "../src/contract/contract";
import type { WindowData } from "../src/data/window-data";
import {
  AppWindowContent,
  ContextMenuHost,
  createFakeTransport,
  createHttpTransport,
  TooltipProvider,
  createShellStore,
  installShellDragGuard,
  useShellSelector,
  type FakeTransport,
} from "@kaleidoscope/ui";
import "@kaleidoscope/ui/styles.css";
import "./harness.css";
import galleryJson from "../../examples/block-gallery.json";
import fieldLayoutJson from "../../examples/field-layout.json";
import sampleOne from "./assets/landscape.png";
import sampleTwo from "./assets/shapes.png";
import sampleTone from "./assets/tone.wav";
import mdEditorJson from "../../apps/md-editor.json";
import htmlReportJson from "../../apps/html-report.json";
import { htmlReportSample } from "./html-report-sample";
import workspacePasJson from "../../examples/workspace-pas.json";
import { dataViewsApp } from "./data-views-app";
import { pagingApp, pagingComparisonApp, pagingSeeds, pagingSplitApp } from "./paging-app";
import { dataLayoutApp } from "./data-layout-app";
import earthJson from "../../tests/fixtures/store-apps/earth.json";
import marketJson from "../../tests/fixtures/store-apps/market.json";
import profilerJson from "../../apps/profiler.json";
import readerJson from "../../tests/fixtures/store-apps/reader.json";
import pluginsDocument from "./fixtures/create-plugins.txt?raw";
import clientChatSource from "./fixtures/client-chat.js?raw";
import { exposeDocsHarness, galleryForDocs } from "./docs-media-test";
import { makeLongConversation } from "./chat-long-history";
import { blockSet18Fixtures } from "../e2e/fixtures/blocks-18";
import { previewGridFixtures } from "../e2e/fixtures/preview-grid";
import { shellDefectFixtures } from "../e2e/fixtures/shell-defects";
import { stackWhenFillApp } from "../e2e/fixtures/stack-when-fill";
import { repeatEmptyCenterApp } from "../e2e/fixtures/repeat-empty-center";
import { inputSpinApp } from "../e2e/fixtures/input-spin";
import { inputOptionsApp } from "../e2e/fixtures/input-options-app";
import { inputDateTimeApp } from "../e2e/fixtures/input-date-time-app";
import windowBodyGutter from "../e2e/fixtures/window-body-gutter.json";
import windowBodyGutterLists from "../e2e/fixtures/window-body-gutter-lists.json";
import windowBodyGutterRow from "../e2e/fixtures/window-body-gutter-row.json";
import bareLayoutEdges1063 from "../e2e/fixtures/bare-layout-edges-1063.json";
import progressTrackJson from "../e2e/fixtures/progress-track-app.json";
import { executeWindowAction, readWindowView, registerControlWindow } from "../src/share/window-control";
import { describeVisible } from "../src/share/visible";

const mdEditor = mdEditorJson as AppDefinition;
installShellDragGuard();
const htmlReport = htmlReportJson as AppDefinition;
const workspacePas = workspacePasJson as unknown as AppDefinition;
const clientChatScriptUrl = URL.createObjectURL(new Blob([clientChatSource], { type: "text/javascript" }));
const chatStateMode = new URLSearchParams(window.location.search).get("chat_state");
const clientChatApp = {
  id: "client-chat-test", name: "클라이언트 채팅 시험",
  requires: { blocks: 38, modules: { assets: 1, client: 4 } },
  permissions: [], state: {},
  ...(chatStateMode === "failed" || chatStateMode === "login"
    ? { sources: { chat_status: { kind: "request", permission: "chat-connection", path: "/chat-status" } } }
    : {}),
  assets: [{ id: "client-chat-fixture", version: 1 }, { id: "client-chat-image", version: 1 }],
  client: {
    runtime: "javascript", entry: { id: "client-chat-fixture", version: 1 }, inputs: {},
    outputs: { footer: { default: "도구 승인 기본값" }, switching: { default: false } }, channels: ["thread"],
    actions: ["send", "cancel", "attachment"], commands: {}, state_keys: [], storage_entries: [],
  },
  ui: {
    type: "chat", loading: chatStateMode === "failed" || chatStateMode === "login" ? { expr: "$data.chat_status" } : { client: "switching" }, client: { channel: "thread", on_send: "send", on_cancel: "cancel", on_attachment: "attachment" },
    footer: { type: "text", value: { client: "footer" }, style: "body" },
  },
} as unknown as AppDefinition;
const visualPreviewDefinitions = [earthJson, marketJson, profilerJson, readerJson].map((definition) => definition as unknown as AppDefinition);
const shellSelectionApp: AppDefinition = {
  id: "shell-selection-test", name: "선택 간격 시험", requires: { blocks: 10, modules: {} }, permissions: [],
  state: { note: "선택 가능한 입력 내용", enabled: false },
  ui: { type: "stack", direction: "column", gap: "none", children: [
    { type: "toolbar", start: [
      { type: "text", value: "카드 제목" },
      { type: "text", value: "**툴바 글자**", format: "markdown", style: "body" },
    ], end: [{ type: "text", value: "889" }] },
    { type: "tabs", tabs: [
      { label: "요약", child: { type: "stack", direction: "column", gap: "medium", children: [
        { type: "properties", fields: [{ label: "상태", value: "대기 중" }] },
        { type: "section", title: "확인", collapsible: true, child: { type: "stack", direction: "column", gap: "small", children: [
          { type: "text", value: "읽고 복사할 **요약 본문**입니다.", format: "markdown", style: "body" },
          { type: "input", value: { state: "note" }, on_change: { set_state: "note" }, multiline: true, placeholder: "메모" },
          { type: "toggle", label: "활성화", value: { state: "enabled" }, on_change: { set_state: "enabled" } },
        ] } },
      ] } },
      { label: "확인 항목", child: { type: "list", items: [{ key: "1", title: "확인할 내용", value: "설명" }] } },
      { label: "요청", child: { type: "text", value: "요청의 **본문 글자**입니다.", format: "markdown", style: "body" } },
      { label: "노트", child: { type: "feed", entries: [{ key: "note-1", name: "작성자", body: "피드에서 복사할 글" }] } },
    ] },
  ] },
};
const previewDefinitions = [windowBodyGutter as unknown as AppDefinition, windowBodyGutterLists as unknown as AppDefinition, windowBodyGutterRow as unknown as AppDefinition, bareLayoutEdges1063 as unknown as AppDefinition, progressTrackJson as unknown as AppDefinition, ...visualPreviewDefinitions, ...blockSet18Fixtures, ...previewGridFixtures, ...shellDefectFixtures, fieldLayoutJson as unknown as AppDefinition, shellSelectionApp, pagingApp, pagingComparisonApp, pagingSplitApp, stackWhenFillApp, repeatEmptyCenterApp, inputSpinApp, inputOptionsApp, inputDateTimeApp];
const storageDocument: AppDefinition = {
  id: "storage-document", name: "저장소 문서", requires: { blocks: 6, modules: { storage: 1 } },
  permissions: [], state: {},
  storage: { entries: [{ id: "memo", key: "memo", kind: "md", default: "# 기본 문서", label: "문서", presentation: "hidden" }] },
  ui: { type: "split", direction: "row", sizes: [50, 50], children: [
    { type: "markdown", document: { entry: "memo" } },
    { type: "markdown", document: { entry: "memo" }, read_only: true },
  ] },
};
const galleryParams = new URLSearchParams(window.location.search);
const gallery = galleryForDocs(galleryJson as AppDefinition, galleryParams.has("long-log"), galleryParams.has("crop-image"), galleryParams.has("video-controls"));
const conversationMode = new URLSearchParams(window.location.search).get("conversation");
const historyParam = new URLSearchParams(window.location.search).get("history");
const historyCount = historyParam !== null && Number.isInteger(Number(historyParam)) && Number(historyParam) >= 0 ? Number(historyParam) : null;
if (conversationMode) workspacePas.agent = {
  protocol: "conversation-v1", permission: "conversation", base_path: "api", namespace: "test", profile: "test", collection: "test", model_order: [], selected_model: "", title_template: "", initial_instruction_template: "", instructions_template: "", thread_entry: "thread",
};
const definitions = [mdEditor, htmlReport, workspacePas, clientChatApp, dataLayoutApp, gallery, dataViewsApp, storageDocument, ...previewDefinitions];
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
  app_badges: {},
  embedded_available: false,
  shared: {
    app_comments: {},
    apps,
    app_versions: appVersions,
    workspaces: [{ id: "workspace-1", name: "kaleidoscope", created_at: timestamp, updated_at: timestamp }],
    desktops: [{ id: "desktop-1", workspace_id: "workspace-1", name: "작업", position: 0, created_at: timestamp, updated_at: timestamp }],
    windows: [makeWindow(mdEditor, "editor-window", 1), makeWindow(htmlReport, "html-report-window", 2), makeWindow(workspacePas, "pas-window", 3), makeWindow(dataLayoutApp, "data-window", 4), makeWindow(gallery, "gallery-window", 5), makeWindow(dataViewsApp, "views-window", 6), makeWindow(storageDocument, "storage-window", 7), makeWindow(clientChatApp, "client-chat-window", 8), ...previewDefinitions.map((definition, index) => makeWindow(definition, `${definition.id}-window`, 9 + index))],
  },
  device: { active_workspace_id: "workspace-1", active_desktop_ids: { "workspace-1": "desktop-1" }, grants: [], pc_access: [], default_folder_access: [], process_access: [], store_servers: [] },
  supported: { blocks: 22, modules: { assets: 1, client: 4, files: 1, storage: 1 } },
  link: { state: "unlinked" },
  sharing: [],
  update: { state: "unavailable" },
  theme: "system",
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

| 항목 | 상태 | 다음 동작 | 담당 | 날짜 | 설명 |
| --- | --- | --- | --- | --- | --- |
| 긴 표 | 준비 중 | 좁은 창에서 줄바꿈 확인 | 테스트 | 오늘 | 표 셀 내용이 폭을 밀어내지 않습니다 |

    const longLine = "창 폭을 넘길 만큼 충분히 긴 코드 줄이라도 편집기 전체에 가로 스크롤을 만들지 않습니다";

[프로젝트 안내](https://example.com) · ![표식 아이콘](marker.png)
`;

const previewDocument = `# Create plugins

> Create custom plugins to extend Agent B with skills, agents, hooks, and MCP servers.

Plugins let you extend Agent B with custom functionality that can be shared across projects and teams. This guide covers creating your own plugins with skills, agents, hooks, and MCP servers.

Looking to install existing plugins? See [Discover and install plugins](/en/discover-plugins). For complete technical specifications, see [Plugins reference](/en/plugins-reference).

## When to use plugins vs standalone configuration

Agent B supports two ways to add custom skills, agents, and hooks:

| Approach | Skill names | Best for |
| :--- | :--- | :--- |
| **Standalone** (\`.agent/\` directory) | \`/hello\` | Personal workflows, project-specific customizations, quick experiments |
| **Plugins** (directories with a \`.agent-plugin/plugin.json\`) | \`/plugin-name:hello\` | Sharing with teammates, distributing to community, versioned releases, reusable across projects |

**Use standalone configuration when:**

* You're customizing Agent B for a single project
* The configuration is personal and doesn't need to be shared
* You're experimenting with skills or hooks before packaging them

### Example

\`\`\`sh
agent-b --plugin-dir ./my-plugin
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
const mdViewerSnapshot = initialSnapshot;
const connectedSnapshot: ShellSnapshot = {
  ...mdViewerSnapshot,
  link: { state: "connected", mode: "remote", server_url: "https://kaleidoscope.example", device_name: "개발 PC" },
};
const demoSnapshot: ShellSnapshot = conversationMode ? connectedSnapshot : ["ready", "empty", "loading", "load-error", "send-error"].includes(pasMode ?? "")
  ? connectedSnapshot
  : pasMode === "offline"
    ? { ...mdViewerSnapshot, link: { state: "offline", mode: "remote", server_url: "https://kaleidoscope.example", device_name: "개발 PC", reason: null } }
    : mdViewerSnapshot;
const fakeTransport = createFakeTransport({
  snapshot: demoSnapshot,
  storage: [{ window_id: "html-report-window", entry: "reports", content: htmlReportSample }],
  data: { sources: { ...pagingSeeds, chat_status: chatStateMode === "login" ? { login: "chat-connection" } : { error: "대화 상태를 받지 못했습니다" }, date_bounds: { value: { min: "2026-11-19", max: "2026-11-25" }, delayMs: Number(params.get("bounds-delay")) || 1500 }, pictures: { value: [{ kind: "file", name: "landscape.png", path: "landscape.png", size: 2048, modified: timestamp }, { kind: "file", name: "shapes.png", path: "shapes.png", size: 1024, modified: timestamp }] }, sounds: { value: [{ kind: "file", name: "tone.wav", path: "tone.wav", ext: "wav", size: 128044, modified: timestamp }, { kind: "file", name: "tone-second.wav", path: "tone-second.wav", ext: "wav", size: 128044, modified: timestamp }] }, sample: { value: { message: "데이터를 불러왔습니다" }, delayMs: 1000 }, slow_options: { value: ["첫째", "둘째"], delayMs: Number(params.get("options-delay")) || 1500 }, failed: { error: "데이터를 받지 못했습니다" } }, callError: "요청을 처리하지 못했습니다" },
  media: { "landscape.png": sampleOne, "shapes.png": sampleTwo, "tone.wav": sampleTone, "tone-second.wav": sampleTone, "client-chat-fixture": clientChatScriptUrl, "client-chat-image": sampleOne,
    ...Object.fromEntries([
      "<rect x='5' y='3' width='14' height='18' rx='2'/><path d='M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15v2M8 18h2M12 18h2'/>",
      "<path d='M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.3 9.6 4 4 0 0 0 7 17.5h10.5z'/>",
      "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M7 9l3 3-3 3M12 15h5'/>",
      "<path d='M9 18V6l10-2v12'/><circle cx='6.5' cy='18' r='2.5'/><circle cx='16.5' cy='16' r='2.5'/>",
    ].map((body, index) => [`tile-${index}.svg`, `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`)}`])),
  },
  folder: { root_path: "/fake/docs", root_name: "문서" },
  conversation: conversationMode || pasMode ? {
    thread: ["start", "login-start", "attach-start", "attach-own"].includes(conversationMode ?? "") || pasMode === "empty" ? null : conversationMode === "attach-attached" ? { id: "fake-thread", external: { namespace: "test", key: "workspace-1" }, title: "서소영 PAS — 카드 운영 기록 2026년 11월", model: { id: "sol", label: "Sol", group: { id: "eiaserinnys", label: "eiaserinnys" } }, profile: { id: "profile-a", label: "서소영" }, created_at: timestamp, archived: false } : { id: "fake-thread", external: { namespace: "test", key: "workspace-1" }, title: "작업", model: { id: "sol", label: "Sol", group: { id: "eiaserinnys", label: "eiaserinnys" } }, profile: { id: "profile-a", label: "서소영" }, created_at: timestamp, archived: false },
    items: historyCount === null ? [{ id: "1", kind: "assistant", text: "기존 기록", at: timestamp, attachments: [] }] : makeLongConversation(historyCount),
    olderPages: [[{ id: "0", kind: "user", text: "이전 기록", at: timestamp, attachments: [] }], [{ id: "older", kind: "assistant", text: "더 이전 기록", at: timestamp, attachments: [] }]],
    profiles: [{ id: "profile-a", label: "서소영", available: true }, { id: "profile-b", label: "키키", available: true }],
    start: { profile: "profile-a", model: "sol" },
    models: [
      { id: "argon", label: "Argon", available: false, reason: "한도 거부 중", reason_code: "limit_rejected", resets_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), group: { id: "eiaserinnys", label: "eiaserinnys" } },
      { id: "sol", label: "Sol", available: true, group: { id: "eiaserinnys", label: "eiaserinnys" } },
      { id: "n1:eias-linegames:argon", label: "Argon", available: true, group: { id: "eias-linegames", label: "eias-linegames" } },
    ],
    loginRequired: conversationMode === "login" || conversationMode === "login-start", conflict: conversationMode === "conflict", delayMs: pasMode === "loading" ? 5000 : historyCount !== null ? 0 : conversationMode ? 350 : 0,
    getError: pasMode === "load-error" ? "작업 PAS를 불러오지 못했습니다" : undefined,
    sendError: pasMode === "send-error" ? "메시지를 보내지 못했습니다" : undefined,
    sendDelayMs: Number(params.get("send-delay")) || undefined,
    startError: params.get("start-error") ? { code: "conflict", id: "CONV_ATTACH_CONFLICT", message: "고른 대화가 이미 다른 곳에 연결되어 있습니다. 대화 목록을 다시 열고 다른 대화를 고르세요.", details: [] } : undefined,
    draft: conversationMode === "draft" ? { request_id: "draft-id", text: "복원된 초안", attachments: [{ name: "메모.txt", mime: "text/plain", data_base64: "aGVsbG8=" }], failed: false } : undefined,
    attached: conversationMode === "attach-attached",
    own: conversationMode === "attach-own" ? { id: "session-own", external: { namespace: "test", key: "workspace-1" }, title: "서소영 PAS — 카드 운영 기록", model: { id: "sol", label: "Sol", group: { id: "eiaserinnys", label: "eiaserinnys" } }, profile: { id: "profile-a", label: "서소영" }, created_at: timestamp, archived: false } : null,
    adoptable: conversationMode === "attach-start" || conversationMode === "attach-own" ? [
      { id: "session-1", title: "서소영 PAS — 카드 운영과 배포 기록", profile: { id: "profile-a", label: "서소영" }, updated_at: "2026-11-08T09:00:00Z" },
      { id: "session-2", title: "엠버 앤 블레이드 밸런스 회의", profile: { id: "profile-b", label: "키키" }, updated_at: "2026-11-07T09:00:00Z" },
      { id: "session-3", title: "kaleidoscope 셸 설계 검토", updated_at: "2026-11-06T09:00:00Z" },
      { id: "session-4", title: "주간 회고 — 10월 넷째 주 정리", profile: { id: "profile-a", label: "서소영" }, updated_at: "2026-11-05T09:00:00Z" },
      { id: "session-5", title: "", updated_at: "2026-11-04T09:00:00Z" },
      { id: "session-6", title: "발행 파이프라인 점검과 남은 작업 목록", profile: { id: "profile-b", label: "키키" }, updated_at: "2026-11-03T09:00:00Z" },
      { id: "session-7", title: "kaleidoscope · 작업 PAS 연결 설계와 쉘 출시 준비, 10월 마지막 주 정리", profile: { id: "profile-a", label: "서소영" }, updated_at: "2026-11-02T09:00:00Z" },
    ] : undefined,
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

let holdDateInput: string | null = null;
let releaseDateInput: (() => void) | null = null;
if (previewAppId === "input-date-time-fixture") {
  const call = fakeTransport.call.bind(fakeTransport);
  fakeTransport.call = async (request) => {
    if (request.op === "data.act" && "event" in request && holdDateInput !== null && request.event === holdDateInput) {
      holdDateInput = null;
      await new Promise<void>((resolve) => { releaseDateInput = resolve; });
    }
    return call(request);
  };
}
const coreUrl = new URLSearchParams(window.location.search).get("core");
const transport = coreUrl ? createHttpTransport(coreUrl) : fakeTransport;
const store = createShellStore(transport);
let clientChatWindowData: WindowData | null = null;
let noticeFixtureData: WindowData | null = null;
let holdClientChatSnapshot = new URLSearchParams(window.location.search).has("hold_chat_snapshot");
let clientChatSnapshotPending = false;
const captureClientChatWindowData = (data: WindowData | null) => { clientChatWindowData = data; };
const captureNoticeFixtureData = (data: WindowData | null) => { noticeFixtureData = data; };
if (!coreUrl) {
  const clientChatCalls: Array<{ name: string; event: unknown }> = [];
  window.addEventListener("message", (event) => {
    const frame = document.querySelector<HTMLIFrameElement>(".ks-client-frames iframe");
    if (event.source !== frame?.contentWindow) return;
    if (event.data?.type === "chat-test-attachment-held") {
      clientChatCalls.push({ name: "attachment-held", event: {} });
      return;
    }
    if (event.data?.type === "chat-test-snapshot-request") {
      if (holdClientChatSnapshot) { holdClientChatSnapshot = false; clientChatSnapshotPending = true; return; }
      frame.contentWindow?.postMessage({ type: "chat-test-continue-snapshot" }, "*");
      return;
    }
    if (event.data?.type !== "chat-test-call") return;
    clientChatCalls.push({ name: String(event.data.name), event: event.data.event });
  });
  Object.assign(window, { clientChatHarness: {
    calls: () => [...clientChatCalls],
    visibleText: () => { const app = document.querySelector<HTMLElement>('[data-testid="app-window-client-chat"]'); return app ? describeVisible(app).text : ""; },
    clear: () => { clientChatCalls.length = 0; },
    // 성능 측정기가 주기마다 보내는 profiler.report는 사용자 조작과 무관해 세지 않는다.
    coreCalls: () => fakeTransport.getCalls().filter((call) => call.op !== "profiler.report").length,
    control: (type: string) => document.querySelector<HTMLIFrameElement>(".ks-client-frames iframe")?.contentWindow?.postMessage({ type }, "*"),
    setLoading: (value: boolean) => clientChatWindowData?.publishClient({ switching: value }),
    pauseNextSnapshot: () => { holdClientChatSnapshot = true; },
    snapshotPending: () => clientChatSnapshotPending,
    resumeSnapshot: () => { clientChatSnapshotPending = false; document.querySelector<HTMLIFrameElement>(".ks-client-frames iframe")?.contentWindow?.postMessage({ type: "chat-test-continue-snapshot" }, "*"); },
    restartClient: async () => { await clientChatWindowData?.restartClient(); },
    clientGeneration: () => clientChatWindowData?.getClientGeneration() ?? 0,
    chatState: () => {
      const state = clientChatWindowData?.getClientChat("thread");
      return state ? { loading: state.loading, busy: state.busy, items: state.items.length, queued: state.queued.length, attachments: state.attachments.size } : null;
    },
  } });
  Object.assign(window, { noticeFixture: { show: () => noticeFixtureData?.setStatus("저장했습니다"), alert: (message = "파일을 받을 수 없습니다") => noticeFixtureData?.setNotice({ id: "TEST_ERROR", code: "invalid_request", message, details: [] }), read: () => { const root = document.querySelector<HTMLElement>('[data-testid="app-window-notice-fixture"] .ks-data-window'); return root ? describeVisible(root).text : ""; } } });
  exposeDocsHarness(fakeTransport, store);
  Object.assign(window, { conversationHarness: {
    emit: fakeTransport.emit,
    calls: fakeTransport.getCalls,
    emitText: (text: string) => fakeTransport.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "text", stream_id: "perf-stream", text } }),
    setBusy: (busy: boolean) => fakeTransport.emit({ event: "conversation.update", thread_id: "fake-thread", update: { kind: "activity", busy, tool: null } }),
    moveOtherWindow: () => {
      const snapshot = store.getSnapshot();
      if (!snapshot) throw new Error("하네스 상태가 아직 준비되지 않았습니다");
      const z = snapshot.shared.windows.find((item) => item.id === "editor-window")?.z ?? 0;
      fakeTransport.emit({ event: "state.changed", snapshot: {
        ...snapshot,
        shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === "editor-window" ? { ...item, z: z === 1 ? 2 : 1 } : item) },
      } });
    },
  } });
}

function Harness() {
  const remoteEdits = useRef(0);
  const snapshot = useShellSelector(store, (current) => current);
  const editorWindow = snapshot?.shared.windows.find((item) => item.app_id === "md-editor");
  const htmlReportWindow = snapshot?.shared.windows.find((item) => item.app_id === "html-report");
  const dataWindow = snapshot?.shared.windows.find((item) => item.app_id === "data-controls");
  const viewsWindow = snapshot?.shared.windows.find((item) => item.app_id === "data-views-test");
  const galleryWindow = snapshot?.shared.windows.find((item) => item.app_id === "block-gallery");
  const pasWindow = snapshot?.shared.windows.find((item) => item.app_id === "workspace-pas" || (coreUrl && snapshot.shared.app_versions.some((version) => version.app_id === item.app_id && version.version === item.app_version && version.definition.agent)));
  const storageWindow = snapshot?.shared.windows.find((item) => item.app_id === "storage-document");
  const clientChatWindow = snapshot?.shared.windows.find((item) => item.app_id === "client-chat-test");
  const optionsWindow = snapshot?.shared.windows.find((item) => item.app_id === "input-options-fixture");
  const dateTimeWindow = snapshot?.shared.windows.find((item) => item.app_id === "input-date-time-fixture");
  useEffect(() => {
    if (previewAppId !== "input-date-time-fixture" || !dateTimeWindow) return;
    const root = document.querySelector<HTMLElement>(`[data-window-id="${dateTimeWindow.id}"]`);
    if (!root) return;
    const unregister = registerControlWindow(dateTimeWindow.id, root, store);
    Object.assign(window, { inputDateTimeHarness: {
      read: () => readWindowView(dateTimeWindow.id),
      act: (viewId: string, action: Parameters<typeof executeWindowAction>[2]) => executeWindowAction(dateTimeWindow.id, viewId, action, "date-time-test"),
      state: () => store.getSnapshot()?.shared.windows.find((item) => item.id === dateTimeWindow.id)?.state,
      calls: () => fakeTransport.getCalls().filter((call) => call.op === "data.act"),
      hold: (value: string) => { holdDateInput = value; },
      waiting: () => releaseDateInput !== null,
      release: () => { releaseDateInput?.(); releaseDateInput = null; },
    } });
    return unregister;
  }, [dateTimeWindow?.id]);
  useEffect(() => {
    if (previewAppId !== "input-options-fixture" || !optionsWindow) return;
    const root = document.querySelector<HTMLElement>(`[data-window-id="${optionsWindow.id}"]`);
    if (!root) return;
    const unregister = registerControlWindow(optionsWindow.id, root, store);
    Object.assign(window, { inputOptionsHarness: {
      read: () => readWindowView(optionsWindow.id),
      act: (viewId: string, action: Parameters<typeof executeWindowAction>[2]) => executeWindowAction(optionsWindow.id, viewId, action, "options-test"),
      state: () => store.getSnapshot()?.shared.windows.find((item) => item.id === optionsWindow.id)?.state,
      calls: () => fakeTransport.getCalls().filter((call) => call.op === "data.act"),
      visibleText: () => { const app = document.querySelector<HTMLElement>('[data-testid="app-window-input-options-fixture"]'); return app ? describeVisible(app).text : ""; },
    } });
    return unregister;
  }, [optionsWindow?.id]);

  return (
    <main className="ks-harness">
      <ContextMenuHost />
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
        <section aria-label="html-report" className={`ks-harness-window${previewOnly && previewAppId !== "html-report" ? " is-hidden" : ""}`} data-app-id="html-report" data-testid="app-window-html-report">
          <header className="ks-harness-window-header">html-report</header>
          <div className="ks-harness-window-content">
            {htmlReportWindow
              ? <AppWindowContent store={store} windowId={htmlReportWindow.id} />
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
        <section aria-label="client-chat-test" className={`ks-harness-window${previewOnly && previewAppId !== "client-chat-test" ? " is-hidden" : ""}`} data-app-id="client-chat-test" data-testid="app-window-client-chat">
          <header className="ks-harness-window-header">client-chat-test</header>
          <div className="ks-harness-window-content">{clientChatWindow ? <AppWindowContent store={store} windowId={clientChatWindow.id} onWindowData={captureClientChatWindowData} /> : null}</div>
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
        {previewDefinitions.map((definition) => {
          const appWindow = snapshot?.shared.windows.find((item) => item.app_id === definition.id);
          return <section aria-label={definition.id} className={`ks-harness-window${previewOnly && previewAppId !== definition.id ? " is-hidden" : ""}`} data-app-id={definition.id} data-testid={`app-window-${definition.id}`} key={definition.id}>
            <header className="ks-harness-window-header">{definition.id === "shell-selection-test" ? <>선택 간격 시험 <label>비선택 레이블</label></> : definition.name}</header>
            <div className="ks-harness-window-content">{appWindow && previewAppId === definition.id ? <AppWindowContent store={store} windowId={appWindow.id} onWindowData={definition.id === "notice-fixture" ? captureNoticeFixtureData : undefined} /> : null}</div>
          </section>;
        })}
      </div>
      {!coreUrl && previewAppId === "storage-document" ? <button onClick={async () => {
        const { result } = await fakeTransport.call({ op: "storage.get", window_id: "storage-window", entry: "memo" });
        remoteEdits.current += 1;
        await fakeTransport.call({ op: "storage.write", window_id: "storage-window", entry: "memo", content: `# 다른 기기의 문서 ${remoteEdits.current}`, expected_revision: result.revision });
      }}>다른 기기에서 수정</button> : null}
      {!coreUrl && !(previewOnly && (previewAppId === "agent" || previewAppId === "client-chat-test" || previewAppId === "data-controls" || previewAppId === "block-gallery" || previewAppId === "data-views-test" || previewAppId === "paging-test" || previewAppId === "paging-split-test" || previewAppId === "input-options-fixture" || previewAppId === "input-date-time-fixture")) ? <FakeFilePanel transport={fakeTransport} /> : null}
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

createRoot(document.getElementById("root")!).render(<TooltipProvider><Harness /></TooltipProvider>);
