import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => { mockVirtualLayout(); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(ui: unknown) {
  const definition = { ...mdViewerDefinition, requires: { blocks: 32, modules: {} }, state: { ...mdViewerDefinition.state, choice: null }, ui: ui as Block } as AppDefinition;
  const transport = createFakeTransport({ ...makeTestSeed({ definitions: [definition] }), media: { "builtin-icon": "data:image/png;base64,iVBORw0KGgo=" } });
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { calls, store };
}

it("피드 첨부와 링크를 조작한다", async () => {
  const { calls } = setup({ type: "feed", on_select: { set_state: "choice" }, entries: [{ key: "a", name: "글쓴이", meta: "시각", body: "본문", media: [{ image: { asset: "builtin-icon" }, alt: "사진", kind: "image" }, { image: { asset: "builtin-icon" }, kind: "video" }, { image: { asset: "builtin-icon" }, kind: "animation" }], link: "https://example.com/post" }] });
  const thumb = await screen.findByRole("button", { name: "사진" });
  expect(screen.getByText("영상")).toBeTruthy();
  expect(screen.getByText("GIF")).toBeTruthy();
  thumb.focus();
  fireEvent.click(thumb);
  await screen.findByRole("dialog", { name: "사진" });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(document.activeElement).toBe(thumb);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
  fireEvent.click(screen.getByRole("link", { name: "시각" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "external.open", window_id: "viewer-window", url: "https://example.com/post" }));
  expect(fireEvent(screen.getByRole("link", { name: "시각" }), new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }))).toBe(false);
  await waitFor(() => expect(calls.mock.calls.filter(([request]) => request.op === "external.open")).toHaveLength(2));
});

it.each(["rows", "grid"])("목록 %s의 빼기는 해당 항목으로 동작한다", async (layout) => {
  const { calls, store } = setup({ type: "list", layout, items: [{ key: "a", title: "그림" }], on_remove: { set_state: "choice" } });
  fireEvent.click(await screen.findByRole("button", { name: "그림 빼기" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_remove", event: "a", item: { key: "a", title: "그림" } })));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.choice).toBe("a"));
});

it("고르기 동작이 없는 그림 목록을 누르면 확대하고 초점을 돌려준다", async () => {
  setup({ type: "list", items: [{ key: "a", title: "사진", image: { asset: "builtin-icon" } }] });
  const row = await screen.findByRole("option", { name: "사진" });
  row.focus();
  fireEvent.click(row);
  const dialog = await screen.findByRole("dialog", { name: "사진" });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(document.activeElement).toBe(row);
});
