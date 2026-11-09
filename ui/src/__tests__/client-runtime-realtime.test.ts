import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealtime } from "../runtime/realtime-socket";
import { cleanupFrameScripts, runFrameScript } from "./frame-script";

afterEach(cleanupFrameScripts);

function deferred<T>() {
  let resolve!: (value:T) => void;
  let reject!: (reason:unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const pending = deferred<{ handle:string; protocol:string }>();
  const cancel = vi.fn();
  const bridge = { open: vi.fn(() => ({ result:pending.promise, cancel })), send:vi.fn(async (_handle: string, _data: string | ArrayBuffer) => {}), close:vi.fn(async () => {}), login:vi.fn(async () => {}) };
  const error = { id:"SHELL_REALTIME_URL_INVALID", code:"invalid_request" as const, message:"잘못된 경로 __PATH__", details:[] };
  const api = createRealtime(bridge, { urlInvalid:error, sendTypeInvalid:error, sendConnecting:error, binaryTypeUnsupported:error, protocolInvalid:error, queueFull:error, messageTooLarge:error });
  return { api, bridge, pending, cancel };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("실시간 연결 생성자", () => {
  it("생성 직후 리스너를 등록하고 open, message, close 순서로 받는다", async () => {
    const f = fixture();
    const Socket = f.api.webSocketConstructor("live");
    expect(Socket.CONNECTING).toBe(0);
    expect(Socket.OPEN).toBe(1);
    expect(Socket.CLOSING).toBe(2);
    expect(Socket.CLOSED).toBe(3);
    const socket = new Socket("/socket");
    const events:string[] = [];
    socket.addEventListener("open", () => events.push("open"));
    const removed = () => events.push("제거된 리스너");
    socket.addEventListener("message", removed);
    socket.removeEventListener("message", removed);
    socket.onmessage = () => events.push("message");
    socket.onclose = () => events.push("close");
    f.pending.resolve({ handle:"handle", protocol:"" });
    await tick();
    f.api.event({ handle:"handle", event:"message", data:"안녕" });
    f.api.event({ handle:"handle", event:"close", code:1000, reason:"", wasClean:true });
    f.api.event({ handle:"handle", event:"close", code:1000, reason:"", wasClean:true });
    expect(events).toEqual(["open", "message", "close"]);
  });

  it("ArrayBufferView에서 선택한 범위만 보내고 원본을 유지한다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); f.pending.resolve({ handle:"handle", protocol:"" }); await tick();
    const bytes = new Uint8Array([8, 1, 2, 9]);
    socket.send(bytes.subarray(1, 3));
    expect(Array.from(new Uint8Array(f.bridge.send.mock.calls[0][1] as ArrayBuffer))).toEqual([1, 2]);
    expect(Array.from(bytes)).toEqual([8, 1, 2, 9]);
  });

  it("잘못된 주소의 인증 정보와 쿼리를 오류에 싣지 않는다", () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const construct = () => new Socket("wss://user:private@example.test/socket?token=secret");
    try { construct(); throw new Error("주소가 거부되지 않았습니다"); }
    catch (error) { expect((error as Error).message).toContain("/socket"); expect((error as Error).message).not.toContain("private"); expect((error as Error).message).not.toContain("secret"); }
    expect(f.bridge.open).not.toHaveBeenCalled();
  });

  it("메시지가 8MiB를 넘으면 전송하지 않고 오류 뒤 1009로 닫는다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); f.pending.resolve({ handle:"handle", protocol:"" }); await tick();
    const events:string[] = []; socket.onerror = () => events.push("error"); socket.onclose = (event) => events.push(`close:${event.code}`);
    socket.send(new Uint8Array(8 * 1024 * 1024 + 1));
    expect(events).toEqual(["error", "close:1009"]); expect(f.bridge.send).not.toHaveBeenCalled(); expect(f.bridge.close).toHaveBeenCalledTimes(1);
  });

  it("빈 메시지도 송신 대기 개수에 포함하고 초과하면 1013으로 닫는다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); f.pending.resolve({ handle:"handle", protocol:"" }); await tick();
    const closed = vi.fn(); socket.onclose = closed;
    for (let index = 0; index < 257; index++) socket.send("");
    expect(closed).toHaveBeenCalledTimes(1); expect(closed.mock.calls[0][0].code).toBe(1013);
  });

  it("열기 전 close는 즉시 한 번 닫히며 늦은 성공에서 열리지 않는다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); const events:string[] = [];
    socket.onopen = () => events.push("open"); socket.onmessage = () => events.push("message");
    socket.onclose = (event:CloseEvent) => events.push(`close:${event.code}:${event.wasClean}`);
    socket.close(3001, "사유"); socket.close();
    expect(socket.readyState).toBe(Socket.CLOSED);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    f.pending.resolve({ handle:"late", protocol:"" }); await tick();
    f.api.event({ handle:"late", event:"message", data:"늦은 값" });
    expect(events).toEqual(["close:1006:false"]);
  });

  it("열기 실패는 error 다음 close를 한 번 보낸다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); const events:string[] = [];
    socket.onerror = (event:Event) => { const problem = (event as Event & { error: { code: string; permission: string } }).error; expect(problem).toMatchObject({ code: "login_required", permission: "live" }); events.push("error"); };
    socket.onclose = () => events.push("close");
    f.pending.reject({ id:"CONN_REALTIME_LOGIN_REQUIRED", code:"login_required", message:"로그인", details:[] });
    await tick(); expect(events).toEqual(["error", "close"]);
  });

  it("재시도 대기 시간을 오류 이벤트에 전달한다", async () => {
    const f = fixture(); const Socket = f.api.webSocketConstructor("live");
    const socket = new Socket("/socket"); const seen = vi.fn(); socket.onerror = seen;
    f.pending.reject({ id:"CONN_REALTIME_OPEN_RATE_LIMITED", code:"server", message:"대기", details:["retry_after_secs=30"] });
    await tick(); expect(seen.mock.calls[0][0].error).toMatchObject({ permission:"live", retry_after_secs:30 });
  });
});

