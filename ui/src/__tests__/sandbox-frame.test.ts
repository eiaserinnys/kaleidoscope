import { expect, it, vi } from "vitest";
import { sandboxSource } from "../blocks/sandbox-frame";

it("스크립트와 인라인 이벤트를 격리 프레임의 실행 가능한 코드로 옮긴다", () => {
  const source = sandboxSource('<html><head><script>window.글 = "안녕"</script></head><body><button onclick="this.dataset.done=event.type">누르기</button></body></html>', { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("connect-src data: blob:");
  const scripts = [...doc.querySelectorAll("script")];
  expect(scripts.length).toBe(3);
  expect(scripts.every((script) => script.src.startsWith("data:text/javascript;charset=utf-8;base64,"))).toBe(true);
  const original = scripts.find((script) => !script.hasAttribute("data-ks-injected"))!;
  expect(new TextDecoder().decode(Uint8Array.from(atob(original.src.split(",")[1]), (c) => c.charCodeAt(0)))).toContain('window.글 = "안녕"');
  expect(doc.querySelector("button")?.hasAttribute("onclick")).toBe(false);
  expect(doc.querySelector("button")?.hasAttribute("data-ks-on-id")).toBe(true);
  const button = doc.querySelector("button")!.cloneNode(true) as HTMLButtonElement;
  document.body.append(button);
  const handlers = scripts[scripts.length - 1];
  const handlerCode = new TextDecoder().decode(Uint8Array.from(atob(handlers.src.split(",")[1]), (c) => c.charCodeAt(0)));
  new Function(handlerCode)();
  button.click();
  expect(button.dataset.done).toBe("click");
  button.remove();
});

it("자동 공유는 암호와 숨겨진 입력값을 보내지 않는다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  document.body.innerHTML = '<input aria-label="보이는 입력" value="공개"><input type="password" value="암호값"><input hidden value="숨김값">';
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const share = post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-sandbox-share");
  expect(share.text).toContain("공개");
  expect(share.text).not.toContain("암호값");
  expect(share.text).not.toContain("숨김값");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();
});

it("body의 onload는 창 로드 때 body를 this로 받아 실행된다", () => {
  const source = sandboxSource('<body onload="this.dataset.loaded=event.type"></body>', { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  document.body.setAttribute("data-ks-on-id", doc.body.getAttribute("data-ks-on-id")!);
  const handler = [...doc.querySelectorAll<HTMLScriptElement>("script")].at(-1)!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(handler.src.split(",")[1]), (c) => c.charCodeAt(0)));
  new Function(code)();
  window.dispatchEvent(new Event("load"));
  expect(document.body.dataset.loaded).toBe("load");
  document.body.removeAttribute("data-ks-on-id");
  delete document.body.dataset.loaded;
});

it("로컬 download 링크는 허용하고 일반 링크 이동은 막는다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const prevented = (href: string, download: boolean) => {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    if (download) anchor.setAttribute("download", "file.txt");
    const child = document.createElement("span"); anchor.append(child); document.body.append(anchor);
    let wasPrevented = false;
    anchor.addEventListener("click", (event) => { wasPrevented = event.defaultPrevented; event.preventDefault(); });
    child.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    anchor.remove(); return wasPrevented;
  };
  expect(prevented("blob:https://example.test/file", true)).toBe(false);
  expect(prevented("data:text/plain,hello", true)).toBe(false);
  expect(prevented("blob:https://example.test/file", false)).toBe(true);
  expect(prevented("https://example.test/", true)).toBe(true);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});
