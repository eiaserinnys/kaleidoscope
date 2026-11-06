import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { selectElement } from "../share/action-select";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["Enter", "Escape"])("없는 이름의 %s는 값과 목록을 함께 되돌린다", async (key) => {
  setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "없는 이름" } });
  fireEvent.keyDown(input, { key });
  expect(input.value).toBe("value-1");
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("한 행만 남으면 일부 이름 Enter도 고르고 선택한 글 전체를 고른다", async () => {
  setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "zom" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("value-503");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
});

it("자유 입력도 Enter 확정에 목록을 닫는다", async () => {
  setup();
  const input = await screen.findByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "항목" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("목록 전용은 고른 글을 전체 선택하고 이름 Enter 확정 뒤 닫는다", async () => {
  setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  input.focus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
  expect(document.querySelector(".ks-combobox-indicator")).toBeTruthy();
  fireEvent.change(input, { target: { value: "Zombie 마지막" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.value).toBe("value-503");
});

it("쉘 안의 좁은 앱 창에서는 설명을 목록 아래로 놓는다", async () => {
  const { Combobox } = await import("../components/combobox");
  const { createRef } = await import("react");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return (this.classList.contains("ks-data-window")
      ? { left: 100, right: 460, top: 40, bottom: 740, width: 360, height: 700 }
      : { left: 120, right: 320, top: 100, bottom: 140, width: 200, height: 40 }) as DOMRect;
  });
  const css = document.documentElement.style;
  css.setProperty("--ks-pane-min-size", "160px");
  vi.spyOn(window, "getComputedStyle").mockReturnValue(css);
  render(<div className="ks-data-window" data-window-id="narrow"><Combobox inputRef={createRef<HTMLInputElement>()} inputProps={{ value: "a" }} ready visible options={[{ value: "a", label: "a", description: "설명", index: 0, searchValue: "a", searchLabel: "a" }]} onChoose={() => {}} onCommit={() => true} onEditingEnd={() => {}} /></div>);
  fireEvent.focus(screen.getByRole("combobox"));
  expect(document.querySelector(".ks-combobox-popup")?.classList.contains("is-far")).toBe(true);
  cleanup(); css.cssText = "";
});

function setup(optionsOnly = false) {
  const choices = Array.from({ length: 504 }, (_, index) => ({ value: `value-${index}`, label: index === 503 ? "Zombie 마지막" : `항목 ${index}`, ...(index === 0 ? {} : { description: `설명 ${index}` }) }));
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 33, modules: {} }, state: { draft: "value-1", saved: "" }, ui: { type: "stack", direction: "column", children: [
    { type: "input", placeholder: "선택", value: { state: "draft" }, options: choices, options_only: optionsOnly, on_change: { set_state: "draft" } },
    { type: "button", label: "확인", on_click: [{ set_state: "saved", value: { expr: "$state.draft" } }] },
  ] } };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { store, spy, transport, originalCall };
}

it("일반 자동완성은 이름과 다른 선택값을 계속 표시한다", async () => {
  setup();
  const input = await screen.findByRole("combobox");
  fireEvent.focus(input);
  const selected = screen.getByRole("option", { selected: true });
  expect(selected.querySelector(".ks-menu-item-description")?.textContent).toBe("value-1");
});

it("504개 중 입력으로 거르고 방향키와 Enter로 고른 뒤 버튼이 그 값을 읽는다", async () => {
  const { store, spy } = setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  expect(screen.getAllByRole("option").length).toBeLessThan(504);
  fireEvent.change(input, { target: { value: "zom" } });
  expect(within(screen.getByRole("listbox")).getByText("Zombie 마지막")).toBeTruthy();
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act").length).toBe(0);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const active = input.getAttribute("aria-activedescendant");
  expect(active && document.getElementById(active)).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("value-503"));
  expect(input.value).toBe("value-503");
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change"))).toHaveLength(1);
});

it("목록 전용 입력의 불일치는 blur에 되돌리고 보내지 않는다", async () => {
  const { spy } = setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "목록 밖" } });
  fireEvent.blur(input);
  expect(input.value).toBe("value-1");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change"))).toHaveLength(0);
});

it("설명을 읽은 뒤 바깥으로 나가면 목록 밖 입력을 되돌린다", async () => {
  const { spy } = setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "항목 50" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const description = document.querySelector<HTMLElement>(".ks-combobox-description")!;
  fireEvent.blur(input, { relatedTarget: description });
  description.focus();
  fireEvent.pointerDown(screen.getByRole("button", { name: "확인" }));
  expect(input.value).toBe("value-1");
  expect(spy.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
});

it("같이 보기 선택은 화면 밖 선택지도 등록된 선택 경로로 고른다", async () => {
  const { store } = setup();
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  act(() => { expect(selectElement("editor-window", input, { by: "label", value: "Zombie 마지막" })).toBeUndefined(); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe("value-503"));
});

it("자유 입력은 타자 중에는 보내지 않고 멈춘 뒤 한 번 보낸다", async () => {
  const { spy } = setup();
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "자유" } });
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change"))).toHaveLength(0);
  await waitFor(() => expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change"))).toHaveLength(1));
});

