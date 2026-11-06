import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { BlockContext } from "../blocks/block-context";
import { StackBlock } from "../blocks/data-layout";
import { SplitPanes } from "../blocks/split";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { describeVisible } from "../share/visible";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";
import blockGallery from "../../../examples/block-gallery.json";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("stack의 값이 바뀔 때만 가장 가까운 세로 스크롤을 처음으로 돌린다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, state: { page: "a" }, ui: {
    type: "stack", direction: "column", scroll_reset: { state: "page" }, children: [{ type: "text", value: "내용" }],
  } as unknown as Block };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { page: "a" };
  const transport = createFakeTransport(seed);
  const host = document.createElement("div");
  host.style.overflowY = "auto"; host.scrollTop = 80;
  document.body.append(host);
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />, { container: host });
  await screen.findByText("내용");
  expect(host.scrollTop).toBe(80);
  await act(async () => { await transport.call({ op: "window.patch_state", window_id: "editor-window", patch: { page: "b" } }); });
  await waitFor(() => expect(host.scrollTop).toBe(0));
  view.unmount(); host.remove();
});

it("가짜 코어가 when 안의 식과 입력 동작을 처리한다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, state: { query: "처음" }, ui: {
    type: "when", value: true, child: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$state.query" } },
      { type: "input", value: { state: "query" }, on_change: { set_state: "query" } },
    ] },
  } };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { query: "처음" };
  const transport = createFakeTransport(seed);
  const attached = await transport.call({ op: "data.attach", window_id: "editor-window", dormant: [] });
  expect(attached.op).toBe("data.attach");
  if (attached.op !== "data.attach") throw new Error("데이터 연결 응답이 아닙니다");
  expect(attached.view.values["/ui/child/children/0/value"]).toEqual({ status: "ready", value: "처음" });
  await transport.call({ op: "data.act", window_id: "editor-window", pointer: "/ui/child/children/1/on_change", event: "변경" });
  const state = await transport.call({ op: "state.get" });
  expect(state.op).toBe("state.get");
  if (state.op !== "state.get") throw new Error("상태 조회 응답이 아닙니다");
  expect(state.snapshot.shared.windows[0].state.query).toBe("변경");
});

it("도구 막대 텍스트 항목은 줄어들 수 있는 항목으로 표시한다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, ui: { type: "toolbar", start: [
    { type: "text", style: "title", value: "긴 제목" },
    { type: "button", label: "실행", on_click: { set_state: "value" } },
  ] } };
  render(<AppWindowContent store={createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })))} windowId="editor-window" />);
  const title = await screen.findByText("긴 제목");
  expect(title.closest(".ks-data-toolbar-item")?.classList.contains("is-text")).toBe(true);
  expect(screen.getByRole("button", { name: "실행" }).closest(".ks-data-toolbar-item")?.classList.contains("is-text")).toBe(false);
});

it.each(["row", "column"] as const)("%s 분할은 구분선 폭을 격자 트랙에 둔다", (direction) => {
  const view = render(<SplitPanes direction={direction} children={[<span key="a">하나</span>, <span key="b">둘</span>]} />);
  const split = view.container.querySelector(".ks-split") as HTMLElement;
  const template = direction === "row" ? split.style.gridTemplateColumns : split.style.gridTemplateRows;
  expect(template).toContain("var(--ks-line-width)");
});

it("stack.align maps cross-axis alignment and center placement keeps precedence", () => {
  for (const align of ["start", "center", "end", "baseline"] as const) {
    const { container, unmount } = render(<StackBlock
      block={{ type: "stack", direction: "row", children: [], align }}
      context={{} as BlockContext}
      pointer="/ui"
    />);
    expect(container.firstElementChild?.classList.contains(`align-${align}`)).toBe(true);
    unmount();
  }

  const { container } = render(<StackBlock
    block={{ type: "stack", direction: "row", children: [], place: "center", align: "baseline" }}
    context={{} as BlockContext}
    pointer="/ui"
  />);
  expect(container.firstElementChild?.classList.contains("is-center")).toBe(true);
  expect(container.firstElementChild?.classList.contains("align-baseline")).toBe(false);
});

