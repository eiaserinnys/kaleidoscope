import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "../../../app/src/shell/shell";
import { directionParticle } from "../../../app/src/shell/korean-particle";
import type { AppDefinition, CoreRequest, LinkStatus } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed } from "./fixtures";
import agent from "../../../apps/agent.json";

const receiver = (id: string, name: string): AppDefinition => ({
  id, name, requires: { blocks: 1, modules: {} }, permissions: [], state: {},
  ui: { type: "text", value: "" }, client: { capabilities: ["receive_message"] },
} as unknown as AppDefinition);

function setup(asked: string[] = ["pas", "report"]) {
  const seed = makeTestSeed({ definitions: [agent as unknown as AppDefinition, receiver("pas", "작업 PAS"), receiver("report", "시안과 리포트")] });
  seed.snapshot.shared.windows = [];
  seed.snapshot.link = { state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "내 PC" };
  seed.snapshot.shared.preferences = { revision: 1, default_message_app_id: null, asked_message_app_ids: asked };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  render(<Shell store={store} />);
  return { seed, transport, store };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("쉘 기본 에이전트 설정", () => {
  it("설정은 한 창으로 열리고 작업 표시줄에서 복원하며 닫으면 연 단추로 돌아간다", async () => {
    const { store } = setup(); await store.ready;
    const gear = screen.getByRole("button", { name: /^설정$/ });
    fireEvent.click(gear);
    const window = screen.getByTestId("system-window-settings");
    fireEvent.click(gear);
    expect(screen.getAllByTestId("system-window-settings")).toHaveLength(1);
    const task = within(screen.getByRole("toolbar", { name: "작업 표시줄" })).getByRole("button", { name: "설정" });
    expect(task.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(window).getByRole("button", { name: "창 최소화" }));
    expect(window.getAttribute("data-minimized")).toBe("true");
    fireEvent.click(task);
    expect(window.getAttribute("data-minimized")).toBe("false");
    fireEvent.click(within(window).getByRole("button", { name: "창 닫기" }));
    expect(screen.queryByTestId("system-window-settings")).toBeNull();
    expect(document.activeElement).toBe(gear);
    store.dispose();
  });

  it("서버 전환 응답을 기다리는 동안 같은 설정 창과 진행 표시를 유지한다", async () => {
    const { transport, store } = setup(); await store.ready;
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, embedded_available: true } }));
    const original = transport.call.bind(transport);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
      if (request.op === "link.use_local") { await pending; return { op: "link.use_local" }; }
      return original(request as never);
    }) as typeof transport.call);
    fireEvent.click(screen.getByRole("button", { name: /^설정$/ }));
    const window = screen.getByTestId("system-window-settings");
    fireEvent.click(screen.getByRole("button", { name: "내 PC 서버로 전환" }));
    act(() => transport.setLink({ state: "connected", mode: "remote", server_url: "https://other.example", device_name: "내 PC" }));
    expect(screen.getByTestId("system-window-settings")).toBe(window);
    expect(screen.getByRole("button", { name: "내 PC 서버로 전환" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    store.dispose();
  });

  it("가져오기 오류가 있으면 이전 성공 결과를 숨긴다", async () => {
    const { transport, store } = setup(); await store.ready;
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, embedded_available: true, last_transfer: { imported: 3, skipped: [] }, transfer_error: "가져오지 못했습니다" } }));
    fireEvent.click(screen.getByRole("button", { name: /^설정$/ }));
    expect(screen.getByText("가져오지 못했습니다")).toBeTruthy();
    expect(screen.queryByText("가져오기 완료 3개")).toBeNull();
    store.dispose();
  });
  it("가져오기 호출이 거절되면 이전 성공 결과를 숨긴다", async () => {
    const { transport, store } = setup(); await store.ready;
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, embedded_available: true, last_transfer: { imported: 3, skipped: [] } } }));
    const original = transport.call.bind(transport);
    vi.spyOn(transport, "call").mockImplementation(((request: CoreRequest) => request.op === "link.sync_local_to_remote"
      ? Promise.reject({ id: "SERVER_LINK_SYNC_FAILED", code: "server", message: "가져오지 못했습니다", details: [] })
      : original(request as never)) as typeof transport.call);
    fireEvent.click(screen.getByRole("button", { name: /^설정$/ }));
    expect(screen.getByText("가져오기 완료 3개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
    expect(await screen.findByText("가져오지 못했습니다")).toBeTruthy();
    expect(screen.queryByText("가져오기 완료 3개")).toBeNull();
    store.dispose();
  });

  it("선택을 서버에 즉시 저장하고 응답 전에는 확정값을 표시한다", async () => {
    const { transport, store } = setup(); await store.ready;
    const original = transport.call.bind(transport);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const call = vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
      if (request.op === "shell.preferences.set_default") await waiting;
      return original(request as never);
    }) as typeof transport.call);
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const select = screen.getByRole("button", { name: "기본 에이전트" }) as HTMLButtonElement;
    expect(select.textContent).toContain("에이전트");
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("menuitem", { name: "작업 PAS" }));
    expect(call).toHaveBeenCalledWith({ op: "shell.preferences.set_default", app_id: "pas" });
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain("에이전트");
    expect(screen.getByText("저장 중")).toBeTruthy();
    select.blur();
    await act(async () => release());
    await waitFor(() => expect(select.textContent).toContain("작업 PAS"));
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    store.dispose();
  });

  it("저장 오류는 선택을 유지하고 해당 행에 표시한다", async () => {
    const { transport, store } = setup(); await store.ready;
    const original = transport.call.bind(transport);
    let reject!: (reason: unknown) => void;
    const pending = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
    vi.spyOn(transport, "call").mockImplementation(((request: CoreRequest) => request.op === "shell.preferences.set_default"
      ? pending
      : original(request as never)) as typeof transport.call);
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const select = screen.getByRole("button", { name: "기본 에이전트" }) as HTMLButtonElement;
    fireEvent.click(select); fireEvent.click(screen.getByRole("menuitem", { name: "작업 PAS" }));
    select.blur();
    await act(async () => reject({ id: "SERVER_PREFERENCES_NOT_CONNECTED", code: "server", message: "서버에 연결되어 있지 않습니다", details: [] }));
    expect(await screen.findByText("서버에 연결되어 있지 않습니다")).toBeTruthy();
    expect(select.textContent).toContain("에이전트");
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    store.dispose();
  });

  it("연결 상태와 계정 스냅샷에 따라 비활성 이유와 대기를 보인다", async () => {
    const { transport, store } = setup(); await store.ready;
    act(() => transport.setLink({ state: "unlinked" }));
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByText("서버에 연결하면 기본 에이전트를 고를 수 있습니다")).toBeTruthy();
    expect((screen.getByRole("button", { name: "기본 에이전트" }) as HTMLButtonElement).disabled).toBe(true);
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, link: { state: "connected", mode: "remote", server_url: "https://remote.example", device_name: "내 PC" }, shared: { ...current.shared, preferences: null } } }));
    expect(screen.getByRole("button", { name: "기본 에이전트" }).closest('[aria-busy="true"]')).toBeTruthy();
    store.dispose();
  });

  it.each([
    [{ state: "pairing", server_url: "https://remote.example", user_code: "123456", expires_at: "2099-01-01T00:00:00Z" }, "서버 연결 승인을 기다리는 중입니다"],
    [{ state: "revoked", server_url: "https://remote.example" }, "서버 연결을 다시 설정하면 바꿀 수 있습니다"],
    [{ state: "offline", mode: "remote", server_url: "https://remote.example", device_name: "내 PC", reason: null }, "서버에 다시 연결하면 바꿀 수 있습니다"],
  ] as Array<[LinkStatus, string]>)("서버 상태에 맞는 잠금 까닭을 고르기에 연결한다", async (link, reason) => {
    const { transport, store } = setup(); await store.ready;
    act(() => transport.setLink(link));
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    const select = screen.getByRole("button", { name: "기본 에이전트" }) as HTMLButtonElement;
    expect(select.disabled).toBe(true);
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe(reason);
    store.dispose();
  });

  it("받을 수 있는 앱이 없을 때 이유를 보인다", async () => {
    const { transport, store } = setup(); await store.ready;
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, apps: [] } } }));
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByText("메시지를 받을 수 있는 앱이 없습니다")).toBeTruthy();
    expect((screen.getByRole("button", { name: "기본 에이전트" }) as HTMLButtonElement).disabled).toBe(true);
    store.dispose();
  });
});

