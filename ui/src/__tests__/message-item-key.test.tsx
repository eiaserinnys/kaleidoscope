import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AppDefinition, Binding, ShellSnapshot } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { DataState } from "../components/data-state";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { ItemScopeProvider, type ItemScope } from "../data/item-scope";
import { useBinding, WindowDataProvider } from "../data/window-data";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";

afterEach(cleanup);

const itemMessage = (path: string) => ({ message: { item: path } }) as unknown as Binding;

function definition(ui: AppDefinition["ui"] = { type: "text", value: "" }): AppDefinition {
  return {
    id: "message-item-test", name: "메시지 키 시험", requires: { blocks: 19, modules: {} }, permissions: [],
    state: { locale: "en", rows: [] },
    messages: { en: { ready: "Ready", parent: "Parent", child: "Child", kind: "State" }, ko: { ready: "준비", parent: "부모", child: "자식", kind: "상태" } },
    locale: { state: "locale" }, ui,
  } as AppDefinition;
}

function setup(app: AppDefinition) {
  const seed = makeTestSeed({ definitions: [app] });
  seed.snapshot.shared.windows[0].state = app.state;
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  return { store, transport, windowId: seed.snapshot.shared.windows[0].id };
}

function BindingLabel({ binding, pointer }: { binding: Binding; pointer: string }) {
  const value = useBinding(pointer, binding);
  if (value.status === "ready") return <span>{String(value.value)}</span>;
  if (value.status === "failed") return <DataState value={value} compact />;
  return null;
}

function scope(item: JsonValue, key: string, parent_item?: JsonValue): ItemScope {
  return { item, ...(parent_item ? { parent_item } : {}), key, index: 0, instance: {} };
}

it("반복 범위마다 현재 항목의 키를 읽고 중첩 범위도 안쪽 항목을 쓴다", () => {
  const app = definition();
  const { store, windowId } = setup(app);
  const outer = scope({ label_key: "parent" }, "outer");
  const inner = scope({ label_key: "child" }, "inner", outer.item);
  render(<WindowDataProvider store={store} windowId={windowId} definition={app}>
    <ItemScopeProvider value={outer}>
      <BindingLabel pointer="/ui/outer" binding={itemMessage("label_key")} />
      <ItemScopeProvider value={inner}>
        <BindingLabel pointer="/ui/inner" binding={itemMessage("label_key")} />
      </ItemScopeProvider>
      <ItemScopeProvider value={scope({ label_key: "ready" }, "sibling")}>
        <BindingLabel pointer="/ui/sibling" binding={itemMessage("label_key")} />
      </ItemScopeProvider>
    </ItemScopeProvider>
  </WindowDataProvider>);

  expect(screen.getByText("Parent")).toBeTruthy();
  expect(screen.getByText("Child")).toBeTruthy();
  expect(screen.getByText("Ready")).toBeTruthy();
  store.dispose();
});

it("실패 details에 화면 pointer, 항목 경로, 메시지 키와 언어를 둔다", () => {
  const app = definition();
  const { store, windowId } = setup(app);
  function Details() {
    const value = useBinding("/ui/label", itemMessage("label_key"));
    return <output data-testid="binding-details">{value.status === "failed" ? value.details?.join("| ") : ""}</output>;
  }
  render(<WindowDataProvider store={store} windowId={windowId} definition={app}>
    <ItemScopeProvider value={scope({ label_key: "not-a-message" }, "row-7")}><Details /></ItemScopeProvider>
  </WindowDataProvider>);

  const details = screen.getByTestId("binding-details").textContent ?? "";
  expect(details).toContain("pointer: /ui/label");
  expect(details).toContain("item_path: label_key");
  expect(details).toContain("key: not-a-message");
  expect(details).toContain("locale: en");
  store.dispose();
});

