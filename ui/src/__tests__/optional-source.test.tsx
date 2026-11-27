import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, BindingValue } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import type { FakeSourceSeed } from "../core/fake-data";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { mockVirtualLayout } from "./virtual-layout";
import { makeTestSeed } from "./fixtures";

const EXTRA = "/ui/children/0/value";
const PLAIN = "/ui/children/1/value";

function definitionOf(extraOptional: boolean): AppDefinition {
  return {
    id: "optional-source", name: "선택 원천", requires: { blocks: 71, modules: {} }, permissions: [], state: {},
    sources: {
      main: { kind: "request", permission: "api", path: "/main" },
      extra: { kind: "request", permission: "api", path: "/extra", ...(extraOptional ? { optional: true } : {}) },
      plain: { kind: "request", permission: "api", path: "/plain" },
    },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: { expr: "$count($data.main) & \"-\" & $count($data.extra)" } },
      { type: "text", value: { expr: "$count($data.main) & \"-\" & $count($data.plain)" } },
    ] },
  };
}

function seedOf(definition: AppDefinition, extra: FakeSourceSeed, plain: FakeSourceSeed = { value: [1, 2, 3] }) {
  const sources: Record<string, FakeSourceSeed> = { main: { value: [1] }, extra, plain };
  return { sources, seed: { ...makeTestSeed({ definitions: [definition] }), data: { sources } } };
}

async function attach(definition: AppDefinition, extra: FakeSourceSeed, plain?: FakeSourceSeed) {
  const { seed } = seedOf(definition, extra, plain);
  const transport = createFakeTransport(seed);
  const values: Record<string, BindingValue> = {};
  const unsubscribe = transport.subscribe((event) => { if (event.event === "data.update") Object.assign(values, event.view.values); });
  const reply = await transport.call({ op: "data.attach", window_id: "viewer-window" });
  if (reply.op === "data.attach") Object.assign(values, { ...reply.view.values, ...values });
  return { values, stop: async () => { unsubscribe(); await transport.call({ op: "data.detach", window_id: "viewer-window" }); } };
}

const ready = (value: JsonValue): BindingValue => ({ status: "ready", value });

beforeEach(mockVirtualLayout);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("선택 원천이 불러오는 중이어도 그 원천을 없는 값으로 읽어 식이 값이 된다", async () => {
  const { values, stop } = await attach(definitionOf(true), { value: [1, 2], delayMs: 60_000 });
  await waitFor(() => expect(values[EXTRA]).toEqual(ready("1-0")));
  await stop();
});

it("선택 원천이 첫 받기에 실패해도 식이 실패하지 않고 값이 된다", async () => {
  const { values, stop } = await attach(definitionOf(true), { error: "서버 오류" });
  await waitFor(() => expect(values[EXTRA]).toEqual(ready("1-0")));
  await stop();
});

it("선택이 아닌 원천은 불러오는 중이면 Loading, 실패하면 Failed로 남는다", async () => {
  const loading = await attach(definitionOf(false), { value: [1, 2], delayMs: 60_000 });
  await waitFor(() => expect(loading.values[EXTRA]).toEqual({ status: "loading" }));
  await loading.stop();
  const failed = await attach(definitionOf(false), { error: "서버 오류" });
  await waitFor(() => expect(failed.values[EXTRA]).toMatchObject({ status: "failed", retry: ["extra"] }));
  await failed.stop();
});

it("선택 원천이 있어도 다른 원천의 판단은 그대로다", async () => {
  const { values, stop } = await attach(definitionOf(true), { error: "서버 오류" }, { error: "평범한 실패" });
  await waitFor(() => expect(values[PLAIN]).toMatchObject({ status: "failed", retry: ["plain"] }));
  expect(values[EXTRA]).toEqual(ready("1-0"));
  await stop();
});

it("선택 원천이 첫 받기에 실패하면 창 알림이 다시 받기와 함께 뜨고, 다시 받아 성공하면 사라지고 식에 값이 들어온다", async () => {
  const definition = definitionOf(true);
  const { seed, sources } = seedOf(definition, { error: "연결 예시의 서버에 오류가 났습니다." });
  const store = createShellStore(createFakeTransport(seed));
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect(await screen.findByText("1-0")).toBeTruthy();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("연결 예시의 서버에 오류가 났습니다.");
  expect(screen.getByRole("button", { name: "자세히" })).toBeTruthy();
  delete sources.extra.error;
  sources.extra.value = [1, 2];
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(await screen.findByText("1-2")).toBeTruthy();
  store.dispose();
});
