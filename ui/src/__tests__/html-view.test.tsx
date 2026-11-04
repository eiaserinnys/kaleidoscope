import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreRequest } from "../contract/contract";
import type { CoreTransport } from "../core/core-transport";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";
import definition from "../../../apps/html-report.json";
import { describeVisible } from "../share/visible";
import type { HtmlAnchor } from "../blocks/html-bridge/frame-protocol";
import { readThread, writeThreadChange } from "../blocks/html-document/storage";
import type { ShellStore } from "../core/shell-store";
import { ContextMenuHost } from "../components/context-menu";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const testAnchor: HtmlAnchor = { kind: "element", selector: "h1", selector_stable: false, path: "body > h1", tag: "h1", text: "제목", attrs: { id: null, role: null, aria_label: null, alt: null, href: null, src_hash: null }, quote: null, label: "h1", heading: "", rect: { x: 0, y: 0, w: 10, h: 10, vw: 300 } };

it("커멘트 문서가 없는 새 시안에서는 없는 문서를 읽지 않는다", async () => {
  const call = vi.fn(async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: "bucket", items: [{ doc: "시안/r1.html", revision: "r1", updated_at: "now", byte_size: 1 }] } };
    if (request.op === "storage.get") throw { code: "not_found", message: "없음", details: [] };
    throw new Error("unexpected request");
  });
  const store = { call } as unknown as ShellStore;
  const result = await readThread(store, "window", "drafts", "시안");
  expect(result).toEqual({ thread: { revisions: {}, comments: [] }, revision: null });
  expect(call.mock.calls.some(([request]) => request.op === "storage.get")).toBe(false);
});

it("커멘트 문서의 빠진 필드는 기본값으로 읽고 잘못된 구조는 거절한다", async () => {
  let content = JSON.stringify({ comments: [{ id: "one", anchor: testAnchor, comment: "수정", created_at: "now", status: "unknown" }] });
  const core = { call: vi.fn(async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/thread.json" }] } };
    if (request.op === "storage.get") return { op: "storage.get", result: { content, revision: "r1" } };
    throw new Error("unexpected request");
  }) } as unknown as ShellStore;
  const result = await readThread(core, "window", "drafts", "시안");
  expect(result.thread.revisions).toEqual({});
  expect(result.thread.comments[0]).toMatchObject({ rev: 1, status: "needs_agent_review", replies: [] });
  content = "{}";
  expect((await readThread(core, "window", "drafts", "시안")).thread).toEqual({ revisions: {}, comments: [] });
  content = JSON.stringify({ comments: "잘못된 구조" });
  await expect(readThread(core, "window", "drafts", "시안")).rejects.toThrow();
});

it("글 선택에서 구조 키는 요소를 바꾸지 않고 요소 선택의 삭제는 유지한다", async () => {
  const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }] } };
    if (request.op === "storage.get") return { op: "storage.get", result: { content: "<p>앞</p><p>대상 문단</p><p>뒤</p>", revision: "r1" } };
    return base.call(request as never);
  };
  render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  const frame = await screen.findByTitle("HTML 보기") as HTMLIFrameElement;
  await waitFor(() => expect(frame.srcdoc).toContain("대상 문단"));
  const doc = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  const n = Number(doc.querySelectorAll("p")[1].getAttribute("data-ks-n"));
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const dispatch = (data: object) => act(() => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data })); });
  dispatch({ type: "ks-html-select", selection: { n, anchor: { ...testAnchor, kind: "text", position: { start: 1, end: 3 } }, styles: {} } });
  post.mockClear();
  for (const key of [{ key: "Delete" }, { key: "Backspace" }, { key: "d", ctrl: true }, { key: "ArrowUp", alt: true }, { key: "ArrowDown", alt: true }]) {
    dispatch({ type: "ks-html-key", ctrl: false, alt: false, shift: false, ...key });
    expect(post.mock.calls.some(([message]) => message.type === "ks-html-edit")).toBe(false);
  }
  dispatch({ type: "ks-html-select", selection: { n, anchor: testAnchor, styles: {} } });
  dispatch({ type: "ks-html-key", key: "Backspace", ctrl: false, alt: false, shift: false });
  expect(post.mock.calls.some(([message]) => message.type === "ks-html-edit" && message.edit.kind === "remove")).toBe(true);
});

