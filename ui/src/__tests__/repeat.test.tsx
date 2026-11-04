import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { ItemScopeProvider } from "../data/item-scope";
import { useOptionalWindowData, WindowDataProvider } from "../data/window-data";
import { makeTestSeed } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(["column", "row"] as const)("가상 %s에서 앞 항목을 지워도 남은 항목을 다시 마운트하지 않는다", async (layout) => {
  const rows = [{ id: "a", title: "첫째" }, { id: "b", title: "둘째" }, { id: "c", title: "셋째" }];
  const definition: AppDefinition = { id: `virtual-${layout}`, name: "가상 반복", requires: { blocks: 14, modules: {} },
    permissions: [], state: { rows }, ui: { type: "repeat", items: { state: "rows" }, key: "id", layout, virtual: true,
      template: { type: "text", value: { item: "title" } } } };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const store = createShellStore(createFakeTransport(seed));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  const second = await screen.findByText("둘째");
  const third = await screen.findByText("셋째");
  await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { rows: rows.slice(1) } }); });
  await waitFor(() => expect(screen.queryByText("첫째")).toBeNull());
  expect(screen.getByText("둘째")).toBe(second);
  expect(screen.getByText("셋째")).toBe(third);
  store.dispose();
});

it("자동 격자는 item_width 단계로 열 수를 정하고 창 폭이 바뀌면 다시 계산한다", async () => {
  let width = 327.5;
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    entry: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: new Set() }; observers.push(this.entry); }
    observe(target: Element) { this.entry.targets.add(target); }
    disconnect() { this.entry.targets.clear(); }
    unobserve(target: Element) { this.entry.targets.delete(target); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const widths = ["small", "medium", "large"] as const;
  const definition: AppDefinition = {
    id: "repeat-grid-widths", name: "격자 칸 폭", requires: { blocks: 20, modules: {} }, permissions: [], state: { rows },
    ui: { type: "stack", direction: "column", children: widths.map((item_width) => ({
      type: "repeat" as const, key: "id", items: { state: "rows" }, layout: "grid" as const,
      grid: { columns: "auto" as const, item_width }, template: { type: "text" as const, value: { item: "id" } },
    })) },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const store = createShellStore(createFakeTransport(seed));
  const view = render(<AppWindowContent store={store} windowId="viewer-window" />);
  const grids = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ks-repeat.is-grid")];
    expect(found).toHaveLength(3);
    return found;
  });
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("ks-repeat-grid-width-probe")) return originalRect.call(this);
    const parent = this.parentElement!;
    const widthVariable = this.style.width.match(/var\((--[^)]+)\)/)?.[1];
    const gapValue = this.style.marginInlineEnd;
    const gapVariable = gapValue.match(/var\((--[^)]+)\)/)?.[1];
    const width = Number.parseFloat(parent.style.getPropertyValue(widthVariable ?? ""));
    const gap = Number.parseFloat(gapVariable ? parent.style.getPropertyValue(gapVariable) : gapValue);
    if (Number.isFinite(gap)) this.style.marginInlineEnd = `${gap}px`;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON() {} } as DOMRect;
  });
  grids.forEach((grid) => {
    grid.style.setProperty("--ks-repeat-grid-item-width-small", "128px");
    grid.style.setProperty("--ks-repeat-grid-item-width-medium", "160px");
    grid.style.setProperty("--ks-repeat-grid-item-width-large", "240px");
    grid.style.setProperty("--ks-space-3", "12px");
    grid.style.padding = "0px";
  });
  const resize = async (next: number) => {
    width = next;
    await act(async () => {
      observers.filter(({ targets }) => [...targets].some((target) => grids.includes(target as HTMLElement)))
        .forEach(({ callback }) => callback([], {} as ResizeObserver));
    });
  };
  const columns = (grid: HTMLElement) => grid.querySelector<HTMLElement>(".ks-repeat-content")?.style.gridTemplateColumns;
  await resize(327.5);
  expect(grids.map(columns)).toEqual(Array(3).fill("repeat(2, minmax(0, 1fr))").map((value, index) => index === 0 ? value : "repeat(1, minmax(0, 1fr))"));
  await resize(900);
  expect(grids.map(columns)).toEqual([
    "repeat(6, minmax(0, 1fr))",
    "repeat(5, minmax(0, 1fr))",
    "repeat(3, minmax(0, 1fr))",
  ]);
  view.unmount();
  store.dispose();
  vi.unstubAllGlobals();
});

