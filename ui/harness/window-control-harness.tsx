import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppWindowContent, createFakeTransport, createShellStore, TextInput } from "../src/index";
import { executeWindowAction, readWindowView, setWindowViewGeometry } from "../src/share/window-control";
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

function Harness() {
  const [outside, setOutside] = useState("디렉터 초안");
  return <div className="app-root">
    <WindowFrame area={{ width: 1000, height: 700 }} appName="조작 대상" isTop={false} sharing shareable={false} hasSettings={false} store={store} onCall={(request) => store.call(request)} onMinimize={() => {}} onMaximize={() => {}} onRestore={() => {}} window={appWindow}>
      <AppWindowContent store={store} windowId={appWindow.id} />
    </WindowFrame>
    <div className="ks-data-window" data-window-id="other" style={{ position: "fixed", right: 20, top: 20 }}>
      <TextInput persistent aria-label="다른 창" value={outside} onEdit={setOutside} onCommit={() => { (window as any).controlHarness.blurCommits += 1; }} onCancel={() => {}} />
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
