import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowFrame } from "../../../app/src/shell/window-frame";
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

    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar");
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

    const title = screen.getByText("Markdown 편집기").closest(".ks-window-titlebar");
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

    await importAppDefinition(store, "desktop-1", JSON.stringify(mdViewerDefinition));

    expect(calls).toEqual([
      { op: "app.import", definition_json: JSON.stringify(mdViewerDefinition) },
      { op: "window.open", desktop_id: "desktop-1", app_id: "md-viewer" },
    ]);
  });

  it("keeps an already open app window instead of opening a duplicate", async () => {
    const snapshot = makeTestSnapshot();
    const calls: CoreRequest[] = [];

    await importAppDefinition(makeStore(snapshot, calls), "desktop-1", JSON.stringify(mdViewerDefinition));

    expect(calls).toEqual([{ op: "app.import", definition_json: JSON.stringify(mdViewerDefinition) }]);
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
