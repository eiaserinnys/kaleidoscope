import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreReply, CoreRequest, StorageEntryDecl, StorageReadReply } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "../__tests__/fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const entry: StorageEntryDecl = {
  id: "collection", key: "collection", label: "대화 모음", kind: "json",
  schema: { type: ["string", "null"] }, default: null, presentation: "settings",
  choices: [{ value: "collection-1", label: "작업 폴더" }, { value: "collection-2", label: "개인 폴더" }],
};

/** 저장값이 없을 때 코어가 싣는 지금 값(choice)을 흉내 내려고 storage.get 응답에 값을 덧붙인다. */
function setup(choice: string | undefined, stored?: JsonValue) {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text", value: "본문" }, storage: { entries: [entry] } };
  const seed = makeTestSeed({ definitions: [definition] });
  const transport = createFakeTransport({ ...seed, storage: stored === undefined ? [] : [{ window_id: "editor-window", entry: entry.id, content: stored }] });
  const original = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call").mockImplementation(async (request: CoreRequest): Promise<CoreReply> => {
    const reply = await original(request);
    if (request.op === "storage.get") return { op: "storage.get", result: { ...(reply as { result: StorageReadReply }).result, ...(choice === undefined ? {} : { choice }) } };
    return reply;
  });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited />);
  return { spy };
}

it("저장값이 없으면 모든 대화가 같은 모음일 때 그 모음을 선택지 이름으로 보이고 기본값이라 하지 않는다", async () => {
  const { spy } = setup("collection-1");
  const button = await screen.findByRole("button", { name: "대화 모음" });
  expect(button.textContent).toContain("작업 폴더");
  expect(screen.getByText("지금 대화 기준")).toBeTruthy();
  expect(screen.queryByText("기본값")).toBeNull();
  expect(spy.mock.calls.filter(([request]) => request.op === "storage.write")).toHaveLength(0);
});

it("지금 모음을 알 수 없으면 지금까지처럼 기본값으로 보인다", async () => {
  setup(undefined);
  const button = await screen.findByRole("button", { name: "대화 모음" });
  expect(button.textContent).toContain("지정 안 함");
  expect(screen.getByText("기본값")).toBeTruthy();
  expect(screen.queryByText("지금 대화 기준")).toBeNull();
});

it("저장값이 있으면 저장된 값을 보이고 지금 값 표시를 쓰지 않는다", async () => {
  setup("collection-1", "collection-2");
  const button = await screen.findByRole("button", { name: "대화 모음" });
  expect(button.textContent).toContain("개인 폴더");
  expect(screen.queryByText("지금 대화 기준")).toBeNull();
});

it("지금 값이 보이는 상태에서 다른 모음을 고르면 그 값을 저장한다", async () => {
  const { spy } = setup("collection-1");
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "대화 모음" });
  await user.click(button);
  await user.click(screen.getByRole("menuitem", { name: "개인 폴더" }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: "storage.write", content: "collection-2" })));
});
