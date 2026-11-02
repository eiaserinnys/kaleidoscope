import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreRequest } from "../contract/contract";
import type { CoreTransport } from "../core/core-transport";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";
import definition from "../../../apps/html-report.json";
import { describeVisible } from "../share/visible";
import type { HtmlAnchor } from "../blocks/html-bridge/frame-protocol";
import { writeThreadChange } from "../blocks/html-document/storage";
import type { ShellStore } from "../core/shell-store";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

it("스레드 CAS 충돌 때 최신 답글을 보존하며 같은 변경을 재적용한다", async () => {
  let reads = 0; let writes = 0; let saved = "";
  const core = { call: vi.fn(async (request: CoreRequest) => {
    if (request.op === "storage.get") { reads++; return { op: "storage.get", result: { content: JSON.stringify({ revisions: {}, comments: reads === 1 ? [] : [{ id: "existing" }] }), revision: `r${reads}` } }; }
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
  expect((await screen.findByRole("button", { name: "리비전" })).textContent).toContain("v1");
  await act(async () => {
    files.set("시안/r2.html", "<h1>둘째 판</h1>");
    base.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "bucket", item: { entry_id: "drafts", key: "drafts/시안/r2.html", kind: "md", revision: "r2", exists: true } } } });
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v2"));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected_revision).toBeNull());
});

it("문서 커멘트를 저장하고 같은 작업의 에이전트 창으로 보낸다", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, width: 300, height: 200, toJSON() {} });
  const agent = { id: "agent", name: "채팅", requires: { blocks: 1, modules: {} }, permissions: [], state: {}, agent: {}, ui: { type: "text", text: "" } } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition as AppDefinition, agent] });
  seed.snapshot.shared.windows[1].id = "agent-window";
  seed.snapshot.shared.windows[1].z = 1;
  seed.snapshot.shared.windows.push({ ...seed.snapshot.shared.windows[1], id: "top-agent-window", z: 2 });
  const base = createFakeTransport(seed);
  const files = new Map<string, { content: string; revision: string }>([["시안/r1.html", { content: "<h1>제목</h1>", revision: "html1" }]]);
  const sent: CoreRequest[] = []; let seq = 0;
  const call = async (request: CoreRequest) => {
    if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: "bucket", items: [...files].map(([doc, value]) => ({ doc, revision: value.revision, updated_at: "now", byte_size: value.content.length })) } };
    if (request.op === "storage.get" && request.doc) { const item = files.get(request.doc); if (!item) throw { code: "not_found", message: "없음", details: [] }; return { op: "storage.get", result: { kind: "md", content: item.content, revision: item.revision, exists: true } }; }
    if (request.op === "storage.write" && request.doc) { const current = files.get(request.doc); if ((request.expected_revision ?? null) !== (current?.revision ?? null)) throw { code: "conflict", message: "충돌", details: [] }; const revision = `rev${++seq}`; files.set(request.doc, { content: String(request.content), revision }); return { op: "storage.write", revision }; }
    if (request.op === "conversation.send") { sent.push(request); return { op: "conversation.send" }; }
    return base.call(request as never);
  };
  const transport: CoreTransport = { ...base, call: call as CoreTransport["call"] };
  const { container } = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  const iframe = await screen.findByTitle("HTML 보기") as HTMLIFrameElement;
  const anchor: HtmlAnchor = { kind: "element", selector: "h1", selector_stable: false, path: "body > h1", tag: "h1", text: "제목", attrs: { id: null, role: null, aria_label: null, alt: null, href: null, src_hash: null }, quote: null, label: "h1", heading: "", rect: { x: 0, y: 0, w: 10, h: 10, vw: 300 } };
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-select", selection: { n: 4, anchor, styles: {} } } })));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "커멘트" }), "색을 바꿔 주세요");
  await user.click(screen.getByRole("button", { name: "등록" }));
  expect(await screen.findByText("색을 바꿔 주세요")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "요소 다듬기" }));
  await user.clear(screen.getByLabelText("배경 색"));
  await user.type(screen.getByLabelText("배경 색"), "red");
  const root = container.querySelector<HTMLElement>(".ks-html-view")!;
  await waitFor(() => expect(describeVisible(root).text).toContain("저장 안 한 수정 1건"));
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
  expect(await screen.findByText("새 리비전 v2이 도착했습니다")).toBeTruthy();
  expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1");
  await user.click(screen.getByRole("button", { name: "리비전" }));
  await user.click(screen.getByRole("menuitem", { name: "v2" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v1");
  await user.click(screen.getByRole("button", { name: "커멘트" }));
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  const request = sent[0]; if (request.op !== "conversation.send") throw new Error("전송 명령 누락");
  expect(request.window_id).toBe("top-agent-window"); expect(request.text).toContain("시안/thread.json"); expect(request.text).toContain("색을 바꿔 주세요");
  expect(request.text).not.toContain("저장 안 한 수정");
  expect(await screen.findByText("보냈습니다")).toBeTruthy();
  expect((screen.getByRole("button", { name: "에이전트에게 보내기" }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByRole("textbox", { name: "커멘트" }), "글자를 키워 주세요");
  await user.click(screen.getByRole("button", { name: "등록" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "에이전트에게 보내기" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기" }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect((screen.getByRole("button", { name: "에이전트에게 보내기" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "요소 다듬기" }));
  await user.click(screen.getByRole("button", { name: "새 리비전으로 저장" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toBe("v3"));
  const savedThread = JSON.parse(files.get("시안/thread.json")!.content);
  expect(savedThread.revisions["3"].title).toBeUndefined();
});
