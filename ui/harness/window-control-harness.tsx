import { EditorView } from "@codemirror/view";
import { ClientRuntime } from "../src/runtime/client-runtime";
import type { WindowData } from "../src/data/window-data";
import { registerOverlay } from "../src/share/overlay-owner";
import { useState, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { AppWindowContent, createFakeTransport, createShellStore, TextInput } from "../src/index";
import { executeWindowAction, readWindowView, setWindowViewGeometry, registerControlWindow } from "../src/share/window-control";
import { WindowFrame } from "../../app/src/shell/window-frame";
import { makeTestSeed, mdViewerDefinition } from "../src/__tests__/fixtures";
import type { AppDefinition } from "../src/contract/contract";
import "../src/styles/index.css";
import "../../app/src/shell.css";

const definition: AppDefinition = { ...mdViewerDefinition, id: "control-fixture", requires: { blocks: 4, modules: {} }, permissions: [], state: { text: "기존", selected: "하나", enabled: false, tab: "0", clicked: null, submitted: null }, ui: {
  type: "stack", direction: "column", children: [
    { type: "button", label: "실행", on_click: { set_state: "clicked" } },
    { type: "input", label: "대상 입력", value: { state: "text" }, on_change: { set_state: "text" }, on_submit: { set_state: "submitted" } },
    { type: "select", label: "종류", value: { state: "selected" }, options: ["하나", "둘"], on_change: { set_state: "selected" } },
    { type: "toggle", label: "표시", value: { state: "enabled" }, on_change: { set_state: "enabled" } },
    { type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [{ label: "첫 탭", child: { type: "text", value: "첫 내용" } }, { label: "둘째 탭", child: { type: "text", value: "둘째 내용" } }] },
  ],
} };
const seed = makeTestSeed({ definitions: [definition] });
const transport = createFakeTransport(seed);
const store = createShellStore(transport);
const appWindow = seed.snapshot.shared.windows[0];
Object.assign(window, { controlHarness: {
  read: () => readWindowView(appWindow.id),
  act: (viewId: string, action: Parameters<typeof executeWindowAction>[2]) => executeWindowAction(appWindow.id, viewId, action, "browser-request"),
  geometry: (viewId: string, width: number, height: number) => setWindowViewGeometry(appWindow.id, viewId, { css_width: width, css_height: height, pixel_width: width, pixel_height: height }),
  state: () => store.getSnapshot()?.shared.windows[0].state,
  blurCommits: 0,
} });

function Surfaces() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current!;
    root.innerHTML = `<button aria-label="횟수">횟수</button><input type="checkbox" aria-label="체크"><div role="row" aria-selected="false" tabindex="0">목록 행</div><div aria-label="스크롤" style="height:50px;overflow:auto"><div style="height:300px;min-height:300px">긴 목록</div></div><div class="editor"></div><canvas width="200" height="60" style="display:block;background:lavender"></canvas><button aria-label="폴더 허용">폴더 허용</button><button aria-label="프레임 완료">프레임 완료</button>`;
    const api = (window as any).controlHarness;
    api.events = [];
    for (const event of ["click", "dblclick", "pointerdown", "mousedown", "pointerup", "mouseup"])
      root.addEventListener(event, (e) => api.events.push(`${(e.target as Element).tagName}:${event}:${(e as MouseEvent).detail}`));
    const row = root.querySelector('[role="row"]')!;
    row.addEventListener("click", () => row.setAttribute("aria-selected", "true"));
    root.querySelector('[aria-label="폴더 허용"]')!.addEventListener("click", () => {
      void store.call({ op:"files.pick_folder", window_id:"surface", permission:"docs" }).catch((error) => { api.permissionError = error.id; });
    });
    const editor = new EditorView({ doc:"기존 코드", parent: root.querySelector(".editor")! });
    editor.contentDOM.setAttribute("aria-label", "코드 입력");
    api.code = () => editor.state.doc.toString();
    const frame = document.createElement("iframe"); frame.setAttribute("sandbox", "allow-scripts"); frame.hidden = true;
    frame.srcdoc = `<script>onmessage=({data:m})=>{if(m.type!=="ks-client-action")return;parent.postMessage({token:"fixture",type:"observed",hasId:!!m.requestId},"*");if(m.requestId)setTimeout(()=>parent.postMessage({token:"fixture",type:"ks-client-action-result",ok:true,requestId:m.requestId},"*"),250)}<`+`/script>`;
    document.body.append(frame);
    const runtime = new ClientRuntime(store, { windowId:"surface", setNotice(){} } as unknown as WindowData, definition, { actions:["wait"] } as never);
    const internals = runtime as any; internals.frame = frame; internals.token = "fixture";
    const observed = (event: MessageEvent) => { if(event.source===frame.contentWindow && event.data.type==="observed") api.frameHasId=event.data.hasId; };
    window.addEventListener("message", internals.receive); window.addEventListener("message", observed);
    root.querySelector('[aria-label="프레임 완료"]')!.addEventListener("click", () => runtime.action("wait", null));
    api.humanAction = () => runtime.action("wait", null);
    api.consent = () => { const overlay=document.createElement("div"); overlay.setAttribute("data-ks-user-consent", ""); overlay.innerHTML="<button>허용</button>"; root.append(overlay); const remove=registerOverlay(overlay,"surface"); api.clearConsent=()=>{remove();overlay.remove();}; };
    const unregister = registerControlWindow("surface", root, store);
    api.surfaceRead = () => readWindowView("surface");
    api.surfaceAct = (viewId: string, action: Parameters<typeof executeWindowAction>[2]) => executeWindowAction("surface",viewId,action,"surface-request");
    api.point = (x: number, y: number) => { const view=readWindowView("surface"), r=root.getBoundingClientRect(); setWindowViewGeometry("surface",view.view_id,{css_width:r.width,css_height:r.height,pixel_width:r.width,pixel_height:r.height});return executeWindowAction("surface",view.view_id,{kind:"point",x,y,gesture:"click"},"point-request"); };
    return () => { unregister();editor.destroy();frame.remove();window.removeEventListener("message",internals.receive);window.removeEventListener("message",observed); };
  }, []);
  return <div ref={ref} className="ks-data-window" data-window-id="surface" style={{position:"fixed",left:700,top:100,width:400,height:550,overflow:"auto"}} />;
}
function Harness() {
  const [outside, setOutside] = useState("디렉터 초안");
  return <div className="app-root">
    <WindowFrame area={{ width: 1000, height: 700 }} appName="조작 대상" isTop={false} sharing shareable={false} hasSettings={false} store={store} onCall={(request) => store.call(request)} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={appWindow}>
      <AppWindowContent store={store} windowId={appWindow.id} />
    </WindowFrame>
    <Surfaces />
    <div className="ks-data-window" data-window-id="other" style={{ position: "fixed", right: 20, top: 20 }}>
      <TextInput persistent aria-label="다른 창" value={outside} onEdit={setOutside} onCommit={() => { (window as any).controlHarness.blurCommits += 1; }} onCancel={() => {}} />
    </div>
  </div>;
}

