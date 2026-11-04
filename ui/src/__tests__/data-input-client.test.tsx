import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ButtonBlock, ColorBlock, InputBlock, SelectBlock, ToggleBlock } from "../blocks/data-input";
import "../styles/data-input-preview.css";

const runtime = vi.hoisted(() => ({ values: {} as Record<string, unknown>, act: vi.fn().mockResolvedValue(true) }));
const previewRender = vi.hoisted(() => vi.fn());
vi.mock("../render/render-block", () => ({ renderBlock: (...args: unknown[]) => previewRender(...args) }));
vi.mock("../data/window-data", () => ({
  useWindowData: () => runtime,
  useBinding: (_pointer: string, binding: unknown) => ({ status: "ready", value: binding && typeof binding === "object" && "client" in binding ? runtime.values[(binding as { client: string }).client] : binding && typeof binding === "object" && "state" in binding ? 120 : binding }),
}));
afterEach(() => { cleanup(); runtime.values = {}; runtime.act.mockClear(); previewRender.mockClear(); });

it.each([false, true])("읽기 전용 %s줄 입력은 동작을 막고 해제하면 다시 편집한다", async (multiline) => {
  runtime.values = { text: "저장된 내용", locked: false };
  const input = { type: "input", label: "내용", multiline, value: { client: "text" }, read_only: { client: "locked" },
    on_change: { client: "change" }, on_submit: { client: "submit" }, on_cancel: { client: "cancel" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" }) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "임시 초안" } });
  runtime.values.locked = true;
  view.rerender(draw());
  expect(field.readOnly).toBe(true);
  expect(field.getAttribute("aria-readonly")).toBe("true");
  expect(field.value).toBe("저장된 내용");
  fireEvent.change(field, { target: { value: "막힌 입력" } });
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: multiline });
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.blur(field);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(runtime.act).not.toHaveBeenCalled();
  runtime.values.locked = false;
  view.rerender(draw());
  expect(field.readOnly).toBe(false);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "다시 수정" } });
  fireEvent.blur(field);
  await vi.waitFor(() => expect(runtime.act).toHaveBeenCalledWith("/input/on_change", "다시 수정"));
});

it("읽기 전용 검색 입력의 지우기 조작은 값을 보내지 않는다", () => {
  runtime.values = { text: "검색어", locked: true };
  const input = { type: "input", kind: "search", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const clear = screen.queryByRole("button", { name: "지우기" }) as HTMLButtonElement | null;
  if (clear) fireEvent.click(clear);
  expect(runtime.act).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("검색어");
});

it("초점을 유지한 채 읽기 전용을 해제한 뒤에도 편집 중 초안을 보존한다", () => {
  runtime.values = { text: "원본", locked: false };
  const input = { type: "input", label: "내용", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" }) as HTMLInputElement;
  fireEvent.focus(field);
  runtime.values.locked = true;
  view.rerender(draw());
  runtime.values.locked = false;
  view.rerender(draw());
  fireEvent.change(field, { target: { value: "새 초안" } });
  runtime.values.text = "외부 변경";
  view.rerender(draw());
  expect(field.value).toBe("새 초안");
});

it("전환 전에 확정한 편집은 순서대로 전송하고 전환 뒤 새 입력과 제출은 막는다", async () => {
  let complete!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { complete = resolve; }));
  runtime.values = { text: "원본", locked: false };
  const input = { type: "input", label: "내용", value: { client: "text" }, read_only: { client: "locked" }, on_change: { client: "change" }, on_submit: { client: "submit" } };
  const draw = () => <InputBlock block={input as never} context={{} as never} pointer="/input" />;
  const view = render(draw());
  const field = screen.getByRole("textbox", { name: "내용" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "첫 편집" } });
  fireEvent.blur(field);
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "다음 편집" } });
  fireEvent.blur(field);
  expect(runtime.act).toHaveBeenCalledTimes(1);
  runtime.values.locked = true;
  view.rerender(draw());
  fireEvent.change(field, { target: { value: "잠긴 뒤 입력" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await act(async () => complete(true));
  expect(runtime.act).toHaveBeenCalledTimes(2);
  expect(runtime.act).toHaveBeenNthCalledWith(1, "/input/on_change", "첫 편집");
  expect(runtime.act).toHaveBeenNthCalledWith(2, "/input/on_change", "다음 편집");
  expect(runtime.act).not.toHaveBeenCalledWith("/input/on_submit", expect.anything());
});

it("클라이언트 버튼 이름·아이콘과 색상 비활성 상태가 바뀐다", () => {
  runtime.values = { label: "재생", icon: "play", disabled: true, color: "#123456" };
  const button = { type: "button", label: { client: "label" }, icon: { client: "icon" }, on_click: { client: "go" } };
  const color = { type: "color", label: "배경", value: { client: "color" }, disabled: { client: "disabled" }, on_change: { client: "change" } };
  const draw = () => <><ButtonBlock block={button as never} context={{} as never} pointer="/button" /><ColorBlock block={color as never} context={{} as never} pointer="/color" /></>;
  const view = render(draw());
  expect(screen.getByRole("button", { name: "재생" }).querySelector("svg")).toBeTruthy();
  expect((screen.getByLabelText("배경") as HTMLInputElement).disabled).toBe(true);
  runtime.values = { ...runtime.values, label: "일시정지", icon: "pause", disabled: false };
  view.rerender(draw());
  expect(screen.getByRole("button", { name: "일시정지" }).querySelector("svg")).toBeTruthy();
  expect((screen.getByLabelText("배경") as HTMLInputElement).disabled).toBe(false);
  runtime.values = { ...runtime.values, icon: "volume-2" };
  view.rerender(draw());
  expect(screen.getByRole("button", { name: "일시정지" }).querySelector("svg")).toBeNull();
});

it("라벨 입력과 묶음 선택지를 기존 선택기로 표시한다", () => {
  const input = { type: "input", label: "BPM", kind: "number", value: { state: "bpm" }, on_change: { client: "bpm" } };
  const select = { type: "select", label: "스타일", value: { state: "style" }, on_change: { client: "style" }, options: [{ name: "기본", options: [{ value: "a", label: "누아르" }] }] };
  render(<><InputBlock block={input as never} context={{} as never} pointer="/input" /><SelectBlock block={select as never} context={{} as never} pointer="/select" /></>);
  expect(screen.getByRole("spinbutton", { name: "BPM" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "스타일" }));
  expect(screen.getByText("기본")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "누아르" }));
  expect(runtime.act).toHaveBeenCalledWith("/select/on_change", "a");
});

