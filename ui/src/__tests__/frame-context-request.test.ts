import { afterEach, expect, it, vi } from "vitest";
import { sandboxSource } from "../blocks/sandbox-frame";
import { cleanupFrameScripts, runFrameScript } from "./frame-script";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
afterEach(cleanupFrameScripts);

for (const kind of ["sandbox", "html"] as const) {
  it(`${kind} 편집은 현재 메뉴 요청의 대상에 초점을 돌려 적용한다`, async () => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    document.body.innerHTML = '<input id="a" value="abc"><textarea id="b">def</textarea>';
    const a = document.querySelector<HTMLInputElement>("#a")!;
    const b = document.querySelector<HTMLTextAreaElement>("#b")!;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const exec = vi.fn(); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    if (kind === "sandbox") {
      const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "request-token" });
      const bridge = new DOMParser().parseFromString(source, "text/html").querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
      runFrameScript(new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), c => c.charCodeAt(0))));
    } else await import("../blocks/html-bridge/main");
    const menu = (field: HTMLElement): number => {
      field.focus(); field.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const message = post.mock.calls.map(([data]) => data).reverse().find(data => data.type === `ks-${kind}-context-menu`);
      expect(message.requestId).toEqual(expect.any(Number));
      return message.requestId;
    };
    const command = (requestId: number, action: string) => window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: `ks-${kind}-context-command`, token: "request-token", requestId, action, text: "추가" } }));
    const first = menu(a);
    b.focus(); command(first, "insertText");
    expect(exec).toHaveBeenCalledWith("insertText", false, "추가"); expect(document.activeElement).toBe(a);
    exec.mockClear();
    const second = menu(b);
    expect(second).not.toBe(first);
    command(first, "delete"); command(first, "selectAll");
    expect(exec).not.toHaveBeenCalled(); expect(b.selectionEnd).toBe(0);
    expect(document.activeElement).toBe(b);
    b.blur(); expect(document.activeElement).toBe(document.body);
    command(second, "insertText"); expect(exec).toHaveBeenCalledWith("insertText", false, "추가");
    expect(document.activeElement).toBe(b);
    command(second, "delete"); expect(exec).toHaveBeenCalledWith("delete", false, undefined);
    command(second, "selectAll"); expect(b.selectionStart).toBe(0); expect(b.selectionEnd).toBe(3);
  });
}
