import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, ShellSnapshot } from "../contract/contract";
import { CLIENT_PING_TIMEOUT_SECS } from "../contract/limits";
import type { ShellStore } from "../core/shell-store";
import type { WindowData } from "../data/window-data";
import { sandboxSource } from "../blocks/sandbox-frame";
import { ClientRuntime, deliverClientMessage } from "../runtime/client-runtime";

const input = { request_id: "입력-1", text: "안녕" };
const timeout = CLIENT_PING_TIMEOUT_SECS * 1000;

function setup(capabilities = ["receive_message"], dormant = false) {
  const definition = { id: "app", name: "받는 앱", assets: [] } as unknown as AppDefinition;
  let snapshot = {
    device: { active_workspace_id: null, active_desktop_ids: {}, grants: [] },
    link: { state: "connected", mode: "remote", server_url: "https://one", device_name: "PC" },
    shared: { windows: [{ id: "window-1", app_id: "app", app_version: 1, desktop_id: "desktop-1", state: {} }], app_versions: [{ app_id: "app", version: 1, definition }], desktops: [{ id: "desktop-1", workspace_id: "workspace-1" }] },
  } as unknown as ShellSnapshot;
  const listeners = new Set<() => void>();
  const store = { getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, subscribeEvents: () => () => {}, call: vi.fn(async () => ({ op: "data.media", media: { mime: "text/javascript", data_base64: "Y29uc29sZS5sb2coMSk=" } })), nativeFiles: false } as unknown as ShellStore;
  const data = { windowId: "window-1", failClient: vi.fn(), clientDormant: dormant } as unknown as WindowData;
  const client = { entry: { id: "runtime", version: 1 }, state_keys: [], storage_entries: [], inputs: {}, actions: [], commands: {}, capabilities };
  const runtime = new ClientRuntime(store, data, definition, client as never);
  const receive = (type: string, extra: object = {}) => {
    const frame = document.querySelector("iframe")!;
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { token: (runtime as any).token, type, ...extra } }));
  };
  const update = (next: ShellSnapshot) => { snapshot = next; listeners.forEach((fn) => fn()); };
  const stop = () => {
    const stopping = runtime.stop();
    for (const requestId of (runtime as any).pending.keys()) receive("ks-sandbox-flushed", { requestId, ok: true });
    return stopping;
  };
  return { store, runtime, receive, update, stop, get snapshot() { return snapshot; } };
}