describe("새 메시지 앱 질문", () => {
  it("처음부터 있던 개인 앱을 이름순으로 하나씩 묻고 답을 기록한다", async () => {
    const { transport, store } = setup([]); await store.ready;
    const spy = vi.spyOn(transport, "call");
    let dialog = await screen.findByRole("dialog", { name: "기본 에이전트를 시안과 리포트로 바꿀까요?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "그대로 두기" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "그대로 두기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "shell.preferences.answer", app_id: "report", use_as_default: false }));
    dialog = await screen.findByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "바꾸기" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "shell.preferences.answer", app_id: "pas", use_as_default: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.getSnapshot()?.shared.preferences?.default_message_app_id).toBe("pas");
    store.dispose();
  });

  it("ESC는 그대로 두기로 기록하고 다른 기기의 답을 반영해 닫는다", async () => {
    const { transport, store } = setup(["report"]); await store.ready;
    const spy = vi.spyOn(transport, "call");
    const dialog = await screen.findByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ op: "shell.preferences.answer", app_id: "pas", use_as_default: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, preferences: { revision: 3, default_message_app_id: null, asked_message_app_ids: ["report"] } } } }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    const now = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...now, shared: { ...now.shared, preferences: { revision: 4, default_message_app_id: null, asked_message_app_ids: ["report", "pas"] } } } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dialog).toBeTruthy();
    store.dispose();
  });

  it("답 저장에 실패하면 질문과 오류를 남기고 다시 답할 수 있다", async () => {
    const { transport, store } = setup(["report"]); await store.ready;
    const original = transport.call.bind(transport);
    let failAnswer = true;
    vi.spyOn(transport, "call").mockImplementation(((request: CoreRequest) => {
      if (request.op === "shell.preferences.answer" && failAnswer) {
        failAnswer = false;
        return Promise.reject({ id: "SERVER_PREFERENCES_NOT_CONNECTED", code: "server", message: "서버에 연결되어 있지 않습니다", details: [] });
      }
      return original(request as never);
    }) as typeof transport.call);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "바꾸기" }));
    expect(await within(dialog).findByText("서버에 연결되어 있지 않습니다")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "그대로 두기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    store.dispose();
  });

  it("저장 중 중복 답과 ESC를 막고, 바깥 닫기는 그대로 두기로 기록한다", async () => {
    const { transport, store } = setup(["report"]); await store.ready;
    const original = transport.call.bind(transport);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
      if (request.op === "shell.preferences.answer") await waiting;
      return original(request as never);
    }) as typeof transport.call);
    const dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    expect(spy).toHaveBeenCalledWith({ op: "shell.preferences.answer", app_id: "pas", use_as_default: false });
    const confirm = within(dialog).getByRole("button", { name: "바꾸기" }) as HTMLButtonElement;
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(confirm.classList.contains("is-progress")).toBe(true);
    expect(confirm.querySelector(".ks-button-progress")).toBeTruthy();
    expect(dialog.querySelector(".ks-dialog-body")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(confirm);
    expect(spy.mock.calls.filter(([request]) => request.op === "shell.preferences.answer")).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    store.dispose();
  });

  it("첫 답의 상태가 응답보다 먼저 도착해도 다음 질문의 안전한 선택에 초점을 둔다", async () => {
    const { transport, store } = setup([]); await store.ready;
    const original = transport.call.bind(transport);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(transport, "call").mockImplementation((async (request: CoreRequest) => {
      const result = await original(request as never);
      if (request.op === "shell.preferences.answer") await waiting;
      return result;
    }) as typeof transport.call);
    const first = await screen.findByRole("dialog", { name: "기본 에이전트를 시안과 리포트로 바꿀까요?" });
    fireEvent.click(within(first).getByRole("button", { name: "그대로 두기" }));
    const second = await screen.findByRole("dialog", { name: "기본 에이전트를 작업 PAS로 바꿀까요?" });
    const cancel = within(second).getByRole("button", { name: "그대로 두기" }) as HTMLButtonElement;
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    await act(async () => release());
    await waitFor(() => expect(cancel.getAttribute("aria-disabled")).toBeNull());
    expect(document.activeElement).toBe(cancel);
    store.dispose();
  });

  it("앱이 기본값이 되거나 연결이 바뀌면 열린 질문을 닫는다", async () => {
    const { transport, store } = setup(["report"]); await store.ready;
    expect(await screen.findByRole("dialog")).toBeTruthy();
    let current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, preferences: { revision: 2, default_message_app_id: "pas", asked_message_app_ids: ["report"] } } } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, preferences: { revision: 3, default_message_app_id: null, asked_message_app_ids: ["report"] } } } }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    current = store.getSnapshot()!;
    const savedShared = current.shared;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: { ...current.shared, apps: current.shared.apps.filter((app) => app.id !== "pas") } } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, shared: savedShared } }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    act(() => transport.setLink({ state: "unlinked" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    store.dispose();
  });

  it("다른 서버에서 같은 앱이 나타나면 이전 질문을 닫고 새 질문을 연다", async () => {
    const { transport, store } = setup(["report"]); await store.ready;
    const before = await screen.findByRole("dialog");
    const current = store.getSnapshot()!;
    act(() => transport.emit({ event: "state.changed", snapshot: { ...current, link: { state: "connected", mode: "remote", server_url: "https://other.example", device_name: "내 PC" } } }));
    const after = screen.getByRole("dialog");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(within(after).getByRole("button", { name: "그대로 두기" }));
    store.dispose();
  });

  it.each([["값", "으로"], ["길", "로"], ["가", "로"], ["PAS", "로"]])("이름 %s의 조사를 고른다", (name, particle) => {
    expect(directionParticle(name)).toBe(particle);
  });
});
