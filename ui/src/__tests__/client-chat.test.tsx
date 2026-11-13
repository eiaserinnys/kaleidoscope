import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { ClientChatBlock, type ClientChatBlockData } from "../blocks/client-chat";
import { applyClientChatEnvelope, emptyClientChatState, type ClientChatEnvelope, type ClientChatQueuedMessage, type ClientChatState } from "../data/client-chat";
import { WindowDataProvider, useWindowData } from "../data/window-data";
import { ClientRuntime } from "../runtime/client-runtime";
import { createShellStore } from "../core/shell-store";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSnapshot } from "./fixtures";
import type { AppDefinition, ConversationItem } from "../contract/contract";

const snapshot = (items: ConversationItem[] = [], busy = false, queued: ClientChatQueuedMessage[] = []): ClientChatEnvelope =>
  ({ kind: "snapshot", items, stream_id: null, text: "", busy, tool: null, queued });

const item = (id: string): ConversationItem => ({ id, kind: "assistant", text: "기록", at: "2026-11-11T00:00:00Z", attachments: [] });
const state = (generation = 3): ClientChatState => ({ ...emptyClientChatState, loading: false, generation });

describe("클라이언트 채팅 스냅샷", () => {
  it("비어 있고 쉬는 스냅샷은 세대를 올려 미확인 보낸 메시지를 지운다", () => {
    expect(applyClientChatEnvelope(state(), snapshot()).generation).toBe(4);
  });

  it("항목이 있거나 바쁘거나 대기 중인 스냅샷은 세대를 올리지 않는다", () => {
    expect(applyClientChatEnvelope(state(), snapshot([item("a")])).generation).toBe(3);
    expect(applyClientChatEnvelope(state(), snapshot([], true)).generation).toBe(3);
    expect(applyClientChatEnvelope(state(), snapshot([], false, [{ id: "q", text: "", attachments: [] }])).generation).toBe(3);
  });

  it("스냅샷의 scope가 바뀌면 세대를 올리고 같은 자리면 그대로 둔다", () => {
    const scoped = (scope?: string | null): ClientChatEnvelope =>
      ({ kind: "snapshot", items: [item("a")], stream_id: null, text: "", busy: false, tool: null, queued: [], scope });
    expect(applyClientChatEnvelope({ ...state(), scope: "card-a" }, scoped("card-b"))).toMatchObject({ generation: 4, scope: "card-b" });
    expect(applyClientChatEnvelope({ ...state(), scope: "card-a" }, scoped("card-a"))).toMatchObject({ generation: 3, scope: "card-a" });
    /* scope를 싣지 않은 스냅샷은 지금 자리를 유지한다. */
    expect(applyClientChatEnvelope({ ...state(), scope: "card-a" }, scoped(undefined))).toMatchObject({ generation: 3, scope: "card-a" });
    expect(applyClientChatEnvelope({ ...state(), scope: "card-a" }, scoped(null))).toMatchObject({ generation: 4, scope: null });
    /* 빈 스냅샷과 scope 변경이 겹쳐도 세대는 한 번만 오른다. */
    expect(applyClientChatEnvelope({ ...state(), scope: "card-a" }, snapshot())).toMatchObject({ generation: 4, scope: "card-a" });
  });
});

