import { describe, expect, it } from "vitest";
import { svgUsesCurrentColor } from "../components/app-icon";

describe("앱 아이콘 SVG 표시 방식", () => {
  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor"><path d="M0 0"/></svg>', true],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0"/></svg>', true],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path style="fill: none; stroke: currentColor" d="M0 0"/></svg>', true],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path fill="#f00" stroke="currentColor" d="M0 0"/></svg>', false],
    ['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', false],
    ['<svg xmlns="http://www.w3.org/2000/svg"><style>path { fill: currentColor }</style><path d="M0 0"/></svg>', false],
    ['<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><path fill="url(#g)"/></svg>', false],
  ])("SVG의 보이는 색상으로 mask 여부를 고른다", (svg, expected) => {
    expect(svgUsesCurrentColor(svg)).toBe(expected);
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, makeTestSnapshot, mdViewerDefinition } from "./fixtures";

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

afterEach(cleanup);

describe("쉘 앱 아이콘", () => {
  it("닫힌 런처는 요청하지 않고 같은 자산 요청을 창과 합치며 서버별로 나눈다", async () => {
    const app = { ...mdViewerDefinition, icon: { asset: "logo", version: 1 } };
    const snapshot = makeTestSnapshot({ definitions: [app] });
    const window = snapshot.shared.windows[0];
    snapshot.shared.windows = [];
    snapshot.link = { state: "connected", mode: "remote", server_url: "https://first.test", device_name: "PC" };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    const calls = vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
      if (request.op === "app.icon") return Promise.resolve({ op: "app.icon", media: { mime: "image/png", data_base64: "AA==", width: null, height: null } });
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    await screen.findByRole("button", { name: "앱 열기" });
    const iconCalls = () => calls.mock.calls.filter(([request]) => request.op === "app.icon");
    expect(iconCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "앱 열기" }));
    await waitFor(() => expect(iconCalls()).toHaveLength(1));
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] } } });
    await screen.findByTestId("app-window-md-viewer");
    expect(iconCalls()).toHaveLength(1);
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] }, link: { state: "connected", mode: "remote", server_url: "https://second.test", device_name: "PC" } } });
    await waitFor(() => expect(iconCalls()).toHaveLength(2));
    store.dispose();
  });
});