it("언어 state만 바꾸면 바인딩이 번역되고 새 코어 요청은 만들지 않는다", async () => {
  const app = definition();
  const { store, transport, windowId } = setup(app);
  render(<WindowDataProvider store={store} windowId={windowId} definition={app}>
    <ItemScopeProvider value={scope({ label_key: "ready" }, "row")}>
      <BindingLabel pointer="/ui/label" binding={itemMessage("label_key")} />
    </ItemScopeProvider>
  </WindowDataProvider>);
  expect(screen.getByText("Ready")).toBeTruthy();
  await store.ready;
  const callCount = transport.getCalls().length;
  const previous = store.getSnapshot()!;
  const snapshot: ShellSnapshot = {
    ...previous,
    shared: { ...previous.shared, windows: previous.shared.windows.map((window) => window.id === windowId
      ? { ...window, state: { ...window.state, locale: "ko" } }
      : window) },
  };
  await act(async () => { transport.emit({ event: "state.changed", snapshot }); });
  expect(await screen.findByText("준비")).toBeTruthy();
  expect(transport.getCalls()).toHaveLength(callCount);
  store.dispose();
});

it("자료 키 실패를 각각 구분하고 일반 단추와 미리보기 카드에 오류 코드를 보인다", async () => {
  const app = definition({
    type: "repeat", items: { state: "rows" }, key: "id", virtual: false,
    template: { type: "stack", direction: "row", children: [
      { type: "button", label: itemMessage("label_key"), on_click: [] },
      { type: "button", label: itemMessage("label_key"), preview: { type: "text", value: "미리보기" }, on_click: [] },
      { type: "button", label: "With prefix", prefix: itemMessage("prefix_key"), on_click: [] },
    ] },
  } as never);
  app.state.rows = [
    { id: "missing", label_key: null, prefix_key: "kind" },
    { id: "not-text", label_key: 3, prefix_key: "kind" },
    { id: "unknown", label_key: "not-in-messages", prefix_key: "kind" },
    { id: "prefix-failure", label_key: "ready", prefix_key: "not-in-messages" },
  ];
  const { store, windowId } = setup(app);
  render(<AppWindowContent store={store} windowId={windowId} />);
  await waitFor(() => expect(document.querySelectorAll(".ks-error-id")).toHaveLength(7));
  expect(document.body.textContent).toContain("SHELL_MESSAGE_ITEM_KEY_MISSING");
  expect(document.body.textContent).toContain("SHELL_MESSAGE_ITEM_KEY_NOT_STRING");
  expect(document.body.textContent).toContain("SHELL_MESSAGE_KEY_NOT_FOUND");
  expect(document.querySelectorAll(".ks-data-button.has-preview .ks-data-button-card-failure .ks-error-id")).toHaveLength(3);
  expect(document.querySelectorAll(".ks-data-button-failure-item > .ks-data-state-compact")).toHaveLength(4);
  expect(document.querySelectorAll(".ks-data-button.has-preview + [role=alert], .ks-data-button:not(.has-preview) + .ks-notice[role=alert]")).toHaveLength(0);
  const prefixFailureButton = screen.getByRole("button", { name: /With prefix: SHELL_MESSAGE_KEY_NOT_FOUND/ });
  expect(prefixFailureButton.hasAttribute("disabled")).toBe(true);
  store.dispose();
});

it("실패한 글은 원인과 코드를 보이고 단추와 카드에도 오류를 표시한다", async () => {
  const app = definition({
    type: "repeat", items: { state: "rows" }, key: "id", virtual: false,
    template: { type: "stack", direction: "row", children: [
      { type: "text", value: itemMessage("label_key") },
      { type: "button", label: itemMessage("label_key"), on_click: [] },
      { type: "button", label: itemMessage("label_key"), preview: { type: "text", value: "미리보기" }, on_click: [] },
    ] },
  } as never);
  app.state.rows = [{ id: "missing", label_key: null }];
  const { store, windowId } = setup(app);
  render(<AppWindowContent store={store} windowId={windowId} />);
  await waitFor(() => expect(document.querySelectorAll(".ks-error-id")).toHaveLength(3));
  const textError = document.querySelector(".ks-data-text[role=alert]")!;
  expect(textError.textContent).toContain("SHELL_MESSAGE_ITEM_KEY_MISSING");
  expect(textError.textContent).toContain("메시지");
  const buttonFailure = document.querySelector(".ks-data-button-failure-item")!;
  expect(buttonFailure.querySelector("button:disabled svg")).toBeTruthy();
  expect(buttonFailure.querySelectorAll("svg")).toHaveLength(1);
  const cardFailure = document.querySelector(".ks-data-button-card-label .ks-data-button-card-failure")!;
  expect(cardFailure.querySelector(".ks-error-id")).toBeTruthy();
  expect(cardFailure.closest("[inert], [aria-hidden=true]")).toBeNull();
  store.dispose();
});
