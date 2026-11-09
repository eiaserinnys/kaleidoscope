import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNativeClose } from "../../../app/src/core/native-close";
import { runSavedTransition, type CoreError, type ShellStore } from "@kaleidoscope/ui";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  handler: undefined as undefined | (() => void),
  finish: undefined as undefined | (() => Promise<void>),
}));

vi.mock("../../../app/node_modules/@tauri-apps/api/core.js", () => ({
  isTauri: () => true,
  invoke: native.invoke,
}));
vi.mock("../../../app/node_modules/@tauri-apps/api/event.js", () => ({ listen: native.listen }));
vi.mock("@kaleidoscope/ui", () => ({
  runSavedTransition: vi.fn(),
  SHELL_PROGRAM_CLOSE_UNSAVED: vi.fn(() => ({
    id: "SHELL_PROGRAM_CLOSE_UNSAVED",
    code: "io",
    message: "저장하지 못한 내용이 있어 프로그램을 닫지 않았습니다.",
    details: [],
  })),
  toCoreError: (reason: unknown) => reason,
}));

const transitions = vi.mocked(runSavedTransition);

function storeWith(windows: string[]): ShellStore {
  return {
    getSnapshot: () => ({ shared: { windows: windows.map((id) => ({ id })) } }),
  } as unknown as ShellStore;
}

function callsTo(command: string) {
  return native.invoke.mock.calls.filter(([name]) => name === command);
}

async function mount(windows = ["window-a"]) {
  native.listen.mockImplementation(async (_event: string, handler: () => void) => {
    native.handler = handler;
    return native.stop;
  });
  const notices: CoreError[] = [];
  const dispose = installNativeClose(storeWith(windows), (error) => notices.push(error));
  await Promise.resolve();
  await Promise.resolve();
  return { notices, dispose };
}

beforeEach(() => {
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "shell_finish_close" && native.finish) await native.finish();
  });
  native.listen.mockReset();
  native.stop.mockReset();
  native.handler = undefined;
  native.finish = undefined;
  transitions.mockReset();
  transitions.mockImplementation(async (_store, _windowIds, commit) => {
    await commit();
    return true;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("네이티브 닫기", () => {
  it("닫기 요청을 받으면 열린 모든 창을 저장한 뒤 종료 명령을 한 번 부른다", async () => {
    const { notices } = await mount(["window-a", "window-b"]);
    expect(native.listen).toHaveBeenCalledWith("shell-close-requested", expect.any(Function));

    native.handler?.();
    await vi.waitFor(() => expect(callsTo("shell_finish_close")).toHaveLength(1));
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(transitions.mock.calls[0][1]).toEqual(["window-a", "window-b"]);
    expect(notices).toHaveLength(0);
  });

  it("저장하지 못하면 종료 명령을 부르지 않고 알림을 보여 준다", async () => {
    transitions.mockResolvedValue(false);
    const { notices } = await mount();

    native.handler?.();
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0].id).toBe("SHELL_PROGRAM_CLOSE_UNSAVED");
    expect(callsTo("shell_finish_close")).toHaveLength(0);
  });

  it("종료 명령이 오류면 코어가 준 오류를 그대로 알린다", async () => {
    const coreError = { id: "STATE_WRITE_IO", code: "io", message: "상태를 저장하지 못했습니다.", details: [] };
    native.finish = async () => {
      throw coreError;
    };
    const { notices } = await mount();

    native.handler?.();
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    expect(notices[0]).toBe(coreError);
  });

  it("저장 중 다시 닫기 요청이 와도 저장과 종료 명령은 한 번씩만 돈다", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transitions.mockImplementation(async (_store, _windowIds, commit) => {
      await gate;
      await commit();
      return true;
    });
    await mount();

    native.handler?.();
    native.handler?.();
    native.handler?.();
    expect(transitions).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(callsTo("shell_finish_close")).toHaveLength(1));
    expect(transitions).toHaveBeenCalledTimes(1);
  });

  it("마운트할 때 닫기 준비를 켜고 언마운트할 때 리스너와 준비를 해제한다", async () => {
    const { dispose } = await mount();
    expect(callsTo("shell_close_ready")).toEqual([["shell_close_ready", { ready: true }]]);

    dispose();
    await vi.waitFor(() => expect(callsTo("shell_close_ready")).toHaveLength(2));
    expect(callsTo("shell_close_ready")[1]).toEqual(["shell_close_ready", { ready: false }]);
    expect(native.stop).toHaveBeenCalledOnce();
  });
});
