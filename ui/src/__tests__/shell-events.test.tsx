import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import type { CoreEvent } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";
import calculatorJson from "../../../apps/calculator.json";
import weatherJson from "../../../apps/weather.json";
import agentJson from "../../../apps/agent.json";
import explorerJson from "../../../apps/explorer.json";
import mdEditorJson from "../../../apps/md-editor.json";
import { mdViewerDefinition as mdViewerJson } from "./fixtures";
import htmlReportJson from "../../../apps/html-report.json";
import webBrowserJson from "../../../apps/web-browser.json";
import type { AppDefinition } from "../contract/contract";
import { registerAppShortcuts } from "../runtime/shortcuts";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  });
}

afterEach(() => cleanup());

describe("shell core events", () => {
  it("맨 위로 올린 창 항목을 목록 안으로 보이게 한다", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />);
    await store.ready;
    const item = document.querySelector<HTMLElement>('.ks-taskbar-window[data-window-id="editor-window"]')!;
    const scroll = vi.fn();
    Object.defineProperty(item, "scrollIntoView", { configurable: true, value: scroll });
    fireEvent.click(item);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ inline: "nearest", block: "nearest" }));
    store.dispose();
  });

  it("빈 데스크톱에서도 고정 조작이 순서대로 있고 상단에는 앱 열기가 없다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows = [];
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;
    const taskbar = screen.getByRole("toolbar", { name: "작업 표시줄" });
    expect(within(taskbar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "이전 데스크톱", "앱 열기", "모든 창 최소화", "모든 창 다시 열기", "다음 데스크톱",
    ]);
    expect(within(document.querySelector(".ks-shell-bar") as HTMLElement).queryByRole("button", { name: "앱 열기" })).toBeNull();
    expect((within(taskbar).getByRole("button", { name: "이전 데스크톱" }) as HTMLButtonElement).disabled).toBe(true);
    store.dispose();
  });

  it("단축키는 입력 중에도 데스크톱을 순환하고 열린 팔레트에서는 동작하지 않는다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.desktops.push({ ...snapshot.shared.desktops[0], id: "desktop-2", position: 1 }, { ...snapshot.shared.desktops[0], id: "desktop-3", position: 2 });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { code: "ArrowLeft", key: "ArrowLeft", ctrlKey: true, altKey: true, isComposing: true });
    await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "desktop.activate", desktop_id: "desktop-3" }));
    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));
    calls.mockClear();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "앱 열기" }), { code: "ArrowRight", key: "ArrowRight", ctrlKey: true, altKey: true });
    expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ op: "desktop.activate" }));
    input.remove();
    store.dispose();
  });

  it("데스크톱 단추와 단축키는 position 순서 끝에서 순환한다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.desktops.push({ ...snapshot.shared.desktops[0], id: "desktop-3", position: 2 }, { ...snapshot.shared.desktops[0], id: "desktop-2", position: 1 });
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;
    const next = screen.getByRole("button", { name: "다음 데스크톱" });
    for (const id of ["desktop-2", "desktop-3", "desktop-1"]) {
      fireEvent.click(next);
      await waitFor(() => expect(store.getSnapshot()?.device.active_desktop_ids["workspace-1"]).toBe(id));
    }
    fireEvent.keyDown(window, { code: "ArrowLeft", key: "ArrowLeft", ctrlKey: true, altKey: true });
    await waitFor(() => expect(store.getSnapshot()?.device.active_desktop_ids["workspace-1"]).toBe("desktop-3"));
    store.dispose();
  });

  it("다시 열기는 최소화된 창만 원래 크기와 최대화 상태로 연다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows[0].minimized = true;
    snapshot.shared.windows[0].maximized = true;
    const original = structuredClone(snapshot.shared.windows);
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "모든 창 다시 열기" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "editor-window" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "모든 창 다시 열기" }) as HTMLButtonElement).disabled).toBe(true));
    const restored = store.getSnapshot()!.shared.windows;
    expect(restored[0].maximized).toBe(true);
    expect(restored[0].rect).toEqual(original[0].rect);
    expect(restored[1]).toEqual(original[1]);
    expect(calls.mock.calls.filter(([request]) => request.op === "window.raise")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "모든 창 최소화" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "모든 창 최소화" }) as HTMLButtonElement).disabled).toBe(true));
    store.dispose();
  });

  it("창 전환은 막대 순서로 돌고 반복 입력과 같은 앱 단축키는 실행하지 않는다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows.push({ ...snapshot.shared.windows[0], id: "third-window", z: 3 });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const appShortcut = vi.fn();
    const remove = registerAppShortcuts({ store, window: snapshot.shared.windows[2] } as never, [{ code: "Tab", modifiers: ["ctrl", "alt"], action: { client: "test" } }], appShortcut);
    fireEvent.keyDown(window, { code: "Tab", key: "Tab", ctrlKey: true, altKey: true });
    await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "editor-window" }));
    fireEvent.keyDown(window, { code: "Tab", key: "Tab", ctrlKey: true, altKey: true });
    await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "viewer-window" }));
    calls.mockClear();
    fireEvent.keyDown(window, { code: "Tab", key: "Tab", ctrlKey: true, altKey: true, repeat: true });
    expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ op: "window.raise" }));
    expect(appShortcut).not.toHaveBeenCalled();
    remove();
    store.dispose();
  });

  it("대체 키로 창을 전환하고 현재 창을 최대화, 복원, 최소화한다", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const key = (code: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { code, key: code, ctrlKey: true, altKey: true, ...extra });
    key("PageUp");
    const editor = screen.getByTestId("app-window-md-editor");
    await waitFor(() => expect(editor.querySelector(".ks-window-frame-active")).toBeTruthy());
    key("ArrowUp");
    await waitFor(() => expect(editor.getAttribute("data-maximized")).toBe("true"));
    key("ArrowUp");
    await waitFor(() => expect(editor.getAttribute("data-maximized")).toBe("false"));
    key("ArrowDown", { metaKey: true });
    expect(editor.getAttribute("data-minimized")).toBe("false");
    key("ArrowDown");
    await waitFor(() => expect(editor.getAttribute("data-minimized")).toBe("true"));
    store.dispose();
  });

  it("데스크톱이 없어도 설정 항목과 전체 창 조작은 살아 있다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.workspaces = [];
    snapshot.shared.desktops = [];
    snapshot.shared.windows = [];
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;
    const bar = screen.getByRole("toolbar", { name: "작업 표시줄" });
    expect((within(bar).getByRole("button", { name: "앱 열기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(bar).getByRole("button", { name: "이전 데스크톱" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    expect(within(bar).getByRole("button", { name: "설정" })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "모든 창 최소화" }));
    await waitFor(() => expect((within(bar).getByRole("button", { name: "모든 창 최소화" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(within(bar).getByRole("button", { name: "모든 창 다시 열기" }));
    await waitFor(() => expect(screen.getByTestId("system-window-settings").getAttribute("data-minimized")).toBe("false"));
    store.dispose();
  });

  it("설정 창만 있어도 최소화된 설정을 원래 크기로 펼친다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows = [];
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    fireEvent.click(screen.getByRole("button", { name: "모든 창 최소화" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "모든 창 최소화" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "모든 창 다시 열기" }));
    await waitFor(() => expect(screen.getByTestId("system-window-settings").getAttribute("data-minimized")).toBe("false"));
    expect(screen.getByTestId("system-window-settings").getAttribute("data-maximized")).toBe("false");
    store.dispose();
  });

  it.each([
    { settingsOnTop: false, shortcut: false },
    { settingsOnTop: true, shortcut: true },
  ])("전체 다시 열기는 설정이 맨 위인지 $settingsOnTop, 단축키인지 $shortcut일 때 겹침 순서를 유지한다", async ({ settingsOnTop, shortcut }) => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows[0].maximized = true;
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    const a = screen.getByTestId("app-window-md-editor");
    const b = screen.getByTestId("app-window-md-viewer");
    const settings = screen.getByTestId("system-window-settings");
    if (!settingsOnTop) {
      fireEvent.pointerDown(b);
      await waitFor(() => expect(b.querySelector(".ks-window-frame-active")).toBeTruthy());
    }
    const order = () => [a, settings, b].sort((left, right) => {
      const difference = Number(left.style.zIndex) - Number(right.style.zIndex);
      return difference || (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    });
    expect(order()).toEqual(settingsOnTop ? [a, b, settings] : [a, settings, b]);
    fireEvent.click(screen.getByRole("button", { name: "모든 창 최소화" }));
    await waitFor(() => expect([a, b, settings].every((element) => element.getAttribute("data-minimized") === "true")).toBe(true));
    if (shortcut) fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp", ctrlKey: true, altKey: true, shiftKey: true });
    else fireEvent.click(screen.getByRole("button", { name: "모든 창 다시 열기" }));
    await waitFor(() => expect([a, b, settings].every((element) => element.getAttribute("data-minimized") === "false")).toBe(true));
    expect([a, b, settings].map((element) => element.getAttribute("data-maximized"))).toEqual(["true", "false", "false"]);
    expect(order()).toEqual(settingsOnTop ? [a, b, settings] : [a, settings, b]);
    store.dispose();
  });

  it("다시 열기 응답이 상태 이벤트보다 먼저 와도 설정을 올리기 전 상태 반영을 기다린다", async () => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const transport = createFakeTransport(makeTestSeed());
    const subscribe = transport.subscribe.bind(transport);
    let hold = false;
    let deliver: (() => void) | undefined;
    transport.subscribe = (listener) => subscribe((event) => {
      if (hold && event.event === "state.changed") { hold = false; deliver = () => listener(event); }
      else listener(event);
    });
    const original = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
      if (request.op === "window.raise" && request.window_id === "editor-window") hold = true;
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    const b = screen.getByTestId("app-window-md-viewer");
    fireEvent.pointerDown(b);
    await waitFor(() => expect(b.querySelector(".ks-window-frame-active")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "모든 창 최소화" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "모든 창 최소화" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "모든 창 다시 열기" }));
    await waitFor(() => expect(deliver).toBeDefined());
    expect(screen.getByTestId("system-window-settings").getAttribute("data-minimized")).toBe("true");
    await act(async () => deliver?.());
    await waitFor(() => expect(b.getAttribute("data-minimized")).toBe("false"));
    const a = screen.getByTestId("app-window-md-editor");
    const settings = screen.getByTestId("system-window-settings");
    expect(Number(a.style.zIndex)).toBeLessThan(Number(settings.style.zIndex));
    expect(Number(settings.style.zIndex)).toBe(Number(b.style.zIndex));
    store.dispose();
  });

  it("빈 데스크톱과 최소화된 창에서 작업 표시줄을 유지한다", async () => {
    const snapshot = makeTestSnapshot();
    const window = snapshot.shared.windows[0];
    snapshot.shared.windows = [];
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    expect(document.querySelector(".ks-taskbar")).not.toBeNull();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] } } });
    await waitFor(() => expect(document.querySelector(".ks-taskbar")).not.toBeNull());

    await transport.call({ op: "window.minimize", window_id: window.id });
    await waitFor(() => expect(document.querySelector(".ks-taskbar")).not.toBeNull());
    expect(document.querySelector(".ks-taskbar-window")?.getAttribute("data-state")).toBe("minimized");
    store.dispose();
  });

  it("태스크바로 창을 올리고 최소화하며 우클릭 메뉴에서 최대화와 복원을 수행한다", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    const editorItem = document.querySelector<HTMLButtonElement>('.ks-taskbar-window[data-window-id="editor-window"]');
    const editorWindow = screen.getByTestId("app-window-md-editor");
    if (!editorItem) throw new Error("편집기 태스크바 항목을 찾지 못했습니다");
    const titlebarIcons = [...editorWindow.querySelectorAll<SVGElement>(".ks-window-title-actions svg")];
    expect(titlebarIcons.map((icon) => icon.getAttribute("width"))).toEqual(titlebarIcons.map(() => "14"));
    const minimizeIcon = within(editorWindow).getByRole("button", { name: "창 최소화" }).querySelector("svg");
    expect(minimizeIcon?.classList.contains("lucide-minus")).toBe(true);
    expect(editorItem.getAttribute("data-state")).toBe("inactive");
    expect(document.querySelector('.ks-taskbar-window[data-window-id="viewer-window"]')?.getAttribute("data-state")).toBe("active");

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorItem.getAttribute("data-state")).toBe("active"));
    expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "editor-window" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("true"));
    expect(editorItem.getAttribute("data-state")).toBe("minimized");
    expect(calls).toHaveBeenCalledWith({ op: "window.minimize", window_id: "editor-window" });

    fireEvent.contextMenu(editorItem);
    expect(screen.getByRole("menuitem", { name: "복원" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("false"));
    expect(editorItem.getAttribute("data-state")).toBe("active");

    fireEvent.contextMenu(editorItem);
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(screen.getByRole("menuitem", { name: "창 최소화" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "창 닫기" }).classList.contains("ks-menu-item-danger")).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "창 최대화" }));
    await waitFor(() => expect(editorWindow.getAttribute("data-maximized")).toBe("true"));
    expect(editorWindow.querySelector(".ks-window-resize-east")).toBeNull();
    expect(calls).toHaveBeenCalledWith({ op: "window.maximize", window_id: "editor-window" });

    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("true"));
    fireEvent.click(editorItem);
    await waitFor(() => expect(editorWindow.getAttribute("data-minimized")).toBe("false"));
    expect(editorWindow.getAttribute("data-maximized")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "이전 크기로 복원" }));
    await waitFor(() => expect(editorWindow.getAttribute("data-maximized")).toBe("false"));
    expect(calls).toHaveBeenCalledWith({ op: "window.restore", window_id: "editor-window" });
    store.dispose();
  });

  it("앱 열기 격자에서 기본 앱과 커스텀 앱을 각각 가나다순으로 열 수 있다", async () => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const definitions = [
      calculatorJson, weatherJson, agentJson, explorerJson, mdEditorJson, htmlReportJson, webBrowserJson,
      { ...mdViewerJson, id: "custom-z", name: "가나다 커스텀" },
      { ...mdViewerJson, id: "custom-a", name: "가나가 커스텀", window_size: { width: 480, height: 360 } },
      { ...mdViewerJson, id: "custom-b", name: "가나가 커스텀" },
    ] as AppDefinition[];
    const snapshot = makeTestSnapshot({ definitions });
    snapshot.shared.windows.forEach((window) => { window.id = `test-window-${window.app_id}`; });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));

    const menu = screen.getByRole("dialog", { name: "앱 열기" });
    expect([...menu.querySelectorAll(".ks-view-group")].map((item) => item.textContent)).toEqual(["기본앱", "커스텀 앱"]);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect([...menu.querySelectorAll(".ks-icon-tile")].map((item) => item.textContent)).toEqual([
      "계산기", "날씨", "마크다운 편집기", "시안과 리포트", "에이전트", "웹 브라우저", "탐색기",
      "가나가 커스텀", "가나가 커스텀", "가나다 커스텀",
    ]);
    fireEvent.click(screen.getByRole("dialog", { name: "앱 열기" }).querySelectorAll(".ks-icon-tile")[7]);
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "custom-a",
      rect: { x: 112, y: 112, width: 480, height: 360 },
    }));
    const openedWindow = {
      ...snapshot.shared.windows[0],
      id: "custom-a-window",
      app_id: "custom-a",
      z: Math.max(...snapshot.shared.windows.map((window) => window.z)) + 1,
    };
    transport.emit({
      event: "state.changed",
      snapshot: {
        ...snapshot,
        shared: { ...snapshot.shared, windows: [...snapshot.shared.windows, openedWindow] },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));
    fireEvent.click(screen.getByRole("dialog", { name: "앱 열기" }).querySelectorAll(".ks-icon-tile")[8]);
    await waitFor(() => expect(calls).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "custom-b",
      rect: { x: 144, y: 144, width: 804, height: 344 },
    }));
    store.dispose();
  });

  it("기본 앱만 있으면 기본앱 섹션만 표시한다", async () => {
    const definitions = [calculatorJson, htmlReportJson] as AppDefinition[];
    const snapshot = makeTestSnapshot({ definitions });
    snapshot.shared.windows.forEach((window) => { window.id = `builtin-window-${window.app_id}`; });
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;

    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));

    const menu = screen.getByRole("dialog", { name: "앱 열기" });
    expect([...menu.querySelectorAll(".ks-view-group")].map((item) => item.textContent)).toEqual(["기본앱"]);
    expect(menu.querySelector('[role="separator"]')).toBeNull();
    expect(screen.queryByText("커스텀 앱")).toBeNull();
    store.dispose();
  });

  it("격자에서 키보드로 묶음 사이를 이동하고 닫으면 실행 단추로 돌아간다", async () => {
    const definitions = [calculatorJson, weatherJson, agentJson, explorerJson, mdEditorJson,
      { ...mdViewerJson, id: "custom-a", name: "가나" },
      { ...mdViewerJson, id: "custom-b", name: "다라" },
      { ...mdViewerJson, id: "custom-c", name: "마바" }] as AppDefinition[];
    const snapshot = makeTestSnapshot({ definitions });
    snapshot.shared.windows.forEach((window) => { window.id = `keyboard-window-${window.app_id}`; });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const calls = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ks-icon-grid") ? 392 : 960;
    });
    render(<Shell store={store} />);
    await store.ready;
    const trigger = within(document.querySelector(".ks-taskbar") as HTMLElement).getByRole("button", { name: "앱 열기" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "앱 열기" });
    const tiles = [...dialog.querySelectorAll<HTMLButtonElement>(".ks-icon-tile")];
    await waitFor(() => expect(document.activeElement).toBe(tiles[0]));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(tiles[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(tiles[1]);
    fireEvent.keyDown(tiles[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(tiles[4]);
    fireEvent.keyDown(tiles[4], { key: "ArrowDown" });
    expect(document.activeElement).toBe(tiles[6]);
    fireEvent.keyDown(tiles[6], { key: "ArrowUp" });
    expect(document.activeElement).toBe(tiles[4]);
    fireEvent.keyDown(tiles[4], { key: "End" });
    expect(document.activeElement).toBe(tiles[7]);
    fireEvent.keyDown(tiles[7], { key: "Home" });
    expect(document.activeElement).toBe(tiles[0]);
    fireEvent.keyDown(tiles[0], { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "앱 열기" }), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const first = screen.getByRole("dialog", { name: "앱 열기" }).querySelector<HTMLButtonElement>(".ks-icon-tile")!;
    fireEvent.click(first);
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(calls.mock.calls.some(([request]) => request.op === "window.open")).toBe(true));
    width.mockRestore();
    store.dispose();
  });

  it("빈 데스크톱의 앱 열기도 같은 패널을 열고 목록 변경을 반영한다", async () => {
    const snapshot = makeTestSnapshot({ definitions: [calculatorJson] as AppDefinition[] });
    snapshot.shared.windows = [];
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const trigger = within(document.querySelector(".ks-desktop-area") as HTMLElement).getByRole("button", { name: "앱 열기" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("dialog", { name: "앱 열기" })).getByRole("button", { name: "계산기" })).toBeTruthy();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, apps: [] } } });
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "앱 열기" })).getByText("앱 없음")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "앱 열기" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "앱 열기" }), { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    store.dispose();
  });

  it("팔레트를 단추 위에 열고 창 크기 변경 때 위 공간을 다시 잰다", async () => {
    const snapshot = makeTestSnapshot({ definitions: [calculatorJson] as AppDefinition[] });
    snapshot.shared.windows = [];
    const store = createShellStore(createFakeTransport({ ...makeTestSeed(), snapshot }));
    render(<Shell store={store} />);
    await store.ready;
    const trigger = within(document.querySelector(".ks-desktop-area") as HTMLElement).getByRole("button", { name: "앱 열기" });
    const bar = document.querySelector<HTMLElement>(".ks-shell-bar")!;
    trigger.style.setProperty("--ks-space-3", "12px");
    trigger.style.setProperty("--ks-space-2", "8px");
    let anchorTop = 478;
    const anchorRect = vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(500, anchorTop, 66, 32));
    const barRect = vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1440, 49));
    const taskbar = document.querySelector<HTMLElement>(".ks-taskbar")!;
    const taskbarRect = vi.spyOn(taskbar, "getBoundingClientRect").mockImplementation(() => new DOMRect(450, anchorTop - 6, 600, 40));
    const surfaceRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      this.style.setProperty("--ks-space-2", "8px");
      return this.classList.contains("ks-app-launcher") ? new DOMRect(0, 0, 410, 300) : new DOMRect();
    });
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 900 });
    try {
      fireEvent.click(trigger);
      const panel = screen.getByRole("dialog", { name: "앱 열기" });
      await waitFor(() => expect(panel.style.maxHeight).toContain("403px"));
      await waitFor(() => expect(panel.style.top).toBe("164px"));
      anchorTop = 240;
      window.innerHeight = 600;
      fireEvent(window, new Event("resize"));
      await waitFor(() => expect(panel.style.maxHeight).toContain("165px"));
      fireEvent.keyDown(panel, { key: "Escape" });
    } finally {
      surfaceRect.mockRestore();
      anchorRect.mockRestore();
      barRect.mockRestore();
      taskbarRect.mockRestore();
      Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: previousHeight });
      store.dispose();
    }
  });

  it("빈 데스크톱에서 앱을 열면 새 창이 초점을 받는다", async () => {
    const snapshot = makeTestSnapshot({ definitions: [calculatorJson] as AppDefinition[] });
    const openedWindow = { ...snapshot.shared.windows[0], id: "opened-calculator", app_id: "calculator" };
    snapshot.shared.windows = [];
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
      if (request.op === "window.open") {
        transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [openedWindow] } } });
        return Promise.resolve({ op: "window.open", window: openedWindow });
      }
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    const desktopTrigger = within(document.querySelector(".ks-desktop-area") as HTMLElement).getByRole("button", { name: "앱 열기" });
    fireEvent.click(desktopTrigger);
    fireEvent.click(within(screen.getByRole("dialog", { name: "앱 열기" })).getByRole("button", { name: "계산기" }));
    await waitFor(() => expect(document.querySelector('[data-window-id="opened-calculator"]')).not.toBeNull());
    expect(desktopTrigger.isConnected).toBe(true);
    await waitFor(() => expect(document.querySelector('[data-window-id="opened-calculator"]')?.contains(document.activeElement)).toBe(true));
    store.dispose();
  });

  it("바깥 누름은 초점이 없는 곳일 때만 실행 단추로 복구한다", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />);
    await store.ready;
    const trigger = within(document.querySelector(".ks-taskbar") as HTMLElement).getByRole("button", { name: "앱 열기" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    const other = screen.getByRole("button", { name: "데스크톱 추가" });
    fireEvent.pointerDown(other);
    other.focus();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.activeElement).toBe(other);
    store.dispose();
  });

  it("delivers non-state events without replacing the snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const store = createShellStore(transport);
    await store.ready;
    const listener = vi.fn();
    const unsubscribe = store.subscribeEvents(listener);
    const event: CoreEvent = { event: "app.open_requested", app_id: "md-viewer" };

    transport.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
    expect(store.getSnapshot()?.shared.apps.map((app) => app.id)).toContain("md-viewer");
    unsubscribe();
    store.dispose();
  });

  it("opens a requested app on the selected desktop using the new-window placement", async () => {
    document.documentElement.style.setProperty("--ks-window-min-width", "360px");
    document.documentElement.style.setProperty("--ks-window-min-height", "240px");
    const snapshot = makeTestSnapshot();
    const viewerVersion = snapshot.shared.app_versions.find((version) => version.app_id === "md-viewer")!;
    viewerVersion.definition = { ...viewerVersion.definition, window_size: { width: 480, height: 360 } } as AppDefinition;
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-1",
      app_id: "md-viewer",
      rect: { x: 80, y: 80, width: 480, height: 360 },
    }));
    store.dispose();
  });

  it("raises the highest window for an already open requested app", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows.push({ ...snapshot.shared.windows[1], id: "viewer-window-top", z: 5 });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "window.raise", window_id: "viewer-window-top" }));
    store.dispose();
  });

  it("ignores a request for an app absent from the latest snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    spy.mockClear();

    transport.emit({ event: "app.open_requested", app_id: "missing-app" });

    expect(spy).not.toHaveBeenCalled();
    store.dispose();
  });

  it("opens a workspace-targeted app on that workspace desktop without changing the visible workspace", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.workspaces.push({
      id: "workspace-2", name: "다른 작업", created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.shared.desktops.push({
      id: "desktop-2", workspace_id: "workspace-2", name: "작업 화면", position: 0,
      created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.shared.desktops.push({
      id: "desktop-3", workspace_id: "workspace-2", name: "마지막 화면", position: 1,
      created_at: "2026-10-29T00:00:00Z", updated_at: "2026-10-29T00:00:00Z",
    });
    snapshot.device.active_desktop_ids["workspace-2"] = "desktop-3";
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;

    transport.emit({ event: "app.open_requested", app_id: "md-viewer", workspace_id: "workspace-2" });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({
      op: "window.open",
      desktop_id: "desktop-3",
      app_id: "md-viewer",
      rect: { x: 48, y: 48, width: 880, height: 440 },
    }));
    expect(store.getSnapshot()?.device.active_workspace_id).toBe("workspace-1");
    expect(store.getSnapshot()?.device.active_desktop_ids["workspace-2"]).toBe("desktop-3");
    store.dispose();
  });

  it("ignores a workspace-targeted request for a workspace absent from the latest snapshot", async () => {
    const transport = createFakeTransport(makeTestSeed());
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    spy.mockClear();

    transport.emit({ event: "app.open_requested", app_id: "md-viewer", workspace_id: "missing-workspace" });

    expect(spy).not.toHaveBeenCalled();
    store.dispose();
  });
});