it("distinguishes an explicit stack fill from the default last child", () => {
  const defaultFill = render(<StackBlock
    block={{ type: "stack", direction: "row", children: [] }}
    context={{} as BlockContext}
    pointer="/ui"
  />);
  expect(defaultFill.container.firstElementChild?.classList.contains("has-explicit-fill")).toBe(false);
  defaultFill.unmount();

  const explicitFill = render(<StackBlock
    block={{ type: "stack", direction: "row", fill: 0, children: [] }}
    context={{} as BlockContext}
    pointer="/ui"
  />);
  expect(explicitFill.container.firstElementChild?.classList.contains("has-explicit-fill")).toBe(true);
});

const fillText: Block = { type: "text", value: "설명" };
const fillList: Block = { type: "list", items: [] };
const fillButton: Block = { type: "button", label: "확인", on_click: { set_state: "value" } };
const fillInput: Block = { type: "input", value: { state: "value" }, on_change: { set_state: "value" } };
const fillToolbar: Block = { type: "toolbar", start: [] };

it.each([
  ["세로 마지막 단추", { type: "stack", direction: "column", children: [fillText, fillList, fillButton, fillButton] }, [], false],
  ["세로 마지막 목록", { type: "stack", direction: "column", children: [fillToolbar, fillList] }, [1], false],
  ["세로 여러 줄 입력", { type: "stack", direction: "column", children: [fillText, { ...fillInput, multiline: true }] }, [1], false],
  ["세로 rows 여러 줄 입력", { type: "stack", direction: "column", children: [fillText, { ...fillInput, rows: 4 }] }, [1], false],
  ["세로 한 줄 입력", { type: "stack", direction: "column", children: [fillText, fillInput] }, [], false],
  ["가로 한 줄 입력", { type: "stack", direction: "row", children: [fillText, fillInput] }, [1], false],
  ["가로 마지막 단추", { type: "stack", direction: "row", children: [fillText, fillButton] }, [], false],
  ["가로 단추 두 개", { type: "stack", direction: "row", children: [fillButton, fillButton] }, [], false],
  ["가로 조건 단추", { type: "stack", direction: "row", children: [fillText, { type: "when", value: true, child: fillButton }] }, [], false],
  ["가로 고르기", { type: "stack", direction: "row", children: [fillText, { type: "select", value: { state: "value" }, on_change: { set_state: "value" }, options: ["a"] }] }, [1], false],
  ["명시한 목록", { type: "stack", direction: "column", fill: 0, children: [fillList, fillButton] }, [0], true],
  ["명시한 단추", { type: "stack", direction: "column", fill: 1, children: [fillList, fillButton] }, [1], true],
  ["명시한 인접 폭 조건", { type: "stack", direction: "column", fill: 0, children: [{ type: "when", min_width: 1200, child: fillList }, { type: "when", max_width: 1199, child: fillList }] }, [0, 1], true],
  ["명시한 폭 조건 사이 다른 블록", { type: "stack", direction: "column", fill: 1, children: [fillToolbar, { type: "when", min_width: 1200, child: fillList }, fillText, { type: "when", max_width: 1199, child: fillList }] }, [1], true],
  ["암묵 폭 조건 채움", { type: "stack", direction: "column", children: [fillToolbar, { type: "when", min_width: 1200, child: fillList }, { type: "when", max_width: 1199, child: fillList }] }, [2], false],
  ["폭 조건 없는 명시 채움", { type: "stack", direction: "column", fill: 0, children: [{ type: "when", value: true, child: fillList }, { type: "when", value: true, child: fillText }, { type: "when", value: true, child: fillButton }] }, [0], true],
  ["폭 조건 없는 이웃", { type: "stack", direction: "column", fill: 0, children: [{ type: "when", min_width: 1200, child: fillList }, { type: "when", value: true, child: fillText }] }, [0], true],
  ["명시한 폭 조건 양옆", { type: "stack", direction: "column", fill: 1, children: [{ type: "when", max_width: 500, child: fillList }, { type: "when", min_width: 501, child: fillList }, { type: "when", min_width: 1200, child: fillList }] }, [0, 1, 2], true],
  ["가운데 배치의 명시 fill", { type: "stack", direction: "column", place: "center", fill: 1, children: [fillList, fillButton] }, [], false],
  ["가로 단추 줄", { type: "stack", direction: "column", children: [fillText, fillList, { type: "stack", direction: "row", children: [fillButton, fillButton] }] }, [], false],
  ["조건 단추", { type: "stack", direction: "column", children: [fillText, fillList, { type: "when", value: true, child: fillButton }] }, [], false],
  ["앵커 단추", { type: "stack", direction: "column", children: [fillText, fillList, { type: "anchor", id: "confirm", child: fillButton }] }, [], false],
  ["가로 입력과 단추", { type: "stack", direction: "column", children: [fillToolbar, { type: "stack", direction: "row", children: [fillInput, fillButton] }] }, [], false],
  ["조건 목록", { type: "stack", direction: "column", children: [fillToolbar, { type: "when", value: true, child: fillList }] }, [1], false],
  ["가로 단추와 목록", { type: "stack", direction: "column", children: [fillText, { type: "stack", direction: "row", children: [fillButton, fillList] }] }, [1], false],
  ...([
    { type: "select", value: { state: "value" }, on_change: { set_state: "value" }, options: ["a"] },
    { type: "toggle", value: { state: "value" }, on_change: { set_state: "value" }, label: "켜기" },
    { type: "slider", value: { state: "value" }, on_change: { set_state: "value" }, label: "크기", min: 0, max: 100 },
    { type: "color", value: { state: "value" }, on_change: { set_state: "value" }, label: "색" },
    fillToolbar,
  ] as Block[]).map((control) => [control.type, { type: "stack", direction: "column", children: [fillText, control] }, [], false]),
] as Array<[string, Block, number[], boolean]>)("stack fill: %s", async (_name, stack, expected, explicit) => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const definition: AppDefinition = { ...mdEditorDefinition, state: { value: "" }, ui: stack };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  await waitFor(() => expect(view.container.querySelector(".ks-data-stack")).not.toBeNull());
  const element = view.container.querySelector(".ks-data-stack")!;
  const content = element.querySelector(":scope > .ks-stack-scroll > .ks-stack-scroll-content") ?? element;
  expect(Array.from(content.children).flatMap((child, index) => child.classList.contains("is-fill") ? [index] : [])).toEqual(expected);
  expect(element.classList.contains("has-explicit-fill")).toBe(explicit);
  if (_name === "가로 입력과 단추") {
    const row = element.querySelector(".ks-data-stack.is-row")!;
    expect(Array.from(row.children).map((child) => child.classList.contains("is-fill"))).toEqual([false, false]);
  }
});

