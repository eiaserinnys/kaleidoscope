import { waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Binding, DataView } from "../contract/contract";
import type { ItemScope } from "../data/item-scope";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { WindowData } from "../data/window-data";
import { resolveActionScope } from "../data/action-scope";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";

const originalClipboard = navigator.clipboard;
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function setup(action: unknown, values: DataView["values"], state: Record<string, never> = {}) {
  const definition = { id: "md-viewer", name: "동작 시험", requires: { blocks: 18, modules: {} }, permissions: [], state,
    ui: { type: "button", label: "실행", on_click: action } } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = state;
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const calls: string[] = [];
  const requests: unknown[] = [];
  vi.spyOn(transport, "call").mockImplementation((async (request: { op: string }) => {
    calls.push(request.op); requests.push(request);
    if (request.op === "data.read") return { op: "data.read", state, view: { sources: {}, values } };
    if (request.op === "data.act" || request.op === "external.open") return { op: request.op, sequence: 0 };
    return originalCall(request as never);
  }) as typeof transport.call);
  const store = createShellStore(transport);
  const data = new WindowData(store, "viewer-window", definition);
  const stop = data.mount();
  const done = () => { stop(); store.dispose(); };
  return { data, calls, requests, done };
}

function row(item: object, items: Binding, pointer = "/ui/list", parentScope?: ItemScope): ItemScope {
  return { item, key: "a", index: 0, instance: {}, locator: { pointer, items, keyField: "id" }, parentScope } as ItemScope;
}

it("지연된 화면 갱신 대신 현재 반복 항목을 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const h = setup({ copy_text: { item: "text" } }, { "/ui/list/items": { status: "ready", value: [{ id: "a", text: "새 글" }] } });
  expect(await h.data.act("/ui/on_click", null, undefined, undefined, row({ id: "a", text: "옛 글" }, { expr: "$state.items" }))).toBe(true);
  expect(writeText).toHaveBeenCalledWith("새 글");
  expect(h.calls.filter((op) => op === "data.read")).toHaveLength(1);
  h.done();
});

it("사라진 항목은 실행하지 않고 알린다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const h = setup({ copy_text: { item: "text" } }, { "/ui/list/items": { status: "ready", value: [] } });
  expect(await h.data.act("/ui/on_click", null, undefined, undefined, row({ id: "a", text: "옛 글" }, { expr: "$state.items" }))).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
  expect(h.data.getNoticeId()).toBe("SHELL_ACTION_ITEM_REMOVED");
  h.done();
});

it("순서가 바뀐 항목의 새 값과 위치를 코어 동작에 전달한다", async () => {
  const h = setup({ set_state: "saved" }, { "/ui/list/items": { status: "ready", value: [{ id: "b" }, { id: "a", text: "새 글" }] } });
  const scope = row({ id: "a", text: "옛 글" }, { expr: "$state.items" });
  expect(await h.data.act("/ui/on_click", null, undefined, undefined, scope)).toBe(true);
  expect(h.requests).toContainEqual(expect.objectContaining({ op: "data.act", item: { id: "a", text: "새 글" } }));
  h.done();
});

it("중첩 항목은 현재 부모 항목을 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const h = setup({ copy_text: { parent_item: "text" } }, { "/ui/list/items": { status: "ready", value: [{ id: "a", text: "새 부모", children: [{ id: "a" }] }] } });
  const parent = row({ id: "a", text: "옛 부모", children: [{ id: "a" }] }, { expr: "$state.items" });
  const child = row({ id: "a" }, { item: "children" }, "/ui/list/template", parent);
  expect(await h.data.act("/ui/on_click", null, undefined, undefined, child)).toBe(true);
  expect(writeText).toHaveBeenCalledWith("새 부모");
  h.done();
});

it.each([
  [{ copy_text: { expr: "$state.text" } }, "/ui/on_click/copy_text", "새 글", "copy"],
  [{ open_url: { expr: "$state.url" } }, "/ui/on_click/open_url", "https://example.com/new", "open"],
] as const)("로컬 동작은 읽은 식 값을 사용한다: %s", async (action, pointer, value, kind) => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const h = setup(action, { [pointer]: { status: "ready", value } });
  expect(await h.data.act("/ui/on_click", null)).toBe(true);
  if (kind === "copy") expect(writeText).toHaveBeenCalledWith(value);
  else expect(h.requests).toContainEqual(expect.objectContaining({ op: "external.open", url: value }));
  expect(h.calls.filter((op) => op === "data.read")).toHaveLength(1);
  h.done();
});

it("입력과 항목 범위 없는 일반 동작은 현재 값 읽기를 부르지 않는다", async () => {
  const h = setup({ set_state: "saved" }, {});
  await waitFor(() => expect(h.calls).toContain("data.attach"));
  await h.data.act("/ui/on_click", "입력", undefined, undefined, undefined, { input: true });
  await h.data.act("/ui/on_click", null);
  expect(h.calls.filter((op) => op === "data.read")).toHaveLength(0);
  h.done();
});

it("순서가 바뀌면 같은 key의 새 위치를 찾고 사라지면 반복 자리와 key를 알린다", () => {
  const read = (value: unknown[]) => () => ({ status: "ready" as const, value: value as JsonValue });
  const scope = row({ id: "a", text: "옛 글" }, { expr: "$state.items" });
  const moved = resolveActionScope(scope, read([{ id: "b" }, { id: "a", text: "새 글" }]));
  expect(moved.index).toBe(1);
  expect(moved.item).toEqual({ id: "a", text: "새 글" });
  expect(resolveActionScope(scope, () => ({ status: "loading" }))).toBe(scope);
  try { resolveActionScope(scope, read([])); throw new Error("던지지 않음"); }
  catch (error) { expect(error).toMatchObject({ id: "SHELL_ACTION_ITEM_REMOVED", details: ["repeat: /ui/list", "key: a"] }); }
});
