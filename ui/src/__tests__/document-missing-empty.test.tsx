import { act, cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { flushWindowEditors } from "../blocks/file-editor-session";
import type { CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DOC = "없는 메모.md";

function seed() {
  const seed = structuredClone(makeTestSeed());
  const definition = seed.snapshot.shared.app_versions[0].definition;
  definition.storage = {
    entries: [{ id: "memos", key: "memos", kind: "md", collection: true, default: "", label: "메모", presentation: "hidden" }],
  };
  definition.ui = { type: "markdown", document: { entry: "memos", doc: DOC } };
  return seed;
}

function setup(error: { code: string; id: string; message: string; details: string[] }) {
  const transport = createFakeTransport(seed());
  const original = transport.call.bind(transport);
  const calls: CoreRequest[] = [];
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    calls.push(request as CoreRequest);
    if (request.op === "storage.get") throw { ...error };
    return original(request as never) as never;
  });
  const store = createShellStore(transport);
  const { container } = render(<AppWindowContent store={store} windowId="editor-window" />);
  return { transport, calls, store, container };
}

const NOT_FOUND = {
  code: "not_found",
  id: "STORAGE_DOCUMENT_READ_NOT_FOUND",
  message: `저장 문서를 찾을 수 없습니다: ${DOC}. 저장 문서 목록에서 새로 고침을 선택하세요.`,
  details: [],
};

it("문서 모음에 없는 문서를 가리키면 오류 없이 빈 편집기로 열고 쓰지 않는다", async () => {
  const { calls, store, container } = setup(NOT_FOUND);
  await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector(".cm-content")?.textContent).toBe("");
  expect(await flushWindowEditors(["editor-window"])).toBe(true);
  expect(calls.filter((call) => call.op === "storage.write")).toHaveLength(0);
  store.dispose();
});

it("없는 문서를 처음 고치면 expected_revision null로 만든다", async () => {
  const { calls, store, container } = setup(NOT_FOUND);
  await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
  const editor = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
  act(() => editor.dispatch({ changes: { from: 0, insert: "새 메모" } }));
  expect(await flushWindowEditors(["editor-window"])).toBe(true);
  const writes = calls.filter((call) => call.op === "storage.write");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ entry: "memos", doc: DOC, content: "새 메모", expected_revision: null });
  store.dispose();
});

it("다른 읽기 오류는 지금처럼 오류 안내로 보인다", async () => {
  const { store, container } = setup({
    code: "server",
    id: "STORAGE_DOCUMENT_READ_KIND_MISMATCH",
    message: `저장 문서 ${DOC}의 종류가 앱 선언과 다릅니다. 에이전트에게 이 오류 코드를 전하세요.`,
    details: [],
  });
  await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.querySelector(".cm-editor")).toBeNull();
  expect(container.textContent).toContain("종류가 앱 선언과 다릅니다");
  store.dispose();
});
