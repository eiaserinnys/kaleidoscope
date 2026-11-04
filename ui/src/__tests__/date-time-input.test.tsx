import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(kind: "date" | "time", value: string | null, extra = {}) {
  const definition: AppDefinition = { ...mdEditorDefinition, requires: { blocks: 33, modules: {} }, state: { draft: value, saved: "" }, ui: { type: "stack", direction: "column", children: [
    { type: "input", kind, label: "입력", value: { state: "draft" }, on_change: { set_state: "draft" }, ...extra },
    { type: "button", label: "확인", on_click: [{ set_state: "saved", value: { expr: "$state.draft" } }] },
  ] } };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const originalCall = transport.call.bind(transport);
  const spy = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="editor-window" />);
  return { store, spy, originalCall };
}
it("날짜 초안을 유지하다 완성한 ISO만 보내고 부분 글은 되돌린다", async () => {
  const { store, spy } = setup("date", "2026-11-01");
  const input = await screen.findByRole("textbox", { name: "입력" }) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "2026-11-20" } });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe("2026-11-20"));
  expect(input.value).toBe("2026-11-20");
  fireEvent.blur(input);
  expect(input.value).not.toBe("2026-11-20");
  fireEvent.focus(input); fireEvent.change(input, { target: { value: "2026-1" } }); fireEvent.blur(input);
  expect(input.value).not.toBe("2026-1");
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.event === "2026-1")).toHaveLength(0);
});
it("달력 키보드로 날짜를 고르면 입력으로 복귀하고 바로 누른 단추가 ISO를 읽는다", async () => {
  const { store } = setup("date", "2026-11-20", { min: "2026-11-19", max: "2026-11-22" });
  const input = await screen.findByRole("textbox", { name: "입력" });
  fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("grid")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("2026-11-21"));
});
it("시간 직접 입력과 목록 선택은 ISO 시각을 보낸다", async () => {
  const { store } = setup("time", null);
  const input = await screen.findByRole("combobox", { name: "입력" }) as HTMLInputElement;
  fireEvent.focus(input); fireEvent.change(input, { target: { value: "15:30" } });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe("15:30"));
  fireEvent.blur(input);
  fireEvent.focus(input);
  expect(screen.getByRole("listbox")).toBeTruthy();
  await act(async () => {});
});
it("시간 목록은 표시 시각만 한 줄로 보여 준다", async () => {
  setup("time", "15:30");
  const input = await screen.findByRole("combobox", { name: "입력" });
  fireEvent.focus(input);
  const selected = screen.getByRole("option", { selected: true });
  expect(selected.textContent).toContain("3:30");
  expect(selected.querySelector(".ks-menu-item-description")).toBeNull();
});
it("지연된 날짜 입력을 받은 뒤 외부 단추가 새 값을 읽는다", async () => {
  const { store, spy, originalCall } = setup("date", "2026-11-20");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  spy.mockImplementation(async (request) => {
    if (request.op === "data.act" && request.event === "2026-11-23") await waiting;
    return originalCall(request);
  });
  const input = await screen.findByRole("textbox", { name: "입력" });
  fireEvent.focus(input); fireEvent.change(input, { target: { value: "2026-11-23" } });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await waitFor(() => expect(spy.mock.calls.some(([r]) => r.op === "data.act" && r.event === "2026-11-23")).toBe(true));
  expect(spy.mock.calls.some(([r]) => r.op === "data.act" && r.pointer.endsWith("on_click"))).toBe(false);
  await act(async () => { release(); await waiting; });
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("2026-11-23"));
});

it.each(["date", "time"] as const)("%s 제출 입력은 초점을 떠나도 미제출 초안을 보내지 않는다", async (kind) => {
  const previous = kind === "date" ? "2026-11-20" : "14:00";
  const next = kind === "date" ? "2026-11-23" : "15:30";
  const { store, spy } = setup(kind, previous, { commit: "submit" });
  const input = await screen.findByRole(kind === "date" ? "textbox" : "combobox", { name: "입력" }) as HTMLInputElement;
  fireEvent.focus(input); fireEvent.change(input, { target: { value: next } });
  fireEvent.keyDown(input, { key: "Tab" }); fireEvent.blur(input);
  expect(input.value).not.toBe(next);
  expect(store.getSnapshot()?.shared.windows[0].state.draft).toBe(previous);
  expect(spy.mock.calls.filter(([r]) => r.op === "data.act" && r.pointer.endsWith("on_change"))).toHaveLength(0);
});

it("달력은 주의 시작과 끝, 월과 연 이동 뒤 Escape로 입력에 돌아간다", async () => {
  setup("date", "2024-02-29");
  const input = await screen.findByRole("textbox", { name: "입력" });
  fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
  expect((document.activeElement as HTMLElement).textContent).toBe("29");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect((document.activeElement as HTMLElement).textContent).toBe("25");
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect((document.activeElement as HTMLElement).textContent).toBe("2");
  fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
  expect(document.activeElement?.getAttribute("aria-label")).toContain("February 2, 2024");
  fireEvent.keyDown(document.activeElement!, { key: "PageUp", shiftKey: true });
  expect(document.activeElement?.getAttribute("aria-label")).toContain("February 2, 2023");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(input);
});

it("날짜 범위 밖은 잠기고 지우면 null을 보낸다", async () => {
  const { store } = setup("date", "2026-11-20", { min: "2026-11-19", max: "2026-11-22" });
  const input = await screen.findByRole("textbox", { name: "입력" }) as HTMLInputElement;
  fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
  const dialog = await screen.findByRole("dialog");
  expect((within(dialog).getByText("18", { selector: "button" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByText("19", { selector: "button" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.draft).toBeNull());
});

it.each([
  ["date", "잘못된 날짜", { min: { state: "draft" } }, "SHELL_INPUT_DATE_BOUND_INVALID"],
  ["time", "24:00", { max: { state: "draft" } }, "SHELL_INPUT_TIME_BOUND_INVALID"],
  ["time", "14:00", { step: { state: "draft" } }, "SHELL_INPUT_TIME_STEP_INVALID"],
] as const)("%s 동적 범위와 간격 오류를 표시한다", async (kind, value, binding, id) => {
  setup(kind, value, binding);
  expect((await screen.findByRole("alert")).textContent).toContain(id);
});