function setup(rows?: number) {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} },
    state: { query: "", choice: "a", enabled: false },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$state.query" } },
      { type: "input", value: { state: "query" }, on_change: { set_state: "query" }, on_submit: { set_state: "query" }, placeholder: "입력", ...(rows ? { rows } : {}) },
      { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["a", "b"], style: "segmented" },
      { type: "toggle", value: { state: "enabled" }, on_change: { set_state: "enabled" }, label: "켜기" },
      { type: "button", label: "확인", on_click: [{ call: { permission: "remote", method: "GET", path: "/" } }], confirm: { title: "진행할까요?" } },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { transport, spy, store, originalCall };
}

it("여러 줄 입력은 지정한 줄 수로 표시하고 변경을 전달한다", async () => {
  const { spy } = setup(4);
  const input = await screen.findByPlaceholderText("입력");
  expect(input.tagName).toBe("TEXTAREA");
  expect(input.getAttribute("rows")).toBe("4");
  fireEvent.change(input, { target: { value: "첫 줄\n둘째 줄" } });
  fireEvent.blur(input);
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/1/on_change", event: "첫 줄\n둘째 줄" }));
});

it("범위와 색상 입력은 각각의 동작에 선택한 값을 전달한다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 11, modules: {} },
    state: { amount: 30, color: "#123456" },
    ui: { type: "toolbar", start: [
      { type: "slider", value: { state: "amount" }, on_change: { set_state: "amount" }, label: "강도", min: 0, max: 100, step: 5 },
      { type: "color", value: { state: "color" }, on_change: { set_state: "color" }, label: "색상" },
    ] } as unknown as Block,
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  fireEvent.change(await screen.findByRole("slider", { name: "강도" }), { target: { value: "45" } });
  fireEvent.change(screen.getByLabelText("색상"), { target: { value: "#abcdef" } });
  await waitFor(() => {
    expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/start/0/on_change", event: 45 });
    expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/start/1/on_change", event: "#abcdef" });
    expect(store.getSnapshot()?.shared.windows[0].state).toMatchObject({ amount: 45, color: "#abcdef" });
  });
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  const text = describeVisible(screen.getByRole("slider", { name: "강도" }).closest(".ks-data-toolbar") as HTMLElement).text;
  expect(text.match(/강도/g)).toHaveLength(1);
  expect(text.match(/색상/g)).toHaveLength(1);
  expect(text).toContain("강도: 45");
  expect(text).toContain("색상: #abcdef");
});

