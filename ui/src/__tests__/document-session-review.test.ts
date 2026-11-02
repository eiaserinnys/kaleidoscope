import { expect, it, vi } from "vitest";
import type { CoreEvent, CoreRequest } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import type { BlockContext } from "../blocks/block-context";
import { documentEditorSession } from "../blocks/document-editor-session";
import { flushEditors } from "../blocks/file-editor-session";

function fixture(name: string) {
  const events = new Set<(event: CoreEvent) => void>();
  const windows = [
    { id: "a", app_id: "app-a", app_version: 1, desktop_id: "desk-a" },
    { id: "same", app_id: "app-a", app_version: 1, desktop_id: "desk-a" },
    { id: "workspace", app_id: "app-a", app_version: 1, desktop_id: "desk-b" },
    { id: "app", app_id: "app-b", app_version: 1, desktop_id: "desk-a" },
  ];
  const entries = [
    { id: "docs", key: "workspaces/{workspace_id}/documents" },
    { id: "archive", key: "workspaces/{workspace_id}/archive" },
    { id: "global", key: "global" },
  ];
  const definitions = ["app-a", "app-b"].map((app_id) => ({ app_id, version: 1, definition: { storage: { entries } } }));
  const snapshot = { shared: { windows, desktops: [{ id: "desk-a", workspace_id: "ws-a" }, { id: "desk-b", workspace_id: "ws-b" }], app_versions: definitions }, link: { state: "connected" } };
  const call = vi.fn(async (request: CoreRequest) => {
    if (request.op === "storage.get") return { op: "storage.get", result: { kind: "md", content: request.doc ?? "", revision: "r1", exists: true } };
    if (request.op === "storage.write") {
      const allowed = (request.entry === "docs" && ["a", "same"].includes(request.window_id)) || (request.entry === "global" && ["a", "workspace"].includes(request.window_id));
      if (name !== "target" || !allowed) throw { code: "server", message: "다른 저장소", details: [] };
      return { op: "storage.write", revision: "r2" };
    }
    throw new Error("예상하지 않은 요청");
  });
  const store = { getSnapshot: () => snapshot, subscribe: () => () => {}, subscribeEvents: (fn: (event: CoreEvent) => void) => { events.add(fn); return () => events.delete(fn); }, call } as unknown as ShellStore;
  const context = (id: string) => ({ store, window: windows.find((item) => item.id === id)!, definition: definitions.find((item) => item.app_id === windows.find((item) => item.id === id)!.app_id)!.definition } as unknown as BlockContext);
  const session = (id: string, entry: string, doc: string) => documentEditorSession(store, id, entry, { context: context(id), collection: true, stateKey: null, fixedDoc: doc });
  return { store, call, session, emit: (event: CoreEvent) => { for (const listener of events) listener(event); } };
}

it("같은 모음의 고정 문서는 독립 세션이며 이동한 새 주소로 다시 찾는다", async () => {
  const { session, emit, call } = fixture("target");
  const first = session("a", "docs", "a.md");
  const second = session("a", "docs", "b.md");
  try {
    await first.open("a.md");
    await second.open("b.md");
    expect(first).not.toBe(second);
    expect(first.getSnapshot()).toMatchObject({ path: "a.md", text: "a.md" });
    expect(second.getSnapshot()).toMatchObject({ path: "b.md", text: "b.md" });
    emit({ event: "storage.update", window_id: "a", update: { kind: "moved", moved: { bucket_id: "bucket", entry_id: "docs", from_doc: "a.md", to_doc: "c.md", revision: "r1" } } });
    expect(session("a", "docs", "c.md")).toBe(first);
    expect(second.getSnapshot().path).toBe("b.md");
    first.setText("옮긴 문서 초안");
    expect(await first.saveNow()).toBe(true);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", window_id: "a", entry: "docs", doc: "c.md", content: "옮긴 문서 초안" }));
  } finally { first.dispose(); second.dispose(); }
});

it("문서 범위 저장은 같은 저장 칸의 다른 창만 포함하고 나머지 저장소 실패에 막히지 않는다", async () => {
  const local = fixture("target");
  const otherStore = fixture("other");
  const sessions = [
    local.session("a", "docs", "a.md"), local.session("same", "docs", "a.md"),
    local.session("workspace", "docs", "a.md"), local.session("app", "docs", "a.md"),
    local.session("a", "archive", "a.md"), otherStore.session("a", "docs", "a.md"),
  ];
  try {
    for (const item of sessions) { await item.open("a.md"); item.setText("초안"); }
    expect(await flushEditors({ kind: "document", store: local.store, windowId: "a", entry: "docs", doc: "a.md" })).toBe(true);
    expect(local.call.mock.calls.flatMap(([request]) => request.op === "storage.write" ? [request.window_id] : []).sort()).toEqual(["a", "same"]);
    expect(otherStore.call.mock.calls.filter(([request]) => request.op === "storage.write")).toHaveLength(0);
    expect(sessions.slice(2).every((item) => item.getSnapshot().dirty)).toBe(true);
  } finally { for (const item of sessions) item.dispose(); }
});

it("작업마다 다른 창이어도 전역 저장 칸이 같으면 함께 저장한다", async () => {
  const local = fixture("target");
  const sessions = [local.session("a", "global", "a.md"), local.session("workspace", "global", "a.md")];
  try {
    for (const item of sessions) { await item.open("a.md"); item.setText("초안"); }
    expect(await flushEditors({ kind: "document", store: local.store, windowId: "a", entry: "global", doc: "a.md" })).toBe(true);
    expect(local.call.mock.calls.flatMap(([request]) => request.op === "storage.write" ? [request.window_id] : []).sort()).toEqual(["a", "workspace"]);
  } finally { for (const item of sessions) item.dispose(); }
});
