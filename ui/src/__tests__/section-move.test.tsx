import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";
import { SECTION_MIME } from "../blocks/section-drag";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("구역 머리를 끌어 다른 구역 앞에 놓으면 대상 범위와 이동 위치를 전한다", async () => {
  mockVirtualLayout();
  const ui = { type: "repeat", items: { state: "groups" }, key: "key", template: {
    type: "section", title: { item: "title" }, collapsible: true,
    on_move: [{ set_state: "last", value: { expr: "$event" } }],
    child: { type: "text", value: "내용" },
  } } as unknown as Block;
  const state = { groups: [{ key: "a", title: "첫째" }, { key: "b", title: "둘째" }, { key: "c", title: "셋째" }], last: null };
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 66, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = state;
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const source = (await screen.findByRole("button", { name: "셋째" })).closest(".ks-data-section-header")!;
  const target = (await screen.findByRole("button", { name: "첫째" })).closest(".ks-data-section-header")!;
  vi.spyOn(source, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  const drag = (type: string, element: Element, clientY = 0) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(element, event);
  };
  drag("dragstart", source);
  drag("dragover", target, 10);
  expect(target.parentElement!.getAttribute("data-drop-position")).toBe("before");
  drag("drop", target, 10);
  await waitFor(() => expect(calls.mock.calls.map(([request]) => request as CoreRequest)).toContainEqual(expect.objectContaining({
    op: "data.act", pointer: "/ui/template/on_move", event: { key: "c", target: "a", position: "before" }, item: { key: "a", title: "첫째" },
  })));
  const count = () => calls.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer === "/ui/template/on_move").length;
  const middle = (await screen.findByRole("button", { name: "둘째" })).closest(".ks-data-section-header")!;
  vi.spyOn(middle, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
  drag("dragstart", source);
  drag("dragover", source, 10);
  drag("drop", source, 10);
  expect(count()).toBe(1);
  drag("dragstart", source);
  drag("dragover", middle, 30);
  expect(middle.parentElement!.getAttribute("data-drop-position")).toBeNull();
  drag("drop", middle, 30);
  expect(count()).toBe(1);
  drag("dragstart", target);
  drag("dragover", source, 30);
  expect(source.parentElement!.getAttribute("data-drop-position")).toBe("after");
  drag("drop", source, 30);
  await waitFor(() => expect(count()).toBe(2));
  expect(calls.mock.calls.map(([request]) => request as CoreRequest)).toContainEqual(expect.objectContaining({
    op: "data.act", event: { key: "a", target: "c", position: "after" }, item: { key: "c", title: "셋째" },
  }));
  drag("dragstart", source);
  drag("dragover", target, 10);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(target.parentElement!.getAttribute("data-drop-position")).toBeNull();
});

async function setupSectionDrag() {
  mockVirtualLayout();
  const ui = { type: "repeat", items: { state: "groups" }, key: "key", template: {
    type: "section", title: { item: "title" }, collapsible: true,
    on_move: [{ set_state: "last" }], child: { type: "text", value: "내용" },
  } } as unknown as Block;
  const state = { groups: [{ key: "a", title: "첫째" }, { key: "b", title: "둘째" }, { key: "c", title: "셋째" }], last: null };
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 66, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = state;
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const toggle = await screen.findByRole("button", { name: "셋째" });
  const target = (await screen.findByRole("button", { name: "첫째" })).closest(".ks-data-section-header")!;
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  const drag = (type: string, element: Element, clientY = 0) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, relatedTarget: null });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(element, event);
  };
  return { toggle, target, dataTransfer, drag };
}

it("머리 밖으로 나가면 놓을 자리 표시를 지운다", async () => {
  const { toggle, target, drag } = await setupSectionDrag();
  drag("dragstart", toggle.closest(".ks-data-section-header")!);
  drag("dragover", target, 10);
  expect(target.parentElement!.getAttribute("data-drop-position")).toBe("before");
  drag("dragleave", target);
  expect(target.parentElement!.getAttribute("data-drop-position")).toBeNull();
  drag("dragend", toggle.closest(".ks-data-section-header")!);
});

it("접기 단추에서 끌기를 시작하면 구역 끌기 표식을 넣는다", async () => {
  const { toggle, target, dataTransfer, drag } = await setupSectionDrag();
  expect(toggle.classList.contains("ks-data-section-toggle")).toBe(true);
  drag("dragstart", toggle);
  expect(dataTransfer.setData).toHaveBeenCalledWith(SECTION_MIME, expect.stringContaining('"key":"c"'));
  drag("dragover", target, 10);
  expect(target.parentElement!.getAttribute("data-drop-position")).toBe("before");
  drag("dragend", toggle);
});

it("구역 끌기와 트리 끌기는 서로를 놓을 자리로 받지 않는다", async () => {
  mockVirtualLayout();
  const ui = { type: "repeat", items: { state: "groups" }, key: "key", template: {
    type: "section", title: { item: "title" }, collapsible: true, on_move: [{ set_state: "last" }],
    child: { type: "tree", items: { item: "rows" }, by: "children", on_move: [{ set_state: "last" }] },
  } } as unknown as Block;
  const state = { groups: [{ key: "a", title: "첫째", rows: [{ key: "row-a", title: "첫 행" }] }, { key: "b", title: "둘째", rows: [] }], last: null };
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 66, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] }); seed.snapshot.shared.windows[0].state = state;
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const first = (await screen.findByRole("button", { name: "첫째" })).closest(".ks-data-section-header")!;
  const second = (await screen.findByRole("button", { name: "둘째" })).closest(".ks-data-section-header")!;
  const row = await screen.findByRole("treeitem", { name: "첫 행" });
  const emptyTree = second.parentElement!.querySelector(".ks-data-tree")!;
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  const drag = (type: string, element: Element) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 5 });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(element, event);
  };
  drag("dragstart", row); drag("dragover", second);
  expect(second.parentElement!.getAttribute("data-drop-position")).toBeNull();
  drag("dragend", row);
  drag("dragstart", first); drag("dragover", row); drag("dragover", emptyTree);
  expect(row.getAttribute("data-drop-state")).toBeNull();
  expect(emptyTree.getAttribute("data-drop-state")).toBeNull();
  drag("dragend", first);
});

it("동작 단추와 편집 중인 머리는 끌기를 시작하지 않는다", async () => {
  mockVirtualLayout();
  const ui = { type: "repeat", items: { state: "groups" }, key: "key", template: {
    type: "section", title: { item: "title" }, collapsible: true, editing: { item: "editing" },
    on_edit: [{ set_state: "last" }], on_move: [{ set_state: "last" }],
    actions: [{ type: "button", label: "추가", on_click: [] }], child: { type: "text", value: "본문" },
  } } as unknown as Block;
  const state = { groups: [{ key: "a", title: "첫째", editing: false }, { key: "b", title: "둘째", editing: true }], last: null };
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 66, modules: {} }, permissions: [], state, ui };
  const seed = makeTestSeed({ definitions: [definition] }); seed.snapshot.shared.windows[0].state = state;
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const add = (await screen.findAllByRole("button", { name: "추가" }))[0];
  const input = await screen.findByRole("textbox", { name: "구역 이름" });
  expect(input.closest(".ks-data-section-header")?.getAttribute("draggable")).not.toBe("true");
  const setData = vi.fn();
  const event = new MouseEvent("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { setData, effectAllowed: "" } });
  fireEvent(add, event);
  expect(event.defaultPrevented).toBe(true);
  expect(setData).not.toHaveBeenCalled();
});
