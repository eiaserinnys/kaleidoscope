import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { executeWindowAction, readWindowView, registerControlWindow, setWindowViewGeometry } from "../share/window-control";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
let unregister: (() => void) | undefined;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
});
afterEach(() => { unregister?.(); unregister = undefined; cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup(markup: string) {
  document.body.innerHTML = `<main id="root">${markup}</main>`;
  const root = document.querySelector<HTMLElement>("#root")!;
  unregister = registerControlWindow("one", root);
  const view = readWindowView("one");
  const number = (label: string) => Number(view.text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${label}`))?.[1]);
  return { root, view, number };
}

it("번호 단추를 사람 입력 순서로 누르고 더블클릭을 구별한다", async () => {
  const { root, view, number } = setup('<button>실행</button>');
  const button = root.querySelector("button")!;
  const seen: string[] = [];
  for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick"]) button.addEventListener(name, (event) => seen.push(`${name}:${(event as MouseEvent).detail}`));
  const result = await executeWindowAction("one", view.view_id, { kind: "click", target: number("실행"), gesture: "double_click" }, "req");
  expect(result.applied).toBe(true);
  expect(seen).toEqual(["pointerdown:1", "mousedown:1", "pointerup:1", "mouseup:1", "click:1", "pointerdown:2", "mousedown:2", "pointerup:2", "mouseup:2", "click:2", "dblclick:2"]);
});

it("입력 상태 이벤트가 늦어도 단추 동작이 끝나야 창 조작이 완료된다", async () => {
  const definition: AppDefinition = {
    ...mdEditorDefinition, requires: { blocks: 4, modules: {} }, state: { draft: "", saved: "" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", placeholder: "입력", value: { state: "draft" }, on_change: { set_state: "draft" } },
      { type: "button", label: "추가", on_click: [{ set_state: "saved", value: { expr: "$state.draft" } }] },
    ] },
  };
  const seed = makeTestSeed({ definitions: [definition] });
  seed.snapshot.shared.windows[0].state = { ...definition.state };
  const transport = createFakeTransport(seed);
  const subscribe = transport.subscribe.bind(transport);
  let releaseEvent = () => {};
  let eventHeld = false;
  transport.subscribe = (listener) => subscribe((event) => {
    if (event.event === "state.changed" && event.snapshot.shared.windows[0].state.draft === "새 글" && !eventHeld) {
      eventHeld = true;
      releaseEvent = () => listener(event);
    } else listener(event);
  });
  const originalCall = transport.call.bind(transport);
  let changeReplied = false;
  let buttonStarted = false;
  let releaseButton!: () => void;
  const buttonPending = new Promise<void>((resolve) => { releaseButton = resolve; });
  vi.spyOn(transport, "call").mockImplementation(async (request) => {
    if (request.op === "data.act" && request.pointer.endsWith("on_click")) {
      buttonStarted = true;
      const reply = await originalCall(request);
      await buttonPending;
      return reply;
    }
    const reply = await originalCall(request);
    if (request.op === "data.act" && request.pointer.endsWith("on_change")) changeReplied = true;
    return reply;
  });
  const store = createShellStore(transport);
  const rendered = render(createElement(AppWindowContent, { store, windowId: "editor-window" }));
  const input = await screen.findByPlaceholderText("입력");
  const root = rendered.container.firstElementChild as HTMLElement;
  unregister = registerControlWindow("editor-window", root, store);
  const view = readWindowView("editor-window");
  const number = Number(view.text.match(/\[(\d+)\] [^\n]*추가/)?.[1]);
  expect(number).toBeGreaterThan(0);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "새 글" } });
  let completed = false;
  const action = executeWindowAction("editor-window", view.view_id, { kind: "click", target: number, gesture: "click" }, "req")
    .then((result) => { completed = true; return result; });
  await waitFor(() => { expect(eventHeld).toBe(true); expect(changeReplied).toBe(true); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  const completedBeforeEvent = completed;
  await act(async () => { releaseEvent(); });
  await waitFor(() => expect(buttonStarted).toBe(true));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  const completedBeforeButton = completed;
  await act(async () => { releaseButton(); await buttonPending; });
  const result = await action;
  expect(completedBeforeEvent).toBe(false);
  expect(completedBeforeButton).toBe(false);
  expect(result.after?.settled).toBe(true);
  expect(store.getSnapshot()?.shared.windows[0].state.saved).toBe("새 글");
  store.dispose();
});

it("입력은 다른 창의 포커스를 옮기지 않고 input 이벤트로 전달한다", async () => {
  const { root, view, number } = setup('<input aria-label="대상" value="기존">');
  const other = document.createElement("input"); document.body.append(other); other.focus();
  const input = root.querySelector("input")!;
  const events: string[] = []; input.addEventListener("input", () => events.push(input.value));
  const result = await executeWindowAction("one", view.view_id, { kind: "type", target: number("대상"), text: "새 글", mode: "replace" }, "req");
  expect(result.applied).toBe(true); expect(events).toEqual(["새 글"]); expect(document.activeElement).toBe(other);
});

it("숨겨진 이전 번호와 허용 화면을 거절한다", async () => {
  const { root, view, number } = setup('<button>숨길 것</button>');
  root.querySelector("button")!.hidden = true;
  const result = await executeWindowAction("one", view.view_id, { kind: "click", target: number("숨길 것") }, "req");
  expect(result.error?.id).toBe("SHELL_WINDOW_CONTROL_TARGET_HIDDEN");
  expect(result.applied).toBe(false);
});

it("Space를 공백 key와 Space code로 보내고 막지 않은 단추를 누른다", async () => {
  const { root, view, number } = setup('<button>선택</button>');
  const button = root.querySelector("button")!; const events: string[] = [];
  button.addEventListener("keydown", (event) => events.push(`${event.key}:${event.code}`));
  button.addEventListener("click", () => events.push("click"));
  await executeWindowAction("one", view.view_id, { kind: "key", target: number("선택"), key: "Space" }, "req");
  expect(events).toEqual([" :Space", "click"]);
});

it("그림 크기 밖의 좌표는 처리하지 않는다", async () => {
  const { view } = setup('<canvas></canvas>');
  setWindowViewGeometry("one", view.view_id, { css_width: 100, css_height: 100, pixel_width: 100, pixel_height: 100 });
  const result = await executeWindowAction("one", view.view_id, { kind: "point", x: 101, y: 1, gesture: "click" }, "req");
  expect(result.error?.id).toBe("SHELL_WINDOW_CONTROL_POINT_OUTSIDE");
});

for (const [name, markup, expected] of [
  ["DOM 뒤쪽의 일반 요소가 canvas를 가린다", '<canvas></canvas><div>가림</div>', "SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED"],
  ["앞쪽의 높은 z-index가 뒤쪽 canvas를 가린다", '<div style="position:absolute;z-index:2">가림</div><canvas style="position:absolute;z-index:1"></canvas>', "SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED"],
  ["자식의 높은 z-index는 부모 쌓임 맥락을 벗어나지 않는다", '<div style="position:absolute;z-index:1"><canvas style="position:absolute;z-index:999"></canvas></div><div style="position:absolute;z-index:2">가림</div>', "SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED"],
  ["높은 canvas는 뒤쪽 일반 요소보다 위다", '<canvas style="position:absolute;z-index:2"></canvas><div>뒤</div>', undefined],
] as const) it(name, async () => {
  const { view } = setup(markup);
  setWindowViewGeometry("one", view.view_id, { css_width:100, css_height:100, pixel_width:100, pixel_height:100 });
  const result = await executeWindowAction("one", view.view_id, { kind:"point", x:10, y:10, gesture:"click" }, "req");
  expect(result.error?.id).toBe(expected);
});

it("프레임 point 응답이 없어도 동작 시작 2초 뒤 보호 문맥을 끝낸다", async () => {
  const { registerFramePointHandler } = await import("../share/frame-point");
  const { windowActionActive } = await import("../share/action-context");
  const { root, view } = setup('<iframe></iframe>');
  setWindowViewGeometry("one", view.view_id, { css_width:100, css_height:100, pixel_width:100, pixel_height:100 });
  const remove = registerFramePointHandler(root.querySelector("iframe")!, () => new Promise(() => {}));
  const pending = executeWindowAction("one", view.view_id, { kind:"point", x:10, y:10, gesture:"click" }, "req");
  expect(windowActionActive("one")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  expect(windowActionActive("one")).toBe(false);
  const result = await pending;
  expect(result.after?.settled).toBe(false);
  expect(result.applied).toBe(true);
  remove();
});
