import { useState, useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { useWindowData, WindowDataProvider } from "../data/window-data";
import { makeTestSeed } from "./fixtures";

const originalClipboard = navigator.clipboard;
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function setup() {
  const definition = {
    id: "md-viewer", name: "복사 시험", requires: { blocks: 18, modules: {} }, permissions: [],
    state: { target: "https://example.com/page" },
    ui: { type: "button", label: "복사", on_click: { copy_text: { expr: "$state.target" } } },
  } as unknown as AppDefinition;
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const store = createShellStore(transport);
  function Harness() {
    const data = useWindowData();
    const [result, setResult] = useState("");
    const noticeId = useSyncExternalStore(data.subscribeNotice, data.getNoticeId);
    return <><button onClick={async () => setResult(String(await data.act("/ui/on_click", null)))}>실행</button>
      <output data-testid="result">{result}</output><output data-testid="notice">{noticeId ?? ""}</output></>;
  }
  render(<WindowDataProvider store={store} windowId="viewer-window" definition={definition}><Harness /></WindowDataProvider>);
  return { transport, store };
}

async function publishCopyValue(transport: ReturnType<typeof createFakeTransport>, value: unknown) {
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "data.attach")).toBe(true));
  transport.emit({ event: "data.update", window_id: "viewer-window", view: {
    sources: {}, values: { "/ui/on_click/copy_text": { status: "ready", value: value as never } },
  } });
}

it("copy_text는 코어 호출 없이 바인딩 글을 한 번 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { transport, store } = setup();
  await publishCopyValue(transport, "https://example.com/page");

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith("https://example.com/page");
  expect(screen.getByTestId("result").textContent).toBe("true");
  expect(transport.getCalls().filter((call) => call.op === "data.act")).toHaveLength(0);
  store.dispose();
});

it("비문자열은 SHELL_COPY_TEXT_EMPTY로 알린다", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  const { transport, store } = setup();
  await publishCopyValue(transport, 42);

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("result").textContent).toBe("false");
  expect(screen.getByTestId("notice").textContent).toBe("SHELL_COPY_TEXT_EMPTY");
  store.dispose();
});

it("빈 글은 SHELL_COPY_TEXT_EMPTY로 알린다", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  const { transport, store } = setup();
  await publishCopyValue(transport, "");

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("result").textContent).toBe("false");
  expect(screen.getByTestId("notice").textContent).toBe("SHELL_COPY_TEXT_EMPTY");
  store.dispose();
});

it("클립보드 거부는 SHELL_COPY_TEXT_WRITE_FAILED로 알린다", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
  const { transport, store } = setup();
  await publishCopyValue(transport, "https://example.com/page");

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("result").textContent).toBe("false");
  expect(screen.getByTestId("notice").textContent).toBe("SHELL_COPY_TEXT_WRITE_FAILED");
  store.dispose();
});
