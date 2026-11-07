import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { selectElement } from "../share/action-select";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(holdNewEvent = false, withOptions = false) {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} },
    state: { draft: "", saved: "", search: "", note: "" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", placeholder: "커맨드", value: { state: "draft" }, on_change: { set_state: "draft" }, on_submit: [{ set_state: "draft", value: "" }], ...(withOptions ? { options: ["새 명령", "다른 명령"], options_only: true } : {}) },
      { type: "button", label: "추가", on_click: [{ set_state: "saved", value: { expr: "$state.draft" } }] },
      { type: "input", placeholder: "검색", value: { state: "search" }, on_change: { set_state: "search" }, on_submit: { set_state: "search" } },
      { type: "input", placeholder: "메모", rows: 3, value: { state: "note" }, on_change: { set_state: "note" }, on_submit: [{ set_state: "note", value: "" }] },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const subscribe = transport.subscribe.bind(transport);
  let releaseEvent = () => {};
  let eventHeld = false;
  if (holdNewEvent) transport.subscribe = (listener) => subscribe((event) => {
    if (event.event === "state.changed" && event.snapshot.shared.windows[0].state.draft === "새 명령" && !eventHeld) {
      eventHeld = true;
      releaseEvent = () => listener(event);
    } else listener(event);
  });
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { store, spy, originalCall, eventHeld: () => eventHeld, releaseEvent: () => releaseEvent() };
}

it("스핀 직후 단추는 입력 요청과 응답과 상태 반영을 기다려 새 숫자를 읽는다", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 31, modules: {} }, state: { amount: 2, saved: 0 },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", kind: "number", spin: true, label: "수량", value: { state: "amount" }, on_change: { set_state: "amount" } },
      { type: "button", label: "저장", on_click: [{ set_state: "saved", value: { expr: "$state.amount" } }] },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const subscribe = transport.subscribe.bind(transport);
  let releaseEvent = () => {};
  let eventHeld = false;
  transport.subscribe = (listener) => subscribe((event) => {
    if (event.event === "state.changed" && event.snapshot.shared.windows[0].state.amount === 3 && !eventHeld) {
      eventHeld = true; releaseEvent = () => listener(event);
    } else listener(event);
  });
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  let releaseCall!: () => void;
  let releaseReply!: () => void;
  const pendingCall = new Promise<void>((resolve) => { releaseCall = resolve; });
  const pendingReply = new Promise<void>((resolve) => { releaseReply = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_change") && request.event === 3) {
      await pendingCall;
      const reply = await originalCall(request);
      await pendingReply;
      return reply;
    }
    return originalCall(request);
  });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  const up = await screen.findByRole("button", { name: "늘리기" });
  fireEvent.pointerDown(up, { button: 0 });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  const clicked = () => spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("/on_click"));
  await waitFor(() => expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.event === 3)).toBe(true));
  expect(clicked()).toBe(false);
  await act(async () => { releaseCall(); await pendingCall; });
  await waitFor(() => expect(eventHeld).toBe(true));
  expect(clicked()).toBe(false);
  await act(async () => { releaseReply(); await pendingReply; });
  expect(clicked()).toBe(false);
  await act(async () => { releaseEvent(); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe(3));
  fireEvent.pointerUp(up);
});

it("제출 뒤 새 입력을 바로 추가하면 새 값이 전달된다", async () => {
  const { store, spy, originalCall, eventHeld, releaseEvent } = setup(true);
  const input = await screen.findByPlaceholderText("커맨드") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "첫 명령" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_submit"))).toBe(true));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe(""));
  let releaseCall!: () => void;
  let releaseReply!: () => void;
  const pendingCall = new Promise<void>((resolve) => { releaseCall = resolve; });
  const pendingReply = new Promise<void>((resolve) => { releaseReply = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.event === "새 명령") {
      await pendingCall;
      const reply = await originalCall(request);
      await pendingReply;
      return reply;
    }
    return originalCall(request);
  });
  fireEvent.change(input, { target: { value: "새 명령" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() => expect(spy.mock.calls.some(([r]) => r.op === "data.act" && r.event === "새 명령")).toBe(true));
  await act(async () => { await Promise.resolve(); });
  const early = spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_click"));
  await act(async () => { releaseCall(); await pendingCall; });
  await waitFor(() => expect(eventHeld()).toBe(true));
  const beforeReply = spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_click"));
  await act(async () => { releaseReply(); await pendingReply; });
  await act(async () => { await Promise.resolve(); });
  const beforeEvent = spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_click"));
  await act(async () => { releaseEvent(); });
  expect(early).toBe(false);
  expect(beforeReply).toBe(false);
  expect(beforeEvent).toBe(false);
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("새 명령"));
  const calls = spy.mock.calls.map(([r]) => r).filter((r) => r.op === "data.act");
  const submitted = calls.findIndex((r) => r.op === "data.act" && r.pointer.endsWith("on_submit"));
  expect(calls.slice(submitted + 1).some((r) => r.op === "data.act" && r.pointer.endsWith("on_change") && r.event === "첫 명령")).toBe(false);
});

