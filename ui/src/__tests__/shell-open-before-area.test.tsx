import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("데스크톱 크기를 재기 전에 온 앱 열기 요청은 크기를 잰 뒤에 창을 연다", async () => {
  const observers: { target: Element; callback: ResizeObserverCallback }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) { observers.push({ target, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });

  const snapshot = makeTestSnapshot();
  snapshot.shared.windows = snapshot.shared.windows.filter((window) => window.app_id !== "md-viewer");
  const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;

  transport.emit({ event: "app.open_requested", app_id: "md-viewer" });
  await act(async () => { await Promise.resolve(); });
  expect(openRequests(calls)).toHaveLength(0);

  await act(async () => {
    for (const { target, callback } of observers) {
      if (!(target instanceof Element) || !target.classList.contains("ks-desktop-area")) continue;
      callback([{ target, contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], {} as ResizeObserver);
    }
  });

  await waitFor(() => expect(openRequests(calls)).toHaveLength(1));
  const request = openRequests(calls)[0][0] as { rect: { x: number; y: number; width: number; height: number } };
  expect(request.rect.x).toBe(80);
  expect(request.rect.y).toBe(80);
  expect(request.rect.width).toBeGreaterThanOrEqual(360);
  expect(request.rect.height).toBeGreaterThanOrEqual(240);
  store.dispose();
});

function openRequests(calls: { mock: { calls: readonly unknown[][] } }) {
  return calls.mock.calls.filter(([request]) => (request as { op?: string } | undefined)?.op === "window.open");
}
