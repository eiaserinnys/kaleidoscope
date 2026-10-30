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

it("reset 중 같은 값을 재확정해도 표시와 저장이 일치한다", async () => {
  const pending = deferred(); const writes: any[] = [];
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: { content: "저장값", revision: "r0", exists: true } };
    if (request.op === "storage.reset") return pending.promise;
    writes.push(request); return { revision: "r1" };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load(); const reset = session.reset();
  session.edit("저장값"); const write = session.save();
  pending.resolve({ revision: null }); await Promise.all([reset, write]);
  session.dispose();
  expect(writes.map(x => x.content)).toEqual(["저장값"]);
  expect(session.getSnapshot()).toMatchObject({ value: "저장값", dirty: false });
});

it("단일행 첫 Escape는 취소하고 다음 Escape는 설정만 닫는다", async () => {
  const definition = { ...mdEditorDefinition, requires: { blocks: 6, modules: { storage: 2 } }, ui: { type: "text" as const, value: "본문" }, storage: { entries: [entry] } };
  const store = createShellStore(createFakeTransport(makeTestSeed({ definitions: [definition] })));
  const onClose = vi.fn();
  render(<AppWindowContent store={store} windowId="editor-window" settingsOpen settingsVisited onSettingsClose={onClose} />);
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", { name: "제목" });
  await user.clear(input); await user.type(input, "취소 초안");
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled(); expect((input as HTMLInputElement).value).toBe("기본");
  await user.keyboard("{Escape}"); expect(onClose).toHaveBeenCalledTimes(1);
});

it("원격 변경과 대기열이 만나면 초안을 보존하고 CAS 충돌한다", async () => {
  const pending = deferred(); let writes = 0;
  const store = { call: vi.fn(async (request: any) => {
    if (request.op === "storage.get") return { result: { content: "기본", revision: null, exists: false } };
    if (++writes === 1) return pending.promise;
    throw { code: "conflict", message: "원격 변경", details: [] };
  }) } as unknown as ShellStore;
  const session = new SettingsEntrySession(store, "window", entry);
  await session.load(); session.edit("첫 값"); const first = session.save();
  session.edit("마지막 값"); const last = session.save(); await session.refresh();
  pending.resolve({ revision: "r1" }); await Promise.all([first, last]); session.dispose();
  expect(session.getSnapshot()).toMatchObject({ value: "마지막 값", dirty: true, conflict: true });
});