async function started(s: ReturnType<typeof setup>) {
  await s.runtime.start();
  const frame = document.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  return { post, request: () => post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-client-message") };
}

describe("창 메시지 전달", () => {
  afterEach(() => { document.querySelector(".ks-client-frames")?.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("늦게 등록된 숨긴 dormant 창이 두 준비 신호를 보낸 뒤에만 전달하고 accepted를 반환한다", async () => {
    const s = setup(["receive_message"], true);
    const pending = deliverClientMessage(s.store, "window-1", input);
    const { post, request } = await started(s);
    const frame = document.querySelector("iframe")!;
    const token = (s.runtime as any).token;
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: "null", data: { type: "ks-client-message-ready", token } }));
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://wrong", data: { type: "ks-client-message-ready", token } }));
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { type: "ks-client-message-ready", token: "wrong" } }));
    s.receive("ks-sandbox-ready");
    expect(request()).toBeUndefined();
    s.receive("ks-client-message-ready");
    expect(request()).toMatchObject({ message: input });
    s.receive("ks-client-message-result", { requestId: request().requestId, result: { status: "accepted" } });
    await expect(pending).resolves.toEqual({ status: "accepted" });
    expect(post).toHaveBeenCalled();
    await s.stop();
  });

  it("not_ready와 앱의 구조화 오류를 그대로 돌려준다", async () => {
    const s = setup(); const { post, request } = await started(s);
    s.receive("ks-sandbox-ready"); s.receive("ks-client-message-ready");
    const first = deliverClientMessage(s.store, "window-1", input);
    s.receive("ks-client-message-result", { requestId: request().requestId, result: { status: "not_ready", reason: "먼저 로그인하세요" } });
    await expect(first).resolves.toEqual({ status: "not_ready", reason: "먼저 로그인하세요" });
    const second = deliverClientMessage(s.store, "window-1", input);
    const id = post.mock.calls.map(([value]) => value).filter((value) => value.type === "ks-client-message").at(-1).requestId;
    const error = { id: "APP_ERROR", code: "invalid_request", message: "앱 오류", details: [] };
    s.receive("ks-client-message-result", { requestId: id, error });
    await expect(second).rejects.toEqual(error);
    await s.stop();
  });

  it("잘못된 결과는 형식 오류로 끝난다", async () => {
    const s = setup(); const { request } = await started(s); s.receive("ks-sandbox-ready"); s.receive("ks-client-message-ready");
    const pending = deliverClientMessage(s.store, "window-1", input);
    s.receive("ks-client-message-result", { requestId: request().requestId, result: { status: "not_ready" } });
    await expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_RECEIVE_RESULT_INVALID" });
    await s.stop();
  });

  it("선언 없는 준비 신호는 무시하고 시작 시간을 제한한다", async () => {
    vi.useFakeTimers(); const s = setup([]); await started(s); s.receive("ks-sandbox-ready"); s.receive("ks-client-message-ready");
    const pending = deliverClientMessage(s.store, "window-1", input); const checked = expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_RECEIVER_START_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(timeout); await checked; await s.stop();
  });

  it("수신 준비 뒤 응답이 없으면 별도 시간 초과를 반환한다", async () => {
    vi.useFakeTimers(); const s = setup(); await started(s); s.receive("ks-sandbox-ready"); s.receive("ks-client-message-ready");
    const pending = deliverClientMessage(s.store, "window-1", input); const checked = expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_RECEIVE_REPLY_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(timeout); await checked; await s.stop();
  });

  it.each(["before-runtime", "ready", "reply"])("%s 대기 중 종료되면 닫힘으로 끝난다", async (stage) => {
    const s = setup(); let request: (() => any) | undefined;
    if (stage !== "before-runtime") ({ request } = await started(s));
    if (stage === "reply") { s.receive("ks-sandbox-ready"); s.receive("ks-client-message-ready"); }
    const pending = deliverClientMessage(s.store, "window-1", input);
    if (stage === "reply") expect(request!()).toBeDefined();
    const stopping = s.stop();
    await expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_RECEIVER_CLOSED" });
    await stopping;
  });

  it.each(["window", "server"])("%s 변경으로 대기를 종료한다", async (kind) => {
    const s = setup(); const pending = deliverClientMessage(s.store, "window-1", input);
    const next = structuredClone(s.snapshot);
    if (kind === "window") next.shared.windows = [];
    else next.link = { state: "connected", mode: "remote", server_url: "https://two", device_name: "PC" };
    s.update(next);
    await expect(pending).rejects.toMatchObject({ id: "SHELL_MESSAGE_RECEIVER_CLOSED" });
  });
});

it("프레임 SDK는 선언된 앱에만 onMessage를 주고 handler가 끝난 뒤 결과나 오류를 보낸다", async () => {
  vi.useFakeTimers();
  const make = (capabilities: any[]) => {
    const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험", capabilities });
    const script = new DOMParser().parseFromString(source, "text/html").querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
    new Function(new TextDecoder().decode(Uint8Array.from(atob(script.src.split(",")[1]), (c) => c.charCodeAt(0))))();
    return (window as any).kaleidoscope;
  };
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  expect(make([]).onMessage).toBeUndefined();
  const sdk = make(["receive_message"]); let finish!: (value: unknown) => void; let failNext = false; let failKnown = false;
  sdk.onMessage(vi.fn(() => { if (failKnown) throw Object.assign(new Error("원본 오류"), { id: "KNOWN_ERROR", code: "invalid_request" }); if (failNext) throw new Error("실패"); return new Promise((resolve) => { finish = resolve; }); }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-message-ready" }), "*");
  const send = (requestId: string) => window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-client-message", token: "시험", requestId, message: input } }));
  send("요청-1"); await Promise.resolve();
  expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-message-result", requestId: "요청-1" }), "*");
  finish({ status: "accepted" });
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-message-result", requestId: "요청-1", result: { status: "accepted" } }), "*"));
  failNext = true; send("요청-2");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-message-result", requestId: "요청-2", error: expect.objectContaining({ id: "SHELL_CLIENT_ACTION_FAILED" }) }), "*"));
  failKnown = true; send("요청-3");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-message-result", requestId: "요청-3", error: { id: "KNOWN_ERROR", code: "invalid_request", message: "원본 오류", details: [] } }), "*"));
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});