describe("shell server link control", () => {
  it("설정이 맨 위일 때 앱 창을 누르면 앱을 올린다", async () => {
    const seed = makeTestSeed();
    const transport = createFakeTransport(seed); const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    const target = seed.snapshot.shared.windows[0];
    fireEvent.pointerDown(screen.getByTestId(`app-window-${target.app_id}`));
    expect(spy).toHaveBeenCalledWith({ op: "window.raise", window_id: target.id });
    store.dispose();
  });

  it("설정 위로 올린 앱 창을 최소화하면 설정이 맨 위로 보인다", async () => {
    const seed = makeTestSeed();
    const store = createShellStore(createFakeTransport(seed)); render(<Shell store={store} />); await store.ready;
    fireEvent.click(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    const target = seed.snapshot.shared.windows[0];
    const frame = screen.getByTestId(`app-window-${target.app_id}`);
    fireEvent.pointerDown(frame);
    await waitFor(() => expect(frame.querySelector(".ks-window-frame-active")).toBeTruthy());
    fireEvent.click(within(frame).getByRole("button", { name: "창 최소화" }));
    await waitFor(() => expect(frame.getAttribute("data-minimized")).toBe("true"));
    const taskbar = screen.getByRole("toolbar", { name: "작업 표시줄" });
    const items = within(taskbar).getAllByRole("button");
    const settingsItem = within(taskbar).getByRole("button", { name: "설정" });
    expect(settingsItem.getAttribute("aria-pressed")).toBe("true");
    const appItems = items.filter((item) => item.classList.contains("ks-taskbar-window") && item !== settingsItem);
    expect(appItems.length).toBeGreaterThan(0);
    expect(appItems.map((item) => item.getAttribute("aria-pressed"))).toEqual(appItems.map(() => "false"));
    store.dispose();
  });

  it("pairs with the entered remote URL and keeps the code visible", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버" }));
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "원격 서버 주소" });
    expect(document.activeElement).toBe(input);
    const connect = screen.getByRole("button", { name: "연결" }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy.mock.calls.some(([request]) => request.op === "link.start")).toBe(false);
    fireEvent.change(input, { target: { value: "https://remote.example" } });
    expect(connect.disabled).toBe(false);
    fireEvent.blur(input);
    expect(spy.mock.calls.some(([request]) => request.op === "link.start")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start", server_url: "https://remote.example" }));
    expect(await screen.findByRole("button", { name: "코드 복사" })).toBeTruthy();
    expect(screen.getByText("https://remote.example")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 돌아가기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.use_local" })); store.dispose();
  });
  it("opens the same server control in an empty workspace and groups its action", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    seed.snapshot.shared.workspaces = []; seed.snapshot.shared.desktops = []; seed.snapshot.shared.windows = [];
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    const button = screen.getByRole("button", { name: "내 PC 서버" });
    expect(button.closest(".ks-shell-actions")).toBeTruthy();
    expect(button.querySelector(".shell-server-dot")).toBeTruthy();
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(screen.getByRole("button", { name: "작업 만들기" }).closest(".ks-empty-state-action")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    store.dispose();
  });
  it("offers prefilled remote re-pairing after revocation", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "revoked", server_url: "https://revoked.example" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 연결 거부됨" }));
    expect(screen.queryByRole("button", { name: "가져오기" })).toBeNull();
    const input = screen.getByRole("textbox", { name: "원격 서버 주소" }) as HTMLInputElement;
    expect((screen.getByRole("button", { name: "연결" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "내 PC 서버로 전환" }));
    expect(input.value).toBe("https://revoked.example");
    expect(screen.getByRole("button", { name: "내 PC 서버로 전환" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.start", server_url: "https://revoked.example" }));
    store.dispose();
  });
  it("names an unlinked panel without claiming a local connection", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "연결 해제됨" }));
    expect(within(screen.getByTestId("system-window-settings")).getByText("연결 해제됨")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "원격 서버 주소" })).toBeTruthy();
    expect(screen.queryByText("내 PC 내장 서버")).toBeNull(); store.dispose();
  });
  it("copies a pairing code and updates the open panel on approval", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "페어링 코드 123456" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "코드 복사" }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("123456"));
      const status = await screen.findByText("복사했습니다");
      expect(status.getAttribute("role")).toBe("status");
      expect(screen.getByRole("button", { name: "코드 복사" }).querySelector(".lucide-check")).toBeTruthy();
      expect(screen.queryByText("코드 복사됨")).toBeNull();
      act(() => { vi.advanceTimersByTime(1500); });
      expect(status.textContent).toBe("");
      expect(screen.getByRole("button", { name: "코드 복사" }).querySelector(".lucide-copy")).toBeTruthy();
      expect(screen.getByRole("button", { name: "코드 복사" }).querySelector(".lucide-check")).toBeNull();
    } finally { vi.useRealTimers(); }
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    expect(await screen.findByText("집")).toBeTruthy();
    expect(screen.getByRole("button", { name: "연결 끊기" })).toBeTruthy(); store.dispose();
  });
  it("복사하지 못하면 코드와 직접 복사할 안내를 보인다", async () => {
    const transport = createFakeTransport(makeTestSeed());
    transport.setLink({ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("거부")) } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "페어링 코드 123456" }));
    fireEvent.click(screen.getByRole("button", { name: "코드 복사" }));
    expect(await screen.findByText("페어링 코드를 복사하지 못했습니다. 표시된 코드를 직접 복사하세요.")).toBeTruthy();
    expect(screen.getByText("SHELL_SERVER_PAIRING_CODE_COPY_FAILED")).toBeTruthy();
    store.dispose();
  });
  it("reports import results and switches back to the local server", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 서버 (remote.example)" }));
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    expect(await screen.findByText("가져오기 완료 3개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 전환" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "link.use_local" })); store.dispose();
  });
  it("가져오는 동안 누른 서버 단추 자리에 진행 표시를 둔다", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" });
    const original = transport.call.bind(transport);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(transport, "call").mockImplementation((async (request) => {
      if (request.op === "link.sync_local_to_remote") await waiting;
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 서버 (remote.example)" }));
    const button = screen.getByRole("button", { name: "가져오기" });
    fireEvent.click(button);
    expect(button.classList.contains("is-progress")).toBe(true);
    expect(button.querySelector(".ks-button-progress")).toBeTruthy();
    await act(async () => release());
    store.dispose();
  });
  it("shows offline state and disables importing until reconnected", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "offline", mode: "remote", server_url: "https://remote.example", device_name: "집", reason: { id: "CONN_EVENTS_SEND_FAILED", code: "server", message: "연결 끊김", details: ["host=remote.example"] } });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "원격 오프라인" }));
    expect(screen.getByText("연결 끊김")).toBeTruthy();
    expect(screen.getByText("CONN_EVENTS_SEND_FAILED")).toBeTruthy();
    expect(screen.queryByText("host=remote.example")).toBeNull();
    expect((screen.getByRole("button", { name: "가져오기" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("region", { name: "설정" }), { key: "Escape" });
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("system-window-settings")).getByRole("button", { name: "창 닫기" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "원격 오프라인" })); store.dispose();
  });
  it("톱니와 창 닫기로 설정을 열고 닫으며 초점을 되돌린다", async () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    render(<Shell store={store} />); await store.ready;
    const gear = screen.getByRole("button", { name: "설정" });
    fireEvent.click(gear);
    expect(document.activeElement).toBe(screen.getByTestId("system-window-settings").querySelector(".ks-window-content"));
    expect(document.querySelector(".app-root")?.hasAttribute("data-settings-open")).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("system-window-settings")).getByRole("button", { name: "창 닫기" }));
    expect(screen.queryByRole("region", { name: "설정" })).toBeNull();
    expect(document.activeElement).toBe(gear);
    store.dispose();
  });
  it.each([
    [{ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" } as const, "연결 취소", "link.cancel"],
    [{ state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "집" } as const, "연결 끊기", "link.unlink"],
  ])("내 PC 서버가 없을 때 기존 원격 연결 조작을 유지한다", async (link, label, op) => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = false;
    const transport = createFakeTransport(seed); transport.setLink(link);
    const spy = vi.spyOn(transport, "call");
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op }));
    store.dispose();
  });
  it("열린 설정에서 서버 단추는 서버 구역에 초점을 옮기고 데스크톱 선택은 설정을 닫는다", async () => {
    const seed = makeTestSeed(); seed.snapshot.embedded_available = true;
    const transport = createFakeTransport(seed);
    transport.setLink({ state: "connected", mode: "embedded", server_url: "http://127.0.0.1:4219", device_name: "내 PC" });
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const desktop = screen.getByRole("button", { name: "Desktop" });
    expect(desktop.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "원격 서버 주소" }));
    fireEvent.click(desktop);
    expect(screen.getByRole("region", { name: "설정" })).toBeTruthy();
    expect(desktop.getAttribute("aria-pressed")).toBe("true");
    store.dispose();
  });
  it("연결 후 작업이 생겨도 설정을 연 단추로 초점을 돌린다", async () => {
    const seed = makeTestSeed();
    const next = makeTestSnapshot();
    seed.snapshot.shared.workspaces = []; seed.snapshot.shared.desktops = []; seed.snapshot.shared.windows = [];
    const transport = createFakeTransport(seed);
    const store = createShellStore(transport); render(<Shell store={store} />); await store.ready;
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const current = store.getSnapshot()!;
    transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, workspaces: next.shared.workspaces, desktops: next.shared.desktops }, device: next.device } });
    await waitFor(() => expect(screen.getByRole("button", { name: "데스크톱 추가" })).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("system-window-settings")).getByRole("button", { name: "창 닫기" }));
    expect(document.activeElement).toBe(within(document.querySelector(".ks-shell-bar") as HTMLElement).getByRole("button", { name: "설정" }));
    store.dispose();
  });
});
