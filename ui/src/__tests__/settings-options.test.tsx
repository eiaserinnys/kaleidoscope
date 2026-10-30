import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, StorageEntryDecl } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(entry: StorageEntryDecl, stored?: JsonValue) {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text", value: "본문" }, storage: { entries: [entry] } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport({ ...seed, storage: stored === undefined ? [] : [{ window_id: "editor-window", entry: entry.id, content: stored }] });
  const original = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited />);
  return { spy, original };
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
