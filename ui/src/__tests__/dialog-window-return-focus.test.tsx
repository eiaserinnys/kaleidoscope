import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowFocus } from "../render/window-focus";
import { Shell } from "../../../app/src/shell/shell";
import { makeTestSeed, makeTestSnapshot } from "./fixtures";

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 960, height: 552 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  });
}
if (!window.PointerEvent) Object.defineProperty(window, "PointerEvent", { configurable: true, value: window.MouseEvent });

beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function dialogProbe(id: string, name: string): AppDefinition {
  return {
    id, name, requires: { blocks: 35, modules: {} }, permissions: [], state: { text: "abcdef", open: true },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", label: `${name} 입력`, value: { state: "text" }, on_change: { set_state: "text" } },
      { type: "button", label: `${name} 단추` },
      { type: "dialog", open: { state: "open" }, title: `${name} 확인`, close_label: "저장", cancel_label: "취소",
        child: { type: "input", label: `${name} 대화상자 입력`, value: { state: "text" }, on_change: { set_state: "text" } },
        on_confirm: [{ set_state: "open", value: false }],
        on_close: [{ set_state: "open", value: false }] },
    ] },
  } as unknown as AppDefinition;
}

function plainProbe(id: string, name: string): AppDefinition {
  return {
    id, name, requires: { blocks: 35, modules: {} }, permissions: [], state: { text: "abcdef" },
    ui: { type: "stack", direction: "column", children: [
      { type: "input", label: `${name} 입력`, value: { state: "text" }, on_change: { set_state: "text" } },
      { type: "button", label: `${name} 단추` },
    ] },
  } as unknown as AppDefinition;
}

function closeOnlyProbe(): AppDefinition {
  return {
    id: "probe-c", name: "다", requires: { blocks: 35, modules: {} }, permissions: [], state: { open: true },
    ui: { type: "stack", direction: "column", children: [
      { type: "text", value: "안내" },
      { type: "dialog", open: { state: "open" }, title: "안내 확인", close_label: "닫기",
        child: { type: "text", value: "읽고 닫으십시오" },
        on_close: [{ set_state: "open", value: false }] },
    ] },
  } as unknown as AppDefinition;
}

function twoWindowSeed(first: AppDefinition, second: AppDefinition) {
  const snapshot = makeTestSnapshot({ definitions: [first, second] });
  snapshot.shared.windows[0].id = "probe-a-window";
  snapshot.shared.windows[0].z = 2;
  snapshot.shared.windows[1].id = "probe-b-window";
  snapshot.shared.windows[1].z = 1;
  return { ...makeTestSeed(), snapshot };
}

function titlebarOf(testId: string): HTMLElement {
  const titlebar = screen.getByTestId(testId).querySelector(".ks-window-titlebar");
  if (!(titlebar instanceof HTMLElement)) throw new Error("창 제목 줄을 찾지 못했습니다");
  return titlebar;
}

async function windowDialog(name: string) {
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByRole("textbox", { name: `${name} 대화상자 입력` }) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(input));
  return { dialog, input };
}

it("대화상자 입력에서 다른 창을 거쳐 돌아오면 입력과 커서가 복원되고 글자가 들어간다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { dialog, input } = await windowDialog("가");
  input.setSelectionRange(2, 2);

  fireEvent.pointerDown(titlebarOf("app-window-probe-b"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-b-window" }));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));

  fireEvent.pointerDown(titlebarOf("app-window-probe-a"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-a-window" }));
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(2);

  await userEvent.keyboard("가");
  expect(input.value).toBe("ab가cdef");
  expect(dialog.contains(document.activeElement)).toBe(true);
  store.dispose();
});

it("창 전환 단축키는 대화상자가 열려 있는 동안 창을 바꾸지 않는다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { input } = await windowDialog("가");

  fireEvent.keyDown(window, { code: "PageDown", key: "PageDown", ctrlKey: true, altKey: true });
  await act(async () => { await Promise.resolve(); });
  expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ op: "window.raise" }));
  expect(document.activeElement).toBe(input);
  store.dispose();
});

