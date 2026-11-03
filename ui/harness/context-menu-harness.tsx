import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ContextMenuHost, openFrameContextMenu } from "../src/components/context-menu";
import { htmlViewSource } from "../src/blocks/html-view-frame";
import { sandboxSource } from "../src/blocks/sandbox-frame";
import { WindowFrame } from "../../app/src/shell/window-frame";
import { makeTestSnapshot } from "../src/__tests__/fixtures";
import "../src/styles/index.css";
import "../../app/src/shell.css";
import "./harness.css";

const html = "<html><body><p id='frame-text'>프레임에서 고를 글입니다.</p></body></html>";
function Harness() {
  const [text, setText] = useState("abcde");
  const [number, setNumber] = useState("12345");
  const [email, setEmail] = useState("abcde@example.com");
  const editorRoot = useRef<HTMLDivElement>(null);
  const htmlFrame = useRef<HTMLIFrameElement>(null);
  const sandboxFrame = useRef<HTMLIFrameElement>(null);
  const htmlSource = useRef(htmlViewSource(html));
  const sandbox = useRef(sandboxSource(html, { state: {}, stateKeys: [], storageEntries: [], token: "context-test" }));
  useEffect(() => {
    const view = new EditorView({ state: EditorState.create({ doc: "편집기 원본" }), parent: editorRoot.current! });
    return () => view.destroy();
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = event.source === htmlFrame.current?.contentWindow ? htmlFrame.current : event.source === sandboxFrame.current?.contentWindow && event.data?.token === "context-test" ? sandboxFrame.current : null;
      if (frame && (event.data?.type === "ks-html-context-menu" || event.data?.type === "ks-sandbox-context-menu")) openFrameContextMenu(frame, event.data);
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, []);
  if (new URLSearchParams(window.location.search).has("title")) {
    const snapshot = makeTestSnapshot();
    const store = { getSnapshot: () => snapshot, subscribe: () => () => {}, subscribeEvents: () => () => {}, call: async () => undefined };
    return <main className="app-root"><ContextMenuHost /><WindowFrame area={{ width: window.innerWidth, height: window.innerHeight }} appName="문서" isTop sharing={false} shareable hasSettings store={store as never} onCall={async () => undefined} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={snapshot.shared.windows[0]}><p>창 내용</p></WindowFrame></main>;
  }
  return <main className="ks-harness"><ContextMenuHost /><h1>입력과 문서</h1>
    <label>글<input aria-label="글" value={text} onChange={(event) => setText(event.target.value)} /></label>
    <label>숫자<input aria-label="숫자" type="number" value={number} onChange={(event) => setNumber(event.target.value)} /></label>
    <label>메일<input aria-label="메일" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <textarea aria-label="여러 줄" defaultValue="여러 줄" />
    <p id="reading" className="ks-data-text">읽는 글을 선택합니다.</p>
    <div ref={editorRoot} aria-label="코드" />
    <iframe ref={htmlFrame} title="HTML 문서" sandbox="allow-scripts" srcDoc={htmlSource.current} />
    <iframe ref={sandboxFrame} title="샌드박스" sandbox="allow-scripts" srcDoc={sandbox.current} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
