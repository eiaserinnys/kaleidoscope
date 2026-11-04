import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoreEvent, CoreRequest } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { registerControlWindow } from "../share/window-control";

const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
let unregister: (() => void) | undefined;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
});
afterEach(() => { unregister?.(); unregister = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(failCapture = false) {
  document.body.innerHTML = '<section class="ks-window"><div class="ks-window-title">제목</div><main><button>실행</button></main></section>';
  let listener: (event: CoreEvent) => void = () => undefined;
  const operations: CoreRequest[] = [];
  const geometry = { css_width: 100, css_height: 100, pixel_width: 100, pixel_height: 100 };
  const call = vi.fn(async (request: CoreRequest) => {
    operations.push(request);
    if (request.op === "share.freeze") return { op: "share.freeze", frozen: true };
    if (request.op === "window.control.capture") {
      expect(document.documentElement.dataset.shareIsolating).toBe("true");
      expect(document.querySelector<HTMLElement>(".ks-window")?.dataset.shareTarget).toBe("true");
      if (failCapture) throw new Error("capture failed");
      return { op: "window.control.capture", image_base64: "png", geometry };
    }
    return { op: request.op };
  });
  const store = { call, subscribeEvents: (fn: (event: CoreEvent) => void) => { listener = fn; return () => undefined; } } as unknown as ShellStore;
  unregister = registerControlWindow("one", document.querySelector("main")!, store);
  const send = (operation: Record<string, unknown>) => listener({ event: "window.control", request: { request_id: "req", window_id: "one", expires_at: "2099-01-01T00:00:00Z", operation } } as CoreEvent);
  const response = async () => {
    await vi.waitFor(() => expect(operations.some((x) => x.op === "window.control.respond")).toBe(true));
    return operations.find((x) => x.op === "window.control.respond") as Extract<CoreRequest, { op: "window.control.respond" }>;
  };
  return { send, response, operations };
}

it.each([false, true])("읽기 요청 image=%s를 순서대로 응답한다", async (image) => {
  const { send, response, operations } = setup();
  send({ kind: "read", image });
  const reply = await response();
  expect(reply.response.result.status).toBe("ok");
  if (reply.response.result.status === "ok") {
    expect(reply.response.result.value.after.window_title).toBe("제목");
    expect(reply.response.result.value.after.image_base64).toBe(image ? "png" : undefined);
  }
  expect(operations.map((x) => x.op)).toEqual(image ? ["share.freeze", "window.control.capture", "share.unfreeze", "window.control.respond"] : ["window.control.respond"]);
  expect(document.documentElement.dataset.shareIsolating).toBeUndefined();
  expect(document.querySelector("[data-share-target]")).toBeNull();
});

it.each([false, true])("조작 뒤 캡처 실패=%s에서도 적용 상태를 지킨다", async (failCapture) => {
  const { send, response, operations } = setup(failCapture);
  send({ kind: "read", image: false });
  const first = await response();
  if (first.response.result.status !== "ok") throw new Error("read failed");
  const after = first.response.result.value.after;
  const target = Number(after.text.match(/\[(\d+)\].*실행/)?.[1]);
  operations.length = 0;
  send({ kind: "act", image: true, view_id: after.view_id, action: { kind: "click", target } });
  const reply = await response();
  expect(reply.response.result.status).toBe(failCapture ? "error" : "ok");
  if (reply.response.result.status === "error") expect(reply.response.result.applied).toBe(true);
  expect(operations.map((x) => x.op)).toEqual(["share.freeze", "window.control.capture", "share.unfreeze", "window.control.respond"]);
  expect(document.querySelector("[data-share-target]")).toBeNull();
});

it("그림 없는 조작은 캡처하지 않고 응답한다", async () => {
  const { send, response, operations } = setup();
  send({ kind: "read", image: false });
  const first = await response();
  if (first.response.result.status !== "ok") throw new Error("read failed");
  const after = first.response.result.value.after;
  const target = Number(after.text.match(/\[(\d+)\].*실행/)?.[1]);
  operations.length = 0;
  send({ kind: "act", image: false, view_id: after.view_id, action: { kind: "click", target } });
  expect((await response()).response.result.status).toBe("ok");
  expect(operations.map((x) => x.op)).toEqual(["window.control.respond"]);
});

it("읽기 중 캡처가 실패하면 적용하지 않은 오류로 답한다", async () => {
  const { send, response } = setup(true);
  send({ kind: "read", image: true });
  const result = (await response()).response.result;
  expect(result.status).toBe("error");
  if (result.status === "error") expect(result.applied).toBe(false);
  expect(document.documentElement.dataset.shareIsolating).toBeUndefined();
});
