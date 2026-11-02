import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

it("문서 커멘트를 저장하고 같은 작업의 에이전트 창으로 보낸다", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, width: 300, height: 200, toJSON() {} });
  const agent = { id: "agent", name: "채팅", requires: { blocks: 1, modules: {} }, permissions: [], state: {}, agent: {}, ui: { type: "text", text: "" } } as unknown as AppDefinition;
  const seed = makeTestSeed({ definitions: [definition as AppDefinition, agent] });
  seed.snapshot.shared.windows[1].id = "agent-window";
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
  await user.click(screen.getByRole("button", { name: "에이전트에게 보내기" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  const request = sent[0]; if (request.op !== "conversation.send") throw new Error("전송 명령 누락");
  expect(request.window_id).toBe("agent-window"); expect(request.text).toContain("시안/thread.json"); expect(request.text).toContain("색을 바꿔 주세요");
  const root = container.querySelector<HTMLElement>(".ks-html-view")!;
  expect(describeVisible(root).text).toContain("미해결 커멘트 1건");
});