it("문서 머리 줄에서 고르기와 레일 면을 아이콘으로 바꾼다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const base = createFakeTransport(seed);
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: "bucket", items: [{ doc: "시안/r1.html", revision: "r1", updated_at: "now", byte_size: 1 }] } };
    if (request.op === "storage.get" && request.doc === "시안/r1.html") return { op: "storage.get", result: { kind: "md", content: "<p>시안</p>", revision: "r1", exists: true } };
    if (request.op === "storage.get") throw { code: "not_found", message: "없음", details: [] };
    return base.call(request as never);
  };
  render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  expect((await screen.findByRole("button", { name: "보기" })).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "속성" })).toBeNull();
  const frame = await screen.findByTitle("HTML 보기");
  await userEvent.click(screen.getByRole("button", { name: "고르기" }));
  expect(screen.queryByText("요소를 고르세요")).toBeNull();
  expect(screen.getByText("요소나 글을 고르세요")).toBeTruthy();
  expect(screen.getAllByRole("separator")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "보기" }));
  await userEvent.click(screen.getByRole("button", { name: "고르기" }));
  expect(screen.getByTitle("HTML 보기")).toBe(frame);
  expect(screen.queryByRole("button", { name: "요소 다듬기" })).toBeNull();
  expect(screen.queryByRole("button", { name: /에이전트에게 보내기/ })).toBeNull();
});

it("값 HTML은 스크립트를 정화한 격리 프레임으로 표시한다", async () => {
  const html = "<h1>바인딩 미리보기</h1><script>window.secret = true</script>";
  const app: AppDefinition = { id: "html-value", name: "미리보기", requires: { blocks: 6, modules: {} }, permissions: [], state: {}, ui: { type: "html_view", value: html } };
  const seed = makeTestSeed({ definitions: [app] });
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const frame = await screen.findByTitle("미리보기") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("바인딩 미리보기");
  expect(frame.srcdoc).not.toContain("window.secret");
});

it("값 HTML 프레임의 선택 복사 요청을 공용 메뉴로 연다", async () => {
  const app: AppDefinition = { id: "html-value", name: "미리보기", requires: { blocks: 6, modules: {} }, permissions: [], state: {}, ui: { type: "html_view", value: "<p>글</p>" } };
  render(<><ContextMenuHost /><AppWindowContent store={createShellStore(createFakeTransport(makeTestSeed({ definitions: [app] })))} windowId="viewer-window" /></>);
  const frame = await screen.findByTitle("미리보기") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "ks-html-context-menu", x: 12, y: 18, text: "프레임 글" } })));
  expect(screen.getByRole("menuitem", { name: "복사" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "ks-html-context-menu", x: 12, y: 18, text: "", editable: true, readOnly: false, password: false } })));
  fireEvent.click(screen.getByRole("menuitem", { name: "모두 선택" }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "ks-html-context-command", action: "selectAll" }), "*");
});

