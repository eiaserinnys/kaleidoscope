import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import boardJson from "../../../examples/card-board.json";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import * as windowData from "../data/window-data";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("uses the contract's card-board pointers for supported bindings and actions", async () => {
  const definition = boardJson as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport({ ...seed, data: { sources: { cards: { value: { cards: [] } } } } });
  const calls = vi.spyOn(transport, "call");
  const subscriptions = vi.spyOn(windowData, "useBinding");
  render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const input = await screen.findByPlaceholderText("카드 찾기");
  await waitFor(() => expect(subscriptions.mock.calls.map(([pointer]) => pointer)).toEqual(expect.arrayContaining([
    "/ui/children/1/children/0/start/0/value",
    "/ui/children/1/children/0/end/0/confirm/body",
    "/ui/children/1/children/0/end/0/disabled",
  ])));
  const pointers = subscriptions.mock.calls.map(([pointer]) => pointer);
  expect(pointers).not.toContain("/ui/children/0/children/1/items");
  expect(pointers).not.toContain("/ui/children/1/children/1/fields/0/value");
  const expressionPointers = [...new Set(subscriptions.mock.calls.flatMap(([pointer, binding]) =>
    binding !== null && typeof binding === "object" && !Array.isArray(binding) && "expr" in binding ? [pointer] : []))].sort();
  expect(expressionPointers).toEqual([
    "/ui/children/1/children/0/end/0/confirm/body",
    "/ui/children/1/children/0/end/0/disabled",
    "/ui/children/1/children/0/start/0/value",
  ]);
  expect(screen.getAllByText(/지원하지 않는 블록/)).toHaveLength(2);
  const user = userEvent.setup();
  await user.type(input, "찾기");
  await user.click(screen.getByRole("button", { name: "전체" }));
  await user.click(screen.getByRole("menuitem", { name: "진행" }));
  await user.click(screen.getByRole("button", { name: "다시 받기" }));
  act(() => transport.emit({ event: "data.update", window_id: "viewer-window", view: { sources: {}, values: { "/ui/children/1/children/0/end/0/disabled": { status: "ready", value: false } } } }));
  await user.click(screen.getByRole("button", { name: "완료로" }));
  await user.click(screen.getByRole("dialog").querySelectorAll("button")[1]);
  await waitFor(() => {
    const paths = calls.mock.calls.flatMap(([request]) => request.op === "data.act" ? [request.pointer] : []);
    expect([...new Set(paths)].sort()).toEqual([
      "/ui/children/0/children/0/start/0/on_change",
      "/ui/children/0/children/0/end/0/on_change",
      "/ui/children/0/children/0/end/1/on_click",
      "/ui/children/1/children/0/end/0/on_click",
    ].sort());
    expect(paths).not.toContain("/ui/children/0/children/1/on_select");
  });
});

it("only rerenders the subscriber of the changed data pointer", async () => {
  const definition: AppDefinition = {
    ...boardJson as AppDefinition,
    sources: {}, state: { a: "처음 A", b: "처음 B" },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$state.a" } },
      { type: "text", value: { expr: "$state.b" } },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  const window = seed.snapshot.shared.windows[0];
  window.state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  const renders = { a: 0, b: 0 };
  function Value({ name }: { name: "a" | "b" }) {
    renders[name] += 1;
    const value = windowData.useBinding(`/ui/${name}`, { expr: `$state.${name}` });
    return <span>{value.status === "ready" ? String(value.value) : "대기"}</span>;
  }
  render(<windowData.WindowDataProvider store={store} appWindow={window} definition={definition}><Value name="a" /><Value name="b" /></windowData.WindowDataProvider>);
  await waitFor(() => expect(renders.a).toBeGreaterThan(0));
  const before = { ...renders };
  act(() => transport.emit({ event: "data.update", window_id: window.id, view: { sources: {}, values: { "/ui/a": { status: "ready", value: "바뀐 A" } } } }));
  expect(await screen.findByText("바뀐 A")).toBeTruthy();
  expect(renders.a).toBeGreaterThan(before.a);
  expect(renders.b).toBe(before.b);
});
