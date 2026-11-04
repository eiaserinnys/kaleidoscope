import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { TreeView } from "../components/tree/tree-view";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualRows } from "../blocks/data-view-common";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => {
  mockVirtualLayout();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value(this: HTMLElement, options: ScrollToOptions) {
    if (options.top !== undefined) this.scrollTop = options.top;
    if (options.left !== undefined) this.scrollLeft = options.left;
    queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Kind = "list" | "grouped" | "list-grid" | "feed" | "table" | "grid" | "tree" | "repeat";
const items = (prefix: string, count = 80) => Array.from({ length: count }, (_, i) => ({ key: `${prefix}-${i}`, title: `${prefix} ${i}`, body: `${prefix} ${i}` }));
function block(kind: Kind): Block {
  const binding = { state: "rows" };
  if (kind === "list" || kind === "grouped" || kind === "list-grid") return { type: "list", items: binding, grouped: kind === "grouped", ...(kind === "list-grid" ? { layout: "grid" } : {}) };
  if (kind === "feed") return { type: "feed", entries: binding };
  if (kind === "table" || kind === "grid") return { type: "table", rows: binding, columns: [{ field: "title", label: "제목" }], ...(kind === "grid" ? { selection: "cell" } : {}) };
  if (kind === "tree") return { type: "tree", items: binding };
  return { type: "repeat", items: binding, key: "key", virtual: true, template: { type: "text", value: { item: "title" } } };
}
function value(kind: Kind, rows: ReturnType<typeof items>) {
  return kind === "grouped" ? [{ title: "묶음", items: rows }] : rows;
}
async function setup(kind: Kind) {
  const rows = items("이전");
  const state = { rows: value(kind, rows) };
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 25, modules: {} }, permissions: [], state, ui: block(kind) };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = state;
  const store = createShellStore(createFakeTransport(seed));
  const view = render(<AppWindowContent store={store} windowId="viewer-window" />);
  const selector = kind === "tree" ? ".ks-data-tree" : kind === "repeat" ? ".ks-repeat" : kind === "feed" ? ".ks-feed" : kind === "table" || kind === "grid" ? ".ks-table-scroll" : ".ks-list";
  const scroller = await waitFor(() => { const element = view.container.querySelector<HTMLElement>(selector); expect(element).not.toBeNull(); return element!; });
  const update = async (next: ReturnType<typeof items>) => {
    await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { rows: value(kind, next) } }); });
  };
  const scroll = async () => { await act(async () => { scroller.scrollTop = 800; fireEvent.scroll(scroller); }); expect(scroller.scrollTop).toBe(800); };
  return { rows, scroller, update, scroll, store };
}

it.each(["list", "grouped", "list-grid", "feed", "table", "grid", "tree", "repeat"] as Kind[])("%s에서 보이던 키가 모두 사라지면 맨 위로 간다", async (kind) => {
  const { rows, scroller, update, scroll, store } = await setup(kind);
  await scroll();
  await update([rows[0], ...items("새 목록")]);
  await waitFor(() => expect(scroller.scrollTop).toBe(0));
  expect(scroller.isConnected).toBe(true);
  store.dispose();
});

it("트리에서 폴더를 펼치고 접어도 보던 위치를 지킨다", async () => {
  const nodes = [{ id: "folder", label: "폴더", expandable: true, children: [{ id: "child", label: "자식" }] },
    ...items("행").map((item) => ({ id: item.key, label: item.title }))];
  const props = { className: "ks-data-tree", label: "트리", nodes, onActivate: () => {}, onExpandedChange: () => {} };
  const view = render(<TreeView {...props} expanded={new Set()} />);
  const tree = screen.getByRole("tree");
  await act(async () => { tree.scrollTop = 800; fireEvent.scroll(tree); });
  view.rerender(<TreeView {...props} expanded={new Set(["folder"])} />);
  expect(tree.scrollTop).toBe(800);
  view.rerender(<TreeView {...props} expanded={new Set()} />);
  expect(tree.scrollTop).toBe(800);
});

it.each(["list", "grouped", "list-grid", "feed", "table", "grid", "tree", "repeat"] as Kind[])("%s에서 새로 읽기, 이어 붙이기, 일부 삭제와 앞 삽입은 위치를 지킨다", async (kind) => {
  const { rows, scroller, update, scroll, store } = await setup(kind);
  await scroll();
  for (const next of [rows.map((row) => ({ ...row, title: `${row.title}!` })), [...rows, ...items("다음", 10)], rows.filter((_, i) => i !== 21), [...items("앞", 2), ...rows]]) {
    await update(next);
    expect(scroller.scrollTop).toBe(800);
  }
  store.dispose();
});

it.each(["list", "grouped"] as Kind[])("%s에서 보이던 항목 하나만 남아도 위치를 지킨다", async (kind) => {
  const { rows, scroller, update, scroll, store } = await setup(kind);
  await scroll();
  await update([rows[25], ...items("새 목록")]);
  expect(scroller.scrollTop).toBe(800);
  store.dispose();
});

function OuterViewport({ prefix }: { prefix: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ element: HTMLDivElement; margin: number } | null>(null);
  useLayoutEffect(() => { setViewport({ element: outer.current!, margin: 200 }); }, []);
  const keys = useMemo(() => items(prefix).map((row) => [row.key]), [prefix]);
  const { virtual } = useVirtualRows(keys.length, 40, inner, false, undefined, viewport, keys);
  return <div className="ks-data-view" ref={outer} data-testid="outer"><div ref={inner}>
    {virtual.getVirtualItems().map((row) => <div key={row.key} data-index={row.index} ref={virtual.measureElement}>{keys[row.index][0]}</div>)}
  </div></div>;
}

it("반복의 바깥 viewport를 쓸 때 실제 바깥 스크롤도 맨 위로 간다", async () => {
  const view = render(<OuterViewport prefix="이전" />);
  const outer = screen.getByTestId("outer");
  await act(async () => { outer.scrollTop = 800; fireEvent.scroll(outer); });
  view.rerender(<OuterViewport prefix="새 목록" />);
  await waitFor(() => expect(outer.scrollTop).toBe(0));
});
