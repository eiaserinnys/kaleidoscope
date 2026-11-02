import { expect, it, vi } from "vitest";

it("프레임 호버와 포인터 이동은 부모에게 상태를 보내지 않는다", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  if (!globalThis.CSS) vi.stubGlobal("CSS", {});
  document.body.innerHTML = '<button data-ks-n="1">대상</button><p data-ks-n="2">다음</p>';
  const send = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  await import("../blocks/html-bridge/main");
  send.mockClear();
  window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "ks-html-mode", mode: "select" } }));
  document.querySelector("button")!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
  document.querySelector("p")!.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(send).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "ks-html-theme", tokens: { "--ks-color-accent": "#abcdef" } } }));
  expect(document.documentElement.style.getPropertyValue("--ks-color-accent")).toBe("#abcdef");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  send.mockRestore();
  vi.unstubAllGlobals();
});