describe("실시간 호스트 브리지", () => {
  it("응답보다 빠른 ready를 놓치지 않고 전달 뒤에 확인한다", async () => {
    const { ClientRealtime } = await import("../runtime/client-realtime");
    const opening = deferred<{ handle:string; protocol:string | null }>();
    const sent: any[] = []; const replies: any[] = []; const calls: any[] = [];
    const meta = new TextEncoder().encode(JSON.stringify({ session:"session", sequence:1, kind:"text" }));
    const payload = new TextEncoder().encode("문자");
    const packet = new Uint8Array(4 + meta.length + payload.length);
    new DataView(packet.buffer).setUint32(0, meta.length); packet.set(meta, 4); packet.set(payload, 4 + meta.length);
    const store = {
      call: vi.fn(async (req:any) => { calls.push(req); if (req.op === "connection.realtime.session") return { session:"session" }; if (req.op === "connection.realtime.open") return opening.promise; return {}; }),
      bytes: vi.fn(async () => packet.buffer),
    };
    const host = new ClientRealtime(store as never, "window", ["live"], (event) => sent.push(event), (...reply) => replies.push(reply));
    await host.start();
    const pending = host.request("1", "open", { permission:"live", path:"/socket", protocols:[] });
    host.event({ event:"connection.realtime.ready", window_id:"window", session:"session", handle:"handle" });
    opening.resolve({ handle:"handle", protocol:null }); await pending; await tick();
    expect(replies[0][1].handle).toBe("handle");
    expect(sent[0]).toMatchObject({ event:"message", data:"문자", sequence:1 });
    expect(calls.filter((request) => request.op === "connection.realtime.ack")).toHaveLength(0);
    await host.delivered("handle", 1);
    expect(calls.filter((request) => request.op === "connection.realtime.ack")).toMatchObject([{ through:1 }]);
  });

  it("열기 중 취소를 다섯 번 반복해도 종료 ACK로 슬롯을 비우고 다음 연결을 연다", async () => {
    const { ClientRealtime } = await import("../runtime/client-realtime");
    let opening = deferred<{ handle:string; protocol:string | null }>();
    const sent = vi.fn(); const reply = vi.fn(); const calls:any[] = [];
    const slots = new Map<string, number>();
    const store = {
      call: vi.fn(async (req:any) => {
        calls.push(req);
        if (req.op === "connection.realtime.session") return { session:"session" };
        if (req.op === "connection.realtime.open") {
          if (slots.size >= 4) throw { id:"CONN_REALTIME_OPEN_LIMIT", code:"invalid_request", message:"한도", details:[] };
          return opening.promise;
        }
        if (req.op === "connection.realtime.close") slots.set(req.handle, 1);
        if (req.op === "connection.realtime.ack") {
          if (req.through === 2) slots.delete(req.handle);
          else slots.set(req.handle, 2);
        }
        return {};
      }),
      bytes: vi.fn(async (req:any) => {
        const sequence = slots.get(req.handle);
        const meta = new TextEncoder().encode(JSON.stringify({ session:"session", sequence, kind:sequence === 1 ? "text" : sequence === 2 ? "terminal" : "empty", terminal:{ code:1000, reason:"", was_clean:true } }));
        const packet = new Uint8Array(4 + meta.length);
        new DataView(packet.buffer).setUint32(0, meta.length); packet.set(meta, 4);
        return packet.buffer;
      }),
    };
    const host = new ClientRealtime(store as never, "window", ["live"], sent, reply);
    await host.start();
    for (let index = 0; index < 5; index++) {
      opening = deferred();
      const pending = host.request(String(index), "open", { permission:"live", path:"/socket", protocols:[] });
      await host.request(String(index), "close", {});
      const handle = `late-${index}`;
      slots.set(handle, 0);
      opening.resolve({ handle, protocol:null }); await pending; await tick();
      expect(slots.size).toBe(0);
    }
    expect(calls.filter((req) => req.op === "connection.realtime.close")).toHaveLength(5);
    expect(calls.filter((req) => req.op === "connection.realtime.ack")).toHaveLength(10);
    expect(sent).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled();
    opening = deferred();
    const next = host.request("next", "open", { permission:"live", path:"/socket", protocols:[] });
    opening.resolve({ handle:"next", protocol:null }); await next;
    expect(reply).toHaveBeenCalledWith("next", { handle:"next", protocol:"" });
  });
});

