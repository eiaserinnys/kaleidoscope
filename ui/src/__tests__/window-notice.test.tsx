import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import * as windowData from "../data/window-data";
import { WindowNotice } from "../data/window-notice";
import { isFullyVisible } from "../blocks/web-surface-layer";
import { makeTestSeed } from "./fixtures";

const definition: AppDefinition = { id: "notices", name: "알림", requires: { blocks: 4, modules: {} }, permissions: [], state: {}, ui: { type: "text", value: "본문" } };
let data: windowData.WindowData;
let store: ReturnType<typeof createShellStore>;
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
beforeEach(() => {
  vi.useFakeTimers();
  store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  data = new windowData.WindowData(store, "viewer-window", definition);
  vi.spyOn(windowData, "useWindowData").mockReturnValue(data);
  render(<WindowNotice />);
});
afterEach(() => { cleanup(); store.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(["동작 오류", "원천 실패"])("%s 알림이 겹친 네이티브 웹 표면을 가린다", (kind) => {
  const surface = document.createElement("div");
  document.body.append(surface);
  const rect = new DOMRect(20, 20, 100, 80);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1, item: () => rect } as unknown as DOMRectList);
  expect(isFullyVisible(surface)).toBe(true);

  if (kind === "동작 오류") {
    act(() => data.setNotice({ id: "TEST_ERROR", code: "invalid_request", message: "동작 오류", details: [] }));
  } else {
    cleanup();
    vi.spyOn(data, "getSources").mockReturnValue({ feed: { state: "failed", has_value: true, message: "읽기 실패", id: "SOURCE_READ_FAILED" } } as never);
    render(<WindowNotice />);
  }
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(isFullyVisible(surface)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(isFullyVisible(surface)).toBe(true);
  surface.remove();
});

it("정보 알림은 잠시 보인 뒤 사라진다", () => {
  act(() => data.setStatus("저장했습니다"));
  expect(screen.getByRole("status").textContent).toContain("저장했습니다");
  expect(screen.queryByRole("button")).toBeNull();
  tick(4999);
  expect(screen.queryByRole("status")).toBeTruthy();
  tick(1);
  expect(screen.queryByRole("status")).toBeNull();
});

it("빈 글 복사는 일시 상태로 알리고 5초 뒤 사라진다", async () => {
  const copyDefinition = { ...definition, ui: { type: "button", label: "번역", on_click: { copy_text: "" } } } as AppDefinition;
  data = new windowData.WindowData(store, "viewer-window", copyDefinition);
  cleanup();
  vi.mocked(windowData.useWindowData).mockReturnValue(data);
  render(<WindowNotice />);
  let result: boolean | undefined;
  await act(async () => { result = await data.act("/ui/on_click", null); });
  expect(result).toBe(false);
  expect(screen.getByRole("status").textContent).toBe("번역: 복사할 글이 아직 없습니다. 글이 나온 뒤 다시 누르세요.");
  expect(screen.queryByRole("alert")).toBeNull();
  tick(5000);
  expect(screen.queryByRole("status")).toBeNull();
});

it("마우스를 올려도 정보 알림은 사라진다", () => {
  act(() => data.setStatus("작업을 마쳤습니다"));
  const notice = screen.getByRole("status");
  fireEvent.mouseEnter(notice.parentElement!);
  tick(5000);
  expect(screen.queryByRole("status")).toBeNull();
});

it("정보 알림에는 초점과 닫기 조작이 없다", () => {
  act(() => data.setStatus("작업을 마쳤습니다"));
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("status").querySelector('[tabindex], button, a')).toBeNull();
  tick(5000);
  expect(screen.queryByRole("status")).toBeNull();
});

it("새 정보 알림은 같은 문구라도 시간을 새로 시작한다", () => {
  act(() => data.setStatus("처리했습니다"));
  tick(4000);
  act(() => data.setStatus("처리했습니다"));
  tick(1000);
  expect(screen.queryByRole("status")).toBeTruthy();
  tick(4000);
  expect(screen.queryByRole("status")).toBeNull();
});

it("오류와 다시 시작은 자동으로 사라지지 않는다", () => {
  act(() => data.failClient({ id: "SHELL_CLIENT_FAILED", code: "server", message: "실행 오류", details: [] }));
  tick(10000);
  expect(screen.getByRole("alert").textContent).toContain("실행 오류");
  expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
});