it("한글 조합 중 Enter와 방향키는 선택하지 않고 Escape는 목록만 닫는다", async () => {
  const { spy } = setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act")).toHaveLength(0);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("조합 중 일치하는 항목이 없으면 기존 목록을 유지하고 조합 완료 후 거른다", async () => {
  setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  expect(screen.getByText("항목 1")).toBeTruthy();
  expect(screen.getAllByRole("option")[0].getAttribute("aria-setsize")).toBe("504");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "ㅎ" } });
  expect(screen.getByText("항목 1")).toBeTruthy();
  fireEvent.change(input, { target: { value: "하" } });
  expect(screen.getByText("항목 1")).toBeTruthy();
  fireEvent.change(input, { target: { value: "항" } });
  fireEvent.compositionEnd(input, { data: "항" });
  expect(screen.getByText("항목 1")).toBeTruthy();
  expect(screen.getAllByRole("option")[0].getAttribute("aria-setsize")).toBe("503");
});

it.each([false, true])("불일치 시 목록 전용 %s에 맞는 팝업을 보인다", async (optionsOnly) => {
  setup(optionsOnly);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "선택지에 없는 이름" } });
  if (optionsOnly) expect(screen.getByText("일치 없음")).toBeTruthy();
  else expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.change(input, { target: { value: "zom" } });
  expect(screen.getByText("Zombie 마지막")).toBeTruthy();
});

it("활성 선택지에 설명이 없으면 설명 칸과 구분선을 숨긴다", async () => {
  setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  expect(document.querySelector(".ks-combobox-description")).toBeTruthy();
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(document.querySelector(".ks-combobox-description")).toBeNull();
  expect(document.querySelector(".ks-combobox-separator")).toBeNull();
});

it("자유 입력은 한글 조합을 마치기 전에는 지연 시간이 지나도 보내지 않는다", async () => {
  const { spy } = setup();
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "한" } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  expect(spy.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
  fireEvent.compositionEnd(input);
  await waitFor(() => expect(spy.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer.endsWith("on_change"))).toHaveLength(1));
});

it("포커스 중 바깥에서 바뀐 값은 입력을 떠날 때 반영된다", async () => {
  const { store, transport } = setup(true);
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  const snapshot = store.getSnapshot()!;
  await act(async () => transport.emit({ event: "state.changed", sequence: 100, snapshot: {
    ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((item) => item.id === "editor-window" ? { ...item, state: { ...item.state, draft: "value-2" } } : item) },
  } }));
  expect(input.value).toBe("value-1");
  fireEvent.blur(input);
  expect(input.value).toBe("value-2");
});

it.each(["value-3", "value-1"])("연속 선택 뒤 첫 응답이 와도 미일치 초안은 마지막 선택 %s로 돌아간다", async (lastValue) => {
  const { store, spy, originalCall } = setup(true);
  let releaseSecond!: () => void;
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.event === lastValue) await second;
    return originalCall(request);
  });
  const input = await screen.findByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  act(() => { expect(selectElement("editor-window", input, { by: "value", value: "value-2" })).toBeUndefined(); });
  act(() => { expect(selectElement("editor-window", input, { by: "value", value: lastValue })).toBeUndefined(); });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe("value-2"));
  await waitFor(() => expect(spy.mock.calls.some(([request]) => request.op === "data.act" && request.event === lastValue)).toBe(true));
  fireEvent.change(input, { target: { value: "목록 밖" } });
  fireEvent.blur(input);
  expect(input.value).toBe(lastValue);
  await act(async () => { releaseSecond(); await second; });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe(lastValue));
  expect(spy.mock.calls.filter(([request]) => request.op === "data.act" && request.pointer.endsWith("on_change"))).toHaveLength(2);
});

it("선택지 세 개가 아래에 들어가면 아래로 연다", async () => {
  const { Combobox } = await import("../components/combobox");
  const { createRef } = await import("react");
  const ref = createRef<HTMLInputElement>();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 20, right: 220, top: 510, bottom: 550, width: 200, height: 40 } as DOMRect);
  const css = document.documentElement.style;
  for (const [key, value] of Object.entries({ "--ks-space-1": "4px", "--ks-space-2": "8px", "--ks-space-3": "12px", "--ks-pane-min-size": "160px", "--ks-control-height": "40px", "--ks-type-body": "14px", "--ks-line-body": "1.5", "--ks-line-width": "1px" })) css.setProperty(key, value);
  vi.spyOn(window, "getComputedStyle").mockReturnValue(css);
  render(<Combobox inputRef={ref} inputProps={{}} ready visible options={["사과", "배", "포도"].map((value, index) => ({ value, label: value, index, searchValue: value, searchLabel: value }))} onChoose={() => {}} onCommit={() => true} onEditingEnd={() => {}} />);
  fireEvent.focus(screen.getByRole("combobox"));
  expect(document.querySelector(".ks-combobox-popup")?.classList.contains("is-above")).toBe(false);
  cleanup(); css.cssText = "";
});

it("불러오는 중에도 열면 목록 자리에 뼈대 세 줄을 보인다", async () => {
  const { Combobox } = await import("../components/combobox");
  const { createRef } = await import("react");
  render(<Combobox inputRef={createRef<HTMLInputElement>()} inputProps={{}} ready={false} loading visible options={[]} onChoose={() => {}} onCommit={() => true} onEditingEnd={() => {}} />);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.focus(screen.getByRole("combobox"));
  expect(within(screen.getByRole("listbox")).getByRole("status")).toBeTruthy();
  expect(document.querySelectorAll(".ks-combobox-list .ks-data-skeleton i")).toHaveLength(3);
});
