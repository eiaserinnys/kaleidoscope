import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed } from "./fixtures";
import definition from "../../../apps/html-report.json";
import { editedHtml, shareHtmlReport, type HtmlElementSelection } from "../blocks/html-view-model";
import { htmlViewSource } from "../blocks/html-view-frame";
import { describeVisible } from "../share/visible";
import { createHash } from "node:crypto";
import tauriConfig from "../../../app/src-tauri/tauri.conf.json";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("html_view의 value 바인딩을 격리된 HTML 프레임으로 표시한다", async () => {
  const html = "<h1>바인딩 미리보기</h1><script>window.secret = true</script>";
  const app: AppDefinition = {
    id: "html-value", name: "미리보기", requires: { blocks: 6, modules: {} }, permissions: [], state: {},
    ui: { type: "html_view", value: html },
  };
  const seed = makeTestSeed({ definitions: [app] });
  render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const frame = await screen.findByTitle("미리보기") as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("srcdoc")).toContain("바인딩 미리보기");
  expect(frame.getAttribute("srcdoc")).not.toContain("window.secret");
});

it("html_view의 같이 보기는 숨긴 글과 스크립트를 제외한다", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 300, bottom: 200, x: 0, y: 0, width: 300, height: 200, toJSON() {} });
  const html = "<p>보이는 글</p><p hidden>숨긴 글</p><script>비표시 코드</script>";
  const app: AppDefinition = { id: "html-value", name: "미리보기", requires: { blocks: 6, modules: {} }, permissions: [], state: {}, ui: { type: "html_view", value: html } };
  const seed = makeTestSeed({ definitions: [app] });
  const { container } = render(<AppWindowContent store={createShellStore(createFakeTransport(seed))} windowId="viewer-window" />);
  const frame = await screen.findByTitle("미리보기") as HTMLIFrameElement;
  const root = container.querySelector<HTMLElement>(".ks-html-view");
  if (!root) throw new Error("HTML 보기 컨테이너가 없습니다");
  const sharedText = () => describeVisible(root).text;
  expect(sharedText()).toContain("보이는 글");
  expect(sharedText()).not.toContain("숨긴 글");
  expect(sharedText()).not.toContain("비표시 코드");

  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { type: "ks-html-visible-text", text: "iframe에 보이는 글" } })));
  await waitFor(() => expect(sharedText()).toContain("iframe에 보이는 글"));
});

it("여러 직접 텍스트가 있는 요소의 문구를 바꾸되 안쪽 요소는 유지한다", () => {
  const previous: HtmlElementSelection = { selector: "p", tagName: "p", text: "안녕  반가워", selected_text: "안녕 세계 반가워", styles: { color: "", backgroundColor: "", margin: "", padding: "" } };
  const html = editedHtml("<p>안녕 <strong>세계</strong> 반가워</p>", { ...previous, text: "새 문구" }, previous);
  const paragraph = new DOMParser().parseFromString(html, "text/html").querySelector("p");
  expect(paragraph?.textContent).toBe("새 문구세계");
  expect(paragraph?.querySelector("strong")?.textContent).toBe("세계");
});

it("문서의 실행 코드와 외부 이동을 제거하고 브리지 해시만 허용한다", () => {
  const source = htmlViewSource('<script>window.location="https://evil.example"</script><iframe src="https://evil.example"></iframe><meta http-equiv="refresh" content="0;url=https://evil.example"><img src="x" onerror="alert(1)"><a href="https://evil.example">링크</a><template><script>alert(1)</script><img onerror="alert(1)"></template>');
  const doc = new DOMParser().parseFromString(source, "text/html");
  const scripts = doc.querySelectorAll("script");
  expect(scripts).toHaveLength(1);
  expect(doc.querySelector("iframe, img[onerror], a[href^='https:'], meta[http-equiv='refresh']")).toBeNull();
  expect(doc.querySelector("template")?.content.querySelector("script, [onerror]")).toBeNull();
  const hash = `sha256-${createHash("sha256").update(scripts[0].textContent ?? "", "utf8").digest("base64")}`;
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain(`script-src '${hash}'`);
  expect(tauriConfig.app.security.csp).toContain(`script-src 'self' '${hash}'`);
});

