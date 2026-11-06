import { describe, expect, it } from "vitest";
import { AppIcon, svgUsesCurrentColor } from "../components/app-icon";
import { IconTileSkeleton } from "../components/icon-tile";

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

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("창 아이콘을 불러오는 동안 14px 뼈대를 보여 주고 격자 뼈대는 32px을 유지한다", async () => {
    const snapshot = makeTestSnapshot({ definitions: [{ ...mdViewerDefinition, icon: { asset: "logo", version: 1 } }] });
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) =>
      request.op === "app.icon" ? new Promise(() => {}) : original(request)) as typeof transport.call);
    const store = createShellStore(transport);
    await store.ready;
    const { container } = render(<><AppIcon store={store} appId={snapshot.shared.app_versions[0].app_id} appVersion={1} size="chrome" placeholder="skeleton" /><IconTileSkeleton count={1} /></>);
    const skeletons = container.querySelectorAll<HTMLElement>(".ks-icon-skeleton-icon");
    expect(skeletons).toHaveLength(2);
    expect(skeletons[0].classList.contains("ks-icon-skeleton-chrome")).toBe(true);
    expect(skeletons[0].style.width).toBe("14px");
    expect(skeletons[0].style.height).toBe("14px");
    expect(skeletons[0].style.flexShrink).toBe("0");
    expect(skeletons[1].style.width).toBe("32px");
    expect(skeletons[1].style.height).toBe("32px");
    expect(container.querySelector("svg.ks-app-icon")).toBeNull();
    store.dispose();
  });
  it("창은 최신 앱 판 대신 자기 판의 아이콘을 요청한다", async () => {
    const snapshot = makeTestSnapshot({ definitions: [{ ...mdViewerDefinition, icon: { asset: "old-logo", version: 1 } }] });
    const version = snapshot.shared.app_versions[0];
    snapshot.shared.app_versions.push({ ...version, version: 2, definition: { ...version.definition, icon: { asset: "new-logo", version: 1 } } });
    snapshot.shared.apps[0].current_version = 2;
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    const calls = vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) =>
      request.op === "app.icon" ? Promise.resolve({ op: "app.icon", media: { mime: "image/png", data_base64: request.app_version === 1 ? "AQ==" : "Ag==", width: null, height: null } }) : original(request)) as typeof transport.call);
    const store = createShellStore(transport);
    render(<AppIcon store={store} appId={version.app_id} appVersion={1} size="chrome" />);
    await waitFor(() => expect(document.querySelector("img.ks-app-icon")?.getAttribute("src")).toBe("data:image/png;base64,AQ=="));
    expect(calls.mock.calls.filter(([request]) => request.op === "app.icon")).toEqual([[{ op: "app.icon", app_id: version.app_id, app_version: 1 }]]);
    store.dispose();
  });
  it("서버 전환과 연결 해제는 Promise 캐시를 비우고 오프라인 전환은 보존한다", async () => {
    const snapshot = makeTestSnapshot();
    snapshot.link = { state: "connected", mode: "remote", server_url: "https://first.test", device_name: "PC" };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const store = createShellStore(transport);
    await store.ready;
    store.iconCache.set("logo", Promise.resolve(null));
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, link: { ...snapshot.link, state: "offline", reason: null } } });
    expect(store.iconCache.size).toBe(1);
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, link: { ...snapshot.link, server_url: "https://second.test" } } });
    expect(store.iconCache.size).toBe(0);
    store.iconCache.set("logo", Promise.resolve(null));
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, link: { state: "unlinked" } } });
    expect(store.iconCache.size).toBe(0);
    store.dispose();
  });
  it("닫힌 런처는 요청하지 않고 같은 자산 요청을 창과 합치며 서버별로 나눈다", async () => {
    const app = { ...mdViewerDefinition, icon: { asset: "logo", version: 1 } };
    const snapshot = makeTestSnapshot({ definitions: [app] });
    const window = snapshot.shared.windows[0];
    snapshot.shared.windows = [];
    snapshot.link = { state: "connected", mode: "remote", server_url: "https://first.test", device_name: "PC" };
    const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
    const original = transport.call.bind(transport);
    let complete!: (reply: { op: "app.icon"; media: { mime: string; data_base64: string; width: null; height: null } }) => void;
    const pending = new Promise<{ op: "app.icon"; media: { mime: string; data_base64: string; width: null; height: null } }>((resolve) => { complete = resolve; });
    const calls = vi.spyOn(transport, "call").mockImplementation(((request: Parameters<typeof original>[0]) => {
      if (request.op === "app.icon") return pending;
      return original(request);
    }) as typeof transport.call);
    const store = createShellStore(transport);
    render(<Shell store={store} />);
    await store.ready;
    await waitFor(() => expect(document.querySelector(".ks-shell-actions")).not.toBeNull());
    const launcher = within(document.querySelector(".ks-taskbar") as HTMLElement).getByRole("button", { name: "앱 열기" });
    const iconCalls = () => calls.mock.calls.filter(([request]) => request.op === "app.icon");
    expect(iconCalls()).toHaveLength(0);
    fireEvent.click(launcher);
    await waitFor(() => expect(iconCalls()).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "앱 열기" }).querySelector(".ks-icon-skeleton-icon")).not.toBeNull();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] } } });
    await screen.findByTestId("app-window-md-viewer");
    expect(screen.getByTestId("app-window-md-viewer").querySelector(".ks-window-titlebar .ks-icon-skeleton-chrome")).not.toBeNull();
    expect(iconCalls()).toHaveLength(1);
    complete({ op: "app.icon", media: { mime: "image/png", data_base64: "AA==", width: null, height: null } });
    await waitFor(() => expect(document.querySelectorAll("img.ks-app-icon")).toHaveLength(3));
    expect(screen.getByRole("dialog", { name: "앱 열기" }).querySelector(".ks-icon-skeleton-icon")).toBeNull();
    transport.emit({ event: "state.changed", snapshot: { ...snapshot, shared: { ...snapshot.shared, windows: [window] }, link: { state: "connected", mode: "remote", server_url: "https://second.test", device_name: "PC" } } });
    await waitFor(() => expect(iconCalls()).toHaveLength(2));
    store.dispose();
  });
});
