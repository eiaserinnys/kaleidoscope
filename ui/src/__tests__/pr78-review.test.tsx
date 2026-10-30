import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsEntrySession } from "../settings/settings-entry-session";
import type { ShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { makeTestSeed, mdEditorDefinition } from "./fixtures";

afterEach(cleanup);
const entry = { id: "title", key: "title", kind: "json" as const, schema: { type: "string" as const }, default: "기본", label: "제목", presentation: "settings" as const };
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };

it("저장 응답이 와도 새 편집의 Enter/blur 전에는 쓰지 않는다", async () => {
  const pending = deferred();
  const calls: any[] = [];
  const store = { call: vi.fn(async (request: any) => {
    calls.push(request);
    if (request.op === "storage.get") return { result: { content: "기본", revision: null, exists: false } };
    if (calls.filter(x => x.op === "storage.write").length === 1) return pending.promise;
    return { revision: "r2" };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  session.beginEdit(); session.edit("확정"); const save = session.finishEdit();
  session.beginEdit(); session.edit("아직 입력 중");
  pending.resolve({ revision: "r1" }); await save;
  session.dispose();
  expect(calls.filter(x => x.op === "storage.write").map(x => x.content)).toEqual(["확정"]);
});

it("저장 대기 중 편집을 취소하면 마지막으로 확정한 값으로 돌아간다", async () => {
  const pending = deferred();
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: { content: "기본", revision: null, exists: false } };
    if (request.op === "storage.write") return pending.promise;
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  session.beginEdit(); session.edit("확정"); const save = session.finishEdit();
  session.beginEdit(); session.edit("취소할 초안"); session.cancel();
  expect(session.getSnapshot().value).toBe("확정");
  pending.resolve({ revision: "r1" }); await save;
  expect(session.getSnapshot()).toMatchObject({ value: "확정", dirty: false });
  session.dispose();
});

it("reset 응답 대기 중 새로 입력한 값은 응답 뒤에도 남는다", async () => {
  const pending = deferred();
  const calls: any[] = [];
  const store = { call: vi.fn(async (request: any) => {
    calls.push(request);
    if (request.op === "storage.get") return { result: { content: "저장값", revision: "r0", exists: true } };
    if (request.op === "storage.reset") return pending.promise;
    if (request.op === "storage.write") return { revision: "r1" };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load(); const reset = session.reset();
  session.edit("새 초안"); const save = session.save();
  expect(calls.filter((x) => x.op === "storage.write")).toHaveLength(0);
  pending.resolve({ revision: null }); await Promise.all([reset, save]);
  session.dispose();
  expect(session.getSnapshot().value).toBe("새 초안");
  expect(calls.filter((x) => x.op === "storage.write")).toEqual([expect.objectContaining({ content: "새 초안", expected_revision: null })]);
});

it("reset 중 미확정 초안은 남고 저장하지 않는다", async () => {
  const pending = deferred();
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: { content: "저장값", revision: "r0", exists: true } };
    if (request.op === "storage.reset") return pending.promise;
    throw new Error("확정하지 않은 초안을 저장했습니다");
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  const reset = session.reset();
  session.beginEdit(); session.edit("새 초안");
  pending.resolve({ revision: null }); await reset;
  expect(session.getSnapshot()).toMatchObject({ value: "새 초안", revision: null, dirty: true, editing: true });
  session.dispose();
});

it("쓰기와 기본값 복귀가 이어지면 앞선 쓰기의 revision으로 reset한다", async () => {
  const pending = deferred();
  const calls: any[] = [];
  const store = { call: vi.fn(async (request: any) => {
    calls.push(request);
    if (request.op === "storage.get") return { result: { content: "저장값", revision: "r0", exists: true } };
    if (request.op === "storage.write") return pending.promise;
    if (request.op === "storage.reset") return { revision: null };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  session.edit("확정값"); const write = session.save();
  const reset = session.reset();
  expect(calls.filter((x) => x.op === "storage.reset")).toHaveLength(0);
  pending.resolve({ revision: "r1" }); await Promise.all([write, reset]);
  expect(calls.filter((x) => x.op === "storage.reset")).toEqual([expect.objectContaining({ expected_revision: "r1" })]);
  expect(session.getSnapshot()).toMatchObject({ value: "기본", exists: false, dirty: false });
  session.dispose();
});

it("reset이 충돌해도 나중에 입력한 초안과 충돌 안내가 남는다", async () => {
  const pending = deferred();
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: { content: "저장값", revision: "r0", exists: true } };
    if (request.op === "storage.reset") return pending.promise;
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  const reset = session.reset();
  session.beginEdit(); session.edit("새 초안");
  pending.resolve(Promise.reject({ code: "conflict", message: "변경됨", details: [] }));
  await reset;
  expect(session.getSnapshot()).toMatchObject({ value: "새 초안", dirty: true, conflict: true });
  session.dispose();
});

it("이미 다른 곳에서 기본값으로 돌린 reset을 해결해도 새 초안은 남는다", async () => {
  let reads = 0;
  let resets = 0;
  const pending = deferred();
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: reads++ === 0
      ? { content: "저장값", revision: "r0", exists: true }
      : { content: "기본", revision: null, exists: false } };
    if (request.op === "storage.reset") return resets++ === 0 ? pending.promise : { revision: null };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load();
  const reset = session.reset();
  session.beginEdit(); session.edit("새 초안");
  pending.resolve(Promise.reject({ code: "conflict", message: "변경됨", details: [] }));
  await reset;
  await session.reset();
  await session.overwrite();
  expect(resets).toBe(2);
  expect(session.getSnapshot()).toMatchObject({ value: "새 초안", revision: null, dirty: true, conflict: false });
  session.dispose();
});

it("설정 메뉴에서 Escape는 메뉴만 닫는다", async () => {
  const decl = { ...entry, schema: { type: "string" as const, enum: ["기본", "다른 값"] } };
  const definition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text" as const, value: "본문" }, storage: { entries: [decl] } };
  const seed = makeTestSeed({ definitions: [definition] });
  const store = createShellStore(createFakeTransport(seed));
  const onClose = vi.fn();
  render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited onSettingsClose={onClose} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "제목" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
});
