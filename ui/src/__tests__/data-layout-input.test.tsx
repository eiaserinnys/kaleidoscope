import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} },
    state: { query: "", choice: "a", enabled: false },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$state.query" } },
      { type: "input", value: { state: "query" }, on_change: { set_state: "query" }, on_submit: { set_state: "query" }, placeholder: "입력" },
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
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "data.act", window_id: "editor-window", pointer: "/ui/children/4/on_click", event: null }));
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
  expect(screen.getByText("다시 받지 못했습니다: file")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  expect(spy).toHaveBeenCalledWith({ op: "data.refresh", window_id: "editor-window", sources: ["file"] });
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByText("다시 받지 못했습니다: file")).toBeNull();
  act(() => transport.emit({ event: "data.update", window_id: "editor-window", view: { sources: { file: { state: "failed", message: "다시 오류", has_value: true } }, values: {} } }));
  expect(await screen.findByText("다시 받지 못했습니다: file")).toBeTruthy();
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
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", event: "Paris" })));
  await act(async () => { releaseFirst(); await first; });
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
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(buttons[1]);
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
  expect(opener.disabled).toBe(true);
  await act(async () => { release(); await waiting; });
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(opener.disabled).toBe(false);
});

it("retries a section heading failure without collapsing the section", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: {},
    sources: { broken: { kind: "request", permission: "remote", path: "/" } },
    ui: { type: "section", title: { expr: "$data.broken.title" }, collapsible: true, child: { type: "text", value: "내용" } },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = {};
  const transport = createFakeTransport({ ...seed, data: { sources: { broken: { error: "받기 실패" } } } });
  render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  const retry = await screen.findByRole("button", { name: "다시 받기" });
  const toggle = document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.contains(retry)).toBe(false);
  await userEvent.click(retry);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("내용")).toBeTruthy();
});