it("값 HTML의 같이 보기는 숨긴 글과 스크립트를 빼고 프레임의 보이는 글을 받는다", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, width: 300, height: 200, toJSON() {} });
  const html = "<p>보이는 글</p><p hidden>숨긴 글</p><script>비표시 코드</script>";
  const app: AppDefinition = { id: "html-value", name: "미리보기", requires: { blocks: 6, modules: {} }, permissions: [], state: {}, ui: { type: "html_view", value: html } };
  const { container } = render(<AppWindowContent store={createShellStore(createFakeTransport(makeTestSeed({ definitions: [app] })))} windowId="viewer-window" />);
  const frame = await screen.findByTitle("미리보기") as HTMLIFrameElement;
  const root = container.querySelector<HTMLElement>(".ks-html-view")!;
  expect(describeVisible(root).text).toContain("보이는 글");
  expect(describeVisible(root).text).not.toContain("숨긴 글");
  expect(describeVisible(root).text).not.toContain("비표시 코드");
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "ks-html-visible-text", text: "프레임에 보이는 글" } })));
  await waitFor(() => expect(describeVisible(root).text).toContain("프레임에 보이는 글"));
});

it("파일 HTML을 읽기 전용 격리 프레임으로 표시한다", async () => {
  const app: AppDefinition = { id: "html-file", name: "파일 보기", requires: { blocks: 6, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "read", label: "읽을 폴더" }], state: {}, ui: { type: "html_view", file: { permission: "docs", path: "review.html" } } };
  const seed = makeTestSeed({ definitions: [app], grants: [grantFor("viewer-window", "docs")], files: { "review.html": "<h1>파일 본문</h1><script>window.secret = true</script>" } });
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const frame = await screen.findByTitle("파일 보기") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("파일 본문");
  expect(frame.srcdoc).not.toContain("window.secret");
});

it("깨진 스레드는 문서 이름과 복구 방법을 담은 코어 오류를 반환한다", async () => {
  const core = { call: vi.fn(async (request: CoreRequest) => request.op === "storage.list"
    ? { op: "storage.list", result: { items: [{ doc: "시안/thread.json" }] } }
    : { op: "storage.get", result: { content: "{", revision: "bad" } }) } as unknown as ShellStore;
  await expect(readThread(core, "window", "drafts", "시안")).rejects.toMatchObject({ code: "invalid_request", id: "SHELL_THREAD_READ_INVALID", message: "문서 시안의 커멘트 기록을 읽지 못했습니다. 에이전트에게 이 오류 코드를 전하세요." });
});

it("스레드 CAS 충돌 때 최신 답글을 보존하며 같은 변경을 재적용한다", async () => {
  let reads = 0; let writes = 0; let saved = "";
  const core = { call: vi.fn(async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/thread.json" }] } };
    if (request.op === "storage.get") { reads++; return { op: "storage.get", result: { content: JSON.stringify({ revisions: {}, comments: reads === 1 ? [] : [{ id: "existing", anchor: testAnchor, comment: "기존", created_at: "now" }] }), revision: `r${reads}` } }; }
    if (request.op === "storage.write") { writes++; if (writes === 1) throw { code: "conflict", message: "충돌", details: [] }; saved = String(request.content); return { op: "storage.write", revision: "r3" }; }
    throw new Error("unexpected request");
  }) } as unknown as ShellStore;
  const comment = { id: "new", rev: 1, status: "needs_agent_review" as const, anchor: {} as HtmlAnchor, comment: "수정", created_at: "now", resolved_rev: null, replies: [] };
  await writeThreadChange(core, "window", "drafts", "시안", { kind: "add", comment });
  expect(reads).toBe(2); expect(writes).toBe(2);
  expect(JSON.parse(saved).comments.map((item: { id: string }) => item.id)).toEqual(["existing", "new"]);
});

it("최신 리비전을 따라간 창은 다시 열 때도 최신을 본다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  seed.snapshot.shared.windows[0].state = { selected_doc: "시안", selected_revision: 1 };
  const base = createFakeTransport(seed);
  const files = new Map([["시안/r1.html", "<h1>첫 판</h1>"]]);
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: "bucket", items: [...files].map(([doc, content]) => ({ doc, revision: doc, updated_at: "now", byte_size: content.length })) } };
    if (request.op === "storage.get" && request.doc) { const content = files.get(request.doc); if (content === undefined) throw { code: "not_found", message: "없음", details: [] }; return { op: "storage.get", result: { kind: "md", content, revision: request.doc, exists: true } }; }
    return base.call(request as never);
  };
  const store = createShellStore({ ...base, call: call as CoreTransport["call"] });
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1"));
  await act(async () => {
    files.set("시안/r2.html", "<h1>둘째 판</h1>");
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/r2.html", kind: "md", revision: "r2", exists: true } } } });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v2"));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected_revision).toBeNull());
});