it("프레임 출처와 토큰을 확인하고 파일 없는 client도 세션을 해제한다", async () => {
  const { ClientRuntime } = await import("../runtime/client-runtime");
  const empty = new TextEncoder().encode(JSON.stringify({ session:"session", kind:"empty" }));
  const packet = new Uint8Array(4 + empty.length); new DataView(packet.buffer).setUint32(0, empty.length); packet.set(empty, 4);
  const snapshot = { device:{ active_workspace_id:"workspace", active_desktop_ids:{ workspace:"desktop" }, grants:[] }, shared:{ windows:[{ id:"window", desktop_id:"desktop", minimized:false, state:{} }], desktops:[{ id:"desktop", workspace_id:"workspace" }] } };
  const call = vi.fn(async (request:any) => {
    if (request.op === "data.media") return { op:request.op, media:{ mime:"text/javascript", data_base64:"" } };
    if (request.op === "connection.realtime.session") return { op:request.op, session:"session" };
    if (request.op === "connection.realtime.open") return { op:request.op, handle:"owned", protocol:null };
    return { op:request.op };
  });
  const store = { call, bytes:vi.fn(async () => packet.buffer), nativeFiles:false, getSnapshot:() => snapshot, subscribe:() => () => {}, subscribeEvents:() => () => {} };
  const client = { entry:{ id:"script", version:1 }, realtime_permissions:["live"], state_keys:[], storage_entries:[], inputs:{}, actions:[], commands:{} };
  const data = { windowId:"window", clientHost:null, failClient:vi.fn(), setClientReady:vi.fn(), setNotice:vi.fn() };
  const runtime = new ClientRuntime(store as never, data as never, { assets:[], permissions:[] } as never, client as never);
  await runtime.start();
  const frame = document.querySelector<HTMLIFrameElement>(".ks-client-frames iframe")!;
  const token = (runtime as any).token;
  const request = { type:"ks-client-realtime", requestId:"1", method:"open", params:{ permission:"live", path:"/socket", protocols:[] } };
  window.dispatchEvent(new MessageEvent("message", { source:frame.contentWindow, origin:"null", data:{ ...request, token:"fake" } }));
  window.dispatchEvent(new MessageEvent("message", { source:window, origin:"null", data:{ ...request, token } }));
  await tick();
  expect(call.mock.calls.filter(([value]) => value.op === "connection.realtime.open")).toHaveLength(0);
  window.dispatchEvent(new MessageEvent("message", { source:frame.contentWindow, origin:"null", data:{ ...request, token } }));
  await tick();
  expect(call.mock.calls.filter(([value]) => value.op === "connection.realtime.open")).toHaveLength(1);
  await runtime.stop();
  expect(call.mock.calls.filter(([value]) => value.op === "connection.realtime.release")).toMatchObject([[{ session:"session" }]]);
  expect(call.mock.calls.filter(([value]) => value.op === "client.release")).toHaveLength(0);
});

