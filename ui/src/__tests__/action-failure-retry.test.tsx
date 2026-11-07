import { afterEach, expect, it, vi } from "vitest";
import type { AppDefinition, CoreRequest } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { WindowData } from "../data/window-data";
import { makeTestSeed } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

type Hold = { hit: () => void; wait: Promise<void> };
type Control = { fail: boolean; message: string; holds: Hold[] };

function setup(ui: AppDefinition["ui"], state: Record<string, unknown> = {}) {
  const definition = { id: "action-failure", name: "동작 실패", requires: { blocks: 4, modules: {} }, permissions: [], state, ui } as AppDefinition;
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  const original = transport.call.bind(transport);
  const control: Control = { fail: false, message: "저장하지 못했습니다", holds: [] };
  vi.spyOn(transport, "call").mockImplementation(async (request: CoreRequest) => {
    if (request.op === "data.act") {
      const hold = control.holds.shift();
      if (hold) { hold.hit(); await hold.wait; return { op: "data.act", sequence: 1 } as never; }
      if (control.fail) throw { id: "TEST_ACTION_FAILED", code: "server", message: control.message, details: [] };
    }
    return original(request as never) as never;
  });
  const store = createShellStore(transport);
  const data = new WindowData(store, "viewer-window", definition);
  const stop = data.mount();
  const done = () => { stop(); store.dispose(); };
  return { data, store, control, done };
}

function hold(control: Control) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const hit = new Promise<void>((resolve) => { entered = resolve; });
  control.holds.push({ hit: entered, wait });
  return { hit, release };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

it("재시도하는 동안 지난 실패 알림은 그대로 있고 성공하면 거둔다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  expect(data.getNotice()).toContain("저장하지 못했습니다");

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_click", null);
  await gate.hit;
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  gate.release();
  await second;
  expect(data.getNotice()).toBeNull();
  expect(data.getNoticeId()).toBeNull();
  done();
});

it("알림 칸이 있으면 성공 응답 뒤 300ms 동안 알림을 남긴다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  const slot = document.createElement("div");
  data.setNoticeSlot(slot);

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_click", null);
  await gate.hit;
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  gate.release();
  await second;
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  await sleep(150);
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  await sleep(200);
  expect(data.getNotice()).toBeNull();
  data.setNoticeSlot(null);
  done();
});

it("성공 응답을 기다리지 않고 대화상자가 닫히면 알림 칸이 사라질 때 지난 실패를 거둔다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  const slot = document.createElement("div");
  data.setNoticeSlot(slot);

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_click", null);
  await gate.hit;
  gate.release();
  await second;
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  data.setNoticeSlot(null);
  expect(data.getNotice()).toBeNull();
  await sleep(350);
  expect(data.getNotice()).toBeNull();
  done();
});

it("다시 실패하면 알림을 같은 칸에서 새 내용으로 바꾸고 거두지 않는다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  const slot = document.createElement("div");
  data.setNoticeSlot(slot);
  const trail: Array<string | null> = [];
  const unsubscribe = data.subscribeNotice(() => trail.push(data.getNotice()));

  control.fail = true;
  control.message = "첫째 실패";
  await data.act("/ui/on_click", null);
  control.message = "둘째 실패";
  await data.act("/ui/on_click", null);
  expect(data.getNotice()).toContain("둘째 실패");
  expect(trail).toEqual([expect.stringContaining("첫째 실패"), expect.stringContaining("둘째 실패")]);
  unsubscribe();
  data.setNoticeSlot(null);
  done();
});

it("다른 동작의 성공은 지난 실패 알림을 거두지 않는다", async () => {
  const { data, control, done } = setup({
    type: "stack", direction: "column", children: [
      { type: "button", label: "첫째", on_click: [{ set_state: "first", value: true }] },
      { type: "button", label: "둘째", on_click: [{ set_state: "second", value: true }] },
    ],
  }, { first: false, second: false });
  control.fail = true;
  await data.act("/ui/children/0/on_click", null);
  control.fail = false;
  await data.act("/ui/children/1/on_click", null);
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  done();
});

it("다른 알림이 덮은 뒤에는 같은 동작을 다시 실행해도 그 알림을 거두지 않는다", async () => {
  const { data, control, done } = setup({
    type: "stack", direction: "column", children: [
      { type: "button", label: "첫째", on_click: [{ set_state: "first", value: true }] },
      { type: "button", label: "둘째", on_click: [{ set_state: "second", value: true }] },
    ],
  }, { first: false, second: false });
  control.fail = true;
  control.message = "첫째 실패";
  await data.act("/ui/children/0/on_click", null);
  control.message = "둘째 실패";
  await data.act("/ui/children/1/on_click", null);
  control.fail = false;
  await data.act("/ui/children/0/on_click", null);
  expect(data.getNotice()).toContain("둘째 실패");
  expect(data.getNotice()).not.toContain("첫째 실패");
  done();
});

