import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { grantFor, makeTestSeed } from "./fixtures";

const rects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
beforeEach(() => Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] }));
afterEach(() => {
  cleanup();
  if (rects) Object.defineProperty(Range.prototype, "getClientRects", rects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.restoreAllMocks();
});

const source = "# Heading\r\n\r\nA **bold** [link](/docs) paragraph.\r\n\r\n| left | right |\r\n| :--- | ---: |\r\n| **one** | [two](/x) |\r\n| | empty |\r\n\r\n<img src=x onerror=alert(1)>\r\n<script>alert(1)</script>\r\n";

async function openEditor() {
  const transport = createFakeTransport(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")], files: { "README.md": source } }));
  const call = vi.spyOn(transport, "call");
  render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
  const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("편집기를 찾지 못했습니다");
  expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  return { editor, view, call, transport };
}

describe("마크다운 실시간 보기", () => {
  it("정의 없는 대괄호는 그대로 두고 체크 표식은 같은 요소로 그린다", async () => {
    const text = "> [!NOTE]\n\n[검수] [link](https://example.com) [참조][id]\n\n[id]: https://example.com\n\n- [x] 완료\n- [ ] 할 일";
    const transport = createFakeTransport(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")], files: { "README.md": text } }));
    render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const view = EditorView.findFromDOM(editor)!;
    expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    expect(editor.textContent).toContain("[!NOTE]");
    expect(editor.textContent).toContain("[검수]");
    const links = [...editor.querySelectorAll(".ks-live-link")].map((element) => element.textContent);
    expect(links).toContain("link");
    expect(links).toContain("참조");
    const boxes = editor.querySelectorAll(".ks-live-task");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].tagName).toBe(boxes[1].tagName);
    expect(boxes[0].textContent).toBe("");
    expect(boxes[1].textContent).toBe("");
  });

  it("위아래 이동이 표를 건너뛸 때 표의 원문으로 들어간다", async () => {
    const text = "before\n\n| A | B |\n| --- | --- |\n| one | two |\n\nafter";
    const transport = createFakeTransport(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")], files: { "README.md": text } }));
    render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const view = EditorView.findFromDOM(editor)!;
    expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 0 } }); });
    const tableStart = view.state.doc.line(3).from;
    const tableEnd = view.state.doc.line(5).to;
    const move = vi.spyOn(view, "moveVertically").mockReturnValue(EditorSelection.cursor(view.state.doc.line(7).from));
    act(() => { fireEvent.keyDown(editor, { key: "ArrowDown" }); });
    expect(view.state.selection.main.head).toBe(tableStart);
    expect(editor.querySelector("table")).toBeNull();
    act(() => { view.dispatch({ selection: { anchor: view.state.doc.line(7).from } }); });
    move.mockReturnValue(EditorSelection.cursor(0));
    act(() => { fireEvent.keyDown(editor, { key: "ArrowUp" }); });
    expect(view.state.selection.main.head).toBe(tableEnd);
  });
  it("코드 블록 밖에서는 펜스를 감추고 블록 안에서는 원문 전체를 보인다", async () => {
    const text = "# Title\n\n```ts\nconst value = 1;\n```\n\nEnd";
    const transport = createFakeTransport(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")], files: { "README.md": text } }));
    render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const view = EditorView.findFromDOM(editor)!;
    expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    const lines = editor.querySelectorAll(".ks-live-code-block");
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).not.toContain("```");
    expect(lines[0].textContent).not.toContain("ts");
    expect(lines[2].textContent).not.toContain("```");
    act(() => { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.line(4).from } }); });
    expect(editor.textContent).toContain("```ts");
    expect(editor.textContent).toContain("const value = 1;");
  });

  it("표를 렌더하고 HTML을 실행하지 않으며 선택과 클릭만으로 원문을 저장하지 않는다", async () => {
    const { editor, view, call } = await openEditor();
    const table = editor.querySelector("table");
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelectorAll("td")).toHaveLength(4);
    expect(table?.querySelectorAll("tr")[2].children[0].textContent).toBe("");
    expect(table?.querySelectorAll("th")[0].style.textAlign).toBe("left");
    expect(table?.querySelectorAll("th")[1].style.textAlign).toBe("right");
    expect(editor.querySelector("script, a")).toBeNull();
    for (const image of editor.querySelectorAll("img")) {
      expect(image.classList.contains("cm-widgetBuffer")).toBe(true);
      expect(image.hasAttribute("src")).toBe(false);
    }
    for (const element of editor.querySelectorAll("*")) {
      expect([...element.attributes].filter((attribute) => attribute.name.toLowerCase().startsWith("on"))).toHaveLength(0);
    }
    expect(editor.textContent).toContain("<img src=x onerror=alert(1)>");
    const oldLocation = window.location.href;
    const link = editor.querySelector(".ks-live-link");
    expect(link).toBeTruthy();
    act(() => { fireEvent.click(link!); });
    expect(window.location.href).toBe(oldLocation);
    const cell = table!.querySelectorAll("td")[1];
    act(() => { fireEvent.mouseDown(cell); });
    expect(editor.querySelector("table")).toBeTruthy();
    act(() => { fireEvent.mouseUp(cell); });
    await waitFor(() => expect(editor.querySelector("table")).toBeNull());
    expect(view.state.sliceDoc()).toBe(source);
    expect(call.mock.calls.filter(([command]) => command.op === "files.write")).toHaveLength(0);
  });

  it("포커스와 커서 이동은 LF 원문을 고치지 않고 한 글자 편집만 기록한다", async () => {
    const text = "# Title\n\nA **bold** paragraph\n\nNext line\n";
    const transport = createFakeTransport(makeTestSeed({ editorPath: "README.md", grants: [grantFor("editor-window", "docs")], files: { "README.md": text } }));
    const call = vi.spyOn(transport, "call");
    render(<AppWindowContent store={createShellStore(transport)} windowId="editor-window" />);
    const editor = await screen.findByRole("textbox", { name: "마크다운 편집기" });
    const view = EditorView.findFromDOM(editor)!;
    expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 4 } }); view.dispatch({ selection: { anchor: view.state.doc.line(3).from } }); });
    expect(view.state.sliceDoc()).toBe(text);
    expect(call.mock.calls.filter(([command]) => command.op === "files.write")).toHaveLength(0);
    const offset = view.state.doc.line(3).from + 2;
    act(() => { view.dispatch({ changes: { from: offset, insert: "X" } }); });
    await waitFor(() => expect(transport.getFiles()["README.md"]).toBe(text.replace("A ", "A X")), { timeout: 3000 });
  });

  it("CRLF 문서에 삽입한 글만 저장하고 목록 칸을 접었다 편다", async () => {
    const { view, call, transport } = await openEditor();
    fireEvent.click(await screen.findByRole("button", { name: "목록 접기" }));
    expect(screen.queryByRole("tree", { name: "파일 목록" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "목록 펼치기" }));
    expect(screen.getByRole("tree", { name: "파일 목록" })).toBeTruthy();
    const pos = view.state.sliceDoc().indexOf("bold");
    // CRLF는 CodeMirror 내부에서 한 문자로 다뤄지므로 줄과 열로 위치를 구한다.
    const line = view.state.doc.line(3);
    const offset = line.from + line.text.indexOf("bold");
    expect(pos).toBeGreaterThan(0);
    act(() => { view.focus(); view.dispatch({ changes: { from: offset, insert: "X" } }); });
    await waitFor(() => expect(call.mock.calls.some(([command]) => command.op === "files.write")).toBe(true), { timeout: 3000 });
    expect(transport.getFiles()["README.md"]).toBe(source.replace("bold", "Xbold"));
  });
});
