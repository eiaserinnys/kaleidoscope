import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../e2e/fixtures/process/client.js?raw";
import { clientSource } from "../blocks/sandbox-frame";
import { cleanupFrameScripts, runFrameScript } from "./frame-script";

afterEach(cleanupFrameScripts);

it("준비 콜백의 계속되는 출력 읽기가 창 닫기를 막지 않는다", async () => {
  vi.useFakeTimers();
  const source = clientSource(fixture, { state: {}, stateKeys: [], storageEntries: [], token: "시험", processEnabled: true });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const scripts = [...doc.querySelectorAll<HTMLScriptElement>("script")];
  const decode = (script: HTMLScriptElement) => new TextDecoder().decode(Uint8Array.from(atob(script.src.split(",")[1]), (char) => char.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  runFrameScript(decode(scripts[0]));
  runFrameScript(decode(scripts[1]));
  const host = (data: object) => window.dispatchEvent(new MessageEvent("message", { source: window, data }));
  host({ type: "ks-client-lifecycle", lifecycle: { phase: "ready", visible: true, focused: true, viewport: {} } });
  await vi.waitFor(() => expect(post.mock.calls.some(([value]) => value.type === "ks-client-process" && value.method === "attach")).toBe(true));
  const attach = post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-client-process" && value.method === "attach");
  host({ type: "ks-client-reply", requestId: attach.requestId, result: { handle: "process", after: 0, checkpoint: null } });
  await vi.waitFor(() => expect(post.mock.calls.some(([value]) => value.type === "ks-client-process" && value.method === "read")).toBe(true));
  host({ type: "ks-client-lifecycle", lifecycle: { phase: "closing", visible: true, focused: true, viewport: {} } });
  host({ type: "ks-sandbox-flush", requestId: "close" });
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-flushed", requestId: "close", ok: true }), "*"));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