it("item을 포함한 여러 필드의 리터럴은 그대로 표시한다", async () => {
  const definition: AppDefinition = { id: "literal-item", name: "리터럴", requires: { blocks: 14, modules: {} },
    permissions: [], state: {}, ui: { type: "text", value: { item: "원래 값", label: "그대로" } } };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect(await screen.findByText((_, element) => Boolean(element?.classList.contains("ks-data-text") && element.textContent?.includes("원래 값") && element.textContent.includes("그대로")))).toBeTruthy();
  store.dispose();
});

it("선택적 창 데이터 훅의 동작도 반복 항목을 사용한다", async () => {
  const definition: AppDefinition = { id: "optional-scope", name: "항목 범위", requires: { blocks: 14, modules: {} },
    permissions: [], state: {}, ui: { type: "text", value: "내용" } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const scope = { item: { id: "row" }, key: "row", index: 0, instance: {} };
  function OptionalAction() {
    const data = useOptionalWindowData();
    return <button onClick={() => void data?.act("/ui/on_select", "선택", { id: "child" })}>선택</button>;
  }
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={definition}>
    <ItemScopeProvider value={scope}><OptionalAction /></ItemScopeProvider>
  </WindowDataProvider>);
  await userEvent.click(screen.getByRole("button", { name: "선택" }));
  await waitFor(() => expect(transport.getCalls()).toContainEqual(expect.objectContaining({
    op: "data.act", pointer: "/ui/on_select", item: { id: "row" },
  })));
  store.dispose();
});

it("반복 항목의 값과 중첩 항목의 부모를 표시하고 템플릿 포인터로 동작을 보낸다", async () => {
  const definition: AppDefinition = {
    id: "repeat-test", name: "반복 시험", requires: { blocks: 14, modules: {} }, permissions: [],
    state: { rows: [{ id: "one", name: "첫 항목", children: [{ id: "child", name: "안쪽" }] }] },
    ui: { type: "repeat", items: { state: "rows" }, key: "id", virtual: false, template: {
      type: "stack", direction: "column", children: [
        { type: "input", value: { item: "name" }, on_change: [{ set_state: "rows", value: { expr: "$item" } }] },
        { type: "repeat", items: { item: "children" }, key: "id", virtual: false, template: {
          type: "stack", direction: "row", children: [
            { type: "text", value: { parent_item: "name" } },
            { type: "button", label: { item: "name" }, on_click: [{ set_state: "rows", value: { expr: "$item" } }] },
          ],
        } },
      ],
    } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect(await screen.findByDisplayValue("첫 항목")).toBeTruthy();
  expect(screen.getByText("첫 항목")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "안쪽" }));
  await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.act")).toEqual([
    expect.objectContaining({ pointer: "/ui/template/children/1/template/children/1/on_click", item: { id: "child", name: "안쪽" } }),
  ]));
  const input = screen.getByDisplayValue("첫 항목");
  fireEvent.change(input, { target: { value: "고친 항목" } });
  fireEvent.blur(input);
  await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.act")).toContainEqual(expect.objectContaining({
    pointer: "/ui/template/children/0/on_change", event: "고친 항목", item: { id: "one", name: "첫 항목", children: [{ id: "child", name: "안쪽" }] },
  })));
  store.dispose();
});

it("중첩 단추의 클라이언트 동작에 항목과 부모, 키, 순서와 수정 키를 전달한다", async () => {
  const definition: AppDefinition = {
    id: "repeat-client", name: "반복 동작 시험", requires: { blocks: 14, modules: { client: 1, assets: 1 } }, permissions: [],
    state: { rows: [{ id: "parent", children: [{ id: "inner", name: "고르기" }] }] },
    assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: ["choose"], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "repeat", items: { state: "rows" }, key: "id", template: {
      type: "repeat", items: { item: "children" }, key: "id", template: { type: "button", label: { item: "name" }, on_click: { client: "choose" } },
    } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
    : call(request));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  const frame = document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.click(await screen.findByRole("button", { name: "고르기" }), { shiftKey: true });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-action", name: "choose", context: {
    event: null, item: { id: "inner", name: "고르기" }, parent_item: { id: "parent", children: [{ id: "inner", name: "고르기" }] }, key: "inner", index: 0, modifiers: { shift: true, alt: false, ctrl: false, meta: false },
  } }), "*");
  store.dispose();
});

it("앞 항목을 제거한 뒤 남은 항목의 동작은 바뀐 순서를 받는다", async () => {
  const rows = [{ id: "first", name: "첫째" }, { id: "second", name: "둘째" }];
  const definition: AppDefinition = {
    id: "repeat-index", name: "순서 시험", requires: { blocks: 14, modules: { client: 1, assets: 1 } }, permissions: [], state: { rows },
    assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: {}, actions: ["choose"], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "repeat", items: { state: "rows" }, key: "id", template: { type: "button", label: { item: "name" }, on_click: { client: "choose" } } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const store = createShellStore(createFakeTransport(seed));
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa(""), width: null, height: null } } as CoreReply
    : call(request));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  const post = vi.spyOn((document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement).contentWindow!, "postMessage");
  await act(async () => { await store.call({ op: "window.set_state", window_id: "viewer-window", state: { rows: rows.slice(1) } }); });
  await userEvent.click(await screen.findByRole("button", { name: "둘째" }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-action", context: expect.objectContaining({ item: rows[1], key: "second", index: 0 }) }), "*");
  store.dispose();
});

