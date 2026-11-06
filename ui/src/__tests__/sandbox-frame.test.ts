import { expect, it, vi } from "vitest";
import { sandboxSource } from "../blocks/sandbox-frame";
import tauriConfig from "../../../app/src-tauri/tauri.conf.json";

it("프레임 편집 명령은 부모와 해당 토큰만 받는다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "context-token" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const input = document.createElement("input"); input.value = "abc"; document.body.append(input); input.focus();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const exec = vi.fn(); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  new Function(code)();
  input.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-sandbox-context-command", token: "wrong", requestId: 1, action: "insertText", text: "추가" } }));
  expect(exec).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-sandbox-context-command", token: "context-token", requestId: 1, action: "insertText", text: "추가" } }));
  expect(exec).toHaveBeenCalledWith("insertText", false, "추가");
  input.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("선언된 지침과 같이 보기 요청은 프레임을 통해 전달된다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험", capabilities: ["instructions", "context_capture"] as any });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as any).kaleidoscope;
  void sdk.host.instructions("app_authoring");
  void sdk.context.prepare({ request_id: "말-1", channel: "chat", attachments: { count: 2, bytes: 123 } });
  void sdk.context.commit("ticket-1");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-instructions", kind: "app_authoring" }), "*");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-context-prepare", request_id: "말-1", channel: "chat", attachments: { count: 2, bytes: 123 } }), "*");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-context-commit", ticket: "ticket-1" }), "*");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("공통 프레임 브리지는 로컬 출력과 동작 및 표면 API를 제공한다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as unknown as { kaleidoscope: { publish: (value: object) => void; handle: (name: string, callback: () => void) => void; surfaces: { on: Function } } }).kaleidoscope;
  expect(typeof sdk.handle).toBe("function");
  expect(typeof sdk.surfaces.on).toBe("function");
  sdk.publish({ count: 1 });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-publish", patch: { count: 1 } }), "*");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("HTTP와 기기 보관 요청은 바이트를 전송 목록에 담는다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as any).kaleidoscope;
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  void sdk.http.read({ permission: "images", path: "/a", query: { q: "한글" } });
  void sdk.blobs.put({ key: "cache/a", bytes });
  void sdk.blobs.open({ key: "cache/a" });
  void sdk.blobs.remove({ key: "cache/a" });
  void sdk.blobs.list({ prefix: "cache/" });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-http-read", permission: "images", query: { q: "한글" } }), "*");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-blob-put", key: "cache/a", bytes }), "*", [bytes]);
  for (const type of ["ks-client-blob-open", "ks-client-blob-remove", "ks-client-blob-list"]) expect(post).toHaveBeenCalledWith(expect.objectContaining({ type }), "*");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("HTTP 요청은 문자열 본문을 UTF-8 바이트로 전송하고 응답을 돌려준다", async () => {
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const pending = (window as any).kaleidoscope.http.request({ permission: "net", method: "PUT", path: "/item", headers: { "if-match": "abc" }, body: "한글" });
  const request = post.mock.calls.map(([value]) => value).find((value) => value.type === "ks-client-http-request");
  expect(new TextDecoder().decode(request.body)).toBe("한글");
  expect(request).toMatchObject({ permission: "net", method: "PUT", path: "/item", headers: { "if-match": "abc" }, query: {} });
  const bytes = new Uint8Array([1, 2]).buffer;
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-client-reply", token: "시험", requestId: request.requestId, result: { status: 412, headers: { etag: "abc" }, bytes, mime: "text/plain" } } }));
  await expect(pending).resolves.toEqual({ status: 412, headers: { etag: "abc" }, bytes, mime: "text/plain" });
  vi.restoreAllMocks();
});