it("대화상자의 취소 단추에서 다른 창을 거쳐 돌아오면 그 단추로 초점이 돌아간다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { dialog } = await windowDialog("가");
  const cancel = within(dialog).getByRole("button", { name: "취소" });
  cancel.focus();
  expect(document.activeElement).toBe(cancel);

  fireEvent.pointerDown(titlebarOf("app-window-probe-b"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-b-window" }));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));
  fireEvent.pointerDown(titlebarOf("app-window-probe-a"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-a-window" }));
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  store.dispose();
});

it("대화상자 알림의 닫기 단추에서 돌아오면 그 닫기 단추로 초점이 돌아간다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const original = transport.call.bind(transport);
  const calls = vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
    if (request.op === "data.act" && request.pointer.endsWith("/on_confirm")) throw new Error("저장하지 못했습니다");
    return original(request as never) as never;
  }) as typeof transport.call);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { dialog } = await windowDialog("가");
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  const close = await within(dialog).findByRole("button", { name: "닫기" });
  close.focus();
  expect(document.activeElement).toBe(close);

  fireEvent.pointerDown(titlebarOf("app-window-probe-b"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-b-window" }));
  await waitFor(() => expect(screen.getByTestId("app-window-probe-b").contains(document.activeElement)).toBe(true));
  fireEvent.pointerDown(titlebarOf("app-window-probe-a"), { button: 0 });
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "window.raise", window_id: "probe-a-window" }));
  await waitFor(() => expect(document.activeElement).toBe(close));
  store.dispose();
});

it("대화상자에서 Tab과 Shift+Tab이 대화상자 밖으로 나가지 않는다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { dialog, input } = await windowDialog("가");
  const confirm = within(dialog).getByRole("button", { name: "저장" });
  confirm.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  expect(dialog.contains(document.activeElement)).toBe(true);
  store.dispose();
});

it("대화상자 안의 초점 요소가 사라지면 대화상자의 첫 단추로 옮긴다", async () => {
  const seed = twoWindowSeed(dialogProbe("probe-a", "가"), plainProbe("probe-b", "나"));
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const { dialog, input } = await windowDialog("가");
  const cancel = within(dialog).getByRole("button", { name: "취소" });
  input.remove();
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  store.dispose();
});

it("확정 단추가 없는 대화상자는 처음부터 닫기 단추로 초점을 받는다", async () => {
  const snapshot = makeTestSnapshot({ definitions: [closeOnlyProbe()] });
  const transport = createFakeTransport({ ...makeTestSeed(), snapshot });
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  await store.ready;
  const dialog = await screen.findByRole("dialog");
  const close = within(dialog).getByRole("button", { name: "닫기" });
  await waitFor(() => expect(document.activeElement).toBe(close));
  expect(close.closest(".ks-dialog-actions")).not.toBeNull();
  store.dispose();
});

function FocusHarness({ store, withAppDialog, withConsent }: { store: ReturnType<typeof createShellStore>; withAppDialog: boolean; withConsent: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  return <>
    <input aria-label="바깥 입력" />
    <div className="ks-window-frame">
      <WindowFocus host={host} store={store} windowId="viewer-window" />
      <div className="ks-window-content">
        <div className="ks-data-window" ref={host}>
          <div className="ks-data-window-body" inert><input aria-label="본문 입력" /></div>
          {withAppDialog ? <div className="ks-dialog-overlay"><div className="ks-dialog" role="dialog">
            <div className="ks-dialog-body"><input aria-label="대화상자 입력" /></div>
            <div className="ks-dialog-actions"><button>취소</button><span className="ks-dialog-confirm"><button>저장</button></span></div>
          </div></div> : null}
        </div>
      </div>
      {withConsent ? <div className="ks-dialog-overlay ks-window-consent-overlay"><div className="ks-dialog" role="dialog">
        <div className="ks-dialog-body"><button>허용</button></div>
      </div></div> : null}
    </div>
  </>;
}

it("창으로 돌아올 때 앱 대화상자가 있으면 대화상자 안으로 초점을 돌린다", async () => {
  const transport = createFakeTransport(makeTestSeed());
  const store = createShellStore(transport);
  render(<FocusHarness store={store} withAppDialog withConsent={false} />);
  (document.activeElement as HTMLElement | null)?.blur();
  await act(async () => { await store.ready; });
  const input = screen.getByLabelText("대화상자 입력");
  await waitFor(() => expect(document.activeElement).toBe(input));
  store.dispose();
});

it("바깥 입력에 초점이 있으면 앱 대화상자가 열려도 그 초점을 지킨다", async () => {
  const transport = createFakeTransport(makeTestSeed());
  const store = createShellStore(transport);
  render(<FocusHarness store={store} withAppDialog withConsent={false} />);
  const outside = screen.getByLabelText("바깥 입력") as HTMLInputElement;
  outside.focus();
  await act(async () => { await store.ready; });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(document.activeElement).toBe(outside);
  store.dispose();
});

it("동의 창은 창으로 돌아오는 초점 이동 경로에서 움직이지 않는다", async () => {
  const transport = createFakeTransport(makeTestSeed());
  const store = createShellStore(transport);
  render(<FocusHarness store={store} withAppDialog={false} withConsent />);
  const outside = screen.getByLabelText("바깥 입력") as HTMLInputElement;
  outside.focus();
  await act(async () => { await store.ready; });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(document.activeElement).toBe(outside);
  store.dispose();
});