it("문서의 최신 리비전을 열고 코멘트를 저장한다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const content: JsonValue = { documents: [{ id: "one", title: "첫 문서", revisions: [
    { rev: 1, html: "<h1>첫 판</h1>" }, { rev: 2, html: "<h1>최신 판</h1>", comments: [] },
  ] }] };
  const transport = createFakeTransport({ ...seed, storage: [{ window_id: "viewer-window", entry: "reports", content }] });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect((await screen.findByRole("button", { name: "리비전" })).textContent).toContain("v2");
  const iframe = screen.getByTitle("HTML 보기") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-selection", selected_text: "최신 판", selector: "h1" } })));
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "코멘트" }), "색을 바꿔 주세요");
  await user.click(screen.getByRole("button", { name: "등록" }));
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "storage.write" && JSON.stringify(call.content).includes("색을 바꿔 주세요"))).toBe(true));
  expect(await screen.findByText("색을 바꿔 주세요")).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "답글 1" }), "다시 확인해 주세요");
  await user.click(screen.getByRole("button", { name: "답글" }));
  expect(await screen.findByText("나: 다시 확인해 주세요")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "해결" }));
  expect(await screen.findByText("해결됨", { selector: ".ks-badge" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "미해결" }));
  expect(screen.queryByText("색을 바꿔 주세요")).toBeNull();
  await user.click(screen.getByRole("button", { name: "전체" }));
  await user.click(screen.getByRole("button", { name: "다시 열기" }));
  expect(await screen.findByText("검토 요청", { selector: ".ks-badge" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByText("색을 바꿔 주세요")).toBeNull());
});

it("코멘트와 답글을 Enter로 제출하고 Escape와 취소 버튼으로 입력을 지운다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const content: JsonValue = { documents: [{ id: "doc", title: "시안", revisions: [{ rev: 1, html: "<h1>제목</h1>", comments: [] }] }] };
  const transport = createFakeTransport({ ...seed, storage: [{ window_id: "viewer-window", entry: "reports", content }] });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect(await screen.findByText("코멘트가 없습니다")).toBeTruthy();
  const iframe = screen.getByTitle("HTML 보기") as HTMLIFrameElement;
  const select = () => act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-selection", selected_text: "제목", selector: "h1" } })));
  const writes = () => transport.getCalls().filter((call) => call.op === "storage.write");
  const user = userEvent.setup();
  select();
  await user.type(await screen.findByRole("textbox", { name: "코멘트" }), "취소할 글");
  await user.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.queryByRole("textbox", { name: "코멘트" })).toBeNull();
  expect(writes()).toHaveLength(0);
  select();
  await user.type(await screen.findByRole("textbox", { name: "코멘트" }), "입력 취소{Escape}");
  expect(screen.queryByRole("textbox", { name: "코멘트" })).toBeNull();
  expect(writes()).toHaveLength(0);
  select();
  await user.type(await screen.findByRole("textbox", { name: "코멘트" }), "코멘트 내용{Enter}");
  expect(await screen.findByText("코멘트 내용")).toBeTruthy();
  await waitFor(() => expect(writes()).toHaveLength(1));
  const reply = screen.getByRole("textbox", { name: "답글 1" }) as HTMLInputElement;
  await user.type(reply, "임시 답글{Escape}");
  expect(reply.value).toBe("");
  await user.type(reply, "전송할 답글");
  await user.tab();
  expect(writes()).toHaveLength(1);
  await user.click(reply);
  await user.keyboard("{Enter}");
  expect(await screen.findByText("나: 전송할 답글")).toBeTruthy();
  await waitFor(() => expect(writes()).toHaveLength(2));
  await waitFor(() => expect(reply.value).toBe(""));
});

