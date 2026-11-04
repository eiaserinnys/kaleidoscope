import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(holdNewEvent = false) {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} },
    state: { draft: "", saved: "", search: "", note: "" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", placeholder: "커맨드", value: { state: "draft" }, on_change: { set_state: "draft" }, on_submit: [{ set_state: "draft", value: "" }] },
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
    ...mdEditorDefinition, requires: { blocks: 30, modules: {} }, state: { amount: 2, saved: 0 },
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