it("host 기능과 저장 대화상자는 capability와 선언 액션 안에서 프레임 요청으로 전달된다", async () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험", capabilities: ["share", "keep_awake"], actions: ["save-and-share"] });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as any).kaleidoscope;
  const pending: Promise<unknown>[] = [];
  sdk.handle("save-and-share", () => {
    pending.push(sdk.host.can_share("file-1").catch(() => undefined));
    pending.push(sdk.host.share("file-1", "메모").catch(() => undefined));
    pending.push(sdk.host.keep_awake(true).catch(() => undefined));
    pending.push(sdk.files.save_prompt({ suggested_name: "메모.txt", mime: "text/plain" }).catch(() => undefined));
  });
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-client-action", name: "save-and-share", context: {} } }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const requests = post.mock.calls.map(([value]) => value).filter((value) => value.type.startsWith("ks-client-") && value.type !== "ks-client-publish");
  expect(requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "ks-client-can-share", file_id: "file-1" }),
    expect.objectContaining({ type: "ks-client-share", file_id: "file-1", title: "메모" }),
    expect.objectContaining({ type: "ks-client-keep-awake", enabled: true }),
    expect.objectContaining({ type: "ks-client-save-prompt", suggested_name: "메모.txt", mime: "text/plain" }),
  ]));
  await expect(sdk.host.can_share("file-1")).rejects.toMatchObject({
    id: "SHELL_CLIENT_CAN_SHARE_ACTION_REQUIRED",
    message: "파일 공유 가능 여부 확인은 앱 동작 안에서 해야 합니다. 앱 코드를 고치세요.",
  });
  await expect(sdk.files.save_prompt({ suggested_name: "메모.txt", mime: "text/plain" })).rejects.toMatchObject({
    id: "SHELL_CLIENT_SAVE_PROMPT_ACTION_REQUIRED",
    message: "파일 저장 대화상자는 앱 동작 안에서 열어야 합니다. 앱 코드를 고치세요.",
  });
  expect(pending).toHaveLength(4);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("폴더 선택은 client 동작 안에서만 요청하고 선언 권한 grant 변화만 알린다", async () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험", actions: ["pick-folder"], filePermissions: ["docs"] });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as any).kaleidoscope;
  const changes: Array<string | null> = [];
  sdk.files.on_grant("docs", (name: string | null) => changes.push(name));
  sdk.files.on_grant("undeclared", () => changes.push("불가"));
  expect(sdk.files.grant("docs")).toBeNull();
  expect(sdk.files.grant("undeclared")).toBeNull();
  await expect(sdk.files.pick_folder("docs")).rejects.toMatchObject({ id: "SHELL_CLIENT_PICK_FOLDER_ACTION_REQUIRED" });

  sdk.handle("pick-folder", () => { void sdk.files.pick_folder("docs").catch(() => undefined); });
  window.dispatchEvent(new MessageEvent("message", { source: window, data: { token: "시험", type: "ks-client-action", name: "pick-folder", context: {} } }));
  await Promise.resolve();
  await Promise.resolve();
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-pick-folder", permission: "docs" }), "*");

  const grantEvent = (grants: object) => window.dispatchEvent(new MessageEvent("message", { source: window, data: { token: "시험", type: "ks-client-grants", grants } }));
  grantEvent({ docs: "작업 폴더", undeclared: "비공개" });
  expect(sdk.files.grant("docs")).toBe("작업 폴더");
  expect(changes).toEqual(["작업 폴더"]);
  grantEvent({});
  expect(sdk.files.grant("docs")).toBeNull();
  expect(changes).toEqual(["작업 폴더", null]);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("권한 파일 열기는 사용자 동작 바깥에서도 프레임 요청을 보낸다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  void (window as any).kaleidoscope.files.open({ permission: "docs", path: "그림.png" });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-client-file-open", permission: "docs", path: "그림.png" }), "*");
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("선언되지 않은 client 동작 메시지는 handler와 host API를 열지 않는다", async () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험", capabilities: ["keep_awake"], actions: [] });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as any).kaleidoscope;
  const handler = vi.fn(() => sdk.host.keep_awake(true));
  sdk.handle("undeclared", handler);

  window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-client-action", name: "undeclared", context: {} } }));
  await Promise.resolve();
  await Promise.resolve();

  expect(handler).not.toHaveBeenCalled();
  expect(post.mock.calls.map(([value]) => value.type)).not.toContain("ks-client-keep-awake");
  await expect(sdk.host.keep_awake(true)).rejects.toMatchObject({
    id: "SHELL_CLIENT_KEEP_AWAKE_ACTION_REQUIRED",
    message: "화면 켜짐 유지 요청은 앱 동작 안에서 해야 합니다. 앱 코드를 고치세요.",
  });
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("표면 가시 변화를 알리고 이전 세대의 detach는 새 표면을 지우지 않는다", () => {
  vi.useFakeTimers();
  const source = sandboxSource("<body></body>", { state: {}, stateKeys: [], storageEntries: [], token: "시험" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  const bridge = doc.querySelector<HTMLScriptElement>("script[data-ks-injected]")!;
  const code = new TextDecoder().decode(Uint8Array.from(atob(bridge.src.split(",")[1]), (c) => c.charCodeAt(0)));
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  new Function(code)();
  const sdk = (window as unknown as { kaleidoscope: { surfaces: { on: (id: string, listener: (surface: any) => void) => void } } }).kaleidoscope;
  const seen: any[] = [];
  sdk.surfaces.on("tile", (surface) => seen.push(surface));
  const send = (data: object) => window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "ks-client-surface", id: "tile", ...data } }));
  send({ phase: "attach", generation: 1, canvas: {}, css_width: 100, css_height: 100, dpr: 1, visible: false });
  expect(seen[0].visible).toBe(false);
  const changed = vi.fn(); seen[0].resize.addEventListener("resize", changed);
  send({ phase: "visibility", generation: 1, visible: true });
  expect(seen[0].visible).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  send({ phase: "attach", generation: 2, canvas: {}, css_width: 100, css_height: 100, dpr: 1, visible: true });
  send({ phase: "detach", generation: 1 });
  expect(seen).toHaveLength(2);
  send({ phase: "detach", generation: 2 });
  expect(seen.at(-1)).toBeNull();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("부모 프레임 정책은 HTTP 주소로의 이동을 허용하지 않는다", () => {
  expect(tauriConfig.app.security.csp).toContain("frame-src data: blob:");
  expect(tauriConfig.app.security.csp).not.toContain("frame-src 'self'");
});

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

it("자동 공유는 암호와 숨겨진 입력값을 보내지 않는다", async () => {
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
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
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
