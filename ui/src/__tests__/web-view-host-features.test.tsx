import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { WebViewBlock } from "../blocks/web-view";
import { WindowDataProvider } from "../data/window-data";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";

afterEach(cleanup);

it("웹 보기를 쓸 수 없는 호스트는 안내 한 줄만 그리고 웹 화면을 붙이지 않는다", async () => {
  const definition = {
    id: "browser", name: "브라우저", requires: { blocks: 1, modules: {} }, permissions: [], state: {},
    ui: { type: "web_view", url: "https://example.com" },
  } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.host_features = { ...seed.snapshot.host_features, web_view: false };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  await store.ready;
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={definition}>
    <WebViewBlock
      block={{ type: "web_view", url: "https://example.com", address_bar: true }}
      context={{ store, window: { id: "viewer-window", app_id: "browser", app_version: 1, desktop_id: "desktop-1" }, definition }}
    />
  </WindowDataProvider>);
  expect(await screen.findByText("이 기기에서는 웹 보기를 쓸 수 없습니다")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(transport.getCalls().some((call) => call.op === "web.attach")).toBe(false);
  store.dispose();
});