it("자동 숫자로 정규화된 값이 이전과 같아도 흐린 입력 초안을 비운다", async () => {
  runtime.values = { bpm: null };
  const input = { type: "input", label: "BPM", kind: "number", value: { client: "bpm" }, on_change: { client: "bpm" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton", { name: "BPM" }) as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-5" } });
  fireEvent.blur(field);
  await vi.waitFor(() => expect(field.value).toBe(""));
});

it("수정 키를 눌러 단추를 누르면 동작에 그대로 전한다", () => {
  const button = { type: "button", label: "선택", on_click: { client: "select" } };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  fireEvent.click(screen.getByRole("button", { name: "선택" }), { shiftKey: true });
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: true, alt: false, ctrl: false, meta: false });
});

it("비활성 선택기와 토글은 disabled 접근성 상태를 내고 조작되지 않는다", () => {
  runtime.values = { disabled: true };
  const select = { type: "select", label: "환경", value: "local", on_change: { client: "select" }, options: ["local", "remote"], disabled: { client: "disabled" } };
  const toggle = { type: "toggle", label: "자동 저장", value: true, on_change: { client: "toggle" }, disabled: { client: "disabled" } };
  render(<><SelectBlock block={select as never} context={{} as never} pointer="/select" /><ToggleBlock block={toggle as never} context={{} as never} pointer="/toggle" /></>);

  const selectButton = screen.getByRole("button", { name: "환경" }) as HTMLButtonElement;
  const toggleButton = screen.getByRole("switch", { name: "자동 저장" }) as HTMLButtonElement;
  expect(selectButton.disabled).toBe(true);
  expect(toggleButton.disabled).toBe(true);
  fireEvent.click(selectButton);
  fireEvent.click(toggleButton);
  expect(screen.queryByRole("menuitem")).toBeNull();
  expect(runtime.act).not.toHaveBeenCalled();
});

it("공용 select와 버튼 블록은 축약 가능한 라벨 요소를 쓴다", () => {
  const select = { type: "select", value: "long", on_change: { client: "select" }, options: [{ value: "long", label: "아주 길어서 좁은 창에서 한 줄 말줄임이 필요한 선택지" }] };
  const button = { type: "button", label: "아주 길어서 좁은 창에서 한 줄 말줄임이 필요한 단추", on_click: { client: "run" } };
  render(<><SelectBlock block={select as never} context={{} as never} pointer="/select" /><ButtonBlock block={button as never} context={{} as never} pointer="/button" /></>);
  expect(document.querySelector(".ks-select-button .ks-select-choice-label")).toBeTruthy();
  expect(document.querySelector(".ks-data-button .ks-truncate-label")?.textContent).toContain("아주 길어서");
});

