import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import boardJson from "../../../examples/card-board.json";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import * as windowData from "../data/window-data";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed } from "./fixtures";
import { TableBlock } from "../blocks/data-table";

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("탭의 쉬는 포인터를 붙일 때 보내고 전환마다 한 번 갱신한다", async () => {
  const definition: AppDefinition = {
    id: "dormant-tabs", name: "탭 시험", requires: { blocks: 4, modules: {} }, permissions: [], state: {},
    ui: { type: "tabs", tabs: [
      { label: "첫째", child: { type: "text", value: "첫째 내용" } },
      { label: "둘째", child: { type: "text", value: "둘째 내용" } },
      { label: "셋째", child: { type: "text", value: "셋째 내용" } },
    ] },
  };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  let releaseAttach!: () => void;
  const attached = new Promise<void>((resolve) => { releaseAttach = resolve; });
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    const reply = await original(request);
    if (request.op === "data.attach") await attached;
    return reply;
  });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(transport.getCalls().find((call) => call.op === "data.attach")).toEqual({
    op: "data.attach", window_id: "viewer-window", dormant: ["/ui/tabs/1", "/ui/tabs/2"],
  }));

  await userEvent.click(screen.getByRole("tab", { name: "둘째" }));
  expect(transport.getCalls().filter((call) => call.op === "data.dormant")).toHaveLength(0);
  await act(async () => releaseAttach());
  await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.dormant")).toEqual([
    { op: "data.dormant", window_id: "viewer-window", dormant: ["/ui/tabs/2", "/ui/tabs/0"] },
  ]));

  await userEvent.click(screen.getByRole("tab", { name: "첫째" }));
  await waitFor(() => expect(transport.getCalls().filter((call) => call.op === "data.dormant")).toEqual([
    { op: "data.dormant", window_id: "viewer-window", dormant: ["/ui/tabs/2", "/ui/tabs/0"] },
    { op: "data.dormant", window_id: "viewer-window", dormant: ["/ui/tabs/2", "/ui/tabs/1"] },
  ]));
  expect(screen.getByText("첫째 내용")).toBeTruthy();
  store.dispose();
});

it("크기 제한을 넘은 출력만 거부하고 다른 출력은 반영한다", () => {
  const definition: AppDefinition = {
    id: "client-output-limit", name: "출력 시험", requires: { blocks: 12, modules: { assets: 1, client: 1 } }, permissions: [], state: {},
    assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: { large: { default: "이전" }, small: { default: 0 } }, actions: [], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "text", value: { client: "small" } },
  };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const data = new windowData.WindowData(store, "viewer-window", definition);
  data.publishClient({ large: "가".repeat(400_000), small: 1 });
  expect(data.getValue("@client/large")).toEqual({ status: "ready", value: "이전" });
  expect(data.getValue("@client/small")).toEqual({ status: "ready", value: 1 });
  expect(data.getNotice()).toContain("large");
  store.dispose();
});

it("클라이언트가 발행한 행과 선택은 코어 동작 없이 표에 반영된다", async () => {
  const definition: AppDefinition = {
    id: "client-table", name: "표 시험", requires: { blocks: 12, modules: { assets: 1, client: 1 } }, permissions: [], state: {},
    assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: { rows: { default: [] }, selected: { default: null } }, actions: [], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "table", rows: { client: "rows" }, columns: [{ field: "title", label: "이름" }], selected: { client: "selected" } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  const appWindow = seed.snapshot.shared.windows[0];
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const context = { store, snapshot: seed.snapshot, window: appWindow, definition };
  function Harness() {
    const data = windowData.useWindowData();
    return <><button onClick={() => data.publishClient({ rows: [{ key: "a", title: "계산된 행" }], selected: "a" })}>계산</button>
      <TableBlock block={definition.ui as Extract<AppDefinition["ui"], { type: "table" }>} context={context} pointer="/ui" /></>;
  }
  render(<windowData.WindowDataProvider store={store} windowId={appWindow.id} definition={definition}><Harness /></windowData.WindowDataProvider>);
  await userEvent.click(screen.getByRole("button", { name: "계산" }));
  expect(await screen.findByText("계산된 행")).toBeTruthy();
  expect(transport.getCalls().filter((call) => call.op === "data.act" || call.op === "window.set_state")).toHaveLength(0);
});

it("창 클라이언트 프레임의 발행은 표로만 전달된다", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000010");
  const definition: AppDefinition = {
    id: "client-frame", name: "프레임 시험", requires: { blocks: 12, modules: { assets: 1, client: 1 } }, permissions: [], state: {},
    assets: [{ id: "script", version: 1 }],
    client: { runtime: "javascript", entry: { id: "script", version: 1 }, inputs: {}, outputs: { rows: { default: [] } }, actions: [], commands: {}, state_keys: [], storage_entries: [] },
    ui: { type: "table", rows: { client: "rows" }, columns: [{ field: "title", label: "이름" }] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const call = store.call.bind(store);
  vi.spyOn(store, "call").mockImplementation(async (request) => request.op === "data.media"
    ? { op: "data.media", media: { mime: "text/javascript", data_base64: btoa("window.loaded = true"), width: null, height: null } } as never
    : call(request));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(document.querySelector(".ks-client-frames iframe")).toBeTruthy());
  const frame = document.querySelector(".ks-client-frames iframe") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("allow")).toBe("autoplay");
  act(() => window.dispatchEvent(new MessageEvent("message", { origin: "null", source: frame.contentWindow, data: { token: "00000000-0000-4000-8000-000000000010", type: "ks-client-publish", patch: { rows: [{ key: "a", title: "프레임 결과" }] } } })));
  expect(await screen.findByText("프레임 결과")).toBeTruthy();
  expect(transport.getCalls().filter((request) => request.op === "data.act" || request.op === "window.set_state")).toHaveLength(0);
});

