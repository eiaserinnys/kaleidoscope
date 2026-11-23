import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

// 쌓기 항목으로 바로 놓인 첨부만 담은 feed의 여백은 이 표지로 켠다(카드 #1729 6절, data-blocks.css).
// 표지는 화면에 그려진 줄이 아니라 자료 전체를 보고 정해야 긴 feed를 굴릴 때 여백이 들락날락하지 않는다.
beforeEach(mockVirtualLayout);
afterEach(cleanup);

function setup(ui: Block) {
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 12, modules: {} }, permissions: [], state: {}, ui };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport({ ...seed });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
}

const media = [{ image: { permission: "media", path: "poster.jpg" }, alt: "포스터.jpg" }];

it("본문이 모두 빈칸인 첨부 feed는 여백 표지와 자료의 마지막 줄 표지를 단다", async () => {
  setup({ type: "stack", direction: "column", children: [{ type: "feed", entries: [
    { key: "a", body: "", media },
    { key: "b", body: "   ", media },
  ] }] } as unknown as Block);
  await waitFor(() => expect(document.querySelector(".ks-feed")).toBeTruthy());
  const feed = document.querySelector(".ks-feed")!;
  expect(feed.classList.contains("is-media-only")).toBe(true);
  const rows = [...feed.querySelectorAll("[data-index]")];
  expect(rows.length).toBe(2);
  expect(rows[rows.length - 1].getAttribute("data-last")).toBe("true");
  expect(rows[0].hasAttribute("data-last")).toBe(false);
});

it("본문이 있는 feed에는 여백 표지를 달지 않는다", async () => {
  setup({ type: "feed", entries: [{ key: "a", body: "본문", media }] } as unknown as Block);
  await waitFor(() => expect(document.querySelector(".ks-feed")).toBeTruthy());
  expect(document.querySelector(".ks-feed")!.classList.contains("is-media-only")).toBe(false);
});

it("media가 없는 feed에는 여백 표지를 달지 않는다", async () => {
  setup({ type: "feed", entries: [{ key: "a", body: "" }] } as unknown as Block);
  await waitFor(() => expect(document.querySelector(".ks-feed")).toBeTruthy());
  expect(document.querySelector(".ks-feed")!.classList.contains("is-media-only")).toBe(false);
});
