import { waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";
import { makeTestSeed } from "./fixtures";

afterEach(() => { vi.restoreAllMocks(); });

it("문서 이동은 무시하고 고정 저장 항목 변경과 스냅샷을 동기화한다", async () => {
  const definition: AppDefinition = {
    id: "client-storage-events", name: "저장 이벤트 시험", requires: { blocks: 12, modules: { assets: 1, client: 1, storage: 3 } },
    permissions: [], state: {}, assets: [{ id: "script", version: 1 }],
    storage: { entries: [
      { id: "draft", key: "draft", kind: "md", label: "문서", presentation: "hidden", default: "" },
      { id: "docs", key: "docs", kind: "md", label: "문서 모음", presentation: "hidden", default: "", collection: true },
    ] },
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: [], commands: {}, state_keys: [], storage_entries: ["draft"] },
    ui: { type: "text", value: "시험" },
  };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const store = createShellStore(transport);
  await store.ready;
  const call = store.call.bind(store);
  const calls = vi.spyOn(store, "call").mockImplementation(async (request) => {
    if (request.op === "data.media") return { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply;
    if (request.op === "storage.get") return { op: "storage.get", result: { content: "저장된 글", revision: "r1", exists: true, kind: "md" } } as CoreReply;
    return call(request);
  });
  const data = new WindowData(store, "viewer-window", definition);
  const runtime = new ClientRuntime(store, data, definition, definition.client!);
  await runtime.start();
  try {
    const frame = document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    expect(() => transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "moved", moved: { bucket_id: "bucket", entry_id: "docs", from_doc: "a", to_doc: "b", revision: "r2" } } })).not.toThrow();
    expect(calls.mock.calls.filter(([request]) => request.op === "storage.get")).toHaveLength(0);
    transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "draft", key: "draft", kind: "md", revision: "r1", exists: true } } } });
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-storage-sync", entry: "draft", content: "저장된 글" }), "*"));
    transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "snapshot", snapshot: { bucket_id: "bucket", items: [] } } });
    await waitFor(() => expect(calls.mock.calls.filter(([request]) => request.op === "storage.get")).toHaveLength(2));
  } finally {
    await runtime.stop();
    store.dispose();
  }
});
