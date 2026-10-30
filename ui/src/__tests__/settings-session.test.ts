import { describe, expect, it } from "vitest";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { SettingsEntrySession } from "../settings/settings-entry-session";
import { makeTestSeed } from "./fixtures";

function setup() {
  const seed = structuredClone(makeTestSeed());
  const declaration = { id: "title", key: "title", kind: "json" as const, schema: { type: "string" as const }, default: "기본", label: "제목", presentation: "settings" as const };
  seed.snapshot.shared.app_versions[0].definition.storage = { entries: [declaration] };
  const transport = createFakeTransport(seed);
  const store = createShellStore(transport);
  return { store, transport, session: new SettingsEntrySession(store, "editor-window", declaration) };
}

describe("설정 항목", () => {
  it("기본값과 revision을 읽고 순서대로 저장한 뒤 기본값으로 되돌린다", async () => {
    const { transport, session } = setup();
    await session.load();
    expect(session.getSnapshot()).toMatchObject({ value: "기본", exists: false, revision: null });
    session.edit("첫 값");
    const first = session.save();
    session.edit("마지막 값");
    void session.save();
    await first;
    expect((await transport.call({ op: "storage.get", window_id: "editor-window", entry: "title" })).result.content).toBe("마지막 값");
    await session.reset();
    expect(session.getSnapshot()).toMatchObject({ value: "기본", exists: false, revision: null });
  });

  it("편집 중 외부 변경을 보존하고 충돌 뒤 다시 불러오거나 덮어쓴다", async () => {
    const { transport, session } = setup();
    await session.load();
    session.edit("내 초안");
    await transport.call({ op: "storage.write", window_id: "editor-window", entry: "title", content: "외부", expected_revision: null });
    await session.refresh();
    expect(session.getSnapshot().value).toBe("내 초안");
    await session.save();
    expect(session.getSnapshot().conflict).toBe(true);
    await session.overwrite();
    expect((await transport.call({ op: "storage.get", window_id: "editor-window", entry: "title" })).result.content).toBe("내 초안");
    session.beginEdit();
    expect(session.getSnapshot().saved).toBe(true);
  });
});
