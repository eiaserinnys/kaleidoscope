import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { makeTestSeed, mdViewerDefinition } from "./fixtures";
import { ContextMenuHost } from "../components/context-menu";
import { mockVirtualLayout } from "./virtual-layout";

beforeEach(() => { mockVirtualLayout();
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = measure.call(this);
    return this.matches(".ks-media-thumbnail") ? new DOMRect(rect.x, rect.y, 32, 32) : rect;
  }); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(ui: unknown) {
  const definition = { ...mdViewerDefinition, requires: { blocks: 40, modules: {} }, state: { ...mdViewerDefinition.state, choice: null, removed: [], locked: true, selected: "a" }, ui: ui as Block } as AppDefinition;
  const transport = createFakeTransport({ ...makeTestSeed({ definitions: [definition] }), media: { "builtin-icon": "data:image/png;base64,iVBORw0KGgo=" } });
  const calls = vi.spyOn(transport, "call");
  const store = createShellStore(transport);
  render(<><ContextMenuHost /><AppWindowContent store={store} windowId="viewer-window" /></>);
  return { calls, store };
}

it.each(["rows", "grid", "icons"])("잠긴 %s 목록은 행 조작을 막고 해제하면 다시 허용한다", async (layout) => {
  const { calls, store } = setup({ type: "stack", direction: "column", children: [
    { type: "list", layout, disabled: { state: "locked" }, items: [{ key: "a", title: "첫 행" }, { key: "b", title: "둘째 행" }], selected: { state: "selected" }, on_select: { set_state: "choice" }, on_remove: { set_state: "removed" }, item_menu: [{ label: "행 동작", on_select: { set_state: "choice" } }] },
    { type: "button", label: "잠금 해제", on_click: { set_state: "locked", value: false } },
  ] });
  const row = await screen.findByRole("button", { name: "첫 행" });
  expect(row.getAttribute("aria-disabled")).toBe("true");
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("button", { name: "첫 행 빼기" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(row);
  row.focus();
  await userEvent.keyboard("{Enter}{Space}");
  fireEvent.contextMenu(row);
  expect(screen.queryByRole("menuitem", { name: "행 동작" })).toBeNull();
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("둘째 행");
  fireEvent.click(screen.getByRole("button", { name: "잠금 해제" }));
  await waitFor(() => expect(row.getAttribute("aria-disabled")).not.toBe("true"));
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("button", { name: "첫 행 빼기" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.contextMenu(row);
  expect(await screen.findByRole("menuitem", { name: "행 동작" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.click(row);
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.choice).toBe("a"));
});

it("잠긴 그림 목록은 미리보기를 열지 않는다", async () => {
  setup({ type: "list", disabled: true, items: [{ key: "a", title: "사진", image: { asset: "builtin-icon" } }] });
  fireEvent.click(await screen.findByRole("option", { name: "사진" }));
  expect(screen.queryByRole("dialog", { name: "사진" })).toBeNull();
});

it("피드 첨부와 링크를 조작한다", async () => {
  const { calls } = setup({ type: "feed", on_select: { set_state: "choice" }, entries: [{ key: "a", name: "글쓴이", meta: "시각", body: "본문", media: [{ image: { asset: "builtin-icon" }, alt: "사진", kind: "image" }, { image: { asset: "builtin-icon" }, kind: "video" }, { image: { asset: "builtin-icon" }, kind: "animation" }], link: "https://example.com/post" }] });
  const thumb = await screen.findByRole("button", { name: "사진" });
  expect(screen.getByText("영상")).toBeTruthy();
  expect(screen.getByText("GIF")).toBeTruthy();
  thumb.focus();
  fireEvent.click(thumb);
  await screen.findByRole("dialog", { name: "사진" });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(document.activeElement).toBe(thumb);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls.mock.calls.filter(([request]) => request.op === "data.act")).toHaveLength(0);
  fireEvent.click(screen.getByRole("link", { name: "시각" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith({ op: "external.open", window_id: "viewer-window", url: "https://example.com/post" }));
  expect(fireEvent(screen.getByRole("link", { name: "시각" }), new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }))).toBe(false);
  await waitFor(() => expect(calls.mock.calls.filter(([request]) => request.op === "external.open")).toHaveLength(2));
});

it.each(["rows", "grid"])("목록 %s의 빼기는 해당 항목으로 동작한다", async (layout) => {
  const { calls, store } = setup({ type: "list", layout, items: [{ key: "a", title: "그림" }], on_remove: { set_state: "choice" } });
  fireEvent.click(await screen.findByRole("button", { name: "그림 빼기" }));
  await waitFor(() => expect(calls).toHaveBeenCalledWith(expect.objectContaining({ op: "data.act", pointer: "/ui/on_remove", event: "a", item: { key: "a", title: "그림" } })));
  await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.choice).toBe("a"));
});

it("고르기 동작이 없는 그림 목록을 누르면 확대하고 초점을 돌려준다", async () => {
  setup({ type: "list", items: [{ key: "a", title: "사진", image: { asset: "builtin-icon" } }] });
  const row = await screen.findByRole("option", { name: "사진" });
  row.focus();
  fireEvent.click(row);
  const dialog = await screen.findByRole("dialog", { name: "사진" });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(document.activeElement).toBe(row);
});


it.each(["rows", "grid"])("빼기가 있는 %s 목록은 항목마다 조작 단추를 묶는다", async (layout) => {
  setup({ type: "list", layout, items: [{key:"a", title:"첫 사진"}], on_remove:{set_state:"choice"} });
  const list = await screen.findByRole("list", {name:"목록"});
  expect(list.querySelector('[role="listitem"]')).toBeTruthy();
  expect(list.querySelector('[role="option"]')).toBeNull();
});

it.each(["rows", "grid"])("%s에서 첫째와 마지막을 키보드로 빼면 이웃 빼기에 초점이 남는다", async (layout) => {
  setup({type:"stack", direction:"column", children:[{ type:"list", layout,
    items:{expr:'[{"key":"a","title":"첫 사진"},{"key":"b","title":"둘째 사진"},{"key":"c","title":"셋째 사진"}][$not(key in $state.removed)]'},
    on_remove:[{set_state:"removed", value:{expr:'$append($state.removed, [$event])'}}]},
    {type:"button",label:"다음 자리",icon:"check",on_click:{set_state:"choice"}},
    {type:"button",label:"올리기",icon:"send",variant:"primary",on_click:{set_state:"choice"}}]});
  const first=await screen.findByRole("button",{name:"첫 사진 빼기"});
  first.focus(); await userEvent.keyboard("{Enter}");
  await waitFor(()=>expect(document.activeElement?.getAttribute("aria-label")).toBe("둘째 사진 빼기"));
  const last=screen.getByRole("button",{name:"셋째 사진 빼기"}); last.focus(); await userEvent.keyboard("{Enter}");
  await waitFor(()=>expect(document.activeElement?.getAttribute("aria-label")).toBe("둘째 사진 빼기"));
  await userEvent.keyboard("{Enter}");
  await waitFor(()=>expect(document.activeElement?.textContent).toBe("다음 자리"));
});

it("불러오는 첨부도 확대창을 바로 열고 그 안에서 기다린다", async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { release = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => response.then((value) => value.clone()));
  setup({type:"feed",entries:[{key:"a",body:"본문",media:[{image:{asset:"builtin-icon"},alt:"늦는 사진"}]}]});
  const thumb=await screen.findByRole("button",{name:"늦는 사진"});
  fireEvent.click(thumb);
  const dialog=await screen.findByRole("dialog",{name:"늦는 사진"});
  expect(dialog.querySelector('[role="status"]')).toBeTruthy();
  release(new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}}));
  await waitFor(()=>expect(dialog.querySelector("img")).toBeTruthy());
});

