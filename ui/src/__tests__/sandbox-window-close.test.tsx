import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { registerSandboxFlush } from "../blocks/sandbox-flush";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
}

afterEach(() => cleanup());

it("샌드박스 저장이 실패하면 닫지 않고 성공할 때까지 기다린다", async () => {
  const transport = createFakeTransport(makeTestSeed());
  const store = createShellStore(transport);
  let finish: ((ok: boolean) => void) | undefined;
  let attempts = 0;
  const unregister = registerSandboxFlush("editor-window", () => ++attempts === 1 ? Promise.resolve(false) : new Promise((resolve) => { finish = resolve; }));
  render(<Shell store={store} />);
  await store.ready;
  const window = screen.getByTestId("app-window-md-editor");
  fireEvent.click(within(window).getByRole("button", { name: "창 닫기" }));
  await screen.findByText("저장하지 못한 내용이 있어 창을 닫지 않았습니다");
  expect(transport.getCalls().some((call) => call.op === "window.close")).toBe(false);
  fireEvent.click(within(window).getByRole("button", { name: "창 닫기" }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(transport.getCalls().some((call) => call.op === "window.close")).toBe(false);
  finish!(true);
  await waitFor(() => expect(transport.getCalls()).toContainEqual({ op: "window.close", window_id: "editor-window" }));
  unregister(); store.dispose();
});
