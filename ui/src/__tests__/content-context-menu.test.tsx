import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as menu from "../components/context-menu";
import { MarkdownText } from "../blocks/markdown-text";
import { ChatItem } from "../blocks/chat-history";
import { HistoryAttachmentView } from "../blocks/agent-attachments";
import { ImageBlock } from "../blocks/data-image";
import { CodeViewBlock } from "../blocks/code-view";
import { EditorView } from "@codemirror/view";
import * as windowData from "../data/window-data";

vi.mock("../data/window-data", async (importOriginal) => ({
  ...await importOriginal<typeof import("../data/window-data")>(),
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding }),
}));
vi.mock("../data/use-media", () => ({ useMedia: () => ({ status: "ready", url: "data:image/png;base64,aW1hZ2U=", retry: vi.fn() }) }));
vi.mock("../components/data-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("../components/data-state")>(), useFolderPick: () => ({ clear: vi.fn(), error: null, pick: vi.fn() }),
}));
vi.mock("../share/visible", () => ({ useShareDescriber: () => {} }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined), write: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("링크 메뉴는 클릭과 같은 열기와 주소 복사를 제공한다", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  render(<><menu.ContextMenuHost /><MarkdownText>{"[링크](https://example.com/a) [메일](mailto:a@example.com)"}</MarkdownText></>);
  const link = screen.getByRole("link", { name: "링크" });
  fireEvent.contextMenu(link);
  expect(screen.getAllByRole("menuitem").map((x) => x.textContent)).toEqual(["링크 열기", "링크 주소 복사"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "링크 열기" }));
  expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  link.focus(); fireEvent.keyDown(link, { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "링크 주소 복사" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com/a");
  fireEvent.contextMenu(screen.getByRole("link", { name: "메일" }));
  expect(screen.queryByRole("menuitem", { name: "링크 열기" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "링크 주소 복사" })).toBeTruthy();
});

it("링크 열기는 창의 외부 열기 호출과 실패 알림을 사용한다", async () => {
  const failure = { id: "EXTERNAL_TEST", code: "io", message: "열기 실패", details: [] };
  const call = vi.fn().mockRejectedValue(failure);
  const setNotice = vi.fn();
  vi.spyOn(windowData, "useOptionalWindowData").mockReturnValue({ windowId: "window", store: { call }, setNotice } as never);
  render(<><menu.ContextMenuHost /><MarkdownText>{"[주소](https://example.com/path)"}</MarkdownText></>);
  fireEvent.contextMenu(screen.getByRole("link", { name: "주소" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "링크 열기" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ op: "external.open", window_id: "window", url: "https://example.com/path" }));
  await waitFor(() => expect(setNotice).toHaveBeenCalledWith(expect.objectContaining({ message: "열기 실패" })));
});

it("코드 펜스는 선택 복사 뒤에 원문 전체 복사를 둔다", () => {
  render(<><menu.ContextMenuHost /><MarkdownText>{"```text\n첫 줄\n  둘째 줄\n```"}</MarkdownText></>);
  const pre = document.querySelector("pre")!;
  const range = document.createRange(); range.selectNodeContents(pre.querySelector(".ks-code-line")!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.contextMenu(pre);
  expect(screen.getAllByRole("menuitem").map((x) => x.textContent)).toEqual([expect.stringContaining("복사"), "코드 복사"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "코드 복사" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("첫 줄\n  둘째 줄\n");
  pre.focus(); fireEvent.keyDown(pre, { key: "ContextMenu" });
  expect(screen.getByRole("menuitem", { name: "코드 복사" })).toBeTruthy();
});

it("읽기 전용 코드 블록의 코드 전체를 복사한다", async () => {
  render(<><menu.ContextMenuHost /><CodeViewBlock block={{ type: "code", value: "one\ntwo" } as never} pointer="/code" context={{} as never} /></>);
  const editor = await screen.findByLabelText("코드 보기");
  vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue(null);
  editor.focus(); fireEvent.keyDown(editor, { key: "ContextMenu" });
  fireEvent.click(screen.getByRole("menuitem", { name: "코드 복사" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("one\ntwo");
});

it("대화의 원문을 복사하고 안쪽 링크가 바깥 메시지 메뉴를 이긴다", () => {
  const item = { id: "a", kind: "assistant", text: "[링크](https://example.com/) **원문**" } as never;
  const { container } = render(<><menu.ContextMenuHost /><ChatItem item={item} renderAttachment={() => null} /></>);
  const row = container.querySelector<HTMLElement>(".ks-agent-chat-assistant")!;
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole("menuitem", { name: "메시지 복사" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("[링크](https://example.com/) **원문**");
  fireEvent.contextMenu(screen.getByRole("link", { name: "링크" }));
  expect(screen.queryByRole("menuitem", { name: "메시지 복사" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "링크 주소 복사" })).toBeTruthy();
});

it("사용자 말의 키보드 메뉴는 원문을 복사하고 첨부 메뉴가 우선한다", async () => {
  const attachment = { id: "inside", name: "안쪽 그림", mime: "image/png" };
  const item = { id: "user", kind: "user", text: "사용자 원문\n둘째 줄", attachments: [attachment] } as never;
  const { container } = render(<><menu.ContextMenuHost /><ChatItem item={item} renderAttachment={() => <HistoryAttachmentView key={attachment.id} attachment={attachment} cacheKey={["nested-image"]} load={async () => ({ mime: "image/png", data_base64: "aW1hZ2U=" })} open={async () => {}} onPreview={() => {}} onError={() => {}} />} /></>);
  const row = container.querySelector<HTMLElement>(".ks-agent-chat-user")!;
  row.focus(); fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  fireEvent.click(screen.getByRole("menuitem", { name: "메시지 복사" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("사용자 원문\n둘째 줄");
  const image = await screen.findByRole("button", { name: "안쪽 그림" });
  fireEvent.contextMenu(image);
  expect(screen.getByRole("menuitem", { name: "이미지 복사" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "메시지 복사" })).toBeNull();
});

it("첨부 그림은 크게 보기와 이미지 복사를 순서대로 제공한다", async () => {
  const preview = vi.fn();
  const { container } = render(<><menu.ContextMenuHost /><HistoryAttachmentView attachment={{ id: "img", name: "그림", mime: "image/png" }} cacheKey={["menu-test"]} load={async () => ({ mime: "image/png", data_base64: "aW1hZ2U=" })} open={async () => {}} onPreview={preview} onError={() => {}} /></>);
  const button = await screen.findByRole("button", { name: "그림" });
  fireEvent.contextMenu(button.querySelector("img")!);
  expect(screen.getAllByRole("menuitem").map((x) => x.textContent)).toEqual(["크게 보기", "이미지 복사"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "크게 보기" }));
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ name: "그림", trigger: button }));
  button.focus(); fireEvent.keyDown(button, { key: "ContextMenu" });
  expect(screen.getByRole("menuitem", { name: "이미지 복사" })).toBeTruthy();
  expect(container.querySelector("img")).toBeTruthy();
});

it("이미지 블록의 그림은 우클릭과 키보드 메뉴로 복사한다", async () => {
  const { container } = render(<><menu.ContextMenuHost /><ImageBlock block={{ type: "image", src: { asset: "image" } } as never} pointer="/image" /></>);
  const image = await waitFor(() => { const value = container.querySelector("img"); expect(value).toBeTruthy(); return value!; });
  fireEvent.contextMenu(image);
  expect(screen.getByRole("menuitem", { name: "이미지 복사" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const host = container.querySelector<HTMLElement>(".ks-image-view")!; host.focus(); fireEvent.keyDown(host, { key: "F10", shiftKey: true });
  expect(screen.getByRole("menuitem", { name: "이미지 복사" })).toBeTruthy();
});

it("PNG는 그대로 쓰고 다른 이미지는 캔버스 PNG로 변환하며 실패를 알린다", async () => {
  const onError = vi.fn(); render(<menu.ContextMenuHost onError={onError} />);
  const png = new Blob(["png"], { type: "image/png" }); const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
  const fetcher = vi.fn().mockResolvedValueOnce({ blob: async () => png }).mockResolvedValueOnce({ blob: async () => jpeg }).mockRejectedValueOnce(new Error("읽기 실패"));
  vi.stubGlobal("fetch", fetcher);
  const written: Array<Record<string, Blob>> = [];
  vi.stubGlobal("ClipboardItem", class { constructor(data: Record<string, Blob>) { written.push(data); } });
  const output = new Blob(["converted"], { type: "image/png" });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(output));
  const image = document.createElement("img"); image.src = "https://example.com/a";
  Object.defineProperties(image, { naturalWidth: { value: 10 }, naturalHeight: { value: 20 } });
  expect(await menu.writeMenuImage(image, "이미지 복사")).toBe(true);
  expect(written[0]["image/png"]).toBe(png);
  expect(await menu.writeMenuImage(image, "이미지 복사")).toBe(true);
  expect(drawImage).toHaveBeenCalled(); expect(written[1]["image/png"]).toBe(output);
  expect(await menu.writeMenuImage(image, "이미지 복사")).toBe(false);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: "SHELL_MENU_IMAGE_CLIPBOARD_WRITE_FAILED", message: expect.stringContaining("원인: 읽기 실패") }));
});