it("실패 첨부를 누르면 다시 받는다", async () => {
  const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("그림 실패",{status:500}));
  setup({type:"feed",entries:[{key:"a",body:"본문",media:[{image:{asset:"builtin-icon"},alt:"실패 사진"}]}]});
  const thumb=await screen.findByRole("button",{name:"실패 사진"});
  await screen.findByText("다시 받기");
  const count=fetch.mock.calls.length;
  fireEvent.click(thumb);
  await waitFor(()=>expect(fetch.mock.calls.length).toBeGreaterThan(count));
});

it("첨부 그림 우클릭은 행 메뉴 대신 그림 메뉴를 연다", async () => {
  setup({type:"feed",entries:[{key:"a",body:"본문",media:[{image:{asset:"builtin-icon"},alt:"메뉴 사진"}]}]});
  const thumb=await screen.findByRole("button",{name:"메뉴 사진"});
  await waitFor(()=>expect(thumb.querySelector("img")).toBeTruthy());
  fireEvent.contextMenu(thumb);
  expect(await screen.findByRole("menuitem",{name:"크게 보기"})).toBeTruthy();
  expect(screen.getByRole("menuitem",{name:"이미지 복사"})).toBeTruthy();
});

it.each(["rows", "grid", "icons"].flatMap(layout => [false, true].map(removable => ({layout, removable}))))("실패 그림도 행 선택을 막지 않는다: $layout / 빼기 $removable", async ({layout, removable}) => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("그림 실패",{status:500}));
  const {store}=setup({type:"list",layout,items:[{key:"a",title:"실패 행",image:{asset:"builtin-icon"}}],on_select:{set_state:"choice"},...(removable ? {on_remove:{set_state:"removed"}} : {})});
  const row=await screen.findByRole(removable ? "button" : "option",{name:"실패 행"});
  await waitFor(()=>expect(row.querySelector('.ks-media-thumbnail.is-failed')).toBeTruthy());
  fireEvent.click(row.querySelector('.ks-media-thumbnail')!);
  await waitFor(()=>expect(store.getSnapshot()?.shared.windows[0].state.choice).toBe("a"));
  expect(document.querySelector('.ks-data-window-notice')?.textContent ?? "").toBe("");
});

it.each(["rows","grid"])("%s 목록이 비면 뒤의 좋아요보다 앞 조작을 먼저 고른다", async layout => {
  setup({type:"stack",direction:"column",children:[
    {type:"button",label:"앞 조작",icon:"image",on_click:{set_state:"choice"}},
    {type:"list",layout,items:{expr:'[{"key":"a","title":"첨부"}][$not(key in $state.removed)]'},on_remove:[{set_state:"removed",value:{expr:'$append($state.removed, [$event])'}}]},
    {type:"button",label:"좋아요",icon:"heart",variant:"primary",on_click:{set_state:"choice"}}]});
  const remove=await screen.findByRole("button",{name:"첨부 빼기"});remove.focus();await userEvent.keyboard("{Enter}");
  await waitFor(()=>expect(document.activeElement?.textContent).toBe("앞 조작"));
});
