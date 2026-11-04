import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { Menu } from "../components/menu";
import { describeNumbered, forgetNumbered } from "../share/numbered";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { mockVirtualLayout } from "./virtual-layout";

afterEach(() => { cleanup(); forgetNumbered("viewer-window"); vi.restoreAllMocks(); });
it("실제 블록 화면의 조작 요소를 번호로 옮긴다", async () => {
  mockVirtualLayout();
  const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 4, modules: {} }, permissions: [], state: { value: "", tab: 0, choice: null, checked: false }, ui: {
    type: "stack", direction: "column", children: [
      { type: "button", label: "저장", on_click: { set_state: "value" } },
      { type: "input", label: "제목", value: { state: "value" }, on_change: { set_state: "value" } },
      { type: "toggle", label: "표시", value: { state: "checked" }, on_change: { set_state: "checked" } },
      { type: "select", label: "종류", value: { state: "value" }, options: ["하나", "둘"], on_change: { set_state: "value" } },
      { type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [{ label: "목록 탭", child: { type: "list", items: [{ key: "a", title: "첫 항목" }], on_select: { set_state: "choice" } } }] },
    ],
  } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await screen.findByRole("button", { name: "저장" });
  await screen.findByRole("tab", { name: "목록 탭" });
  const root = view.container.querySelector<HTMLElement>(".ks-data-window")!;
  const text = describeNumbered("viewer-window", root).text;
  expect(text).toMatch(/\[\d+\] 단추 저장/);
  expect(text).toMatch(/\[\d+\] 입력칸 제목/);
  expect(text).toMatch(/\[\d+\] 탭 › 목록 탭/);
  expect(text).toContain("표시");
  expect(text).toContain("종류");
});

it("동작이 없는 읽기 전용 목록과 표의 행은 번호를 주지 않는다", async () => {
  mockVirtualLayout();
  const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  const definition: AppDefinition = { ...mdViewerDefinition, requires: { blocks: 4, modules: {} }, permissions: [], ui: {
    type: "stack", direction: "column", children: [
      { type: "list", items: [{ key: "a", title: "읽기 목록" }] },
      { type: "table", rows: [{ key: "b", title: "읽기 표" }], columns: [{ field: "title", label: "제목" }] },
    ],
  } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const view = render(<AppWindowContent store={createShellStore(transport)} windowId="viewer-window" />);
  await screen.findByRole("option", { name: "읽기 목록" });
  await screen.findByRole("row", { name: /읽기 표/ });
  const text = describeNumbered("viewer-window", view.container.querySelector<HTMLElement>(".ks-data-window")!).text;
  expect(text).not.toMatch(/\[\d+\] 목록 항목 읽기 목록/);
  expect(text).not.toMatch(/\[\d+\] 목록 행 .*읽기 표/);
});

it("실제 메뉴 포털은 앵커가 속한 창에서만 읽는다", () => {
  const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(document, "createRange").mockImplementation(() => ({ setStart() {}, setEnd() {}, getClientRects: () => [rect] }) as unknown as Range);
  const a = document.createElement("div");
  const b = document.createElement("div");
  a.className = b.className = "ks-data-window";
  a.dataset.windowId = "viewer-window"; b.dataset.windowId = "other";
  a.innerHTML = "<button>첫 창</button>"; b.innerHTML = "<button>둘째 창</button>";
  document.body.append(a, b);
  const view = render(<>
    <Menu anchor={a.querySelector("button")!} items={[{ id: "a", label: "내 메뉴" }]} onClose={() => {}} />
    <Menu anchor={b.querySelector("button")!} items={[{ id: "b", label: "다른 메뉴" }]} onClose={() => {}} />
  </>);
  const text = describeNumbered("viewer-window", a).text;
  expect(text).toMatch(/\[\d+\] 메뉴 항목 내 메뉴/);
  expect(text).not.toContain("다른 메뉴");
  view.unmount(); a.remove(); b.remove();
});