it("원천 실패 알림은 남고 다시 받기와 닫기를 제공한다", () => {
  cleanup();
  vi.spyOn(data, "getSources").mockReturnValue({ feed: { state: "failed", has_value: true, message: "읽기 실패", id: "SOURCE_READ_FAILED" } } as never);
  const refresh = vi.spyOn(data, "refresh").mockResolvedValue(undefined);
  render(<WindowNotice />);
  tick(10000);
  expect(screen.getByRole("alert").textContent).toContain("이전에 받은 내용을 보이고 있습니다. 읽기 실패");
  expect(screen.getByRole("alert").textContent).not.toContain("feed");
  expect(screen.getByRole("alert").textContent).toContain("SOURCE_READ_FAILED");
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  expect(refresh).toHaveBeenCalledWith(["feed"]);
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("원천이 여러 곳에서 실패하면 첫 오류와 나머지 수만 보인다", () => {
  cleanup();
  vi.spyOn(data, "getSources").mockReturnValue({
    first: { state: "failed", has_value: true, message: "첫 오류", id: "FIRST_ERROR" },
    second: { state: "failed", has_value: true, message: "둘째 오류", id: "SECOND_ERROR" },
    third: { state: "failed", has_value: true, message: "셋째 오류", id: "THIRD_ERROR" },
  } as never);
  const refresh = vi.spyOn(data, "refresh").mockResolvedValue(undefined);
  render(<WindowNotice />);
  const text = screen.getByRole("alert").textContent ?? "";
  expect(text).toContain("화면 3곳이 이전에 받은 내용을 보이고 있습니다. 첫 오류");
  expect(text).not.toContain("(외");
  expect(text).not.toContain("first");
  expect(text).toContain("FIRST_ERROR");
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  expect(refresh).toHaveBeenCalledWith(["first", "second", "third"]);
});

it("정보 알림의 만료가 뒤에 온 오류를 지우지 않는다", () => {
  act(() => data.setStatus("작업 완료"));
  tick(4000);
  act(() => data.failClient({ id: "SHELL_CLIENT_FAILED", code: "server", message: "실행 오류", details: [] }));
  tick(10000);
  expect(screen.getByRole("alert").textContent).toContain("실행 오류");
  expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
});

it("새 정보 알림이 이전 문구를 교체한다", () => {
  act(() => data.setStatus("첫 알림"));
  act(() => data.setStatus("둘째 알림"));
  expect(screen.queryByText("첫 알림")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("둘째 알림");
});

it("정보 알림이 사라진 뒤 원천 실패와 다시 받기는 남는다", () => {
  cleanup();
  vi.spyOn(data, "getSources").mockReturnValue({ feed: { state: "failed", has_value: true, message: "읽기 실패", id: "SOURCE_READ_FAILED" } } as never);
  render(<WindowNotice />);
  expect(screen.getByRole("alert").textContent).toContain("읽기 실패");
  act(() => data.setStatus("처리했습니다"));
  expect(screen.getByRole("status").textContent).toContain("처리했습니다");
  tick(5000);
  expect(screen.getByRole("alert").textContent).toContain("읽기 실패");
  expect(screen.getByRole("button", { name: "다시 받기" })).toBeTruthy();
});


it("다른 원천 갱신은 닫힌 실패를 다시 열지 않고 해소 뒤 재발은 연다", () => {
  const fail = { state: "failed", has_value: true, message: "읽기 실패", id: "SOURCE_READ_FAILED" };
  const merge = (sources: unknown) => act(() => (data as any).merge({ sources, values: {} }));
  merge({ feed: fail });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  merge({ other: { state: "ready", has_value: true } });
  expect(screen.queryByRole("alert")).toBeNull();
  merge({ feed: { ...fail } });
  expect(screen.queryByRole("alert")).toBeNull();
  merge({ feed: { ...fail, message: "새 실패" } });
  expect(screen.getByRole("alert").textContent).toContain("새 실패");
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  merge({ feed: { state: "ready", has_value: true } });
  merge({ feed: { ...fail, message: "새 실패" } });
  expect(screen.getByRole("alert").textContent).toContain("새 실패");
});

it("상태 알림이 끝나면 해결하지 않은 동작 실패를 다시 보인다", () => {
  act(() => data.failClient({ id: "TEST_ERROR", code: "server", message: "동작 실패", details: [] }));
  act(() => data.setStatus("복사할 글이 없습니다"));
  expect(screen.getByRole("status")).toBeTruthy();
  tick(5000);
  expect(screen.getByRole("alert").textContent).toContain("동작 실패");
  expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
});
