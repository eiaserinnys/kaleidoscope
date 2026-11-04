import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppDefinition } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import * as windowData from "../data/window-data";
import { WindowNotice } from "../data/window-notice";
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

it("정보 알림은 잠시 보인 뒤 사라진다", () => {
  act(() => data.setStatus("저장했습니다"));
  expect(screen.getByRole("status").textContent).toContain("저장했습니다");
  expect(screen.queryByRole("button")).toBeNull();
  tick(4999);
  expect(screen.queryByRole("status")).toBeTruthy();
  tick(1);
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
  expect(screen.getByRole("alert").textContent).toContain("feed");
  fireEvent.click(screen.getByRole("button", { name: "다시 받기" }));
  expect(refresh).toHaveBeenCalledWith(["feed"]);
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("alert")).toBeNull();
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
  expect(screen.getByRole("alert").textContent).toContain("feed");
  act(() => data.setStatus("처리했습니다"));
  expect(screen.getByRole("status").textContent).toContain("처리했습니다");
  tick(5000);
  expect(screen.getByRole("alert").textContent).toContain("feed");
  expect(screen.getByRole("button", { name: "다시 받기" })).toBeTruthy();
});
