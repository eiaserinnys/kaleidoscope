import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { Shell } from "../../../app/src/shell/shell";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";

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

if (!window.PointerEvent) {
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: window.MouseEvent });
}

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function probe(id: string, name: string): AppDefinition {
  return {
    id, name, requires: { blocks: 35, modules: {} }, permissions: [], state: { text: "abcdef" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", label: `${name} 입력`, value: { state: "text" }, on_change: { set_state: "text" } },
      { type: "button", label: `${name} 단추` },
    ] } as AppDefinition["ui"],
  };
}

function probeSeed() {
  const snapshot = makeTestSnapshot({ definitions: [probe("probe-a", "가"), probe("probe-b", "나")] });
  snapshot.shared.windows[0].id = "probe-a-window";
  snapshot.shared.windows[0].z = 2;
  snapshot.shared.windows[1].id = "probe-b-window";
  snapshot.shared.windows[1].z = 1;
  return { snapshot, seed: { ...makeTestSeed(), snapshot } };
}

function titlebarOf(testId: string): HTMLElement {
  const titlebar = screen.getByTestId(testId).querySelector(".ks-window-titlebar");
  if (!(titlebar instanceof HTMLElement)) throw new Error("창 제목 줄을 찾지 못했습니다");
  return titlebar;
}

it("다른 창 머리를 누르면 가려진 창의 입력칸에서 초점을 거두고 그 창이 받는다", async () => {
  const { seed } = probeSeed();
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(2, 2);

  fireEvent.pointerDown(titlebarOf("app-window-probe-b"), { button: 0 });

  expect(document.activeElement).not.toBe(input);
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-b-window" }));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));

  fireEvent.keyDown(window, { code: "PageDown", key: "PageDown", ctrlKey: true, altKey: true });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-a-window" }));
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(2);
  store.dispose();
});

it("Ctrl+Alt+PageDown도 가려진 창의 입력칸에서 초점을 거두고 다음 창이 받는다", async () => {
  const { seed } = probeSeed();
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();

  fireEvent.keyDown(window, { code: "PageDown", key: "PageDown", ctrlKey: true, altKey: true });

  expect(document.activeElement).not.toBe(input);
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-b-window" }));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));
  store.dispose();
});

it("창이 하나뿐이면 창 전환 단축키가 초점을 건드리지 않는다", async () => {
  const { snapshot, seed } = probeSeed();
  snapshot.shared.windows = [snapshot.shared.windows[0]];
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();

  fireEvent.keyDown(window, { code: "PageDown", key: "PageDown", ctrlKey: true, altKey: true });

  expect(document.activeElement).toBe(input);
  expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ op: "window.raise" }));
  store.dispose();
});

it("맨 위 창 자기 머리를 눌러도 초점을 거두지 않고 끌기는 그대로다", async () => {
  const { seed } = probeSeed();
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();
  const titlebar = titlebarOf("app-window-probe-a");

  fireEvent.pointerDown(titlebar, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(document.activeElement).toBe(input);
  fireEvent.pointerMove(titlebar, { pointerId: 1, clientX: 140, clientY: 130 });
  fireEvent.pointerUp(titlebar, { pointerId: 1, clientX: 140, clientY: 130 });

  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "window.set_rect", window_id: "probe-a-window" })));
  expect(document.activeElement).toBe(input);
  store.dispose();
});

it("초점이 이미 그 창 안에 있으면 머리를 눌러 올려도 거두지 않는다", async () => {
  const { seed } = probeSeed();
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "나 입력" }) as HTMLInputElement;
  input.focus();

  fireEvent.pointerDown(titlebarOf("app-window-probe-b"), { button: 0 });

  expect(document.activeElement).toBe(input);
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").classList.contains("ks-window")).toBe(true));
  await waitFor(() => expect(document.activeElement).toBe(input));
  store.dispose();
});

it("다른 데스크톱으로 옮기면 그 데스크톱의 맨 위 창이 초점을 받는다", async () => {
  const { snapshot, seed } = probeSeed();
  snapshot.shared.desktops.push({
    id: "desktop-2", workspace_id: "workspace-1", name: "Desktop 2", position: 1,
    created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z",
  });
  snapshot.shared.windows[1].desktop_id = "desktop-2";
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();

  fireEvent.keyDown(window, { code: "ArrowRight", key: "ArrowRight", ctrlKey: true, altKey: true });

  expect(document.activeElement).not.toBe(input);
  await waitFor(() => expect(store.getSnapshot()?.device.active_desktop_ids["workspace-1"]).toBe("desktop-2"));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));
  store.dispose();
});

it("에이전트가 연 창은 입력 중인 초점과 커서를 빼앗지 않는다", async () => {
  const { snapshot, seed } = probeSeed();
  const editor = snapshot.shared.windows[0];
  const opened = { ...snapshot.shared.windows[1], id: "probe-b-window", z: 3 };
  snapshot.shared.windows = [editor];
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
    if (request.op === "window.open") {
      transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [editor, opened] } } });
      return Promise.resolve({ op: "window.open", window: opened });
    }
    return original(request);
  }) as typeof transport.call);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const input = screen.getByRole("textbox", { name: "가 입력" }) as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 1);

  transport.emit({ event: "app.open_requested", app_id: "probe-b" });

  await waitFor(() => expect(screen.getByTestId("app-window-probe-b")).toBeTruthy());
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(1);
  store.dispose();
});