it("uses the contract's card-board pointers for supported bindings and actions", async () => {
  const definition = boardJson as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport({ ...seed, data: { sources: { cards: { value: { cards: [{ id: "a", title: "항목 A", number: 1, status: "running", updatedAt: "2026-10-29" }, { id: "b", title: "항목 B", number: 2, status: "running", updatedAt: "2026-10-28" }] } } } } });
  const calls = vi.spyOn(transport, "call");
  const subscriptions = vi.spyOn(windowData, "useBinding");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const input = await screen.findByPlaceholderText("카드 찾기");
  await waitFor(() => expect(subscriptions.mock.calls.map(([pointer]) => pointer)).toEqual(expect.arrayContaining([
    "/ui/children/1/children/0/start/0/value",
    "/ui/children/1/children/0/end/0/confirm/body",
    "/ui/children/1/children/0/end/0/disabled",
  ])));
  const pointers = subscriptions.mock.calls.map(([pointer]) => pointer);
  expect(pointers).toEqual(expect.arrayContaining(["/ui/children/0/children/1/items", ...[0, 1, 2, 3].map((i) => `/ui/children/1/children/1/fields/${i}/value`)]));
  const expressionPointers = [...new Set(subscriptions.mock.calls.flatMap(([pointer, binding]) =>
    binding !== null && typeof binding === "object" && !Array.isArray(binding) && "expr" in binding ? [pointer] : []))].sort();
  expect(expressionPointers).toEqual([
    "/ui/children/1/children/0/end/0/confirm/body",
    "/ui/children/1/children/0/end/0/disabled",
    "/ui/children/1/children/0/start/0/value",
    "/ui/children/0/children/1/items",
    ...[0, 1, 2, 3].map((i) => `/ui/children/1/children/1/fields/${i}/value`),
  ].sort());
  expect(screen.queryByText(/지원하지 않는 블록/)).toBeNull();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("option", { name: "항목 A" }));
  await user.type(input, "찾기");
  await user.click(screen.getByRole("button", { name: "전체" }));
  await user.click(screen.getByRole("menuitem", { name: "진행" }));
  await user.click(screen.getByRole("button", { name: "다시 받기" }));
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/children/1/children/0/end/0/disabled": { status: "ready", value: false } } } }));
  await user.click(screen.getByRole("button", { name: "완료로" }));
  await user.click(screen.getByRole("dialog").querySelectorAll("button")[1]);
  await waitFor(() => {
    const paths = calls.mock.calls.flatMap(([request]) => request.op === "data.act" ? [request.pointer] : []);
    expect([...new Set(paths)].sort()).toEqual([
      "/ui/children/0/children/0/start/0/on_change",
      "/ui/children/0/children/0/end/0/on_change",
      "/ui/children/0/children/0/end/1/on_click",
      "/ui/children/1/children/0/end/0/on_click",
      "/ui/children/0/children/1/on_select",
    ].sort());
    expect(paths).toContain("/ui/children/0/children/1/on_select");
  });
});

it("only rerenders the subscriber of the changed data pointer", async () => {
  const definition: AppDefinition = {
    ...boardJson as AppDefinition,
    sources: {}, state: { a: "처음 A", b: "처음 B" },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$state.a" } },
      { type: "text", value: { expr: "$state.b" } },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  const window = seed.snapshot.shared.windows[0];
  window.state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const renders = { a: 0, b: 0 };
  function Value({ name }: { name: "a" | "b" }) {
    renders[name] += 1;
    const value = windowData.useBinding(`/ui/${name}`, { expr: `$state.${name}` });
    return <span>{value.status === "ready" ? String(value.value) : "대기"}</span>;
  }
  render(<windowData.WindowDataProvider store={store} windowId={window.id} definition={definition}><Value name="a" /><Value name="b" /></windowData.WindowDataProvider>);
  await waitFor(() => expect(renders.a).toBeGreaterThan(0));
  const before = { ...renders };
  act(() => transport.emit({ event: "data.update", window_id: window.id, view: { sources: {}, values: { "/ui/a": { status: "ready", value: "바뀐 A" } } } }));
  expect(await screen.findByText("바뀐 A")).toBeTruthy();
  expect(renders.a).toBeGreaterThan(before.a);
  expect(renders.b).toBe(before.b);
});
