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

it("같은 동작을 다시 실행하면 지난 실패 알림을 응답 전에 거둔다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  expect(data.getNotice()).toContain("저장하지 못했습니다");

  control.fail = false;
  const gate = hold(control);
  const second = data.act("/ui/on_click", null);
  await gate.hit;
  expect(data.getNotice()).toBeNull();
  gate.release();
  await second;
  expect(data.getNotice()).toBeNull();
  expect(data.getNoticeId()).toBeNull();
  done();
});

it("다시 실패하면 같은 자리에 알림을 새로 세운다", async () => {
  const { data, control, done } = setup({ type: "button", label: "저장", on_click: [{ set_state: "saved", value: true }] }, { saved: false });
  control.fail = true;
  await data.act("/ui/on_click", null);
  const first = data.getNotice();
  await data.act("/ui/on_click", null);
  expect(first).toContain("저장하지 못했습니다");
  expect(data.getNotice()).toContain("저장하지 못했습니다");
  expect(data.getNoticeId()).toBe("TEST_ACTION_FAILED");
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
  done();
});
