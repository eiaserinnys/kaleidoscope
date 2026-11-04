import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, AppWindow, CoreRequest, ShellSnapshot } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";
import receivers from "../../../crates/contract/tests/fixtures/message_receivers.json";
import { messageReceiver, messageApps, defaultMessageApp, useDefaultMessageApp } from "../shell/message-target";
import { sendToDefaultAgent } from "../shell/send-message";
import { deliverClientMessage } from "../runtime/client-runtime";

vi.mock("../contract/limits", async (original) => ({ ...await original<typeof import("../contract/limits")>(), BUILTIN_DEFAULT_MESSAGE_APP_IDS: ["builtin"] }));
vi.mock("../runtime/client-runtime", () => ({ deliverClientMessage: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const app = (id: string, kind: "conversation" | "client" | "none" = "conversation"): AppDefinition => ({
  id, name: id, requires: { blocks: 1, modules: {} }, permissions: [], state: {}, ui: { type: "text", value: "" },
  ...(kind === "conversation" ? { agent: {} } : kind === "client" ? { client: { capabilities: ["receive_message"] } } : {}),
} as unknown as AppDefinition);

function setup(kind: "conversation" | "client" = "conversation") {
  let snapshot = makeTestSnapshot({ definitions: [app("source", "none"), app("chosen", kind), app("other"), app("builtin")] });
  snapshot.shared.windows = [snapshot.shared.windows[0]];
  snapshot.shared.preferences = { revision: 1, default_message_app_id: "chosen", asked_message_app_ids: [] };
  snapshot.shared.desktops.push({ ...snapshot.shared.desktops[0], id: "desktop-2" });
  const listeners = new Set<() => void>();
  const calls: CoreRequest[] = [];
  let sendError: unknown;
  let revealError: unknown;
  let showImmediately = true;
  const target = (id: string, desktop = "desktop-1", z = 1, appId = "chosen"): AppWindow => ({ ...snapshot.shared.windows[0], id, desktop_id: desktop, app_id: appId, z });
  const publish = (next: ShellSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()); };
  const show = (window: AppWindow) => publish({ ...snapshot, shared: { ...snapshot.shared, windows: [...snapshot.shared.windows, window] } });
  const call = vi.fn(async (request: CoreRequest) => {
    calls.push(request);
    if (request.op === "window.open") { const window = target("new-window", request.desktop_id, 3, request.app_id); if (showImmediately) show(window); return { op: "window.open", window }; }
    if (request.op === "conversation.send" && sendError) throw sendError;
    if ((request.op === "desktop.activate" || request.op === "window.raise") && revealError) throw revealError;
    return { op: request.op };
  });
  const store = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, call } as unknown as ShellStore;
  return { store, calls, target, show, publish, snapshot: () => snapshot, setError: (error: unknown) => { sendError = error; }, setRevealError: (error: unknown) => { revealError = error; }, delayWindow: () => { showImmediately = false; }, listenerCount: () => listeners.size };
}
const send = (store: ShellStore) => sendToDefaultAgent({ store, fromWindowId: "viewer-window", requestId: "request", text: "검토" });
const ops = (calls: CoreRequest[]) => calls.map((call) => call.op);

describe("기본 메시지 앱", () => {
  it("Rust 수신 판정 fixture와 일치한다", () => {
    for (const row of receivers) {
      const definition = { agent: row.agent ? {} : undefined, client: { capabilities: row.capabilities } } as unknown as AppDefinition;
      expect(messageReceiver(definition)).toBe(row.expected);
    }
  });
  it("현재 판의 수신 앱을 이름순으로 고르고 삭제된 선택은 표지된 기본 앱으로 되돌린다", () => {
    const { snapshot } = setup(); const state = snapshot().shared;
    expect(messageApps(state).map((item) => item.id)).toEqual(["builtin", "chosen", "other"]);
    state.preferences!.default_message_app_id = "deleted";
    expect(defaultMessageApp(state)?.id).toBe("builtin");
  });
  it("창 상태 변경은 기본 앱 훅을 다시 그리지 않는다", () => {
    const s = setup(); let renders = 0;
    function Probe() { renders++; const target = useDefaultMessageApp(s.store); return <span>{target?.name}</span>; }
    render(<Probe />); expect(renders).toBe(1);
    act(() => s.publish({ ...s.snapshot(), shared: { ...s.snapshot().shared, windows: [{ ...s.snapshot().shared.windows[0], state: { value: 1 } }] } }));
    expect(renders).toBe(1);
    act(() => s.publish({ ...s.snapshot(), shared: { ...s.snapshot().shared, preferences: { revision: 2, default_message_app_id: "other", asked_message_app_ids: [] } } }));
    expect(renders).toBe(2);
  });
});

describe("기본 앱에 보내기", () => {
  it("다른 앱 창만 있으면 기본 앱을 새로 열어 보낸다", async () => {
    const s = setup(); s.show(s.target("other-window", "desktop-1", 9, "other"));
    await expect(send(s.store)).resolves.toEqual({ appId: "chosen", windowId: "new-window", created: true });
    expect(s.calls).toContainEqual({ op: "window.open", desktop_id: "desktop-1", app_id: "chosen" });
    expect(s.calls).toContainEqual({ op: "conversation.send", window_id: "new-window", request_id: "request", text: "검토", attachments: [] });
  });
  it("같은 데스크톱을 먼저 고르고 그 안에서는 z가 큰 창에 보낸다", async () => {
    const s = setup(); s.show(s.target("far", "desktop-2", 99)); s.show(s.target("near-low")); s.show(s.target("near-high", "desktop-1", 2));
    await expect(send(s.store)).resolves.toMatchObject({ windowId: "near-high", created: false });
  });
  it("다른 데스크톱에서 성공하면 창을 앞으로 가져오지 않는다", async () => {
    const s = setup(); s.show(s.target("far", "desktop-2")); await send(s.store);
    expect(ops(s.calls)).toEqual(["conversation.send"]);
  });
  it("대화가 없으면 데스크톱과 창을 차례로 드러내고 구성 오류를 낸다", async () => {
    const s = setup(); s.show(s.target("far", "desktop-2")); s.setError({ id: "CONV_SEND_THREAD_NOT_FOUND", code: "not_found", message: "없음", details: [] });
    await expect(send(s.store)).rejects.toMatchObject({ id: "SHELL_MESSAGE_SEND_NOT_CONFIGURED" });
    expect(ops(s.calls)).toEqual(["conversation.send", "desktop.activate", "window.raise"]);
  });
  it("client 준비 전이면 창을 드러내고 안내를 보존한다", async () => {
    const s = setup("client"); s.show(s.target("far", "desktop-2")); vi.mocked(deliverClientMessage).mockResolvedValueOnce({ status: "not_ready", reason: "대화를 시작하세요" });
    await expect(send(s.store)).rejects.toMatchObject({ id: "SHELL_MESSAGE_SEND_NOT_READY", message: expect.stringContaining("대화를 시작하세요") });
    expect(ops(s.calls)).toEqual(["desktop.activate", "window.raise"]);
  });
  it("client가 접수하면 숨은 기존 창을 올리지 않는다", async () => {
    const s = setup("client"); s.show(s.target("far", "desktop-2")); vi.mocked(deliverClientMessage).mockResolvedValueOnce({ status: "accepted" });
    await expect(send(s.store)).resolves.toEqual({ appId: "chosen", windowId: "far", created: false });
    expect(deliverClientMessage).toHaveBeenCalledWith(s.store, "far", { request_id: "request", text: "검토" });
    expect(s.calls).toEqual([]);
  });
  it("열린 창의 판으로 전송 방식을 정한다", async () => {
    const s = setup("client"); s.show({ ...s.target("old"), app_version: 2 });
    s.snapshot().shared.app_versions.push({ ...s.snapshot().shared.app_versions.find((item) => item.app_id === "chosen")!, version: 2, definition: app("chosen", "conversation") });
    await send(s.store);
    expect(ops(s.calls)).toEqual(["conversation.send"]);
  });
  it("드러내기 실패와 다른 전송 오류는 원문 그대로 전한다", async () => {
    const s = setup(); s.show(s.target("far", "desktop-2")); const failure = { code: "server", message: "오류", details: [] };
    s.setError(failure); await expect(send(s.store)).rejects.toBe(failure);
    s.setError({ id: "CONV_SEND_THREAD_NOT_FOUND", code: "not_found", message: "없음", details: [] }); s.setRevealError(failure);
    await expect(send(s.store)).rejects.toBe(failure);
  });
  it("보낸 창이 없거나 후보가 없으면 명시적으로 실패한다", async () => {
    const s = setup(); s.publish({ ...s.snapshot(), shared: { ...s.snapshot().shared, windows: [] } });
    await expect(send(s.store)).rejects.toMatchObject({ id: "SHELL_MESSAGE_SEND_SOURCE_MISSING" });
    s.show(s.target("viewer-window")); s.snapshot().shared.apps = [];
    await expect(send(s.store)).rejects.toMatchObject({ id: "SHELL_MESSAGE_SEND_NO_RECEIVER" });
  });
  it("새 창이 늦게 관측되면 기다린 다음 보낸다", async () => {
    const s = setup(); s.delayWindow(); const pending = send(s.store); await Promise.resolve();
    expect(ops(s.calls)).toEqual(["window.open"]); s.show(s.target("new-window"));
    await expect(pending).resolves.toMatchObject({ windowId: "new-window", created: true });
    expect(ops(s.calls)).toEqual(["window.open", "conversation.send"]); expect(s.listenerCount()).toBe(0);
  });
  it("새 창이 5초 안에 관측되지 않으면 전송하지 않고 오류를 낸다", async () => {
    vi.useFakeTimers(); const s = setup("client"); s.delayWindow(); const pending = send(s.store);
    const rejected = expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_SEND_WINDOW_NOT_SHOWN" });
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(ops(s.calls)).toEqual(["window.open"]); expect(s.listenerCount()).toBe(0);
  });
});
