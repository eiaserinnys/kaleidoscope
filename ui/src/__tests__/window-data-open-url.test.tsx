import { useState, useSyncExternalStore } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { useWindowData, WindowDataProvider } from "../data/window-data";
import { makeTestSeed } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(binding: unknown) {
  const definition = { id: "open-test", name: "열기", requires: { blocks: 34, modules: {} }, permissions: [], state: {}, ui: { type: "button", label: "열기", icon: "external-link", on_click: { open_url: binding } } } as unknown as AppDefinition;
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  vi.spyOn(window, "open").mockImplementation(() => null);
  const store = createShellStore(transport);
  function Harness() {
    const data = useWindowData();
    const [result, setResult] = useState("");
    const notice = useSyncExternalStore(data.subscribeNotice, data.getNoticeId);
    const scope = { item: { url: "https://example.com/item" }, key: "a", index: 0, instance: {} };
    return <><button onClick={async () => setResult(String(await data.act("/ui/on_click", null, undefined, undefined, scope)))}>실행</button><output data-testid="result">{result}</output><output data-testid="notice">{notice ?? ""}</output></>;
  }
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={definition}><Harness /></WindowDataProvider>);
  return { transport, store };
}

it("항목 주소를 코어 외부 열기 요청으로 보낸다", async () => {
  const { transport, store } = setup({ item: "url" });
  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(transport.getCalls()).toContainEqual({ op: "external.open", window_id: "viewer-window", url: "https://example.com/item" });
  expect(screen.getByTestId("result").textContent).toBe("true");
  store.dispose();
});

it.each([[42, "SHELL_OPEN_URL_NOT_TEXT"], ["", "SHELL_OPEN_URL_EMPTY"]])("잘못된 동작 값 %s를 알린다", async (value, id) => {
  const { store } = setup(value);
  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("notice").textContent).toBe(id);
  store.dispose();
});
