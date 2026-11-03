import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WindowFrame } from "../../../app/src/shell/window-frame";
import type { CoreEvent, CoreRequest, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";

if (!window.PointerEvent) Object.defineProperty(window, "PointerEvent", { configurable: true, value: window.MouseEvent });
afterEach(() => cleanup());

function setup(top = "editor-window") {
  let snapshot = makeTestSnapshot();
  snapshot.shared.windows = snapshot.shared.windows.map((window) => ({ ...window, z: window.id === top ? 2 : 1 }));
  const listeners = new Set<() => void>();
  const events = new Set<(event: CoreEvent) => void>();
  const call = vi.fn(async (request: CoreRequest) => ({ op: request.op }));
  const store = {
    getSnapshot: () => snapshot, getError: () => null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvents: (listener: (event: CoreEvent) => void) => { events.add(listener); return () => events.delete(listener); },
    call, ready: Promise.resolve(), dispose: () => undefined,
  } as unknown as ShellStore;
  const onCall = vi.fn(async (_request: CoreRequest) => undefined);
  const onMinimize = vi.fn(); const onMaximize = vi.fn(); const onRestore = vi.fn();
  const a = snapshot.shared.windows.find((window) => window.id === "editor-window")!;
  const b = snapshot.shared.windows.find((window) => window.id === "viewer-window")!;
  render(<>
    <WindowFrame area={{ width: 960, height: 552 }} appName="A" isTop={top === a.id} sharing={false} shareable={false} store={store} onCall={onCall} onMinimize={onMinimize} onMaximize={onMaximize} onRestore={onRestore} window={a}>
      <button>실행 A</button><input aria-label="입력 A" />
    </WindowFrame>
    <WindowFrame area={{ width: 960, height: 552 }} appName="B" isTop={top === b.id} sharing={false} shareable={false} store={store} onCall={onCall} onMinimize={onMinimize} onMaximize={onMaximize} onRestore={onRestore} window={b}>
      <input aria-label="입력 B" />
    </WindowFrame>
  </>);
  const change = (next: (previous: ShellSnapshot) => ShellSnapshot) => act(() => { snapshot = next(snapshot); listeners.forEach((listener) => listener()); });
  const emit = () => act(() => events.forEach((listener) => listener({ event: "process.permission", window_id: a.id, request_id: "request", spec: { name: "긴 프로그램 이름", command: "test-command", args: ["--option"], env: { FIRST: "one", SECOND: "two" } } })));
  return { a, b, call, change, emit, onCall, onMinimize, onMaximize };
}

it("앞 창의 허용 표면 자체에 먼저 포커스하고 Enter로 허용하지 않는다", () => {
  const { call, emit } = setup();
  const run = screen.getByRole("button", { name: "실행 A" });
  run.focus();
  emit();
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Enter" });
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBe(dialog);
});

it("뒤 창 요청은 포커스를 빼앗지 않고 다른 창의 Esc를 무시하며 앞으로 오면 포커스한다", () => {
  const { a, call, change, emit } = setup("viewer-window");
  const other = screen.getByLabelText("입력 B");
  other.focus(); emit();
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(other);
  fireEvent.keyDown(other, { key: "Escape" });
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBe(dialog);
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((window) => window.id === a.id ? { ...window, z: 3 } : window) } }));
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(call).toHaveBeenCalledWith({ op: "process.respond_permission", window_id: a.id, request_id: "request", allow: false });
});

