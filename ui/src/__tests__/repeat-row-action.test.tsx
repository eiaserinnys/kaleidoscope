import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreReply, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(mockVirtualLayout);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sections = [
  { id: "s1", title: "첫째 구역", rows: [{ key: "a1", title: "첫째 할 일", checked: false }, { key: "a2", title: "둘째 할 일", checked: false }] },
  { id: "s2", title: "둘째 구역", rows: [{ key: "b1", title: "셋째 할 일", checked: false }, { key: "b2", title: "넷째 할 일", checked: false }] },
];

function treeRepeat(onCheck: unknown, extra: Record<string, unknown> = {}): Block {
  return {
    type: "repeat", items: { state: "sections" }, key: "id", template: {
      type: "stack", direction: "column", children: [
        { type: "tree", items: { item: "rows" }, on_check: onCheck, ...extra },
        { type: "button", label: "구역 고르기", on_click: [{ set_state: "picked_section", value: { expr: "$item.id" } }] },
      ],
    },
  } as unknown as Block;
}

function setup(ui: Block) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 56, modules: {} }, permissions: [], state: {}, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { sections };
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  return { calls, transport };
}

const actCalls = (calls: { mock: { calls: unknown[][] } }, pointer: string) =>
  calls.mock.calls.map((call) => call[0] as CoreRequest).filter((request) => request.op === "data.act" && request.pointer === pointer);

it("repeat 템플릿 안 트리의 확인 상자를 누르면 그 행 항목을 on_check로 넘긴다", async () => {
  const { calls } = setup(treeRepeat([{ set_state: "checked_key", value: { expr: "$item.key" } }]));
  const row = await screen.findByRole("treeitem", { name: "넷째 할 일" });
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  await waitFor(() => expect(actCalls(calls, "/ui/template/children/0/on_check")).toEqual([
    expect.objectContaining({ event: true, item: sections[1].rows[1] }),
  ]));
});

it("repeat 템플릿 안 트리의 클라이언트 on_check는 행 항목과 부모, 행 키를 받는다", async () => {
  const definition: AppDefinition = {
    ...mdViewerDefinition, id: "repeat-row-client", requires: { blocks: 56, modules: { client: 1, assets: 1 } },
    permissions: [], state: {}, assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: ["check"], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "repeat", items: { state: "sections" }, key: "id", template: { type: "tree", items: { item: "rows" }, on_check: { client: "check" } } } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { sections };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
    : call(request));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  const post = vi.spyOn((document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement).contentWindow!, "postMessage");
  const row = await screen.findByRole("treeitem", { name: "넷째 할 일" });
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: "ks-client-action", name: "check",
    context: expect.objectContaining({ item: sections[1].rows[1], key: "b2", parent_item: sections[1] }),
  }), "*"));
  store.dispose();
});

it("항목을 넘기지 않는 단추 동작은 repeat 항목을 그대로 받는다", async () => {
  const { calls } = setup(treeRepeat([{ set_state: "checked_key", value: { expr: "$item.key" } }]));
  const button = await screen.findAllByRole("button", { name: "구역 고르기" });
  fireEvent.click(button[1]);
  await waitFor(() => expect(actCalls(calls, "/ui/template/children/1/on_click")).toEqual([
    expect.objectContaining({ item: sections[1] }),
  ]));
});