it("columns 입력은 보일 문자 수와 숫자 조작부 폭을 전달한다", () => {
  const input = { type: "input", kind: "number", columns: 4, value: 12, on_change: { client: "change" } };
  render(<InputBlock block={input as never} context={{} as never} pointer="/input" />);
  const field = screen.getByRole("spinbutton") as HTMLInputElement;
  const wrapper = field.closest(".ks-data-input") as HTMLDivElement;
  expect(wrapper.classList.contains("has-columns")).toBe(true);
  expect(wrapper.classList.contains("is-native-number")).toBe(true);
  expect(wrapper.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  field.focus();
  fireEvent.change(field, { target: { value: "1234" } });
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("1234");
});

it("search columns는 같은 문자 수와 검색 아이콘·지우기 조작부를 유지한다", () => {
  const plain = { type: "input", kind: "text", columns: 4, value: "표본", on_change: { client: "plain" } };
  const search = { type: "input", kind: "search", columns: 4, value: "표본", on_change: { client: "search" } };
  const view = render(<><InputBlock block={plain as never} context={{} as never} pointer="/plain" /><InputBlock block={search as never} context={{} as never} pointer="/search" /></>);
  const plainInput = view.container.querySelector(".ks-data-input.has-columns:not(.is-search)") as HTMLDivElement;
  const searchInput = view.container.querySelector(".ks-data-input.has-columns.is-search") as HTMLDivElement;
  expect(plainInput.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  expect(searchInput.style.getPropertyValue("--ks-input-columns")).toBe("4ch");
  expect(searchInput.classList.contains("is-search")).toBe(true);
  expect(searchInput.querySelector(".ks-data-input-search")).toBeTruthy();
  expect(searchInput.querySelector(".ks-data-input-clear")).toBeTruthy();
});

it("preview 단추는 그림과 이름을 한 선택 가능한 카드로 묶고 prefix를 접근 이름에 넣는다", () => {
  const preview = { type: "canvas", surface: "tile", aspect_ratio: 1 };
  const context = {} as never;
  const button = {
    type: "button", variant: "chip", label: "격자", prefix: "배치", preview,
    pressed: true, on_click: { client: "choose" },
  };
  render(<ButtonBlock block={button as never} context={context} pointer="/button" />);
  const action = screen.getByRole("button", { name: "배치: 격자" });
  const card = action.closest(".ks-data-button-card");
  expect(card).toBeTruthy();
  expect(card?.querySelector(".ks-data-button-card-preview")).toBeTruthy();
  expect(action.classList.contains("ks-data-button-card-action")).toBe(true);
  expect(action.getAttribute("aria-pressed")).toBe("true");
  expect(card?.querySelector(".ks-data-button-prefix")?.textContent).toBe("배치");
  expect(card?.querySelector(".ks-data-button-label")?.textContent).toBe("격자");
  expect(previewRender).toHaveBeenCalledWith(preview, context, "/button/preview");
  fireEvent.click(action);
  expect(runtime.act).toHaveBeenCalledWith("/button/on_click", null, undefined, { shift: false, alt: false, ctrl: false, meta: false });
});

it.each(["일반", "아이콘", "카드"])("%s 단추는 실행 중 포커스를 유지하고 중복 실행을 막는다", async (kind) => {
  let finish!: (value: boolean) => void;
  runtime.act.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const button = { type: "button", label: "선택", on_click: { client: "choose" },
    ...(kind === "아이콘" ? { icon: "check", icon_only: true } : {}),
    ...(kind === "카드" ? { preview: { type: "canvas", surface: "tile" } } : {}) };
  render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const action = screen.getByRole("button", { name: "선택" }) as HTMLButtonElement;
  action.focus();
  await userEvent.keyboard("{Enter}");
  expect(action.disabled).toBe(false);
  expect(action.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(action);
  await userEvent.keyboard("{Enter}");
  expect(runtime.act).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(document.activeElement).toBe(action);
});

it("image preview의 포커스 가능한 자식은 inert이고 탭 순서에는 카드 단추만 남는다", () => {
  previewRender.mockImplementation(() => <><button aria-label="확대" /><button aria-label="다시 시도" /></>);
  const image = { type: "image", src: { asset: "sample" } };
  const button = { type: "button", label: "견본", preview: image, on_click: { client: "choose" } };
  const view = render(<ButtonBlock block={button as never} context={{} as never} pointer="/button" />);
  const preview = view.container.querySelector(".ks-data-button-card-preview") as HTMLDivElement;
  const cardButton = screen.getByRole("button", { name: "견본" });
  const tabStops = [...view.container.querySelectorAll("button")].filter((item) => !item.closest("[inert]") && !item.disabled);

  expect(preview.hasAttribute("inert")).toBe(true);
  expect(preview.querySelectorAll("button")).toHaveLength(2);
  expect(cardButton.closest(".ks-data-button-card")).toBeTruthy();
  expect(preview.contains(cardButton)).toBe(false);
  expect(tabStops).toEqual([cardButton]);
});
