import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, StorageEntryDecl } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { WindowDataProvider, useWindowData, type WindowData } from "../data/window-data";
import { WindowNotice } from "../data/window-notice";
import { AppSettings } from "../settings/app-settings";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(entry: StorageEntryDecl, stored?: JsonValue) {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text", value: "본문" }, storage: { entries: [entry] } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport({ ...seed, storage: stored === undefined ? [] : [{ window_id: "editor-window", entry: entry.id, content: stored }] });
  const original = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  const view = render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited />);
  return { spy, original, store, view };
}
const entry = (schema: StorageEntryDecl["schema"], value: JsonValue): StorageEntryDecl => ({ id: "option", key: "option", label: "선택", kind: "json", schema, default: value, presentation: "settings" });

it("일반 boolean은 토글이고 nullable boolean은 세 값을 선택하며 null을 저장한다", async () => {
  const user = userEvent.setup();
  const view = setup(entry({ type: "boolean" }, false));
  await user.click(await screen.findByRole("switch", { name: "선택" }));
  await waitFor(() => expect(view.spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: true })));
  cleanup();
  const next = setup(entry({ type: ["boolean", "null"] }, null));
  const button = await screen.findByRole("button", { name: "선택" });
  expect(button.textContent).toContain("지정 안 함");
  await user.click(button);
  expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["켬", "끔", "지정 안 함✓"]);
  await user.click(screen.getByRole("menuitem", { name: "켬" }));
  await waitFor(() => expect(next.spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: true })));
  await user.click(button);
  await user.click(screen.getByRole("menuitem", { name: "지정 안 함" }));
  await waitFor(() => expect(next.spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: null })));
});

it("숫자 enum은 숫자를 저장하고 enum에 없는 null을 선택지에 더하지 않는다", async () => {
  const { spy } = setup(entry({ type: ["number", "null"], enum: [1, 2.5] }, 1));
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "선택" });
  await user.click(button);
  expect(screen.queryByRole("menuitem", { name: "지정 안 함" })).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: "2.5" }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: 2.5 })));
});

it("boolean과 문자열 enum은 원래 타입과 null을 유지한다", async () => {
  const user = userEvent.setup();
  const { spy } = setup(entry({ type: ["boolean", "null"], enum: [false, null] }, null));
  const button = await screen.findByRole("button", { name: "선택" });
  await user.click(button);
  expect(screen.queryByRole("menuitem", { name: "켬" })).toBeNull();
  await user.click(screen.getByRole("menuitem", { name: "끔" }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: false })));
  cleanup();
  const strings = setup(entry({ type: "string", enum: ["하나", "둘"] }, "하나"));
  await user.click(await screen.findByRole("button", { name: "선택" }));
  await user.click(screen.getByRole("menuitem", { name: "둘" }));
  await waitFor(() => expect(strings.spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: "둘" })));
});

it("choices는 enum보다 우선하고 사라진 현재 값을 메뉴 맨 앞에 유지한다", async () => {
  const item = { ...entry({ type: "string", enum: ["옛 값", "enum"] }, "옛 값"), choices: ["새 값"] };
  setup(item, "옛 값");
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "선택" });
  expect(button.textContent).toContain("옛 값");
  await user.click(button);
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["옛 값✓", "새 값"]);
});

it("목록 저장 검사가 실패하면 각 조작과 오류를 연결한다", async () => {
  const { spy, original } = setup(entry({ type: "array", items: { type: "string" } }, ["하나"]));
  spy.mockImplementation(async (request) => {
    if (request.op === "storage.write") throw { code: "invalid_request", message: "값을 입력해 주세요", details: [] };
    return original(request);
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "하나 삭제" }));
  const error = await screen.findByRole("alert");
  const add = screen.getByRole("textbox", { name: "선택 추가" });
  expect(add.getAttribute("aria-invalid")).toBe("true");
  expect(add.getAttribute("aria-describedby")).toBe(error.parentElement?.id);
});

it("설정을 닫으면 저장 오류와 코드가 창 알림에 남는다", async () => {
  const { spy, original, store, view } = setup(entry({ type: "boolean" }, false));
  spy.mockImplementation(async (request) => {
    if (request.op === "storage.write") throw { id: "STORAGE_WRITE_SCHEMA_MISMATCH", code: "invalid_request", message: "저장 오류", details: [] };
    return original(request);
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("switch", { name: "선택" }));
  await screen.findByText("STORAGE_WRITE_SCHEMA_MISMATCH");
  view.rerender(<AppWindowContent store={store} windowId="editor-window" settingsOpen={false} settingsVisited />);
  await waitFor(() => expect(view.container.querySelector(".ks-data-window-notice")?.textContent).toContain("STORAGE_WRITE_SCHEMA_MISMATCH"));
  expect(view.container.querySelectorAll(".ks-data-window-notice .ks-notice")).toHaveLength(1);
  view.rerender(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited />);
  spy.mockImplementation((request) => original(request));
  await user.click(await screen.findByRole("switch", { name: "선택" }));
  await waitFor(() => expect(view.container.querySelector(".ks-data-window-notice")?.textContent).not.toContain("STORAGE_WRITE_SCHEMA_MISMATCH"));
});

it("설정 오류가 남은 뒤 다른 창 알림이 오면 설정을 닫거나 오류를 해결해도 새 알림을 유지한다", async () => {
  const item = entry({ type: "boolean" }, false);
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text", value: "본문" }, storage: { entries: [item] } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "storage.write") throw { id: "STORAGE_WRITE_SCHEMA_MISMATCH", code: "invalid_request", message: "저장 오류", details: [] };
    return original(request);
  });
  const store = createShellStore(transport);
  await store.ready;
  const window = seed.snapshot.shared.windows.find((candidate) => candidate.id === "editor-window")!;
  const context = { store, window, definition };
  let data: WindowData;
  function Probe() { data = useWindowData(); return null; }
  function View({ open }: { open: boolean }) {
    return <WindowDataProvider store={store} windowId={window.id} definition={definition}>
      <Probe /><AppSettings context={context} open={open} onClose={() => undefined} /><div data-testid="window-notice"><WindowNotice /></div>
    </WindowDataProvider>;
  }
  const view = render(<View open />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("switch", { name: "선택" }));
  await screen.findByText("STORAGE_WRITE_SCHEMA_MISMATCH");
  view.rerender(<View open={false} />);
  await waitFor(() => expect(within(screen.getByTestId("window-notice")).getByText("STORAGE_WRITE_SCHEMA_MISMATCH")).toBeTruthy());

  view.rerender(<View open />);
  act(() => data.setStatus("상태 안내"));
  view.rerender(<View open={false} />);
  expect(screen.getByRole("status").textContent).toContain("상태 안내");

  view.rerender(<View open />);
  act(() => data.failClient({ id: "SHELL_CLIENT_FAILED", code: "server", message: "앱 실행 오류", details: [] }));
  view.rerender(<View open={false} />);
  expect(screen.getByText("앱 실행 오류")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();

  view.rerender(<View open />);
  spy.mockImplementation((request) => original(request));
  await user.click(await screen.findByRole("switch", { name: "선택" }));
  await waitFor(() => expect(within(view.container.querySelector(".ks-app-settings") as HTMLElement).queryByText("STORAGE_WRITE_SCHEMA_MISMATCH")).toBeNull());
  expect(screen.getByText("앱 실행 오류")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
  store.dispose();
});