it("원격 리비전과 요소 편집을 반영하고 새 판을 저장한다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const content: JsonValue = { documents: [{ id: "doc", title: "시안", revisions: [{ rev: 1, html: "<h1>처음</h1>" }] }] };
  const transport = createFakeTransport({ ...seed, storage: [{ window_id: "viewer-window", entry: "reports", content }] });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  expect((await screen.findByRole("button", { name: "리비전" })).textContent).toContain("v1");
  const current = await transport.call({ op: "storage.get", window_id: "viewer-window", entry: "reports" });
  if (current.op !== "storage.get") throw new Error("저장소 응답");
  await act(async () => { await transport.call({ op: "storage.write", window_id: "viewer-window", entry: "reports", expected_revision: current.result.revision, content: { documents: [{ id: "doc", title: "시안", revisions: [{ rev: 1, html: "<h1>처음</h1>" }, { rev: 2, html: "<h1>둘째</h1>" }] }] } }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v2"));
  const iframe = screen.getByTitle("HTML 보기") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-element-select", selector: "h1", tagName: "h1", selected_text: "둘째", text: "둘째", styles: { color: "black", backgroundColor: "white", padding: "0px", margin: "0px" } } })));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "요소 다듬기" }));
  const text = screen.getByRole("textbox", { name: "문구" });
  await user.clear(text); await user.type(text, "취소할 제목"); await user.keyboard("{Escape}");
  expect((text as HTMLInputElement).value).toBe("둘째");
  expect((screen.getByTitle("HTML 보기") as HTMLIFrameElement).srcdoc).toContain("둘째");
  await user.clear(text); await user.type(text, "새 제목");
  const color = screen.getByRole("textbox", { name: "글자 색" });
  await user.clear(color); await user.type(color, "red");
  await user.click(screen.getByRole("button", { name: "새 리비전으로 저장" }));
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "storage.write" && JSON.stringify(call.content).includes("새 제목") && JSON.stringify(call.content).includes("red"))).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "리비전" }).textContent).toContain("v3"));
});

it("인라인 요소가 섞인 문구를 취소하면 원래 순서로 새 리비전에 저장한다", async () => {
  const seed = makeTestSeed({ definitions: [definition as AppDefinition] });
  const content: JsonValue = { documents: [{ id: "doc", title: "시안", revisions: [{ rev: 1, html: "<p>안녕 <strong>세계</strong> 반가워</p>" }] }] };
  const transport = createFakeTransport({ ...seed, storage: [{ window_id: "viewer-window", entry: "reports", content }] });
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  await screen.findByRole("button", { name: "리비전" });
  const iframe = screen.getByTitle("HTML 보기") as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow, data: { type: "ks-html-element-select", selector: "p", tagName: "p", selected_text: "안녕 세계 반가워", text: "안녕  반가워", styles: { color: "black", backgroundColor: "white", padding: "0px", margin: "0px" } } })));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "요소 다듬기" }));
  const text = screen.getByRole("textbox", { name: "문구" });
  await user.clear(text); await user.type(text, "다른 문구{Escape}");
  await user.click(screen.getByRole("button", { name: "새 리비전으로 저장" }));
  await waitFor(() => expect(transport.getCalls().some((call) => call.op === "storage.write")).toBe(true));
  const call = transport.getCalls().find((item) => item.op === "storage.write");
  if (!call || call.op !== "storage.write") throw new Error("저장 요청이 없습니다");
  const saved = call.content as { documents: { revisions: { html: string }[] }[] };
  const paragraph = new DOMParser().parseFromString(saved.documents[0].revisions[1].html, "text/html").querySelector("p");
  expect(paragraph?.textContent).toBe("안녕 세계 반가워");
  expect(paragraph?.querySelector("strong")?.textContent).toBe("세계");
});

it("같이 보기에는 현재 문서와 미해결 스레드, 본문이 담긴다", () => {
  const revision = { rev: 1, html: "<p>본문</p>", comments: [{ id: "c", selected_text: "본문", selector: "p", comment: "고쳐 주세요", status: "needs_user_reply" as const, replies: [{ id: "r", body: "답변" }] }] };
  expect(shareHtmlReport({ id: "doc", title: "시안", revisions: [revision] }, revision, { selector: "p", selected_text: "본문" }, "본문")).toContain("[시안과 리포트: 시안 (doc) - v1/1]\n선택됨: p \"본문\"\n미해결 코멘트 (1건):");
  expect(shareHtmlReport({ id: "doc", title: "시안", revisions: [revision] }, revision, null, "본문")).toContain("답변");
});