it("받을 앱이 없으면 보내기 단추가 비활성이다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const base = createFakeTransport(seed);
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }, { doc: "시안/thread.json" }] } };
    if (request.op === "storage.get" && request.doc === "시안/r1.html") return { op: "storage.get", result: { content: "<h1>시안</h1>", revision: "r1" } };
    if (request.op === "storage.get") return { op: "storage.get", result: { content: JSON.stringify({ revisions: {}, comments: [{ id: "one", rev: 1, status: "needs_agent_review", anchor: testAnchor, comment: "고쳐 주세요", created_at: "now", resolved_rev: null, replies: [] }] }), revision: "r1" } };
    return base.call(request as never);
  };
  render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  await userEvent.click(await screen.findByRole("button", { name: "고르기" }));
  const button = await screen.findByRole("button", { name: "에이전트에게 보내기 1" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.queryByText("대화 창이 없습니다")).toBeNull();
});

it("문서 커멘트를 저장하고 같은 작업의 에이전트 창으로 보낸다", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, width: 300, height: 200, toJSON() {} });
  const agent = { id: "agent", name: "채팅", requires: { blocks: 1, modules: {} }, permissions: [], state: {}, agent: {}, ui: { type: "text", text: "" } } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition as AppDefinition, agent] });
  seed.snapshot.shared.preferences = { revision: 1, default_message_app_id: agent.id, asked_message_app_ids: [] };
  seed.snapshot.shared.windows[1].id = "agent-window";
  seed.snapshot.shared.windows[1].z = 1;
  seed.snapshot.shared.windows.push({ ...seed.snapshot.shared.windows[1], id: "top-agent-window", z: 2 });
  seed.snapshot.shared.desktops.push({ ...seed.snapshot.shared.desktops[0], id: "other-desktop" });
  seed.snapshot.shared.windows.push({ ...seed.snapshot.shared.windows[1], id: "other-desktop-agent", desktop_id: "other-desktop", z: 99 });
  const base = createFakeTransport(seed);
  const files = new Map<string, { content: string; revision: string }>([["시안/r1.html", { content: "<h1>제목</h1>", revision: "html1" }]]);
  const sent: CoreRequest[] = []; let seq = 0; let failMetadata = false; let htmlWrites = 0; let failSend = true;
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: "bucket", items: [...files].map(([doc, value]) => ({ doc, revision: value.revision, updated_at: "now", byte_size: value.content.length })) } };
    if (request.op === "storage.get" && request.doc) { const item = files.get(request.doc); if (!item) throw { code: "not_found", message: "없음", details: [] }; return { op: "storage.get", result: { kind: "md", content: item.content, revision: item.revision, exists: true } }; }
    if (request.op === "storage.write" && request.doc) {
      if (request.doc.endsWith(".html")) htmlWrites++;
      if (request.doc.endsWith("thread.json") && failMetadata) { failMetadata = false; throw { code: "io", message: "메타 저장 오류", details: [] }; }
      const current = files.get(request.doc); if ((request.expected_revision ?? null) !== (current?.revision ?? null)) throw { code: "conflict", message: "충돌", details: [] }; const revision = `rev${++seq}`; files.set(request.doc, { content: String(request.content), revision }); return { op: "storage.write", revision };
    }
    if (request.op === "conversation.send") { if (failSend) { failSend = false; throw { id: "CONV_SEND_THREAD_NOT_FOUND", code: "not_found", message: "대화 없음", details: [] }; } sent.push(request); return { op: "conversation.send" }; }
    return base.call(request as never);
  };
  const transport: CoreTransport = { ...base, call: call as CoreTransport["call"] };
  const { container } = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const iframe = await screen.findByTitle("HTML 보기") as HTMLIFrameElement;
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  const anchor = testAnchor;
  await userEvent.click(screen.getByRole("button", { name: "고르기" }));
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-select", selection: { n: 4, anchor, styles: {} } } })));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "커멘트" }), "색을 바꿔 주세요{Enter}");
  expect(await screen.findByText("색을 바꿔 주세요")).toBeTruthy();
  const commentId = JSON.parse(files.get("시안/thread.json")!.content).comments[0].id;
  await user.click(screen.getByRole("button", { name: "보기" }));
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-select-comment", id: commentId } })));
  expect(screen.getByRole("button", { name: "고르기" }).getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".ks-html-comment.is-active")).toBeTruthy();
  const validThread = files.get("시안/thread.json")!;
  await act(async () => {
    files.set("시안/thread.json", { ...validThread, content: '{"comments":"잘못된 구조"}' });
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/thread.json", kind: "md", revision: "bad", exists: true } } } });
  });
  expect((await screen.findByRole("alert")).textContent).toContain("문서 시안의 커멘트 기록을 읽지 못했습니다");
  expect(screen.getByText("색을 바꿔 주세요")).toBeTruthy();
  await act(async () => {
    files.set("시안/thread.json", validThread);
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/thread.json", kind: "md", revision: validThread.revision, exists: true } } } });
  });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await user.clear(screen.getByRole("textbox", { name: "배경" }));
  await user.type(screen.getByRole("textbox", { name: "배경" }), "red{Enter}");
  const root = container.querySelector<HTMLElement>(".ks-html-view")!;
  await waitFor(() => expect(describeVisible(root).text).toContain("저장 안 한 수정 1건"));
  await act(async () => {
    files.set("가나다/r1.html", { content: "<h1>새 문서</h1>", revision: "other" });
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/가나다/r1.html", kind: "md", revision: "other", exists: true } } } });
  });
  await user.click(screen.getByRole("button", { name: /^문서$/ }));
  expect(await screen.findByRole("menuitem", { name: "가나다" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^문서$/ }).textContent).toContain("시안");
  expect(describeVisible(root).text).toContain("저장 안 한 수정 1건");
  await user.keyboard("{Escape}");
  expect(describeVisible(root).text).toContain("고른 요소: h1");
  expect(describeVisible(root).text).toContain("미해결 커멘트 1건");
  await user.click(screen.getByRole("button", { name: "숨기기" }));
  await waitFor(() => expect(describeVisible(root).text).toContain("display"));
  await user.click(screen.getByRole("button", { name: "되돌리기" }));
  await waitFor(() => expect(describeVisible(root).text).not.toContain("display"));
  await act(async () => {
    files.set("시안/r2.html", { content: "<h1>새 판</h1>", revision: "html2" });
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/r2.html", kind: "md", revision: "html2", exists: true } } } });
  });
  expect(await screen.findByRole("button", { name: "v2 도착, 이동" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1");
  await user.click(screen.getByRole("button", { name: "리비전" }));
  await user.click(screen.getByRole("menuitem", { name: "v2" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1");
  expect(screen.getByRole("button", { name: "에이전트에게 보내기 1" }).getAttribute("title")).toBe("받는 앱: 채팅");
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기 1" }));
  expect((await screen.findByRole("alert")).textContent).toContain("SHELL_MESSAGE_SEND_NOT_CONFIGURED");
  expect((screen.getByRole("button", { name: "에이전트에게 보내기 1" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기 1" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  const request = sent[0]; if (request.op !== "conversation.send") throw new Error("전송 명령 누락");
  expect(request.window_id).toBe("top-agent-window"); expect(request.text).toContain("시안/thread.json"); expect(request.text).toContain("색을 바꿔 주세요");
  expect(request.text).not.toContain("저장 안 한 수정");
  expect(await screen.findByText("보냈습니다")).toBeTruthy();
  expect((screen.getByRole("button", { name: "보냈습니다" }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "커멘트" }), "글자를 키워 주세요{Enter}");
  await waitFor(() => expect((screen.getByRole("button", { name: "에이전트에게 보내기 2" }) as HTMLButtonElement).disabled).toBe(false));
  const workingComment = JSON.parse(files.get("시안/thread.json")!.content).comments.find((item: { comment: string }) => item.comment === "글자를 키워 주세요");
  expect(workingComment.anchor_rev).toBe(0);
  await waitFor(() => expect(post.mock.calls.some(([message]) => message.type === "ks-html-comments" && message.comments.some((item: { id: string; sameRevision: boolean }) => item.id === workingComment.id && !item.sameRevision))).toBe(true));
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기 2" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect((screen.getByRole("button", { name: "보냈습니다" }) as HTMLButtonElement).disabled).toBe(true);
  failMetadata = true;
  await user.click(screen.getByRole("button", { name: "변경 1건 새 리비전으로 저장" }));
  expect(await screen.findByText("메타 저장 오류")).toBeTruthy();
  expect((screen.getByRole("button", { name: "리비전" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "되돌리기" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toBe("v3"));
  const savedThread = JSON.parse(files.get("시안/thread.json")!.content);
  expect(savedThread.revisions["3"].title).toBe("직접 수정 1건");
  expect(savedThread.revisions["3"].edits).toHaveLength(1);
  expect(savedThread.comments.find((item: { comment: string }) => item.comment === "글자를 키워 주세요").anchor_rev).toBe(0);
  expect(htmlWrites).toBe(1);
});

it("문서 목록과 HTML을 기다리는 동안 문서 칸과 머리 줄을 유지한다", async () => {
  const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
  let releaseList!: () => void; let releaseHtml!: () => void;
  const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
  const htmlGate = new Promise<void>((resolve) => { releaseHtml = resolve; });
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") { await listGate; return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }] } }; }
    if (request.op === "storage.get") { await htmlGate; return { op: "storage.get", result: { content: "<p>문서</p>", revision: "r1" } }; }
    return base.call(request as never);
  };
  const { container } = render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  await screen.findByRole("button", { name: "보기" });
  const document = container.querySelector(".ks-html-document");
  expect(document?.textContent).toContain("불러오는 중");
  expect(screen.getByRole("button", { name: "보기" })).toBeTruthy();
  await act(async () => { releaseList(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1"));
  expect(container.querySelector(".ks-html-document")).toBe(document);
  expect(document?.textContent).toContain("불러오는 중");
  await act(async () => { releaseHtml(); });
  await screen.findByTitle("HTML 보기");
  expect(container.querySelector(".ks-html-document")).toBe(document);
});


it("문서가 없거나 목록을 읽지 못해도 머리와 문서 칸을 유지한다", async () => {
  for (const failing of [false, true]) {
    const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
    let attempts = 0;
    const call = async (request: CoreRequest) => {
      if (request.op === "storage.list") {
        if (failing && attempts++ === 0) throw { code: "io", id: "TEST_LIST_ERROR", message: "목록 읽기 오류", details: [] };
        return { op: "storage.list", result: { items: [] } };
      }
      return base.call(request as never);
    };
    const { container, unmount } = render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
    const message = await screen.findByText(failing ? "목록 읽기 오류" : "문서가 없습니다");
    expect(screen.getByRole("button", { name: "보기" })).toBeTruthy();
    expect(container.querySelector(".ks-html-document")?.contains(message)).toBe(true);
    if (failing) { await userEvent.click(screen.getByRole("button", { name: "다시 시도" })); expect(await screen.findByText("문서가 없습니다")).toBeTruthy(); }
    unmount();
  }
});

it("리비전 읽기 오류는 문서 칸에서 다시 시도해 복구한다", async () => {
  const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
  let attempts = 0;
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }] } };
    if (request.op === "storage.get" && request.doc === "시안/r1.html") {
      if (++attempts === 1) throw { code: "io", id: "TEST_HTML_ERROR", message: "리비전 읽기 오류", details: [] };
      return { op: "storage.get", result: { content: "<p>복구된 문서</p>", revision: "r1" } };
    }
    return base.call(request as never);
  };
  const { container } = render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  const error = await screen.findByText("리비전 읽기 오류");
  const document = container.querySelector(".ks-html-document")!;
  expect(document.contains(error)).toBe(true);
  expect(document.textContent).not.toContain("불러오는 중");
  await userEvent.click(within(document as HTMLElement).getByRole("button", { name: "다시 시도" }));
  const frame = await screen.findByTitle("HTML 보기") as HTMLIFrameElement;
  expect(frame.srcdoc).toContain("복구된 문서");
  expect(attempts).toBe(2);
});

it("창 폭 관찰로 세 칸 문턱을 전환하고 좁은 속성 안내와 글 선택 안내를 표시한다", async () => {
  let notifyWidth = (_width: number) => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains("ks-html-view")) notifyWidth = (width) => this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }] } };
    if (request.op === "storage.get") return { op: "storage.get", result: { content: "<h1>제목</h1>", revision: "r1" } };
    return base.call(request as never);
  };
  render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  const frame = await screen.findByTitle("HTML 보기") as HTMLIFrameElement;
  act(() => notifyWidth(842));
  await userEvent.click(screen.getByRole("button", { name: "고르기" }));
  expect(screen.getAllByRole("separator")).toHaveLength(2);
  expect(screen.queryByText("요소를 고르세요")).toBeNull();
  act(() => notifyWidth(841));
  expect(screen.queryByRole("separator")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "속성" }));
  expect(screen.getByText("요소를 고르세요")).toBeTruthy();
  act(() => notifyWidth(1000));
  expect(screen.getByTitle("HTML 보기")).toBe(frame);
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "ks-html-select", selection: { n: 1, anchor: { ...testAnchor, kind: "text", quote: { exact: "제목", prefix: "", suffix: "" } }, styles: {} } } })));
  expect(screen.getByText("요소를 누르면 속성을 고칠 수 있습니다")).toBeTruthy();
  expect(screen.queryByText("고른 글에는 속성이 없습니다. 요소를 누르면 고칠 수 있습니다")).toBeNull();
  vi.unstubAllGlobals();
});

it("열린 문서의 목록 갱신 오류를 재시도해도 프레임을 유지한다", async () => {
  const base = createFakeTransport(makeTestSeed({ definitions: [definition as AppDefinition] }));
  let failList = false;
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") {
      if (failList) { failList = false; throw { code: "io", id: "TEST_LIST_ERROR", message: "목록 갱신 오류", details: [] }; }
      return { op: "storage.list", result: { items: [{ doc: "시안/r1.html" }] } };
    }
    if (request.op === "storage.get") return { op: "storage.get", result: { content: "<p>기존 문서</p>", revision: "r1" } };
    return base.call(request as never);
  };
  render(<AppWindowContent store={createShellStore({ ...base, call: call as CoreTransport["call"] })} windowId="viewer-window" />);
  const frame = await screen.findByTitle("HTML 보기");
  failList = true;
  act(() => base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/r2.html", kind: "md", revision: "r2", exists: true } } } }));
  const error = await screen.findByText("목록 갱신 오류");
  await userEvent.click(within(error.closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(screen.queryByText("목록 갱신 오류")).toBeNull());
  expect(screen.getByTitle("HTML 보기")).toBe(frame);
});