it("가짜 코어는 실제 실시간 코어가 필요하다고 알린다", async () => {
  const { createFakeTransport } = await import("../core/fake-transport");
  const { makeTestSeed } = await import("./fixtures");
  const fake = createFakeTransport(makeTestSeed());
  await expect(fake.call({ op:"connection.realtime.session", window_id:"window" })).rejects.toMatchObject({ id:"SHELL_REALTIME_NATIVE_CORE_REQUIRED", code:"unavailable" });
});

it("로그인은 선언된 앱 동작 안에서만 호스트에 요청한다", async () => {
  vi.useFakeTimers();
  const { sandboxSource } = await import("../blocks/sandbox-frame");
  const source = sandboxSource("<body></body>", { state:{}, stateKeys:[], storageEntries:[], token:"시험", actions:["login"], realtimePermissions:["live"], realtimeNames:{ live:"example" }, realtimeSession:"session" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const script = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(script.src.split(",")[1]), (character) => character.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  runFrameScript(code);
  const api = (window as any).kaleidoscope;
  await expect(api.connection.login("live")).rejects.toMatchObject({ id:"CONN_REALTIME_LOGIN_REQUIRED", code:"login_required" });
  api.handle("login", () => { void api.connection.login("live"); });
  window.dispatchEvent(new MessageEvent("message", { source:window, data:{ type:"ks-client-action", name:"login", context:{} } }));
  await Promise.resolve(); await Promise.resolve();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type:"ks-client-realtime", method:"login", params:{ permission:"live" } }), "*");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("호스트는 같은 연결의 전송과 종료를 받은 순서대로 처리한다", async () => {
  const { ClientRealtime } = await import("../runtime/client-realtime");
  const first = deferred<void>();
  const order: string[] = [];
  const metadata = new TextEncoder().encode(JSON.stringify({ session:"session", kind:"empty" }));
  const empty = new Uint8Array(4 + metadata.length);
  new DataView(empty.buffer).setUint32(0, metadata.length); empty.set(metadata, 4);
  const store = {
    call: vi.fn(async (request: any) => {
      if (request.op === "connection.realtime.session") return { session:"session" };
      if (request.op === "connection.realtime.open") return { handle:"handle", protocol:null };
      if (request.op === "connection.realtime.close") order.push("닫기");
      return {};
    }),
    bytes: vi.fn(async (request: any, packet: ArrayBuffer) => {
      if (request.op === "connection.realtime.read") return empty.buffer;
      const length = new DataView(packet).getUint32(0);
      const value = new TextDecoder().decode(packet.slice(4 + length));
      order.push(value);
      if (value === "첫째") await first.promise;
      return new ArrayBuffer(0);
    }),
  };
  const host = new ClientRealtime(store as never, "window", ["live"], () => {}, () => {});
  await host.start();
  await host.request("open", "open", { permission:"live", path:"/socket", protocols:[] });
  const one = host.request("one", "send", { handle:"handle", data:"첫째" });
  const two = host.request("two", "send", { handle:"handle", data:"둘째" });
  const close = host.request("close", "close", { handle:"handle" });
  await tick();
  expect(order).toEqual(["첫째"]);
  first.resolve(); await Promise.all([one, two, close]);
  expect(order).toEqual(["첫째", "둘째", "닫기"]);
});