const definition: AppDefinition = {
  id: "client-chat-empty", name: "빈 채널", requires: { blocks: 2, modules: {} }, permissions: [], state: {}, ui: { type: "chat" },
};
const block: ClientChatBlockData = { type: "chat", client: { channel: "thread", on_send: "send", on_cancel: "cancel", on_attachment: "attachment" } };
const app: AppDefinition = { ...definition, ui: block, client: {
  runtime: "javascript", entry: { id: "test-chat", version: 1 }, inputs: {}, outputs: {},
  channels: ["thread"], actions: ["send", "cancel", "attachment"], commands: {}, state_keys: [], storage_entries: [],
} };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("빈 채널에서 보낸 메시지는 빈 스냅샷이 오면 보낸 표시에서 사라진다", async () => {
  vi.spyOn(ClientRuntime.prototype, "start").mockResolvedValue(undefined);
  const shellSnapshot = makeTestSnapshot({ definitions: [app] });
  const transport = createFakeTransport({ snapshot: shellSnapshot, folder: null, files: {} });
  const store = createShellStore(transport);
  const window = shellSnapshot.shared.windows[0];
  let publish: ((channel: string, envelope: ClientChatEnvelope) => void) | null = null;
  function Chat() {
    const data = useWindowData();
    useEffect(() => {
      publish = data.publishClientChat;
      vi.spyOn(data, "requestClientAction").mockResolvedValue(undefined);
      data.publishClientChat("thread", snapshot());
      return () => { publish = null; };
    }, [data]);
    return <ClientChatBlock block={block} context={{ store, window, definition: app }} pointer="/ui" />;
  }
  const view = render(<WindowDataProvider store={store} windowId={window.id} definition={app}><Chat /></WindowDataProvider>);
  try {
    const input = (await screen.findByRole("textbox", { name: "메시지" })) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "안녕" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(document.querySelector(".ks-agent-chat-user.is-pending")).not.toBeNull());
    act(() => publish!("thread", snapshot()));
    await waitFor(() => expect(document.querySelector(".ks-agent-chat-user.is-pending")).toBeNull());
  } finally {
    view.unmount();
    store.dispose();
  }
});

it("scope가 바뀌어도 초안은 카드별로 남고 돌아오면 되살아난다", async () => {
  vi.spyOn(ClientRuntime.prototype, "start").mockResolvedValue(undefined);
  const shellSnapshot = makeTestSnapshot({ definitions: [app] });
  const transport = createFakeTransport({ snapshot: shellSnapshot, folder: null, files: {} });
  const store = createShellStore(transport);
  const window = shellSnapshot.shared.windows[0];
  const scoped = (scope: string): ClientChatEnvelope =>
    ({ kind: "snapshot", items: [item("m")], stream_id: null, text: "", busy: false, tool: null, queued: [], scope });
  let publish: ((channel: string, envelope: ClientChatEnvelope) => void) | null = null;
  function Chat() {
    const data = useWindowData();
    useEffect(() => {
      publish = data.publishClientChat;
      vi.spyOn(data, "requestClientAction").mockResolvedValue(undefined);
      return () => { publish = null; };
    }, [data]);
    return <ClientChatBlock block={block} context={{ store, window, definition: app }} pointer="/ui" />;
  }
  const view = render(<WindowDataProvider store={store} windowId={window.id} definition={app}><Chat /></WindowDataProvider>);
  try {
    const input = (await screen.findByRole("textbox", { name: "메시지" })) as HTMLTextAreaElement;
    act(() => publish!("thread", scoped("card-a")));
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "카드 A 초안" } });
    act(() => publish!("thread", scoped("card-b")));
    await waitFor(() => expect(input.value).toBe(""));
    fireEvent.change(input, { target: { value: "카드 B 초안" } });
    act(() => publish!("thread", scoped("card-a")));
    await waitFor(() => expect(input.value).toBe("카드 A 초안"));
    act(() => publish!("thread", scoped("card-b")));
    await waitFor(() => expect(input.value).toBe("카드 B 초안"));
  } finally {
    view.unmount();
    store.dispose();
  }
});

/* CSS 원문은 여러 줄로 접혀 있다. 공백을 하나로 눌러 선택자와 본문을 함께 찾는다. */
function cssRule(css: string, marker: string) {
  const text = css.replace(/\s+/g, " ");
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`규칙 없음: ${marker}`);
  const open = text.indexOf("{", start);
  return { selector: text.slice(start, open), body: text.slice(open + 1, text.indexOf("}", open)) };
}

