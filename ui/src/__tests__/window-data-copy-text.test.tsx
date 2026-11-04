import { useState, useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Binding } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { useWindowData, WindowData, WindowDataProvider } from "../data/window-data";
import { makeTestSeed } from "./fixtures";

const originalClipboard = navigator.clipboard;
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function setup(binding: Binding = { expr: "$state.target" }, appFields: Record<string, unknown> = {}) {
  const definition = {
    id: "md-viewer", name: "복사 시험", requires: { blocks: 18, modules: {} }, permissions: [],
    state: { target: "https://example.com/page" },
    ...appFields,
    ui: { type: "button", label: "복사", icon: "copy", on_click: { copy_text: binding } },
  } as unknown as AppDefinition;
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const store = createShellStore(transport);
  function Harness() {
    const data = useWindowData();
    const [result, setResult] = useState("");
    const noticeId = useSyncExternalStore(data.subscribeNotice, data.getNoticeId);
    const notice = useSyncExternalStore(data.subscribeNotice, data.getNotice);
    const scope = { item: { url: "https://example.com/item" }, parent_item: { url: "https://example.com/parent" }, key: "row", index: 0, instance: {} };
    return <><button onClick={async () => setResult(String(await data.act("/ui/on_click", null)))}>실행</button>
      <button onClick={async () => setResult(String(await data.act("/ui/on_click", null, undefined, undefined, scope)))}>항목 실행</button>
      <output data-testid="result">{result}</output><output data-testid="notice">{noticeId ?? ""}</output><output data-testid="notice-text">{notice ?? ""}</output></>;
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

it("비문자열은 SHELL_COPY_TEXT_NOT_TEXT로 알린다", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  const { transport, store } = setup();
  await publishCopyValue(transport, 42);

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("result").textContent).toBe("false");
  expect(screen.getByTestId("notice").textContent).toBe("SHELL_COPY_TEXT_NOT_TEXT");
  store.dispose();
});

it("빈 글은 SHELL_COPY_TEXT_EMPTY로 알린다", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn() } });
  const { transport, store } = setup();
  await publishCopyValue(transport, "");

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(screen.getByTestId("result").textContent).toBe("false");
  expect(screen.getByTestId("notice").textContent).toBe("SHELL_COPY_TEXT_EMPTY");
  expect(screen.getByTestId("notice-text").textContent).toMatch(/^복사: /);
  store.dispose();
});

it("행 메뉴 이름은 알림에 넣고 이름 없는 단축키는 생략한다", async () => {
  const definition = {
    id: "md-viewer", name: "시험", requires: { blocks: 18, modules: {} }, permissions: [], state: {},
    shortcuts: [{ code: "KeyR", modifiers: [], action: { copy_text: "" } }],
    ui: { type: "list", items: [], item_menu: [{ label: "번역", on_select: { copy_text: "" } }] },
  } as unknown as AppDefinition;
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const data = new WindowData(store, "viewer-window", definition);
  await data.act("/ui/item_menu/0/on_select", null);
  expect(data.getNotice()).toMatch(/^번역: /);
  expect(data.getNoticeId()).toBe("SHELL_COPY_TEXT_EMPTY");
  await data.act("/shortcuts/0/action", null);
  expect(data.getNotice()).toMatch(/^복사할 글이 없습니다/);
  store.dispose();
});

it("동작 알림은 번역된 단추 이름을 사용한다", async () => {
  const definition = {
    id: "md-viewer", name: "시험", requires: { blocks: 18, modules: {} }, permissions: [],
    state: { language: "ko" }, locale: { state: "language" }, messages: { ko: { translate: "번역" } },
    ui: { type: "button", label: { message: "translate" }, on_click: { copy_text: "" } },
  } as unknown as AppDefinition;
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const data = new WindowData(store, "viewer-window", definition);
  await data.act("/ui/on_click", null);
  expect(data.getNotice()).toMatch(/^번역: /);
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

it("반복 항목 바인딩은 WindowData.act에서 항목 값을 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { store } = setup({ item: "url" });

  await userEvent.click(screen.getByRole("button", { name: "항목 실행" }));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith("https://example.com/item");
  store.dispose();
});

it("중첩 반복의 부모 항목 바인딩은 WindowData.act에서 부모 값을 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { store } = setup({ parent_item: "url" });

  await userEvent.click(screen.getByRole("button", { name: "항목 실행" }));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith("https://example.com/parent");
  store.dispose();
});

it("message 바인딩은 WindowData.act에서 현재 언어의 글을 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { store } = setup({ message: "share_url" }, {
    state: { target: "https://example.com/page", language: "ko" },
    messages: { ko: { share_url: "공유할 주소" }, en: { share_url: "Share URL" } },
    locale: { state: "language" },
  });

  await userEvent.click(screen.getByRole("button", { name: "실행" }));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith("공유할 주소");
  store.dispose();
});
