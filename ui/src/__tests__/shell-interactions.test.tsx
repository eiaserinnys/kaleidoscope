import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    appWindow.rect = { x: 48, y: 48, width: 1076, height: 700 };
    const savedRect = { ...appWindow.rect };
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window: appWindow });
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall as ShellStore["call"]}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const frame = screen.getByTestId("app-window-md-editor") as HTMLElement;
    expect(frame.style.top).toBe("0px");
    expect(frame.style.left).toBe("0px");
    expect(frame.style.width).toBe("948px");
    expect(frame.style.height).toBe("540px");
    expect(appWindow.rect).toEqual(savedRect);
    expect(onCall).not.toHaveBeenCalled();
  });

  it("saves the complete displayed rectangle when a clamped window is resized", () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    appWindow.rect = { x: 48, y: 48, width: 1076, height: 700 };
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window: appWindow });
    render(
      <WindowFrame
        area={{ width: 960, height: 552 }}
        appName="Markdown 편집기"
        isTop
        onCall={onCall as ShellStore["call"]}
        window={appWindow}
      >
        <div>content</div>
      </WindowFrame>,
    );

    const edge = document.querySelector(".ks-window-resize-south") as HTMLElement;
    fireEvent.pointerDown(edge, { pointerId: 2, clientX: 300, clientY: 540 });
    fireEvent.pointerMove(edge, { pointerId: 2, clientX: 300, clientY: 420 });
    fireEvent.pointerUp(edge, { pointerId: 2, clientX: 300, clientY: 420 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { x: 0, y: 0, width: 948, height: 420 },
    });
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
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 10, clientY: 510 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 10, clientY: 510 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { ...appWindow.rect, x: 48, y: 60 },
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
      rect: { ...appWindow.rect, height: 540 },
    });
  });

  it("writes the final rectangle once, on pointer release", () => {
    const window = makeTestSnapshot().shared.windows[0] as AppWindow;
    const onCall = vi.fn().mockResolvedValue({ op: "window.set_rect", window });
    const view = render(
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
    const frame = screen.getByTestId("app-window-md-editor") as HTMLElement;
    expect(frame.style.left).toBe("25px");
    expect(frame.style.top).toBe("30px");

    fireEvent.pointerUp(title, { pointerId: 1, clientX: 35, clientY: 40 });

    expect(frame.style.left).toBe("25px");
    expect(frame.style.top).toBe("30px");
    expect(onCall).toHaveBeenCalledOnce();
    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: window.id,
      rect: { ...window.rect, x: window.rect.x + 25, y: window.rect.y + 30 },
    });

    const updated = { ...window, rect: { ...window.rect, x: 25, y: 30 } };
    view.rerender(
      <WindowFrame area={{ width: 1000, height: 800 }} appName="Markdown 편집기" isTop onCall={onCall} window={updated}>
        <div>content</div>
      </WindowFrame>,
    );
    view.rerender(
      <WindowFrame area={{ width: 600, height: 400 }} appName="Markdown 편집기" isTop onCall={onCall} window={updated}>
        <div>content</div>
      </WindowFrame>,
    );
    expect(frame.style.left).toBe("0px");
    expect(frame.style.top).toBe("0px");
    expect(frame.style.width).toBe("588px");
    expect(frame.style.height).toBe("388px");
  });

  it("restores the saved rectangle when saving a gesture fails", async () => {
    const appWindow = makeTestSnapshot().shared.windows[0] as AppWindow;
    const onCall = vi.fn().mockResolvedValue(undefined);
    render(
      <WindowFrame area={{ width: 1000, height: 800 }} appName="Markdown 편집기" isTop onCall={onCall} window={appWindow}>
        <div>content</div>
      </WindowFrame>,
    );
    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar") as HTMLElement;
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 35, clientY: 40 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 35, clientY: 40 });
    const frame = screen.getByTestId("app-window-md-editor") as HTMLElement;
    await waitFor(() => expect(frame.style.left).toBe("0px"));
    expect(frame.style.top).toBe("0px");
  });

  it("keeps the whole window inside the desktop when dragged horizontally", () => {
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
    fireEvent.pointerDown(title, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 1010, clientY: 10 });
    fireEvent.pointerUp(title, { pointerId: 1, clientX: 1010, clientY: 10 });

    expect(onCall).toHaveBeenCalledWith({
      op: "window.set_rect",
      window_id: appWindow.id,
      rect: { ...appWindow.rect, x: 988 - appWindow.rect.width, y: 0 },
    });
    expect((screen.getByTestId("app-window-md-editor") as HTMLElement).style.left).toBe(`${988 - appWindow.rect.width}px`);
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

  it("fits and positions new windows inside the usable desktop area", () => {
    expect(makeNewWindowRect({ width: 960, height: 552 }, 0)).toEqual({
      x: 48,
      y: 0,
      width: 880,
      height: 540,
    });
    expect(makeNewWindowRect({ width: 500, height: 300 }, 8)).toEqual({
      x: 0,
      y: 0,
      width: 488,
      height: 288,
    });
    expect(makeNewWindowRect({ width: 1440, height: 852 }, 1)).toEqual({
      x: 80,
      y: 80,
      width: 880,
      height: 600,
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
