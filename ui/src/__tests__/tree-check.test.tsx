import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreRequest } from "../contract/contract";
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

function setup(ui: Block, state: AppDefinition["state"] = {}, blocks = 55) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...state };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const gates: Array<{ entered: () => void; wait: Promise<void> }> = [];
  const calls = vi.spyOn(transport, "call").mockImplementation(async (request: CoreRequest) => {
    if (request.op === "data.act") {
      const gate = gates.shift();
      if (gate) { gate.entered(); await gate.wait; }
    }
    return originalCall(request as never) as never;
  });
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const hold = () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const hit = new Promise<void>((resolve) => { entered = resolve; });
    gates.push({ entered, wait });
    return { hit, release };
  };
  return { calls, transport, hold };
}

const actCalls = (calls: { mock: { calls: unknown[][] } }, pointer: string) =>
  calls.mock.calls.map((call) => call[0] as CoreRequest).filter((request) => request.op === "data.act" && request.pointer === pointer);

it("확인 상자를 누르면 새 값으로 on_check를 한 번 부르고 행을 선택하지 않는다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { calls } = setup({
    type: "tree",
    items: [item],
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }, { set_state: "last_key", value: { expr: "$item.key" } }],
  } as unknown as Block, { picked: null, last: null, last_key: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  expect(row.getAttribute("aria-checked")).toBe("false");
  const box = row.querySelector("[data-tree-check]");
  expect(box).toBeTruthy();

  row.focus();
  fireEvent.click(box!);
  expect(row.getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: true, item })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(1);
  expect(actCalls(calls, "/ui/on_select")).toHaveLength(0);
  expect(row.getAttribute("aria-selected")).toBe("false");
  expect(document.activeElement).toBe(row);

  await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
});

it("동작이 끝나기 전에도 확인 상자를 새 값으로 그린다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { hold } = setup({
    type: "tree",
    items: [item],
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { last: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  const gate = hold();
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  expect(row.getAttribute("aria-checked")).toBe("true");
  await gate.hit;
  expect(row.getAttribute("aria-checked")).toBe("true");
  gate.release();
  await waitFor(() => expect(row.getAttribute("aria-checked")).toBe("false"));
});

it("확인 상자가 있는 행은 Space로 확인을 뒤집고 Enter로 선택한다", async () => {
  const item = { key: "todo", title: "장보기", checked: true };
  const { calls } = setup({
    type: "tree",
    items: [item],
    selected: { state: "picked" },
    on_select: { set_state: "picked" },
    on_check: [{ set_state: "last" }],
  } as unknown as Block, { picked: null, last: null });
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  row.focus();

  fireEvent.keyDown(row, { key: " " });
  await waitFor(() => expect(actCalls(calls, "/ui/on_check")).toEqual([expect.objectContaining({ event: false, item })]));
  expect(actCalls(calls, "/ui/on_select")).toHaveLength(0);

  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(actCalls(calls, "/ui/on_select")).toEqual([expect.objectContaining({ event: "todo", item })]));
  expect(actCalls(calls, "/ui/on_check")).toHaveLength(1);
});

it("on_check가 없으면 확인 상자는 보이기만 하고 상태를 바꾸지 않는다", async () => {
  const item = { key: "todo", title: "장보기", checked: false };
  const { calls } = setup({
    type: "tree",
    items: [item],
  } as unknown as Block);
  const row = await screen.findByRole("treeitem", { name: "장보기" });
  expect(row.getAttribute("aria-checked")).toBe("false");
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(row.querySelector("[data-tree-check]")).toBeTruthy();

  row.focus();
  fireEvent.click(row.querySelector("[data-tree-check]")!);
  fireEvent.keyDown(row, { key: " " });
  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);
  expect(row.getAttribute("aria-checked")).toBe("false");
});

it("default_expanded는 처음부터 펼치고 사용자가 접은 행은 접힌 채로 두며 새 행은 펼친다", async () => {
  const items = [
    { key: "p", title: "상위", children: [{ key: "c", title: "하위" }] },
  ];
  const { transport } = setup({
    type: "tree",
    default_expanded: true,
    items: { state: "items" },
  } as unknown as Block, { items }, 55);
  const parent = await screen.findByRole("treeitem", { name: "상위" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "하위" })).toBeTruthy();

  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "하위" })).toBeNull();

  await act(async () => {
    await transport.call({
      op: "window.patch_state",
      window_id: "viewer-window",
      patch: { items: [...items, { key: "q", title: "새 상위", children: [{ key: "q1", title: "새 아이" }] }] },
    });
  });
  expect(await screen.findByRole("treeitem", { name: "새 아이" })).toBeTruthy();
  expect(screen.queryByRole("treeitem", { name: "하위" })).toBeNull();
  expect(parent.getAttribute("aria-expanded")).toBe("false");
});

it("확인 상자가 없는 트리는 상자와 aria-checked 없이 그대로 동작한다", async () => {
  const { calls } = setup({ type: "tree", items: [{ key: "a", title: "하나" }] } as unknown as Block);
  const row = await screen.findByRole("treeitem", { name: "하나" });
  expect(row.hasAttribute("aria-checked")).toBe(false);
  expect(row.hasAttribute("aria-disabled")).toBe(false);
  expect(row.querySelector("[data-tree-check]")).toBeNull();

  row.focus();
  fireEvent.keyDown(row, { key: " " });
  await act(async () => { await Promise.resolve(); });
  expect(calls.mock.calls.some(([request]) => (request as CoreRequest).op === "data.act")).toBe(false);
});