it("선택 직후 버튼은 입력 요청과 응답과 상태 이벤트가 모두 도착한 뒤 새 값을 읽는다", async () => {
  const { store, spy, originalCall, eventHeld, releaseEvent } = setup(true, true);
  const input = await screen.findByPlaceholderText("커맨드") as HTMLInputElement;
  let releaseCall!: () => void;
  let releaseReply!: () => void;
  const pendingCall = new Promise<void>((resolve) => { releaseCall = resolve; });
  const pendingReply = new Promise<void>((resolve) => { releaseReply = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.event === "새 명령") {
      await pendingCall;
      const reply = await originalCall(request);
      await pendingReply;
      return reply;
    }
    return originalCall(request);
  });
  fireEvent.focus(input);
  fireEvent.pointerDown(screen.getByRole("option", { name: "새 명령" }));
  fireEvent.click(screen.getByRole("option", { name: "새 명령" }));
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() => expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.event === "새 명령")).toBe(true));
  const clicked = () => spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("on_click"));
  expect(clicked()).toBe(false);
  await act(async () => { releaseCall(); await pendingCall; });
  await waitFor(() => expect(eventHeld()).toBe(true));
  expect(clicked()).toBe(false);
  await act(async () => { releaseReply(); await pendingReply; });
  await act(async () => { await Promise.resolve(); });
  expect(clicked()).toBe(false);
  await act(async () => { releaseEvent(); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("새 명령"));
  expect(spy.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer.endsWith("on_change") && request.event === "새 명령")).toHaveLength(1);
});

it("포커스를 지킨 제출에서 바깥 값 변경만 반영하고 여러 줄은 Ctrl+Enter로 보낸다", async () => {
  setup();
  const input = await screen.findByPlaceholderText("커맨드") as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "첫 명령" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input.value).toBe(""));
  expect(document.activeElement).toBe(input);

  const search = screen.getByPlaceholderText("검색") as HTMLInputElement;
  search.focus();
  fireEvent.change(search, { target: { value: "유지" } });
  fireEvent.keyDown(search, { key: "Enter" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  expect(search.value).toBe("유지");
  expect(document.activeElement).toBe(search);

  const note = screen.getByPlaceholderText("메모") as HTMLTextAreaElement;
  note.focus();
  fireEvent.change(note, { target: { value: "메모 내용" } });
  fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(note.value).toBe(""));
  expect(document.activeElement).toBe(note);
});

it.each([
  ["날짜 직접 입력", "date", "type", "2026-11-23"],
  ["달력 선택", "date", "choose", "2026-11-21"],
  ["시간 직접 입력", "time", "type", "15:30"],
  ["시간 목록 선택", "time", "choose", "16:00"],
] as const)("%s 뒤 단추는 입력 응답과 상태를 기다린다", async (_name, kind, mode, nextValue) => {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 35, modules: {} },
    state: { draft: kind === "date" ? "2026-11-20" : "14:00", saved: "" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", kind, label: "값", value: { state: "draft" }, on_change: { set_state: "draft" } },
      { type: "button", label: "확인", on_click: [{ set_state: "saved", value: { expr: "$state.draft" } }] },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const subscribe = transport.subscribe.bind(transport);
  let releaseEvent = () => {};
  let eventHeld = false;
  transport.subscribe = (listener) => subscribe((event) => {
    if (event.event === "state.changed" && event.snapshot.shared.windows[0].state.draft === nextValue && !eventHeld) {
      eventHeld = true; releaseEvent = () => listener(event);
    } else listener(event);
  });
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  let releaseCall!: () => void;
  let releaseReply!: () => void;
  const call = new Promise<void>((resolve) => { releaseCall = resolve; });
  const reply = new Promise<void>((resolve) => { releaseReply = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.event === nextValue) { await call; const response = await originalCall(request); await reply; return response; }
    return originalCall(request);
  });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  const input = await screen.findByRole(kind === "date" ? "textbox" : "combobox", { name: "값" });
  fireEvent.focus(input);
  if (mode === "type") fireEvent.change(input, { target: { value: nextValue } });
  else if (kind === "date") {
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("21", { selector: "button" }));
  } else {
    act(() => { expect(selectElement("editor-window", input, { by: "value", value: nextValue })).toBeUndefined(); });
  }
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await waitFor(() => expect(spy.mock.calls.some(([r]) => r.op === "data.act" && r.event === nextValue)).toBe(true));
  const clicked = () => spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_click"));
  expect(clicked()).toBe(false);
  await act(async () => { releaseCall(); await call; });
  await waitFor(() => expect(eventHeld).toBe(true));
  expect(clicked()).toBe(false);
  await act(async () => { releaseReply(); await reply; });
  await act(async () => { await Promise.resolve(); });
  expect(clicked()).toBe(false);
  await act(async () => { releaseEvent(); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe(nextValue));
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change") && r.event === nextValue)).toHaveLength(1);
});

it("이름이 보이는 목록 전용에서 고치지 않고 Enter를 누르면 제출은 값을 받는다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} },
    state: { draft: "code-77", saved: "" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", placeholder: "선택", value: { state: "draft" }, on_change: { set_state: "draft" }, on_submit: [{ set_state: "saved", value: { expr: "$state.draft" } }], options: [{ value: "code-77", label: "Zombie 마지막" }], options_only: true },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  const input = await screen.findByPlaceholderText("선택") as HTMLInputElement;
  expect(input.value).toBe("Zombie 마지막");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe("code-77"));
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.pointer.endsWith("on_submit") && request.event === "code-77")).toBe(true));
});