it("attaches data and routes input, selection and toggle through their JSON pointers", async () => {
  const { spy } = setup();
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText("입력");
  await user.type(input, "가");
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/1/on_change", event: "가" }));
  await user.click(screen.getByRole("button", { name: "b" }));
  await user.click(screen.getByRole("switch", { name: "켜기" }));
  expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/2/on_change", event: "b" });
  expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/3/on_change", event: true });
});

it("confirms before acting and escape cancels", async () => {
  const { spy } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "확인" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(spy.mock.calls.some(([request]) => request.op === "data.act")).toBe(false);
  await user.click(screen.getByRole("button", { name: "확인" }));
  await user.click(screen.getByRole("dialog").querySelectorAll("button")[1]);
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/4/on_click", event: null, modifiers: { shift: false, alt: false, ctrl: false, meta: false } }));
});

it("위험 단추의 확인 대화상자는 취소에 먼저 초점을 둔다", async () => {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: { choice: null }, ui: { type: "button", label: "지우기", variant: "danger", on_click: { set_state: "choice" }, confirm: { title: "지울까요?" } } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  fireEvent.click(await screen.findByRole("button", { name: "지우기" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
});

it("applies a data update only to the named window and pointer", async () => {
  const { transport } = setup();
  await screen.findByPlaceholderText("입력");
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: {}, values: { "/ui/children/0/value": { status: "ready", value: "새 값" } } } }));
  expect(screen.getByText("새 값")).toBeTruthy();
  act(() => transport.emit({ event: "data.update", window_id: "other", view: { sources: {}, values: { "/ui/children/0/value": { status: "ready", value: "다른 창" } } } }));
  expect(screen.queryByText("다른 창")).toBeNull();
});

it("does not submit Enter during IME composition", async () => {
  const { spy } = setup();
  const input = await screen.findByPlaceholderText("입력");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_submit"))).toBe(false);
});

it("keeps an input draft while focused and sends only after the debounce", async () => {
  const { store, spy } = setup();
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "초안" } });
  expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_change"))).toBe(false);
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { query: "외부", choice: "a", enabled: false } }); });
  expect(input.value).toBe("초안");
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/1/on_change", event: "초안" }));
});

it("cancels a pending debounced input change when the input unmounts", async () => {
  const { spy } = setup();
  const input = await screen.findByPlaceholderText("입력");
  vi.useFakeTimers();
  try {
    fireEvent.change(input, { target: { value: "폐기할 초안" } });
    expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_change"))).toBe(false);

    cleanup();
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });

    expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_change"))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("does not overwrite a changed value when an untouched focused input blurs", async () => {
  const { store, spy } = setup();
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { query: "새 값", choice: "a", enabled: false } }); });
  fireEvent.blur(input);
  await waitFor(() => expect(input.value).toBe("새 값"));
  expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_change"))).toBe(false);
});