const sandboxFixture: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 11, modules: {} }, permissions: [], ui: { type: "sandbox", title: "실제 샌드박스", value: `<button id="counter">횟수 0</button><input id="check" type="checkbox"><label for="check" id="label">체크</label><details><summary>펼치기</summary>내용</details><script>let n=0;document.querySelector('#counter').addEventListener('click',()=>{document.querySelector('#counter').textContent='횟수 '+(++n)});document.querySelector('#check').addEventListener('change',()=>{document.querySelector('#label').textContent=document.querySelector('#check').checked?'켜짐':'꺼짐'})</script>` } };
const htmlFixture: AppDefinition = { ...mdViewerDefinition, name: "실제 HTML", requires: { blocks: 11, modules: {} }, permissions: [], ui: { type: "html_view", value: '<p data-ks-n="1" id="target">편집할 글</p>' } };
const sandboxStore = createShellStore(createFakeTransport(makeTestSeed({ definitions: [sandboxFixture] })));
const htmlStore = createShellStore(createFakeTransport(makeTestSeed({ definitions: [htmlFixture] })));

function FrameFixture({ id, fixtureStore }: { id: string; fixtureStore: typeof store }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const unregister = registerControlWindow(id, element, fixtureStore);
    const api = (window as any).controlHarness;
    api.framePoint = async (x: number, y: number, gesture: "click" | "double_click") => {
      const view = readWindowView(id), rect = element.getBoundingClientRect();
      setWindowViewGeometry(id, view.view_id, { css_width: rect.width, css_height: rect.height, pixel_width: rect.width, pixel_height: rect.height });
      return executeWindowAction(id, view.view_id, { kind: "point", x, y, gesture }, `${id}-point`);
    };
    return unregister;
  }, [id, fixtureStore]);
  return <div ref={root} data-window-id={id} style={{ width: 500, height: 300 }}><AppWindowContent store={fixtureStore} windowId="viewer-window" /></div>;
}

function FramesHarness() {
  const [kind, setKind] = useState<"sandbox" | "html">("sandbox");
  (window as any).controlHarness.chooseFrame = setKind;
  return kind === "sandbox" ? <FrameFixture key={kind} id="sandbox-frame" fixtureStore={sandboxStore} /> : <FrameFixture key={kind} id="html-frame" fixtureStore={htmlStore} />;
}
createRoot(document.getElementById("root")!).render(location.search === "?frames" ? <FramesHarness /> : <Harness />);
