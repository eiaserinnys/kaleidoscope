// 생성·이름 변경 회귀는 공용 폴더 하니스와 함께 검증하며 이번 보완에서는 테스트 분리로 충돌을 늘리지 않는다.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { AppDefinition, Block } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { createShellStore } from "../core/shell-store";
import { AppWindowContent } from "../render/app-window-content";
import { normalizeBlock } from "../render/render-block";
import { createCollectionFolderBackend, createFileFolderBackend } from "../blocks/folder-backend";
import { grantFor, makeTestSeed } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fileFolderDefinition(access: "read" | "readwrite" = "read", readOnly = true): AppDefinition {
  return {
    id: "folder-files-test",
    name: "파일 폴더 시험",
    requires: { blocks: 13, modules: { files: 1 } },
    permissions: [{ module: "files", id: "docs", access, label: "문서" }],
    state: { selected: null },
    ui: {
      type: "folder",
      root: { permission: "docs" },
      extensions: ["md"],
      selected: { state: "selected" },
      on_select: { set_state: "selected" },
      read_only: readOnly,
    } as unknown as Block,
  };
}

function storageFolderDefinition(readOnly = true): AppDefinition {
  return {
    id: "folder-storage-test",
    name: "저장소 폴더 시험",
    requires: { blocks: 13, modules: { storage: 3 } },
    permissions: [],
    state: { selected: null },
    storage: {
      entries: [{
        id: "documents", key: "documents", collection: true, kind: "md", default: "",
        label: "문서", presentation: "hidden",
      }],
    },
    ui: {
      type: "folder",
      root: { entry: "documents" },
      extensions: ["md"],
      selected: { state: "selected" },
      on_select: { set_state: "selected" },
      read_only: readOnly,
    } as unknown as Block,
  };
}

function storageFolderTabsDefinition(): AppDefinition {
  const definition = storageFolderDefinition(false);
  definition.requires.blocks = 15;
  (definition.ui as Extract<Block, { type: "folder" }> & { header: boolean }).header = false;
  definition.ui = {
    type: "tabs",
    tabs: [
      { label: "서버", child: definition.ui },
      { label: "다른 탭", child: { type: "text", value: "다른 탭 내용" } },
    ],
  };
  return definition;
}

function storageFolderSplitDefinition(): AppDefinition {
  const definition = storageFolderDefinition();
  definition.ui = {
    type: "split",
    direction: "row",
    children: [definition.ui, { type: "text", value: "다른 패널" }],
  };
  return definition;
}

function setup(definition: AppDefinition, configure?: (transport: ReturnType<typeof createFakeTransport>) => void, files: Record<string, string> = { "notes/guide.md": "# Guide", "skip.txt": "skip" }) {
  const seed = makeTestSeed({
    definitions: [definition],
    grants: definition.id === "folder-files-test" ? [grantFor("viewer-window", "docs")] : [],
    files,
  });
  seed.snapshot.supported = { blocks: 15, modules: { files: 2, storage: 3 } };
  seed.snapshot.shared.windows[0].state = { selected: null };
  const transport = createFakeTransport(seed);
  if (configure) configure(transport);
  else vi.spyOn(transport, "call");
  const call = vi.mocked(transport.call);
  const store = createShellStore(transport);
  render(<AppWindowContent store={store} windowId="viewer-window" />);
  return { store, transport, call };
}