it("shows action failures and stale source failures with retry and dismissal", async () => {
  const { transport, spy } = setup();
  await screen.findByPlaceholderText("입력");
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { file: { state: "failed", message: "오류", has_value: true } }, values: {} } }));
  expect(screen.getByText("이전에 받은 내용을 보이고 있습니다. 오류")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  expect(spy).toHaveBeenCalledWith({ op: "data.refresh", window_id: "editor-window", sources: ["file"] });
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("이전에 받은 내용을 보이고 있습니다. 오류")).toBeNull();
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { file: { state: "failed", message: "다시 오류", has_value: true } }, values: {} } }));
  expect(await screen.findByText("이전에 받은 내용을 보이고 있습니다. 다시 오류")).toBeTruthy();
});

it("keeps a blurred draft while its change is pending, then follows a later external state change", async () => {
  const { store, spy, originalCall } = setup();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_change")) await waiting;
    return originalCall(request);
  });
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "보낼 초안" } });
  fireEvent.blur(input);
  expect(input.value).toBe("보낼 초안");
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/1/on_change", event: "보낼 초안" }));
  expect(input.value).toBe("보낼 초안");
  await act(async () => { release(); await waiting; });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.query).toBe("보낼 초안"));
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { query: "외부 변경", choice: "a", enabled: false } }); });
  await waitFor(() => expect(input.value).toBe("외부 변경"));
});

it("shows an external change made while a blurred input request is finishing", async () => {
  const { store, spy, originalCall } = setup();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  spy.mockImplementation(async (request) => {
    const result = await originalCall(request);
    if (request.op === "data.act" && request.pointer.endsWith("/on_change")) await waiting;
    return result;
  });
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Paris" } });
  fireEvent.blur(input);
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.query).toBe("Paris"));
  await act(async () => { await store.call({ op: "window.set_state", window_id: "editor-window", state: { query: "", choice: "a", enabled: false } }); });
  expect(input.value).toBe("Paris");
  await act(async () => { release(); await waiting; });
  await waitFor(() => expect(input.value).toBe(""));
});

it("keeps a blurred draft when its change fails", async () => {
  const { spy, originalCall } = setup();
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_change")) throw { code: "server", message: "전송 실패", details: [] };
    return originalCall(request);
  });
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "보존할 초안" } });
  fireEvent.blur(input);
  await screen.findByText("전송 실패");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(input.value).toBe("보존할 초안");
});

it("keeps the latest failed draft when an earlier input request succeeds", async () => {
  const { store, spy, originalCall } = setup();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_change")) {
      if (request.event === "Par") { const reply = await originalCall(request); await first; return reply; }
      if (request.event === "Paris") { await second; throw { code: "server", message: "전송 실패", details: [] }; }
    }
    return originalCall(request);
  });
  const input = await screen.findByPlaceholderText("입력") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Par" } });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.query).toBe("Par"));
  fireEvent.change(input, { target: { value: "Paris" } });
  fireEvent.blur(input);
  expect(input.value).toBe("Paris");
  await act(async () => { releaseFirst(); await first; });
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "Paris" })));
  await act(async () => { releaseSecond(); await second; });
  await screen.findByText("전송 실패");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(input.value).toBe("Paris");
});

it("keeps a button and its open confirmation visible when its disabled binding is loading", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: {},
    ui: { type: "button", label: "지우기", disabled: { expr: "$state.disabled" }, on_click: [], confirm: { title: "지울까요?" } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = {};
  const transport = createFakeTransport(seed);
  render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  const button = await screen.findByRole("button", { name: "지우기" });
  await userEvent.click(button);
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: {}, values: { "/ui/disabled": { status: "loading" } } } }));
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.isConnected).toBe(true);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("traps tab within the dialog and makes the window body and notice inert", async () => {
  const { transport } = setup();
  const opener = await screen.findByRole("button", { name: "확인" });
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { file: { state: "failed", message: "오류", has_value: true } }, values: {} } }));
  await userEvent.click(opener);
  const dialog = screen.getByRole("dialog");
  const buttons = dialog.querySelectorAll("button");
  expect(document.querySelector(".ks-data-window-body")?.hasAttribute("inert")).toBe(true);
  expect(document.querySelector(".ks-data-window-notice")?.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.activeElement).toBe(opener);
  expect(document.querySelector(".ks-data-window-body")?.hasAttribute("inert")).toBe(false);
});

