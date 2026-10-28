import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowFrame } from "../../../app/src/shell/window-frame";
import { makeNewWindowRect } from "../../../app/src/shell/window-geometry";
import { importAppDefinition } from "../../../app/src/shell/import-definition";
import type { AppWindow, CoreRequest, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot, mdViewerDefinition } from "./fixtures";

afterEach(() => {
  cleanup();
});

if (!window.PointerEvent) {
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: window.MouseEvent });
}

describe("window dragging", () => {
  it("clamps only the drawn rectangle to a small desktop", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    appWindow.rect = { x: 48, y: 48, width: 880, height: 600 };
    const savedRect = { ...appWindow.rect };
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={vi.fn() as ShellStore["call"]}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const frame = screen.getByTestId("app-window-md-editor") as HTMLElement;
    expect(frame.style.top).toBe("0px");
    expect(frame.style.width).toBe("880px");
    expect(frame.style.height).toBe("552px");
    expect(appWindow.rect).toEqual(savedRect);
  });

  it("reserves the bottom handle area when the drawn window reaches the desktop edge", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    appWindow.rect = { x: 48, y: 0, width: 640, height: 600 };
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={vi.fn() as ShellStore["call"]}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    expect(screen.getByTestId("app-window-md-editor").className).toContain("ks-window-bottom-edge");
  });

  it("keeps a dragged window within the desktop bottom edge", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    appWindow.rect = { x: 48, y: 0, width: 640, height: 480 };
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window: appWindow });
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar") as HTMLElement;
    title.style.setProperty("--ks-control-height", "32px");
    title.style.setProperty("--ks-window-visible-width", "64px");
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 10, clientY: 510 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 10, clientY: 510 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { ...appWindow.rect, x: 48, y: 72 },
    });
  });

  it("limits a resized window height to the desktop bottom edge", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    appWindow.rect = { x: 48, y: 0, width: 640, height: 480 };
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window: appWindow });
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const edge = document.querySelector(".ks-window-resize-south") as HTMLElement;
    fireEvent.pointerDown(edge, { pointerId: 2, clientX: 300, clientY: 480 });
    fireEvent.pointerMove(edge, { pointerId: 2, clientX: 300, clientY: 600 });
    fireEvent.pointerUp(edge, { pointerId: 2, clientX: 300, clientY: 600 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { ...appWindow.rect, height: 552 },
    });
  });

  it("writes the final rectangle once, on pointer release", () => {
    const window = makeTestSnapshot().shared.windows[0] as AppWindow;
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window });
    render(
      <WindowFrame
        area={{ width: 1000, height: 800 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall}
        window={window}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar") as HTMLElement | null;
    if (!title) throw new Error("창 제목 줄을 찾지 못했습니다");
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 35, clientY: 40 });
    expect(onCall).not.toHaveBeenCalled();

    fireEvent.pointerUp(title, { pointerId: 1, clientX: 35, clientY: 40 });

    expect(onCall).toHaveBeenCalledOnce();
    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: window.id,
      rect: { ...window.rect, x: window.rect.x + 25, y: window.rect.y + 30 },
    });
  });

  it("keeps the saved and displayed rectangle at the horizontal visibility limit", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    const onCall = vi.fn(async (request: CoreRequest) => {
      if (request.op === "window.set_rect") Object.assign(appWindow.rect, request.rect);
      return { op: request.op };
    });
    render(
      <WindowFrame
        area={{ width: 1000, height: 800 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall as ShellStore["call"]}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar") as HTMLElement | null;
    if (!title) throw new Error("창 제목 줄을 찾지 못했습니다");
    title.style.setProperty("--ks-control-height", "32px");
    title.style.setProperty("--ks-window-visible-width", "64px");
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 1010, clientY: 10 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 1010, clientY: 10 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { ...appWindow.rect, x: 936, y: 0 },
    });
    expect((screen.getByTestId("app-window-md-editor") as HTMLElement).style.left).toBe("936px");
  });
});

describe("app definition import", () => {
  it("opens an imported app only when the active desktop has no window for it", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
    const calls: CoreRequest[] = [];
    const store = makeStore(snapshot, calls);

    const rect = { x: 48, y: 48, width: 880, height: 480 };
    await importAppDefinition(store, "desktop-1", JSON.stringify(mdViewerDefinition), rect);

    expect(calls).toEqual([
      { op: "app.import", definition_json: JSON.stringify(mdViewerDefinition) },
      { op: "window.open", desktop_id: "desktop-1", app_id: "md-viewer", rect },
    ]);
  });

  it("keeps an already open app window instead of opening a duplicate", async () => {
    const snapshot = makeTestSnapshot();
    const calls: CoreRequest[] = [];

    await importAppDefinition(makeStore(snapshot, calls), "desktop-1", JSON.stringify(mdViewerDefinition), {
      x: 48,
      y: 48,
      width: 880,
      height: 480,
    });

    expect(calls).toEqual([{ op: "app.import", definition_json: JSON.stringify(mdViewerDefinition) }]);
  });

  it("stacks new windows in the desktop area and keeps the minimum size", () => {
    expect(makeNewWindowRect({ width: 960, height: 552 }, 0, 360, 240)).toEqual({
      x: 48,
      y: 48,
      width: 880,
      height: 480,
    });
    expect(makeNewWindowRect({ width: 500, height: 300 }, 8, 360, 240)).toEqual({
      x: 48,
      y: 48,
      width: 428,
      height: 240,
    });
  });
});

function makeStore(snapshot: ShellSnapshot, calls: CoreRequest[]): ShellStore {
  return {
    call: vi.fn(async (request: CoreRequest) => {
      calls.push(request);
      if (request.op === "app.import") return { op: "app.import", app: { id: "md-viewer" } };
      return { op: "window.open", window: {} };
    }),
    getSnapshot: () => snapshot,
    getError: () => null,
    subscribe: () => () => undefined,
    ready: Promise.resolve(),
    dispose: () => undefined,
  } as unknown as ShellStore;
}