it("대화상자가 닫힌 뒤의 실패는 창 아래 알림으로 남는다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  const slot = document.createElement("div");
  data.setNoticeSlot(slot);
  data.setNoticeSlot(null);
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  done();
});

it("입력 동작은 보내는 동안 알림을 그대로 두고 성공하면 거둔다", async () => {
  const { data, control, done } = setup({ type: "input", label: "이름", value: { state: "text" }, on_change: { set_state: "text" } }, { text: "" });
  control.fail = true;
  await data.act("/ui/on_change", "가", undefined, undefined, undefined, { input: true });
  expect(data.getNotice()).toContain("저장하지 못했습니다");

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_change", "나", undefined, undefined, undefined, { input: true });
  await gate.hit;
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  gate.release();
  await second;
  expect(data.getNotice()).toBeNull();
  done();
});

it("정보 알림이 떠 있는 동안에도 같은 동작의 지난 실패를 거두지만 정보 알림은 남는다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  data.setStatus("복사했습니다");
  expect(data.getNotice()).toBe("복사했습니다");
  expect(data.getNoticeRole()).toBe("status");

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_click", null);
  await gate.hit;
  expect(data.getNotice()).toBe("복사했습니다");
  expect(data.getNoticeRole()).toBe("status");
  gate.release();
  await second;
  expect(data.getNotice()).toBe("복사했습니다");
  expect(data.getNoticeRole()).toBe("status");
  done();
});

it("재시도 판정은 지금 화면에 그 실패가 보일 때만 참이다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  expect(data.hasActionFailure("/ui/on_click")).toBe(true);
  expect(data.hasActionFailure("/ui/on_close")).toBe(false);

  // 알림을 닫으면 재시도로 보지 않는다.
  data.setNotice(null);
  expect(data.hasActionFailure("/ui/on_click")).toBe(false);

  // 다시 실패하면 다시 재시도다.
  await data.act("/ui/on_click", null);
  expect(data.hasActionFailure("/ui/on_click")).toBe(true);

  // 다른 알림이 덮어도 재시도로 보지 않는다.
  data.setNotice("다른 알림");
  expect(data.hasActionFailure("/ui/on_click")).toBe(false);

  // 성공하면 거둔다.
  data.setNotice(null);
  control.fail = true;
  await data.act("/ui/on_click", null);
  expect(data.hasActionFailure("/ui/on_click")).toBe(true);
  control.fail = false;
  await data.act("/ui/on_click", null);
  expect(data.hasActionFailure("/ui/on_click")).toBe(false);
  done();
});

it("같은 문구로 다시 실패하면 알림 판을 올리고 다른 경로의 알림은 올리지 않는다", async () => {
  const { data, control, done } = setup({
    type: "stack", direction: "column", children: [
      { type: "button", label: "첫째", on_click: [{ set_state: "first", value: true }] },
      { type: "button", label: "둘째", on_click: [{ set_state: "second", value: true }] },
    ],
  }, { first: false, second: false });
  const start = data.getNoticeRevision();
  control.fail = true;
  control.message = "같은 실패";
  await data.act("/ui/children/0/on_click", null);
  expect(data.getNoticeRevision()).toBe(start);
  await data.act("/ui/children/0/on_click", null);
  expect(data.getNoticeRevision()).toBe(start + 1);
  await data.act("/ui/children/0/on_click", null);
  expect(data.getNoticeRevision()).toBe(start + 2);
  await data.act("/ui/children/1/on_click", null);
  expect(data.getNoticeRevision()).toBe(start + 2);
  data.setNotice("직접 알림");
  expect(data.getNoticeRevision()).toBe(start + 2);
  done();
});

it("입력 동작의 재실패는 알림 요소를 새로 그리지 않는다", async () => {
  const { data, control, done } = setup({ type: "text", value: "내용" });
  await data.ready;
  control.fail = true;
  await data.act("/ui/on_change", "가", undefined, undefined, undefined, { input: true });
  const start = data.getNoticeRevision();
  await data.act("/ui/on_change", "나", undefined, undefined, undefined, { input: true });
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  expect(data.getNoticeRevision()).toBe(start);
  done();
});