describe("folder block", () => {
  it("내 폴더 빈 공간 메뉴의 네 취소 경로는 현재 행과 Enter 동작을 유지한다", async () => {
    const user = userEvent.setup();
    const { call } = setup(fileFolderDefinition("readwrite", false), undefined, { "guide.md": "# 안내" });
    const row = await screen.findByRole("treeitem", { name: "guide.md" });
    await user.click(row);
    expect(screen.queryByRole("treeitem", { name: "새 파일" })).toBeNull();
    for (const label of ["새 파일", "새 폴더"]) {
      for (const cancel of ["Escape", "empty"]) {
        fireEvent.contextMenu(screen.getByRole("tree"));
        await user.click(await screen.findByRole("menuitem", { name: label }));
        const input = await screen.findByRole("textbox", { name: `${label} 이름` });
        await waitFor(() => expect(document.activeElement).toBe(input));
        if (cancel === "empty") await user.clear(input);
        await user.keyboard(cancel === "empty" ? "{Enter}" : "{Escape}");
        await waitFor(() => expect(document.activeElement).toBe(row));
        const before = call.mock.calls.filter(([request]) => request.op === "data.act").length;
        await user.keyboard("{Enter}");
        await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "data.act").length).toBeGreaterThan(before));
      }
    }
  });
  it.each(["끝 행", "빈 공간 메뉴", "머리", "행 메뉴"])("%s에서 연 만들기는 취소 뒤 원래 입구로 돌아간다", async (entrance) => {
    const user = userEvent.setup();
    const files = entrance === "머리" || entrance === "행 메뉴";
    const definition = files ? fileFolderDefinition("readwrite", false) : storageFolderDefinition(false);
    if (!files) definition.requires.blocks = 15;
    if (!files) (definition.ui as Extract<Block, { type: "folder" }>).header = false;
    setup(definition, files ? undefined : (transport) => {
      const call = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: definition.id, items: [] } } : call(request));
    }, { "guide.md": "# 안내" });
    const tree = await screen.findByRole("tree");
    const label = files ? "새 파일" : "새 문서";
    await screen.findByRole(files ? "button" : "treeitem", { name: label });
    const origin = () => entrance === "머리" ? screen.getByRole("button", { name: label })
      : screen.getByRole("treeitem", { name: entrance === "행 메뉴" ? "guide.md" : label });
    for (const cancel of ["Escape", "empty"]) {
      if (entrance.includes("메뉴")) {
        fireEvent.contextMenu(entrance === "빈 공간 메뉴" ? tree : origin());
        await user.click(await screen.findByRole("menuitem", { name: label }));
      } else await user.click(origin());
      const input = await screen.findByRole("textbox", { name: `${label} 이름` });
      await waitFor(() => expect(document.activeElement).toBe(input));
      if (cancel === "empty") await user.clear(input);
      await user.keyboard(cancel === "empty" ? "{Enter}" : "{Escape}");
      await waitFor(() => expect(document.activeElement).toBe(origin()));
    }
    await user.keyboard("{Enter}");
    if (entrance !== "머리" && entrance !== "행 메뉴") expect(await screen.findByRole("textbox", { name: `${label} 이름` })).toBeTruthy();
  });

  it.each([0, 40])("목록 %i개를 받기 전에는 끝 행을 먼저 보이지 않는다", async (count) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const definition = storageFolderDefinition(false);
    definition.requires.blocks = 15;
    (definition.ui as Extract<Block, { type: "folder" }>).header = false;
    setup(definition, (transport) => {
      const call = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op !== "storage.list") return call(request);
        await pending;
        return { op: "storage.list", result: { bucket_id: definition.id, items: Array.from({ length: count }, (_, i) => ({ doc: `${i}.md`, revision: "r1", updated_at: "", byte_size: 0 as unknown as bigint })) } };
      });
    });
    await screen.findByText("불러오는 중");
    expect(screen.queryByRole("treeitem", { name: "새 문서" })).toBeNull();
    await act(async () => release());
    const tree = screen.getByRole("tree");
    fireEvent.scroll(tree, { target: { scrollTop: count * 32 } });
    expect(await screen.findAllByRole("treeitem", { name: "새 문서" })).toHaveLength(1);
  });
  it.each(["머리", "우클릭"])("%s에서 만든 파일은 늦은 응답 뒤 열고 새 행에 포커스를 둔다", async (entrance) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { store } = setup(fileFolderDefinition("readwrite", false), (transport) => {
      const call = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "files.write") await pending;
        const reply = await call(request);
        if (request.op === "files.write") transport.emit({ event: "files.changed", root: grantFor("viewer-window", "docs").root_path, changes: [{ to: request.path }] });
        return reply;
      });
    }, { "guide.md": "# 안내" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    if (entrance === "머리") fireEvent.click(screen.getByRole("button", { name: "새 파일" }));
    else {
      fireEvent.contextMenu(guide);
      fireEvent.click(await screen.findByRole("menuitem", { name: "새 파일" }));
    }
    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    fireEvent.change(input, { target: { value: "created" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.getSnapshot()?.shared.windows[0].state.selected).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("created.md"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "created.md" })));
  });

  it.each([0, 1])("머리 없는 문서 모음 %i개에서도 끝 행으로 만들고 문서를 연다", async (count) => {
    let docs = count ? ["guide.md"] : [];
    const definition = storageFolderDefinition(false);
    definition.requires.blocks = 15;
    (definition.ui as Extract<Block, { type: "folder" }>).header = false;
    const { store } = setup(definition, (transport) => {
      const call = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") return { op: "storage.list", result: { bucket_id: definition.id, items: docs.map((doc) => ({ doc, revision: "r1", updated_at: "", byte_size: 0 as unknown as bigint })) } };
        if (request.op === "storage.write") docs = [...docs, request.doc!];
        return call(request);
      });
    });
    const create = await screen.findByRole("treeitem", { name: "새 문서" });
    fireEvent.click(create);
    const input = await screen.findByRole("textbox", { name: "새 문서 이름" });
    expect(screen.queryByRole("treeitem", { name: "새 문서" })).toBeNull();
    fireEvent.change(input, { target: { value: "문서" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("문서.md"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "문서.md" })));
  });

  it.each([["md"], ["md", "markdown"]])("만들기와 이름 바꾸기는 허용 확장자를 구체적으로 안내한다: %j", async (...extensions) => {
    const definition = fileFolderDefinition("readwrite", false);
    (definition.ui as Extract<Block, { type: "folder" }>).extensions = extensions;
    setup(definition, undefined, { "guide.md": "# 안내" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    const message = extensions.length === 1 ? "이름은 .md로 끝나야 합니다" : "이름은 .md, .markdown 가운데 하나로 끝나야 합니다";
    fireEvent.click(screen.getByRole("button", { name: "새 파일" }));
    let input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    fireEvent.change(input, { target: { value: "wrong.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "새 파일 이름" }), { key: "Escape" });
    fireEvent.keyDown(guide, { key: "F2" });
    input = await screen.findByRole("textbox", { name: "이름 바꾸기" });
    fireEvent.change(input, { target: { value: "without-extension" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("포커스 행을 선택에서 빼도 Delete와 잘라내기는 남은 선택을 쓴다", async () => {
    setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "b.md": "b", "notes/n.md": "n" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const notes = screen.getByRole("treeitem", { name: "notes" });
    fireEvent.click(a); fireEvent.click(b, { ctrlKey: true }); fireEvent.click(notes, { ctrlKey: true });
    fireEvent.click(a, { ctrlKey: true });
    fireEvent.keyDown(a, { key: "x", ctrlKey: true });
    expect(b.className).toContain("is-cut"); expect(notes.className).toContain("is-cut");
    expect(a.className).not.toContain("is-cut");
    fireEvent.keyDown(a, { key: "Delete" });
    expect(await screen.findByRole("dialog", { name: "2개 항목" })).toBeTruthy();
  });

  it("열린 파일 표시와 묶음 선택을 따로 두고 F2는 선택이 하나일 때만 연다", async () => {
    setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "b.md": "b" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    fireEvent.click(a);
    await waitFor(() => expect(a.className).toContain("is-open-file"));
    fireEvent.click(b, { ctrlKey: true });
    fireEvent.keyDown(b, { key: "F2" });
    expect(screen.queryByRole("textbox", { name: "이름 바꾸기" })).toBeNull();
    fireEvent.click(a, { ctrlKey: true });
    expect(a.className).toContain("is-open-file");
    expect(a.className).not.toContain("is-selected");
    expect(b.className).toContain("is-selected");
    fireEvent.keyDown(a, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "이름 바꾸기" });
    expect((input as HTMLInputElement).value).toBe("b.md");
  });

  it("빈 공간 클릭으로 선택을 비우고 Ctrl+A와 Home, Shift+End로 보이는 항목을 고른다", async () => {
    setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "b.md": "b", "notes/n.md": "n" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const notes = screen.getByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(a, { key: "a", ctrlKey: true });
    expect([a, b, notes].every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);
    const tree = screen.getByRole("tree"); fireEvent.click(tree);
    expect([a, b, notes].every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
    fireEvent.keyDown(tree, { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    fireEvent.keyDown(notes, { key: "End", shiftKey: true });
    expect([a, b, notes].every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);
  });

  it("읽기 전용 폴더의 Ctrl 클릭은 기존처럼 파일을 연다", async () => {
    const { store } = setup(fileFolderDefinition("read", true), undefined, { "a.md": "a" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    fireEvent.click(a, { ctrlKey: true });
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("a.md"));
    expect(screen.getByRole("tree").hasAttribute("aria-multiselectable")).toBe(false);
  });

  it.each(["재시도", "Escape", "닫기"])("실패 알림을 %s로 지우고 선택을 보존한다", async (dismiss) => {
    let failed = true;
    setup(fileFolderDefinition("readwrite", false), (transport) => {
      const original = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "files.move"
        ? { op: "files.move", results: request.paths.map((path) => failed
          ? { path, error: { code: "conflict", message: "충돌", details: [] } }
          : { path, ok: { from: path, to: `target/${path}` } }) }
        : original(request));
    }, { "a.md": "a", "b.md": "b", "target/.hidden": "x" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const target = screen.getByRole("treeitem", { name: "target" });
    fireEvent.click(a); fireEvent.click(b, { ctrlKey: true });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    const drop = () => { fireEvent.dragStart(a, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); };
    drop();
    const alert = await screen.findByRole("alert");
    if (dismiss === "재시도") { failed = false; drop(); }
    else if (dismiss === "Escape") fireEvent.keyDown(target, { key: "Escape" });
    else fireEvent.click(within(alert).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(b.getAttribute("aria-selected")).toBe("true");
  });

  it.each([false, true, "같은 원인"])("묶음 중 한 건 실패는 개수와 경로를 보이고 코어 식별자를 보존한다 (%s)", async (registered) => {
    setup(fileFolderDefinition("readwrite", false), (transport) => {
      const original = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "files.remove"
        ? { op: "files.remove", results: [
          { path: "a.md", error: { code: "conflict", message: "등록된 원인", details: [], ...(registered ? { id: "FILES_REMOVE_CONFLICT" } : {}) } },
          { path: "b.md", ...(registered === "같은 원인" ? { error: { code: "conflict", message: "등록된 원인", details: [], id: "FILES_REMOVE_CONFLICT" } } : { ok: {} }) },
        ] } : original(request));
    }, { "a.md": "a", "b.md": "b" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    fireEvent.click(a); fireEvent.click(b, { ctrlKey: true }); fireEvent.keyDown(b, { key: "Delete" });
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "휴지통으로 이동" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(registered === "같은 원인" ? "2개 실패: 등록된 원인" : registered ? "1개 실패: a.md: 등록된 원인" : "1개 실패: a.md: 같은 이름이 있습니다");
    if (registered !== "같은 원인") expect(within(alert).queryByRole("button", { name: "펼치기" })).toBeNull();
    if (registered) expect(alert.textContent).toContain("FILES_REMOVE_CONFLICT");
  });

  it("여러 실패는 개수만 보이고 펼치면 경로별 원인을 보여준다", async () => {
    setup(fileFolderDefinition("readwrite", false), (transport) => {
      const original = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "files.remove"
        ? { op: "files.remove", results: [
          { path: "a.md", error: { code: "conflict", message: "충돌", details: [] } },
          { path: "b.md", error: { code: "io", message: "디스크 오류", details: [] } },
        ] } : original(request));
    }, { "a.md": "a", "b.md": "b" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    fireEvent.click(a); fireEvent.click(b, { ctrlKey: true }); fireEvent.keyDown(b, { key: "Delete" });
    fireEvent.click(within(await screen.findByRole("dialog", { name: "2개 항목" })).getByRole("button", { name: "휴지통으로 이동" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("a.md");
    fireEvent.click(within(alert).getByRole("button", { name: "펼치기" }));
    expect(alert.textContent).toContain("a.md"); expect(alert.textContent).toContain("같은 이름이 있습니다");
  });

  it("빈 폴더 안내에 놓으면 해당 폴더로 옮기고 같은 폴더 이동은 막는다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "target/.hidden": "x" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const target = screen.getByRole("treeitem", { name: "target" });
    fireEvent.click(target);
    const empty = await screen.findByText("비어 있음");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer });
    fireEvent.dragOver(empty, { dataTransfer });
    expect(target.getAttribute("data-drop-state")).toBe("valid");
    fireEvent.drop(empty, { dataTransfer });
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.move", paths: ["a.md"], destination: "target" })));
    await waitFor(() => expect(document.activeElement).toBe(target));
  });

  it("선택 일부가 이미 목적지에 있으면 나머지만 옮긴다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false), undefined, { "target/a.md": "a", "b.md": "b" });
    const target = await screen.findByRole("treeitem", { name: "target" });
    fireEvent.click(target);
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    fireEvent.click(a); fireEvent.click(b, { ctrlKey: true });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.move", paths: ["b.md"], destination: "target" })));
  });

  it("잘라낸 항목을 끌어 이동하면 클립보드에서도 지운다", async () => {
    setup(fileFolderDefinition("readwrite", false), (transport) => {
      const original = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "files.move"
        ? { op: "files.move", results: request.paths.map((path) => ({ path, ok: { from: path, to: `target/${path}` } })) }
        : original(request));
    }, { "a.md": "a", "target/.hidden": "x" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const target = screen.getByRole("treeitem", { name: "target" });
    fireEvent.keyDown(a, { key: "x", ctrlKey: true });
    await waitFor(() => expect(a.className).toContain("is-cut"));
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(a.className).not.toContain("is-cut"));
    fireEvent.contextMenu(target);
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "붙여넣기" })).toBeNull();
  });

  it("같은 폴더로 이동은 표시와 요청을 없애고 Ctrl 복사는 허용한다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false), undefined, { "target/a.md": "a" });
    const target = await screen.findByRole("treeitem", { name: "target" });
    fireEvent.click(target);
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none"); expect(target.hasAttribute("data-drop-state")).toBe(false);
    fireEvent.drop(target, { dataTransfer });
    expect(call.mock.calls.some(([request]) => request.op === "files.move")).toBe(false);
    const ctrlDrag = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ctrlKey: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      fireEvent(target, event);
    };
    fireEvent.dragStart(a, { dataTransfer }); ctrlDrag("dragover");
    expect(dataTransfer.dropEffect).toBe("copy");
    ctrlDrag("drop");
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.copy", paths: ["target/a.md"], destination: "target" })));
  });
  it("여러 행을 고르고 키보드 범위를 늘려도 열린 파일은 바뀌지 않으며 묶음 복사와 삭제를 한다", async () => {
    const { store, call } = setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "b.md": "b", "c.md": "c", "target/inside.md": "x" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const c = screen.getByRole("treeitem", { name: "c.md" });
    fireEvent.click(a);
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("a.md"));
    fireEvent.click(c, { ctrlKey: true });
    expect(a.className).toContain("is-selected");
    expect(c.className).toContain("is-selected");
    expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("a.md");
    fireEvent.click(b, { shiftKey: true });
    expect(b.className).toContain("is-selected");
    fireEvent.keyDown(b, { key: "ArrowUp", shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(a));
    expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("a.md");
    fireEvent.keyDown(a, { key: "c", ctrlKey: true });
    const target = screen.getByRole("treeitem", { name: "target" });
    fireEvent.keyDown(target, { key: "v", ctrlKey: true });
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.copy", paths: ["c.md", "b.md", "a.md"], destination: "target" })));
    fireEvent.keyDown(a, { key: "Delete" });
    expect(await screen.findByRole("dialog", { name: "3개 항목" })).toBeTruthy();
  });

  it("묶음을 폴더로 끌고 자기 하위는 거부하며 끌기 동안 코어를 호출하지 않는다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "a", "b.md": "b", "target/inside.md": "x" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    const target = screen.getByRole("treeitem", { name: "target" });
    fireEvent.click(a);
    fireEvent.click(b, { ctrlKey: true });
    const values = new Map<string, string>();
    const transfer = { setData: (type: string, data: string) => values.set(type, data), getData: (type: string) => values.get(type) ?? "", types: ["application/x-kaleidoscope-folder"], effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(a, { dataTransfer: transfer });
    const before = call.mock.calls.length;
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(call.mock.calls.length).toBe(before);
    fireEvent.drop(target, { dataTransfer: transfer });
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.move", paths: ["a.md", "b.md"], destination: "target" })));
    fireEvent.dragStart(target, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("none");
  });

  it("묶음 메뉴에서 단일 항목 동작을 감추고 부분 삭제 실패를 하나로 알린다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false), (transport) => {
      const original = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "files.remove"
        ? { op: "files.remove", results: [
          { path: "a.md", ok: { from: "a.md" } },
          { path: "b.md", error: { code: "io", message: "파일을 지우지 못했습니다", details: [] } },
        ] } : original(request));
    }, { "a.md": "a", "b.md": "b" });
    const a = await screen.findByRole("treeitem", { name: "a.md" });
    const b = screen.getByRole("treeitem", { name: "b.md" });
    fireEvent.click(a, { ctrlKey: true });
    fireEvent.click(b, { ctrlKey: true });
    fireEvent.contextMenu(b);
    expect(await screen.findByRole("menuitem", { name: "휴지통으로 이동" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "이름 바꾸기" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "열기" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "휴지통으로 이동" }));
    const dialog = await screen.findByRole("dialog", { name: "2개 항목" });
    fireEvent.click(within(dialog).getByRole("button", { name: "휴지통으로 이동" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "files.remove", paths: ["a.md", "b.md"] })));
    expect((await screen.findByRole("alert")).textContent).toContain("파일을 지우지 못했습니다");
  });
  it("이름 입력을 바깥 클릭으로 닫으면 누른 대상에 키보드 포커스를 남기고 Escape만 원래 행으로 돌린다", async () => {
    const user = userEvent.setup();
    setup(fileFolderDefinition("readwrite", false), undefined, { "a.md": "# a", "b.md": "# b", "notes/guide.md": "# 안내" });
    render(<textarea aria-label="편집기" />);
    await screen.findByRole("treeitem", { name: "a.md" });
    const targets = [
      () => screen.getByRole("treeitem", { name: "b.md" }),
      () => screen.getByRole("treeitem", { name: "notes" }),
      () => screen.getByRole("tree"),
      () => screen.getByRole("textbox", { name: "편집기" }),
    ];
    for (const mode of ["rename", "create"] as const) {
      for (const target of targets) {
        await user.click(screen.getByRole("treeitem", { name: "a.md" }));
        await user.keyboard(mode === "rename" ? "{F2}" : "{Control>}{Shift>}n{/Shift}{/Control}");
        await screen.findByRole("textbox", { name: mode === "rename" ? "이름 바꾸기" : "새 폴더 이름" });
        await user.click(target());
        await waitFor(() => expect(screen.queryByRole("textbox", { name: mode === "rename" ? "이름 바꾸기" : "새 폴더 이름" })).toBeNull());
        expect(document.activeElement).toBe(target());
        const name = target().getAttribute("data-tree-id");
        if (name === "b.md" || name === "notes") {
          await user.keyboard("{F2}");
          expect((await screen.findByRole("textbox", { name: "이름 바꾸기" }) as HTMLInputElement).value).toBe(name);
          await user.keyboard("{Escape}");
          expect(document.activeElement).toBe(target());
          await user.keyboard("{Control>}x{/Control}");
          expect(target().className).toContain("is-cut");
          await user.keyboard("{Escape}{Delete}");
          await screen.findByRole("dialog", { name });
          await user.keyboard("{Escape}");
        }
      }
    }
  });

  it("reports read and mutation capabilities from the folder root", () => {
    const store = createShellStore(createFakeTransport(makeTestSeed()));
    const writable = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "/docs", writable: true, scope: "folder", readOnly: false });
    const pc = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "", writable: true, scope: "pc", readOnly: false });
    const readOnly = createFileFolderBackend({ store, windowId: "viewer-window", permission: "docs", appId: "test", rootPath: "/docs", writable: true, scope: "folder", readOnly: true });
    const collection = createCollectionFolderBackend({ store, windowId: "viewer-window", entry: "documents", appId: "test", prefix: "docs", markdown: true, readOnly: true });
    expect(writable.capabilities).toMatchObject({ createFile: true, rename: true, reveal: true, absolutePath: true });
    expect(pc.capabilities.createFile).toBe(false);
    expect(readOnly.capabilities.rename).toBe(false);
    expect(collection.capabilities).toMatchObject({ createFile: false, rename: false, permanentDelete: false, properties: true });
    store.dispose();
  });

  it("lists a file root through the shared tree, expands with arrows, and selects a file", async () => {
    const { store, call } = setup(fileFolderDefinition());
    const tree = await screen.findByRole("tree");
    expect(await screen.findByRole("treeitem", { name: "notes" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "skip.txt" })).toBeNull();

    const notes = screen.getByRole("treeitem", { name: "notes" });
    notes.focus();
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(guide));
    fireEvent.keyDown(guide, { key: "Enter" });

    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("notes/guide.md"));
    expect(call).toHaveBeenCalledWith({ op: "files.list", window_id: "viewer-window", permission: "docs", dir: "" });
    expect(tree.querySelector("[data-index]")).not.toBeNull();
  });

  it("lists and selects flat documents from a declared storage collection", async () => {
    const { store, call } = setup(storageFolderSplitDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") {
          return {
            op: "storage.list",
            result: {
              bucket_id: "folder-storage-test",
              items: [
                { doc: "notes/guide.md", revision: "rev-1", updated_at: "2026-11-02T00:00:00Z", byte_size: 7 as unknown as bigint },
              ],
            },
          };
        }
        return originalCall(request);
      });
    });

    const guide = await waitFor(() => {
      const row = document.querySelector<HTMLElement>('[data-tree-id="doc:notes/guide.md"]');
      if (!row) throw new Error("저장소 문서 행이 나타나지 않았습니다");
      return row;
    });
    expect(document.querySelector(".ks-file-tree-header")).toBeTruthy();
    expect(guide.getAttribute("aria-level")).toBe("1");
    expect(call).toHaveBeenCalledWith({ op: "storage.list", window_id: "viewer-window", entry: "documents" });
    fireEvent.click(guide);
    await waitFor(() => expect(store.getSnapshot()?.shared.windows[0].state.selected).toBe("notes/guide.md"));
  });

  it("opens write actions from the file row without changing the active selection", async () => {
    const { store } = setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });

    fireEvent.contextMenu(guide);

    expect(await screen.findByRole("menuitem", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "휴지통으로 이동" })).toBeTruthy();
    expect(guide.hasAttribute("data-menu-target")).toBe(true);
    expect(store.getSnapshot()?.shared.windows[0].state.selected).toBeNull();
  });

  it("exposes file-root creation and preserves an expanded folder's children during F2", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const createFile = await screen.findByRole("button", { name: "새 파일" });
    fireEvent.click(createFile);
    const rootInput = await screen.findByRole("textbox", { name: "새 파일 이름" }) as HTMLInputElement;
    await waitFor(() => expect(rootInput.selectionEnd).toBe("새 파일".length));

    fireEvent.keyDown(rootInput, { key: "Escape" });
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(notes, { key: "F2" });

    expect(await screen.findByRole("textbox", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "guide.md" })).toBeTruthy();
  });

  it("copies a folder to its parent and reports the backend operation", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.contextMenu(notes);
    fireEvent.click(await screen.findByRole("menuitem", { name: "사본 만들기" }));

    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "files.copy", window_id: "viewer-window", permission: "docs", paths: ["notes"], destination: "",
    }));
  });

  it("clears the shell clipboard with Escape from a focused tree row", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(guide, { key: "x", ctrlKey: true });

    await waitFor(() => expect(guide.className).toContain("is-cut"));
    fireEvent.keyDown(guide, { key: "Escape" });
    await waitFor(() => expect(guide.className).not.toContain("is-cut"));
  });

  it("복사 뒤 Escape를 눌러도 붙여넣기를 유지한다", async () => {
    const { call } = setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "c", ctrlKey: true });
    fireEvent.keyDown(notes, { key: "Escape" });
    fireEvent.keyDown(notes, { key: "v", ctrlKey: true });
    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "files.copy", window_id: "viewer-window", permission: "docs", paths: ["notes"], destination: "notes",
    }));
  });

  it("하위 경로 문서의 이름 입력을 루트 행에 표시하고 원래 부모에 옮긴다", async () => {
    const { call } = setup(storageFolderDefinition(false), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [{ doc: "notes/guide.md", revision: "rev-1", updated_at: "2026-11-02T00:00:00Z", byte_size: 7 as unknown as bigint }] } }
        : originalCall(request));
    });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.keyDown(guide, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "이름 바꾸기" });
    fireEvent.change(input, { target: { value: "renamed.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(call).toHaveBeenCalledWith({
      op: "storage.move", window_id: "viewer-window", entry: "documents", from: "notes/guide.md", to: "notes/renamed.md", expected_revision: "rev-1",
    }));
  });

  it("shows a writable server collection's empty action and uses extension-aware document naming", async () => {
    setup(storageFolderDefinition(false), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [] } }
        : originalCall(request));
    });

    const newDocument = await screen.findByRole("treeitem", { name: "새 문서" });
    fireEvent.click(newDocument);
    const input = await screen.findByRole("textbox", { name: "새 문서 이름" }) as HTMLInputElement;
    await waitFor(() => expect(input.selectionEnd).toBe("새 문서".length));
    fireEvent.change(input, { target: { value: "보고서.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe("이름은 .md로 끝나야 합니다");
    expect(screen.getByRole("textbox", { name: "새 문서 이름" })).toBeTruthy();
  });

  it("uses the same create and rename menu for collection documents", async () => {
    const { call } = setup(storageFolderDefinition(false), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") return {
          op: "storage.list",
          result: { bucket_id: "folder-storage-test", items: [{ doc: "guide.md", revision: "rev-1", updated_at: "2026-11-02T00:00:00Z", byte_size: 7 as unknown as bigint }] },
        };
        return originalCall(request);
      });
    });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });

    fireEvent.contextMenu(guide);

    expect(await screen.findByRole("menuitem", { name: "새 문서" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "상대 경로 복사" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "영구 삭제" })).toBeTruthy();
    expect(call).toHaveBeenCalledWith({ op: "storage.list", window_id: "viewer-window", entry: "documents" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(guide, { key: "Delete" });
    const dialog = await screen.findByRole("dialog", { name: "guide.md" });
    expect(dialog.textContent).toContain("되돌릴 수 없습니다.");
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "영구 삭제" })).toBeTruthy();
  });

  it("shows one properties close button and restores focus to its menu target", async () => {
    setup(fileFolderDefinition("readwrite", false));
    const notes = await screen.findByRole("treeitem", { name: "notes" });
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    const guide = await screen.findByRole("treeitem", { name: "guide.md" });
    fireEvent.contextMenu(guide);
    fireEvent.click(await screen.findByRole("menuitem", { name: "속성" }));

    const dialog = await screen.findByRole("dialog", { name: "속성" });
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["닫기"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(document.activeElement).toBe(guide));
  });

  it("labels an empty expanded folder without using an interactive row", async () => {
    setup(fileFolderDefinition("readwrite", false), undefined, { "empty/.hidden": "ignored" });
    const empty = await screen.findByRole("treeitem", { name: "empty" });
    fireEvent.keyDown(empty, { key: "ArrowRight" });

    const label = await screen.findByText("비어 있음");
    expect(label.closest(".ks-row")).toBeNull();
    expect(label.closest("[data-tree-row]")?.getAttribute("data-tree-row")).toBe("empty:empty");
  });

  it("does not repeat the collection label inside a tab panel", async () => {
    setup(storageFolderTabsDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") {
          return { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [] } };
        }
        return originalCall(request);
      });
    });

    await screen.findByRole("tree", { name: "파일 목록" });
    expect(document.querySelector(".ks-file-tree-header")).toBeNull();
    expect(screen.queryByText("문서", { exact: true })).toBeNull();
    expect(await screen.findByRole("treeitem", { name: "새 문서" })).toBeTruthy();
  });

  it("shows the collection header without a split pane by default", async () => {
    setup(storageFolderDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [] } }
        : originalCall(request));
    });
    await screen.findByRole("tree", { name: "파일 목록" });
    expect(document.querySelector(".ks-file-tree-header")?.textContent).toContain("문서");
  });

  it("hides the file-root header when explicitly disabled", async () => {
    const definition = fileFolderDefinition();
    definition.requires.blocks = 15;
    (definition.ui as Extract<Block, { type: "folder" }> & { header: boolean }).header = false;
    setup(definition);
    await screen.findByRole("tree");
    expect(document.querySelector(".ks-file-tree-header")).toBeNull();
  });

  it.each([true, false])("ordinary tabs preserve the child folder collapse control (header=%s)", async (header) => {
    const definition = storageFolderDefinition();
    definition.requires.blocks = 15;
    definition.ui = { type: "split", direction: "row", children: [
      { type: "tabs", header, tabs: [{ label: "문서 탭", child: definition.ui }] },
      { type: "text", value: "다른 패널" },
    ] };
    setup(definition, (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => request.op === "storage.list"
        ? { op: "storage.list", result: { bucket_id: "folder-storage-test", items: [] } }
        : originalCall(request));
    });
    await screen.findByRole("tree", { name: "파일 목록" });
    expect(screen.getAllByRole("button", { name: "목록 접기" })).toHaveLength(1);
    expect(document.querySelector(".ks-file-tree .ks-file-tree-collapse button")).toBe(screen.getByRole("button", { name: "목록 접기" }));
    fireEvent.click(screen.getByRole("button", { name: "목록 접기" }));
    expect(screen.getByRole("button", { name: "목록 펼치기" })).toBeTruthy();
  });

  it("refreshes a visible collection on matching storage changes and defers hidden updates", async () => {
    let documents = ["notes/guide.md"];
    let listError = false;
    const { store, transport, call } = setup(storageFolderDefinition(), (transport) => {
      const originalCall = transport.call.bind(transport);
      vi.spyOn(transport, "call").mockImplementation(async (request) => {
        if (request.op === "storage.list") {
          if (listError) throw { code: "io", message: "저장소 다시 읽기 실패", details: [] };
          return {
            op: "storage.list",
            result: {
              bucket_id: "folder-storage-test",
              items: documents.map((doc) => ({
                doc,
                revision: "rev-1",
                updated_at: "2026-11-02T00:00:00Z",
                byte_size: 7 as unknown as bigint,
              })),
            },
          };
        }
        return originalCall(request);
      });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/guide.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(1));

    documents = ["notes/renamed.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "other-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/renamed.md", kind: "md", revision: "rev-2", exists: true } } } });
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "other", key: "other.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(2));

    documents = ["notes/changed.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/changed.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/changed.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(3));

    documents = ["notes/renamed.md"];
    const hidden = structuredClone(store.getSnapshot()!);
    hidden.shared.windows[0].minimized = true;
    await act(async () => { transport.emit({ event: "state.changed", snapshot: hidden }); });
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/renamed.md", kind: "md", revision: "rev-2", exists: true } } } });
    });
    expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(3);

    const visible = structuredClone(hidden);
    visible.shared.windows[0].minimized = false;
    await act(async () => { transport.emit({ event: "state.changed", snapshot: visible }); });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/renamed.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(4));

    documents = ["notes/moved.md"];
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "moved", moved: { bucket_id: "folder-storage-test", entry_id: "documents", from_doc: "notes/renamed.md", to_doc: "notes/moved.md", revision: "rev-3" } } });
    });
    await waitFor(() => expect(document.querySelector('[data-tree-id="doc:notes/moved.md"]')).toBeTruthy());
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(5));

    listError = true;
    await act(async () => {
      transport.emit({ event: "storage.update", window_id: "viewer-window", update: { kind: "changed", changed: { bucket_id: "folder-storage-test", item: { entry_id: "documents", key: "documents/notes/moved.md", kind: "md", revision: "rev-4", exists: true } } } });
    });
    expect((await screen.findByRole("alert")).textContent).toContain("저장소 다시 읽기 실패");
    expect(document.querySelector('[data-tree-id="doc:notes/moved.md"]')).toBeTruthy();
    await waitFor(() => expect(call.mock.calls.filter(([request]) => request.op === "storage.list")).toHaveLength(6));
  });

  it("normalizes both legacy file-tree shapes into the folder renderer", () => {
    for (const block of [
      { type: "file_tree", root: { permission: "docs" }, selected: { state: "selected" }, on_select: { set_state: "selected" } },
      { type: "tree", root: { permission: "docs" }, selected: { state: "selected" }, on_select: { set_state: "selected" } },
    ]) {
      expect(normalizeBlock(block as unknown as Block)).toMatchObject({
        type: "folder", root: { permission: "docs" }, selected: { state: "selected" }, read_only: true, legacyTreeRoot: true,
      });
    }
    expect(normalizeBlock({ type: "tree", items: { state: "items" } } as Block).type).toBe("tree");
  });
});
