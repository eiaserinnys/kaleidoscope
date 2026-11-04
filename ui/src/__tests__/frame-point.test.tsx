import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { executeWindowAction, readWindowView, registerControlWindow, setWindowViewGeometry } from "../share/window-control";
import { framePointHandler } from "../share/frame-point";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

for (const type of ["sandbox", "html_view"] as const) it(`${type} 좌표를 프레임에 전하고 완료를 기다린다`, async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  const definition: AppDefinition = { ...mdEditorDefinition, ui: { type, value: "<p>내용</p>", title: "격리" } as Block };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  render(<div data-window-id="editor-window"><AppWindowContent store={store} windowId="editor-window" /></div>);
  const frame = await screen.findByTitle(type === "sandbox" ? "격리" : definition.name) as HTMLIFrameElement;
  expect(framePointHandler(frame)).toBeTypeOf("function");
  const root = frame.parentElement as HTMLElement;
  const unregister = registerControlWindow("editor-window", root, store);
  const view = readWindowView("editor-window");
  setWindowViewGeometry("editor-window", view.view_id, { css_width: 100, css_height: 100, pixel_width: 100, pixel_height: 100 });
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const pending = executeWindowAction("editor-window", view.view_id, { kind: "point", x: 20, y: 30, gesture: "double_click" }, "point-test");
  const prefix = type === "sandbox" ? "ks-sandbox" : "ks-html";
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: `${prefix}-point`, x: 20, y: 30, gesture: "double_click", requestId: "point-test" }), "*"));
  await act(async () => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { type: `${prefix}-point-done`, requestId: "point-test", token: "00000000-0000-4000-8000-000000000001" } })));
  expect((await pending).after?.settled).toBe(true);
  unregister(); store.dispose();
});
