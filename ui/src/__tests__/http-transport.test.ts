import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpTransport } from "../core/http-transport";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP core transport errors", () => {
  it("keeps a structured core error instead of replacing it with the unreadable-response message", async () => {
    class FakeEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      close() {}
    }
    const error = { code: "invalid_name", message: "이 이름은 사용할 수 없습니다.", details: [] };
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 400,
      json: async () => error,
    }));
    const transport = createHttpTransport("http://127.0.0.1:4219");

    await expect(transport.call({
      op: "files.write", window_id: "viewer-window", permission: "docs", path: "bad:name.md", text: "",
    })).rejects.toMatchObject(error);
  });
});
