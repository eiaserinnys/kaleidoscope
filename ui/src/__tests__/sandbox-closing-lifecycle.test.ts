import { expect, it, vi } from "vitest";
import { sandboxSource } from "../blocks/sandbox-frame";

it("오래 걸리는 change는 기다리지 않고 closing에서 시작한 저장은 기다린다", async () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: ["draft"], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const script = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(script.src.split(",")[1]), (char) => char.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const api = (window as unknown as { kaleidoscope: {
    onLifecycle: (listener: (event: { phase: string }) => Promise<void> | undefined) => void;
    setStorage: (entry: string, content: string) => Promise<unknown>;
  } }).kaleidoscope;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let changeStarted = false;
  api.onLifecycle(({ phase }) => {
    if (phase === "change") { changeStarted = true; return new Promise<void>(() => {}); }
    if (phase === "closing") return gate.then(() => { void api.setStorage("draft", "마지막 편집"); });
  });
  const host = (data: object) => window.dispatchEvent(new MessageEvent("message", { source: window, data }));
  host({ type: "ks-client-lifecycle", lifecycle: { phase: "change" } });
  host({ type: "ks-client-lifecycle", lifecycle: { phase: "closing" } });
  await Promise.resolve();
  expect(changeStarted).toBe(true);
  host({ type: "ks-sandbox-flush", requestId: "close" });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(post.mock.calls.some(([value]) => value.type === "ks-sandbox-flushed")).toBe(false);
  release();
  await vi.waitFor(() => expect(post.mock.calls.some(([value]) => value.type === "ks-sandbox-storage-set")).toBe(true));
  const write = post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-sandbox-storage-set");
  expect(write.content).toBe("마지막 편집");
  expect(post.mock.calls.some(([value]) => value.type === "ks-sandbox-flushed")).toBe(false);
  host({ type: "ks-sandbox-storage-reply", requestId: write.requestId, content: "마지막 편집" });
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-sandbox-flushed", requestId: "close", ok: true }), "*"));
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});