it("덮인 곳을 눌러도 취소하지 않고 창 머리 조작은 열어 둔다", () => {
  const { a, call, emit, onCall, onMinimize, onMaximize } = setup("viewer-window");
  emit();
  const frame = screen.getByTestId("app-window-md-editor");
  const overlay = frame.querySelector<HTMLElement>(".ks-window-consent-overlay")!;
  fireEvent.pointerDown(overlay); fireEvent.mouseDown(overlay);
  expect(call).not.toHaveBeenCalled();
  expect(onCall).toHaveBeenCalledWith({ op: "window.raise", window_id: a.id });
  const header = frame.querySelector<HTMLElement>(".ks-window-titlebar")!;
  expect(header.hasAttribute("inert")).toBe(false);
  fireEvent.click(within(frame).getByRole("button", { name: "창 최소화" }));
  fireEvent.click(within(frame).getByRole("button", { name: "창 최대화" }));
  fireEvent.click(within(frame).getByRole("button", { name: "창 닫기" }));
  expect(onMinimize).toHaveBeenCalledWith(a.id);
  expect(onMaximize).toHaveBeenCalledWith(a.id);
  expect(onCall).toHaveBeenCalledWith({ op: "window.close", window_id: a.id });
  fireEvent.pointerDown(header, { pointerId: 1, clientX: 40, clientY: 40 });
  expect(frame.classList.contains("ks-window-gesturing")).toBe(true);
  fireEvent.pointerUp(header, { pointerId: 1, clientX: 40, clientY: 40 });
  expect(call).not.toHaveBeenCalled();
});

it("스크롤 본문은 키보드로 진입하고 명령과 환경이 설명에 연결된다", () => {
  const { emit } = setup(); emit();
  const dialog = screen.getByRole("dialog");
  const body = document.getElementById(dialog.getAttribute("aria-describedby")!);
  expect(body?.textContent).toContain("test-command --option");
  expect(body?.textContent).toContain("FIRST=one");
  const scroll = dialog.querySelector<HTMLElement>(".ks-dialog-scroll")!;
  expect(scroll.tabIndex).toBe(0);
  scroll.focus();
  for (const key of ["ArrowDown", "PageDown", "End"]) fireEvent.keyDown(scroll, { key });
  expect(document.activeElement).toBe(scroll);
});

it.each([true, false])("응답 %s 뒤 요청 전 포커스로 돌아간다", (allow) => {
  const { a, call, emit } = setup();
  const previous = screen.getByRole("button", { name: "실행 A" }); previous.focus(); emit();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: allow ? "허용" : "취소" }));
  expect(call).toHaveBeenCalledWith({ op: "process.respond_permission", window_id: a.id, request_id: "request", allow });
  expect(document.activeElement).toBe(previous);
});

it.each([true, false])("뒤 창에서 뜬 표면에 응답 %s 뒤 같은 창 내용에 머문다", async (allow) => {
  const user = userEvent.setup();
  const { a, call, change, emit } = setup("viewer-window");
  const other = screen.getByLabelText("입력 B");
  await user.click(other);
  await user.keyboard("앞 창 입력");
  emit();
  expect(document.activeElement).toBe(other);
  const frame = screen.getByTestId("app-window-md-editor");
  await user.click(frame.querySelector<HTMLElement>(".ks-window-consent-overlay")!);
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((window) => window.id === a.id ? { ...window, z: 3 } : window) } }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: allow ? "허용" : "취소" }));
  expect(call).toHaveBeenCalledWith({ op: "process.respond_permission", window_id: a.id, request_id: "request", allow });
  expect(document.activeElement).toBe(frame.querySelector(".ks-window-content"));
  await user.keyboard("뒤로 보내지 않을 글");
  expect((other as HTMLInputElement).value).toBe("앞 창 입력");
});

it("최소화 복원과 데스크톱 복귀 시 앞 창의 표면으로 포커스한다", () => {
  const { a, b, change, emit } = setup(); emit();
  const dialog = screen.getByRole("dialog");
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((window) => window.id === a.id ? { ...window, minimized: true } : window) } }));
  screen.getByLabelText("입력 B").focus();
  change((snapshot) => ({ ...snapshot, shared: { ...snapshot.shared, windows: snapshot.shared.windows.map((window) => window.id === a.id ? { ...window, minimized: false } : window) } }));
  expect(document.activeElement).toBe(dialog);
  change((snapshot) => ({ ...snapshot, device: { ...snapshot.device, active_desktop_ids: { "workspace-1": "other-desktop" } } }));
  screen.getByLabelText("입력 B").focus();
  change((snapshot) => ({ ...snapshot, device: { ...snapshot.device, active_desktop_ids: { "workspace-1": a.desktop_id } } }));
  expect(document.activeElement).toBe(dialog);
  expect(b.id).toBe("viewer-window");
});