describe("채팅 블록의 탭과 쌓기 배치", () => {
  const dataBlocks = readFileSync(resolve(cwd(), "src/styles/data-blocks.css"), "utf8");
  const blocks = readFileSync(resolve(cwd(), "src/styles/blocks.css"), "utf8");
  const scrollEnd = readFileSync(resolve(cwd(), "src/styles/scroll-end-space.css"), "utf8");

  it("탭 패널은 채팅을 담으면 바닥 여백을 두지 않고, 결정 줄 꼬리만 있으면 패널이 여백을 맡는다", () => {
    const rule = cssRule(dataBlocks, ".ks-data-tab-panel:has( > .ks-agent-chat,");
    expect(rule.body).toContain("padding-block-end: 0");
    expect(rule.selector).not.toContain("has-action-tail");
    expect(rule.selector).toContain("> .ks-data-stack.is-column > .ks-data-stack-item > .ks-agent-chat,");
    expect(rule.selector).toContain("> .ks-data-stack.is-column > .ks-data-stack-item > .ks-split .ks-agent-chat");
    expect(cssRule(dataBlocks, ".ks-data-tab-panel:has(> .ks-data-stack.is-column.has-action-tail):has(.ks-agent-chat)").body).toContain("padding-block-end: 0");
  });

  it("탭·구역·대화상자 안 채팅은 좌우 여백을 다시 더하지 않는다", () => {
    const rule = cssRule(dataBlocks, ":is(.ks-data-tab-panel, .ks-data-section, .ks-dialog) :is(");
    expect(rule.selector).toContain(".ks-agent-chat-history");
    expect(rule.selector).toContain(".ks-agent-chat-footer");
    expect(rule.selector).toContain(".ks-agent-chat-input-area");
    expect(rule.body).toContain("padding-inline: 0");
    expect(cssRule(dataBlocks, ":is(.ks-data-tab-panel, .ks-data-section, .ks-dialog) .ks-agent-chat > .ks-notice").body).toContain("margin-inline: 0");
  });

  it("결정 줄 꼬리 위의 도구 막대는 위쪽 선만 남긴다", () => {
    const rule = cssRule(dataBlocks, ".ks-data-stack.is-column.has-action-tail > .ks-data-stack-item:not(.ks-stack-scroll) > .ks-data-toolbar");
    expect(rule.body).toContain("border-top: var(--ks-line-width) solid var(--ks-color-border)");
    expect(rule.body).toContain("border-bottom: 0");
  });

  it("세로 쌓기의 비채움 채팅은 내용 높이를 쓰고 빈 기록은 숨긴다", () => {
    expect(cssRule(blocks, ".ks-data-stack.is-column > .ks-data-stack-item:not(.is-fill) > .ks-agent-chat {").body).toContain("height: auto");
    const history = cssRule(blocks, ".ks-data-stack.is-column > .ks-data-stack-item:not(.is-fill) > .ks-agent-chat > .ks-agent-chat-history {");
    expect(history.body).toContain("contain: none");
    expect(history.body).toContain("max-height: calc(var(--ks-pane-min-size) + var(--ks-control-height))");
    /* 새로 더한 규칙에는 날값 px를 두지 않는다. */
    expect(history.body).not.toMatch(/\d+px/);
    const guard = cssRule(blocks, ".ks-data-stack.is-column > .ks-data-stack-item:not(.is-fill) > .ks-agent-chat > .ks-agent-chat-history:not( :has(");
    expect(guard.body).toContain("display: none");
    /* 기록에 남는 실제 오류·바닥글 조작 UI가 있으면 숨기지 않는다. */
    expect(guard.selector).toContain(".ks-notice");
    expect(guard.selector).toContain(".ks-data-toggle");
    expect(guard.selector).toContain(".ks-data-input");
  });

  it("스크롤 끝이 탭이나 채팅이면 결정 줄 꼬리의 끝 여백을 더하지 않는다", () => {
    const rule = cssRule(scrollEnd, ".ks-data-stack.has-action-tail:not(.ks-data-section *, .ks-data-tab-panel *, .ks-dialog *) > .ks-stack-scroll:nth-last-child(1 of :not(:empty)) > .ks-stack-scroll-content:not(");
    expect(rule.selector).toContain("> .ks-data-stack-item:nth-last-child(1 of :not(:empty)) > :is(.ks-data-tabs, .ks-agent-chat)");
    expect(rule.body).toContain("padding-block-end: var(--ks-space-3)");
  });
});