it("같은 템플릿의 모든 행에서 탭을 닫을 때만 포인터가 쉰다", async () => {
  const definition: AppDefinition = {
    id: "repeat-dormant", name: "반복 휴면 시험", requires: { blocks: 14, modules: {} }, permissions: [],
    state: { rows: [{ id: "a" }, { id: "b" }] },
    ui: { type: "repeat", items: { state: "rows" }, key: "id", template: { type: "tabs", tabs: [
      { label: "일반", child: { type: "text", value: "일반 내용" } },
      { label: "상세", child: { type: "text", value: { expr: "$data.detail" } } },
    ] } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  const tabs = await screen.findAllByRole("tab", { name: "상세" });
  const latest = () => transport.getCalls().filter((call) => call.op === "data.dormant").at(-1);
  await userEvent.click(tabs[0]);
  await waitFor(() => expect(latest()).toEqual(expect.objectContaining({ dormant: expect.not.arrayContaining(["/ui/template/tabs/1"]) })));
  await userEvent.click(tabs[1]);
  await userEvent.click(screen.getAllByRole("tab", { name: "일반" })[0]);
  await waitFor(() => expect(latest()).toEqual(expect.objectContaining({ dormant: expect.not.arrayContaining(["/ui/template/tabs/1"]) })));
  await userEvent.click(screen.getAllByRole("tab", { name: "일반" })[1]);
  await waitFor(() => expect(latest()).toEqual(expect.objectContaining({ dormant: expect.arrayContaining(["/ui/template/tabs/1"]) })));
  store.dispose();
});

it("사용자 스크롤 후 2500ms 동안 따라가기를 멈추고 마지막 항목을 따라간다", async () => {
  const definition: AppDefinition = {
    id: "repeat-follow", name: "따라가기 시험", requires: { blocks: 14, modules: {} }, permissions: [],
    state: { rows: [{ id: "a", name: "하나" }, { id: "b", name: "둘" }], active: null },
    ui: { type: "repeat", items: { state: "rows" }, key: "id", follow_key: { state: "active" }, follow_pause_ms: 2500,
      template: { type: "text", value: { item: "name" } } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = definition.state;
  const store = createShellStore(createFakeTransport(seed));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await screen.findByText("둘");
  const scroller = document.querySelector<HTMLElement>(".ks-repeat")!;
  Object.defineProperties(scroller, { clientHeight: { value: 50 }, scrollHeight: { value: 100 }, scrollTop: { get: () => 0, set: vi.fn(), configurable: true } });
  scroller.style.overflowY = "auto";
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 50 } as DOMRect);
  for (const row of scroller.querySelectorAll<HTMLElement>(".ks-repeat-item")) vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 80, bottom: 100 } as DOMRect);
  const scrollTop = Object.getOwnPropertyDescriptor(scroller, "scrollTop")!.set!;
  vi.useFakeTimers();
  const window = store.getSnapshot()!.shared.windows[0];
  await act(async () => { await store.call({ op: "window.set_state", window_id: window.id, state: { ...window.state, active: "a" } }); });
  expect(scrollTop).toHaveBeenCalledTimes(1);
  fireEvent.wheel(document.querySelector(".ks-repeat")!, { deltaY: 100 });
  await act(async () => { await store.call({ op: "window.set_state", window_id: window.id, state: { ...window.state, active: "b" } }); });
  expect(scrollTop).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(2499));
  expect(scrollTop).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(1));
  expect(scrollTop).toHaveBeenCalledTimes(2);
  store.dispose();
});

it("repeat은 명시한 gap을 항목 간격으로 표시한다", async () => {
  const definition: AppDefinition = { id: "repeat-gap", name: "간격", requires: { blocks: 26, modules: {} }, permissions: [], state: {},
    ui: { type: "repeat", items: [{ id: "a" }, { id: "b" }], key: "id", gap: "large", template: { type: "text", value: { item: "id" } } } as AppDefinition["ui"] };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const view = render(<AppWindowContent store={store} windowId="viewer-window" />);
  await screen.findByText("a");
  expect(view.container.querySelector(".ks-repeat")?.classList.contains("gap-large")).toBe(true);
  store.dispose();
});