it("restores focus to the opener after the confirmed action finishes", async () => {
  const { spy, originalCall } = setup();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_click")) await waiting;
    return originalCall(request);
  });
  const opener = await screen.findByRole("button", { name: "확인" }) as HTMLButtonElement;
  await userEvent.click(opener);
  await userEvent.click(screen.getByRole("dialog").querySelectorAll("button")[1]);
  expect(opener.disabled).toBe(false);
  expect(opener.getAttribute("aria-disabled")).toBe("true");
  await act(async () => { release(); await waiting; });
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(opener.disabled).toBe(false);
  expect(opener.hasAttribute("aria-disabled")).toBe(false);
});

it("section 머리는 제목과 메타 원천 상태를 반복하지 않는다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: {},
    sources: { broken: { kind: "request", permission: "remote", path: "/" } },
    ui: {
      type: "section",
      title: { expr: "$data.broken.title" },
      meta: { expr: "$data.broken.meta" },
      collapsible: true,
      child: { type: "text", value: { expr: "$data.broken.body" } },
    },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = {};
  const transport = createFakeTransport({ ...seed, data: { sources: { broken: { error: "받기 실패" } } } });
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  await screen.findAllByRole("button", { name: "다시 받기" });
  const header = view.container.querySelector(".ks-data-section-header")!;
  const expectHeaderWithoutSourceState = () => {
    expect(header.querySelector(".ks-data-skeleton")).toBeNull();
    expect(header.querySelector(".ks-data-state-compact")).toBeNull();
  };
  expectHeaderWithoutSourceState();

  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { broken: { state: "loading", has_value: false } }, values: {} } }));
  expectHeaderWithoutSourceState();

  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { broken: { state: "failed", message: "다시 오류", has_value: false } }, values: {} } }));
  expectHeaderWithoutSourceState();
});


it("section의 null 메타는 글을 표시하지 않는다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: {},
    ui: { type: "section", title: "제목", meta: { expr: "null" }, child: { type: "text", value: "내용" } },
  };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  await screen.findByText("내용");
  expect(view.container.querySelector(".ks-data-section-meta")).toBeNull();
});

it("section의 null 제목은 글을 표시하지 않는다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: {},
    ui: { type: "section", title: { expr: "null" }, meta: "정보", child: { type: "text", value: "내용" } },
  };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  await screen.findByText("내용");
  expect(view.container.querySelector(".ks-data-section-title")).toBeNull();
  expect(view.container.querySelector(".ks-data-section-meta")?.textContent).toBe("정보");
});

it("반응형 분할은 자기 폭으로 방향을 바꾸면서 자식을 유지한다", async () => {
  let callback!: ResizeObserverCallback;
  let observed: Element | undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe(target: Element) { observed = target; }
    disconnect() {}
  });
  const definition: AppDefinition = { id: "responsive-split", name: "분할", requires: { blocks: blockGallery.requires.blocks, modules: {} }, permissions: [], state: { value: "처음" },
    ui: { type: "split", direction: "row", column_below: 700, children: [
      { type: "input", value: { state: "value" }, on_change: { set_state: "value" } }, { type: "text", value: "둘째" }, { type: "text", value: "셋째" },
    ] } as Block };
  const seed = makeTestSeed({ definitions: [definition] });
  const store = createShellStore(createFakeTransport(seed));
  const view = render(<AppWindowContent store={store} windowId="viewer-window" />);
  const input = await screen.findByRole("textbox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "유지" } });
  expect(observed?.classList.contains("ks-split")).toBe(true);
  act(() => callback([{ target: observed, contentRect: { width: 699 } } as ResizeObserverEntry], {} as ResizeObserver));
  expect(view.container.querySelector(".ks-split-column")).toBeTruthy();
  expect(view.container.querySelector(".ks-split.is-stacked")).toBeTruthy();
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input.value).toBe("유지");
  act(() => callback([{ target: observed, contentRect: { width: 700 } } as ResizeObserverEntry], {} as ResizeObserver));
  expect(view.container.querySelector(".ks-split-row")).toBeTruthy();
  expect(view.container.querySelector(".ks-split.is-stacked")).toBeNull();
  expect(screen.getByRole("textbox")).toBe(input);
  store.dispose();
});
