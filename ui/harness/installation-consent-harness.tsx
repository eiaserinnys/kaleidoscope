import { createRoot } from "react-dom/client";
import { createFakeTransport, createShellStore } from "../src/index";
import type { AppDefinition, CoreRequest, ProcessSpec } from "../src/contract/contract";
import { makeTestSeed } from "../src/__tests__/fixtures";
import { WindowFrame } from "../../app/src/shell/window-frame";
import "../src/styles/index.css";
import "../../app/src/shell.css";

const seed = makeTestSeed();
const mode = new URLSearchParams(window.location.search).get("link");
if (mode === "embedded" || mode === "remote") {
  seed.snapshot.link = { state: "connected", mode, server_url: mode === "embedded" ? "http://localhost:18400" : "https://server.example.org", device_name: "내 기기" };
}
const appWindow = seed.snapshot.shared.windows[0];
seed.snapshot.shared.windows = [{ ...appWindow, z: 2, rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } }];
const fake = createFakeTransport(seed);
const normalCall = fake.call.bind(fake);
const answers: CoreRequest[] = [];
fake.call = (async (request: CoreRequest) => {
  if (request.op === "app.respond_install_permission") { answers.push(request); return { op: request.op }; }
  return normalCall(request as never);
}) as typeof fake.call;
const store = createShellStore(fake);
const sample = {
  id: "research-desk", name: "자료 수집", requires: { blocks: 1, modules: {} }, permissions: [
    { module: "files", id: "research", label: "자료 폴더", access: "readwrite", scope: "folder" },
    { module: "connection", id: "notes", label: "노트 연결", connection: "notes-service", access: "readwrite" },
    { module: "http", id: "public", label: "공개 자료", base_url: "https://archive.example.org", paths: ["/articles", "/images", "/public/long-path-for-research-materials"] },
    { module: "process", id: "convert", label: "자료 변환" },
    { module: "profiler", id: "performance", label: "성능 측정" },
    { module: "store", id: "catalog", label: "스토어" },
  ], state: {}, ui: { type: "text", value: "자료" },
  storage: { entries: [{ id: "settings", key: "settings/{workspace_id}", kind: "json", default: { language: "ko" }, schema: { type: "object" }, label: "자료 수집 설정", description: "자료 수집 범위", presentation: "settings" }] },
  client: { runtime: "javascript", entry: { id: "research-client", version: 1 }, inputs: {}, outputs: {}, actions: ["collect"], commands: {}, state_keys: [], storage_entries: ["settings"], http_permissions: ["public"], process_permissions: ["convert"], device_storage: { prefixes: ["research/"], scope: "window" }, capabilities: ["share"] },
  worker: { runtime: "python3", code: "def run(action, data):\n    return {'status': 'ready'}", actions: ["collect", "refresh"], schedule: { interval_secs: 3600, jitter_secs: 60, enabled_entry: "settings" }, webhook: { enabled_entry: "settings", token_secret: "webhook-token" }, secrets: [{ id: "archive-token", description: "자료 연결 토큰" }], watch_entries: ["settings"] },
  agent: { protocol: "conversation-v1", permission: "notes", base_path: "/conversation", namespace: "research", profile: "assistant", collection: "threads", model_order: ["model"], selected_model: "model", title_template: "자료 정리", initial_instruction_template: "자료를 정리합니다.", instructions_template: "출처를 함께 기록합니다.", thread_entry: "settings" },
} as unknown as AppDefinition;
const light = { ...sample, id: "clock", name: "간단한 시계", permissions: [], storage: undefined, client: undefined, worker: undefined, agent: undefined };
type ConsentExtra = {
  store_url?: string;
  from_origin?: { store_url: string; store_app_id: string; release: number; digest: string };
  replacing?: boolean;
  modified?: boolean;
};
Object.assign(window, { installationHarness: {
  ready: store.ready,
  show: (kind: string, overrides: Partial<AppDefinition> = {}, installedRelease?: number, extra: ConsentExtra = {}) => {
    const definition = { ...(kind === "heavy" ? sample : light), ...overrides };
    fake.emit({ event: "app.install_permission", window_id: appWindow.id, request_id: kind, app_name: definition.name, release: 3, installed_release: installedRelease, store_url: extra.store_url ?? "https://apps.example.org/store", ...(extra.from_origin ? { from_origin: extra.from_origin } : {}), replacing: extra.replacing, modified: extra.modified, digest: "sha256-test-digest", definition });
  },
  showProcess: (scope: "spec" | "command", spec: Partial<ProcessSpec> = {}) => {
    fake.emit({ event: "process.permission", window_id: appWindow.id, request_id: `process-${scope}`, scope,
      spec: { name: spec.name ?? "긴 프로그램 이름", command: spec.command ?? "fixture-agent", args: spec.args ?? ["--serve", "a b"], env: spec.env ?? { LANG: "ko_KR.UTF-8" } } });
  },
  answers,
} });
createRoot(document.getElementById("root")!).render(<main className="ks-desktop-area" style={{ width: "100vw", height: "100vh" }}>
  <WindowFrame area={{ width: window.innerWidth, height: window.innerHeight }} appName="앱 목록" isTop sharing={false} shareable={false} store={store}
    onCall={async () => undefined} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={seed.snapshot.shared.windows[0]}>
    <div>앱 목록</div>
  </WindowFrame>
</main>);
