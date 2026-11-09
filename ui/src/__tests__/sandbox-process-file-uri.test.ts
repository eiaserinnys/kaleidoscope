import { afterEach, expect, it, vi } from "vitest";
import { clientSource, sandboxErrors } from "../blocks/sandbox-frame";
import { cleanupFrameScripts, runFrameScript } from "./frame-script";

afterEach(cleanupFrameScripts);

it("exposes process.file_uri through the process bridge", async () => {
  const html = clientSource(
    "window.__fileUri = window.kaleidoscope.process.file_uri('cache/item');",
    { state: {}, stateKeys: [], storageEntries: [], token: "시험", processEnabled: true, errors: sandboxErrors() },
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = [...doc.querySelectorAll<HTMLScriptElement>("script")];
  const decode = (script: HTMLScriptElement) => new TextDecoder().decode(Uint8Array.from(atob(script.src.split(",")[1]), (char) => char.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  runFrameScript(decode(scripts[0]));
  runFrameScript(decode(scripts[1]));

  const request = post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-client-process" && value.method === "file_uri");
  expect(request?.params).toEqual({ blob_key: "cache/item" });
  window.dispatchEvent(new MessageEvent("message", {
    source: window,
    data: { type: "ks-client-reply", requestId: request?.requestId, result: "file:///tmp/cache/item" },
  }));
  const bridge = window as unknown as { __fileUri: Promise<string> };
  await expect(bridge.__fileUri).resolves.toBe("file:///tmp/cache/item");
  vi.restoreAllMocks();
});
