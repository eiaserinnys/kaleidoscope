import { memo, useState } from "react";
import type { KeyboardEvent } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { END_ACTION_ID, TreeView } from "../components/tree/tree-view";
import type { TreeFocusController } from "../components/tree/tree-view";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";

const renderedRows = vi.hoisted(() => new Map<string, number>());

vi.mock("../components/tree/tree-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/tree/tree-row")>();
  const ObservedTreeRow = memo(function ObservedTreeRow(props: Parameters<typeof actual.TreeRow>[0]) {
    renderedRows.set(props.row.id, (renderedRows.get(props.row.id) ?? 0) + 1);
    return <actual.TreeRow {...props} />;
  });
  return { ...actual, TreeRow: ObservedTreeRow };
});

const treeNodes: TreeNode[] = Array.from({ length: 20 }, (_, directory) => ({
  id: `dir-${directory}`,
  label: `folder-${directory}`,
  expandable: true,
  children: Array.from({ length: 100 }, (_, item) => ({
    id: `item-${directory}-${item}`,
    label: `item-${directory}-${item}`,
    selectable: true,
  })),
}));
const expanded = new Set(treeNodes.map((node) => node.id));

function Harness({ initiallyExpanded = [...expanded] }: { initiallyExpanded?: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyExpanded));
  return <div style={{ height: "480px" }}>
    <TreeView
      className="ks-file-tree-list"
      expanded={open}
      label="큰 트리"
      nodes={treeNodes}
      onActivate={(row: TreeRowModel) => {
        if (row.hasChildren) setOpen((current) => {
          const next = new Set(current);
          if (row.expanded) next.delete(row.id); else next.add(row.id);
          return next;
        });
        else setSelected(row.id);
      }}
      onExpandedChange={(id, value) => setOpen((current) => {
        const next = new Set(current);
        if (value) next.add(id); else next.delete(id);
        return next;
      })}
      selectedId={selected}
    />
  </div>;
}

afterEach(() => {
  cleanup();
  renderedRows.clear();
  vi.restoreAllMocks();
});

describe("공용 가상 트리", () => {
  it.each([null, "row-40"])("화면 안 포커스 요청은 스크롤 없이 행 또는 목록으로 돌아온다 (%s)", async (target) => {
    let focus!: TreeFocusController;
    render(<><input aria-label="바깥 입력" /><TreeView className="ks-file-tree-list" expanded={new Set()} label="포커스 복귀"
      nodes={Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, label: `행 ${index}` }))}
      onActivate={() => {}} onExpandedChange={() => {}} onFocusController={(value) => { focus = value; }} /></>);
    const first = await screen.findByRole("treeitem", { name: "행 0" });
    act(() => first.focus());
    const tree = screen.getByRole("tree");
    tree.scrollTop = 1200; fireEvent.scroll(tree);
    const visible = await screen.findByRole("treeitem", { name: "행 40" });
    act(() => screen.getByRole("textbox").focus());
    act(() => focus.visibleRow(target));
    await waitFor(() => expect(document.activeElement).toBe(target ? visible : tree));
    expect(tree.scrollTop).toBe(1200);
  });

  it("빈 목록의 화면 안 포커스 요청은 목록 칸으로 돌아온다", async () => {
    let focus!: TreeFocusController;
    render(<TreeView className="ks-file-tree-list" expanded={new Set()} label="빈 복귀" nodes={[]}
      onActivate={() => {}} onExpandedChange={() => {}} onFocusController={(value) => { focus = value; }} />);
    act(() => focus.visibleRow(null));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tree")));
  });

  it("row(null)은 현재 행으로 돌아가고 마지막 행 삭제의 null은 목록으로 돌아간다", async () => {
    let focus!: TreeFocusController;
    const props = { className: "ks-file-tree-list", label: "복귀 구분", expanded: new Set<string>(),
      onActivate: vi.fn(), onExpandedChange: () => {}, onFocusController: (value: TreeFocusController) => { focus = value; } };
    const nodes = [{ id: "only", label: "하나.md" }];
    const { rerender } = render(<TreeView {...props} nodes={nodes} />);
    const row = screen.getByRole("treeitem", { name: "하나.md" });
    act(() => row.focus());
    act(() => screen.getByRole("tree").focus());
    act(() => focus.row(null));
    await waitFor(() => expect(document.activeElement).toBe(row));
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onActivate).toHaveBeenCalledTimes(1);
    act(() => focus.afterDelete([null]));
    rerender(<TreeView {...props} nodes={[]} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tree")));
    expect(document.activeElement).not.toBe(document.body);
  });
  it("입력 중 숨었던 끝 행은 취소 뒤 복귀 요청을 받아 Enter를 처리한다", async () => {
    let focus!: TreeFocusController;
    function CancelHarness() {
      const [editing, setEditing] = useState(false);
      return <TreeView className="ks-file-tree-list" label="복귀 트리" expanded={new Set()}
        nodes={editing ? [{ id: "edit", label: "입력", interactiveContent: true, content: <input aria-label="새 이름" onKeyDown={(event) => {
          if (event.key === "Escape") { setEditing(false); focus.row(END_ACTION_ID, true); }
        }} /> }] : []}
        endAction={editing ? undefined : { label: "새 문서", onActivate: () => setEditing(true) }}
        onActivate={() => {}} onExpandedChange={() => {}} onFocusController={(value) => { focus = value; }} />;
    }
    render(<CancelHarness />);
    fireEvent.click(screen.getByRole("treeitem", { name: "새 문서" }));
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "새 이름" }), { key: "Escape" });
    const end = await screen.findByRole("treeitem", { name: "새 문서" });
    await waitFor(() => expect(document.activeElement).toBe(end));
    fireEvent.keyDown(end, { key: "Enter" });
    expect(await screen.findByRole("textbox", { name: "새 이름" })).toBeTruthy();
  });
  it("끝 액션은 방향키와 Enter로 실행하며 선택과 항목 메뉴에서 제외한다", async () => {
    const onActivate = vi.fn();
    const action = vi.fn();
    const menu = vi.fn();
    render(<TreeView className="ks-file-tree-list" label="끝 행 트리" expanded={new Set()}
      nodes={[{ id: "file", label: "문서.md" }]} selectedId="file"
      endAction={{ label: "새 문서", onActivate: action }}
      onActivate={onActivate} onContextMenu={menu} onExpandedChange={() => {}} />);
    const file = screen.getByRole("treeitem", { name: "문서.md" });
    fireEvent.keyDown(file, { key: "ArrowDown" });
    const end = await screen.findByRole("treeitem", { name: "새 문서" });
    await waitFor(() => expect(document.activeElement).toBe(end));
    fireEvent.keyDown(end, { key: "Enter" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
    expect(file.getAttribute("aria-selected")).toBe("true");
    fireEvent.contextMenu(end);
    expect(menu.mock.calls[0][0]).toBeNull();
    expect(end.hasAttribute("data-menu-target")).toBe(false);
  });

  it("끝 행은 Ctrl+A와 Shift+End 범위에서 제외한다", async () => {
    const selected = vi.fn();
    render(<TreeView className="ks-file-tree-list" expanded={new Set()} label="끝 행 선택"
      nodes={[{ id: "a", label: "a" }, { id: "b", label: "b" }]}
      endAction={{ label: "새 문서", onActivate: vi.fn() }} selection={[]} onSelectionChange={selected}
      onActivate={() => {}} onExpandedChange={() => {}} />);
    const a = await screen.findByRole("treeitem", { name: "a" });
    fireEvent.keyDown(a, { key: "a", ctrlKey: true });
    expect(selected).toHaveBeenLastCalledWith(["a", "b"]);
    fireEvent.click(a);
    fireEvent.keyDown(a, { key: "End", shiftKey: true });
    expect(selected).toHaveBeenLastCalledWith(["a", "b"]);
  });

  it("화면 밖 목적지가 overscan에 남아도 가리킨 행에 놓기 표시를 옮긴다", async () => {
    const drag = { enabled: true, targetId: "dir-0", hoveredId: "item-0-5", valid: true,
      onStart: vi.fn(), onOver: vi.fn(), onDrop: vi.fn(), onEnd: vi.fn(), onLeave: vi.fn() };
    render(<TreeView className="ks-file-tree-list" expanded={expanded} label="놓기 트리" nodes={treeNodes}
      onActivate={() => {}} onExpandedChange={() => {}} drag={drag} />);
    const parent = await screen.findByRole("treeitem", { name: "folder-0" });
    expect(parent.getAttribute("data-drop-state")).toBe("valid");
    const tree = screen.getByRole("tree");
    tree.scrollTop = 96; fireEvent.scroll(tree);
    await waitFor(() => expect(screen.getByRole("treeitem", { name: "item-0-5" }).getAttribute("data-drop-state")).toBe("valid"));
    expect(parent.isConnected).toBe(true);
    expect(parent.hasAttribute("data-drop-state")).toBe(false);
  });

  it("묶음 삭제 포커스 후보는 선택한 행과 그 자손을 건너뛴다", () => {
    let focus: TreeFocusController | null = null;
    const nodes: TreeNode[] = [
      { id: "a", label: "a", children: [{ id: "child", label: "child" }] },
      { id: "b", label: "b" }, { id: "c", label: "c" }, { id: "remaining", label: "remaining" },
    ];
    render(<TreeView className="ks-file-tree-list" expanded={new Set(["a"])} label="삭제 트리" nodes={nodes}
      onActivate={() => {}} onExpandedChange={() => {}} onFocusController={(controller) => { focus = controller; }} />);
    const row = focus!.rows(["b"])[0];
    const candidates = focus!.deletionTargets(row, ["a", "b", "c"]);
    expect(candidates).toEqual(["remaining", null]);
  });

  it("이름 바꾼 행이 나타나면 새 행 하나를 고른다", async () => {
    let focus: TreeFocusController | null = null;
    const onSelectionChange = vi.fn();
    const props = { className: "ks-file-tree-list", expanded: new Set<string>(), label: "이름 트리", onActivate: () => {}, onExpandedChange: () => {}, selection: [], onSelectionChange, onFocusController: (controller: TreeFocusController) => { focus = controller; } };
    const { rerender } = render(<TreeView {...props} nodes={[{ id: "old", label: "old" }]} />);
    act(() => focus!.row("new", true, true));
    rerender(<TreeView {...props} nodes={[{ id: "new", label: "new" }]} />);
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(["new"]));
  });

  it("접히거나 사라진 행은 선택에서 제거한다", async () => {
    const onSelectionChange = vi.fn();
    const props = { className: "ks-file-tree-list", expanded: new Set<string>(), label: "선택 트리", onActivate: () => {}, onExpandedChange: () => {}, selection: ["a", "b"], onSelectionChange };
    const { rerender } = render(<TreeView {...props} nodes={[{ id: "a", label: "a" }, { id: "b", label: "b" }]} />);
    expect(onSelectionChange).not.toHaveBeenCalled();
    rerender(<TreeView {...props} nodes={[{ id: "a", label: "a" }]} />);
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalledWith(["a"]));
  });
  it("목록 대기 중 다른 입력으로 옮긴 포커스를 빼앗지 않고 요청을 버린다", async () => {
    let focus: TreeFocusController | null = null;
    const props = {
      className: "ks-file-tree-list", expanded: new Set<string>(), label: "대기 트리",
      onActivate: () => {}, onExpandedChange: () => {},
      onFocusController: (controller: TreeFocusController) => { focus = controller; },
    };
    const view = (nodes: TreeNode[]) => <><input aria-label="다른 입력" /><TreeView {...props} nodes={nodes} /></>;
    const { rerender } = render(view([{ id: "old", label: "기존" }]));
    act(() => focus!.row("new", true));
    const outside = screen.getByRole("textbox", { name: "다른 입력" });
    act(() => outside.focus());
    const nodes = [{ id: "old", label: "기존" }, { id: "new", label: "새 행" }];
    rerender(view(nodes));
    await screen.findByRole("treeitem", { name: "새 행" });
    expect(document.activeElement).toBe(outside);
    act(() => outside.blur());
    rerender(view([...nodes]));
    expect(document.activeElement).toBe(document.body);
  });

  it("인라인 입력을 연 채 위로 스크롤해도 사용자 위치를 유지한다", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const nodes: TreeNode[] = [
      ...Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, label: `행 ${index}` })),
      { id: "edit-row", label: "새 파일", interactiveContent: true, content: <input aria-label="새 파일 이름" /> },
    ];
    render(<TreeView className="ks-file-tree-list" expanded={new Set()} label="스크롤 트리"
      nodes={nodes} onActivate={() => {}} onExpandedChange={() => {}} />);
    await screen.findByRole("textbox", { name: "새 파일 이름" });
    const tree = screen.getByRole("tree", { name: "스크롤 트리" });
    tree.scrollTop = 1200;
    fireEvent.scroll(tree);
    await screen.findByRole("treeitem", { name: "행 35" });
    expect(tree.scrollTop).toBe(1200);
  });

  it("아직 없는 행의 포커스 요청을 행이 나타날 때까지 유지한다", async () => {
    let focus: TreeFocusController | null = null;
    const props = {
      className: "ks-file-tree-list", expanded: new Set<string>(), label: "대기 트리",
      onActivate: () => {}, onExpandedChange: () => {},
      onFocusController: (controller: TreeFocusController) => { focus = controller; },
    };
    const { rerender } = render(<TreeView {...props} nodes={[{ id: "old", label: "기존" }]} />);
    act(() => focus!.row("new", true));
    rerender(<TreeView {...props} nodes={[{ id: "old", label: "기존" }, { id: "new", label: "새 행" }]} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "새 행" })));
  });

  it("트리 바탕에서 방향키를 누르면 현재 행이나 첫 행으로 들어간다", async () => {
    render(<TreeView className="ks-file-tree-list" expanded={new Set()} label="방향키 트리"
      nodes={[{ id: "first", label: "첫 행" }, { id: "second", label: "둘째 행" }]}
      onActivate={() => {}} onExpandedChange={() => {}} />);
    const tree = screen.getByRole("tree", { name: "방향키 트리" });
    fireEvent.click(tree);
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "첫 행" })));
    act(() => screen.getByRole("treeitem", { name: "둘째 행" }).focus());
    fireEvent.click(tree);
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "둘째 행" })));
  });
  it("빈 트리에 Tab으로 들어오고 빈 공간 클릭 뒤 root 단축키를 처리한다", () => {
    const onCommandKeyDown = vi.fn((_row: TreeRowModel | null, _event: KeyboardEvent<HTMLElement>, _focus: TreeFocusController) => true);
    const { rerender } = render(<div style={{ height: "480px" }}><TreeView
      className="ks-file-tree-list"
      expanded={new Set()}
      label="빈 트리"
      nodes={[]}
      onActivate={() => {}}
      onCommandKeyDown={onCommandKeyDown}
      onExpandedChange={() => {}}
    /></div>);

    const tree = screen.getByRole("tree", { name: "빈 트리" });
    expect(tree.tabIndex).toBe(0);
    fireEvent.click(tree);
    expect(document.activeElement).toBe(tree);
    fireEvent.keyDown(tree, { key: "n", ctrlKey: true, shiftKey: true });
    expect(onCommandKeyDown.mock.calls[0]?.[0]).toBeNull();
    expect(onCommandKeyDown.mock.calls[0]?.[1].key).toBe("n");
    expect(onCommandKeyDown.mock.calls[0]?.[2]).toMatchObject({ row: expect.any(Function), afterDelete: expect.any(Function) });

    rerender(<div style={{ height: "480px" }}><TreeView
      className="ks-file-tree-list"
      expanded={new Set()}
      label="빈 트리"
      nodes={[{ id: "row", label: "행" }]}
      onActivate={() => {}}
      onCommandKeyDown={onCommandKeyDown}
      onExpandedChange={() => {}}
    /></div>);
    expect(screen.getByRole("tree", { name: "빈 트리" }).tabIndex).toBe(-1);
  });

  it("가상 범위 밖의 인라인 입력 행으로 스크롤하고 입력에 포커스한다", async () => {
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    const nodes: TreeNode[] = [
      ...Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, label: `행 ${index}` })),
      { id: "edit-row", label: "새 파일", selectable: false, interactiveContent: true, content: <input aria-label="새 파일 이름" /> },
    ];
    render(<div style={{ height: "240px" }}><TreeView
      className="ks-file-tree-list"
      expanded={new Set()}
      label="긴 트리"
      nodes={nodes}
      onActivate={() => {}}
      onExpandedChange={() => {}}
    /></div>);

    await waitFor(() => expect(document.querySelector('[data-tree-row="edit-row"]')).toBeTruthy());
    const input = await screen.findByRole("textbox", { name: "새 파일 이름" });
    expect(scrollTo).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("삭제 뒤 다음 행에 포커스를 돌려준다", async () => {
    let focus: TreeFocusController | null = null;
    let removeMiddle: (() => void) | null = null;
    let activated: TreeRowModel | null = null;
    function Harness() {
      const [nodes, setNodes] = useState<TreeNode[]>([
        { id: "first", label: "첫 행" },
        { id: "middle", label: "가운데 행" },
        { id: "next", label: "다음 행" },
      ]);
      removeMiddle = () => setNodes((current) => current.filter((node) => node.id !== "middle"));
      return <div style={{ height: "240px" }}><TreeView
        className="ks-file-tree-list"
        expanded={new Set()}
        label="삭제 포커스 트리"
        nodes={nodes}
        onActivate={(row) => { activated = row; }}
        onExpandedChange={() => {}}
        onFocusController={(controller) => { focus = controller; }}
      /></div>;
    }
    render(<Harness />);
    const middle = await screen.findByRole("treeitem", { name: "가운데 행" });
    fireEvent.click(middle);
    await waitFor(() => expect(activated).not.toBeNull());
    const targets = focus!.deletionTargets(activated!);

    act(() => removeMiddle!());
    act(() => focus!.afterDelete(targets));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "다음 행" })));
  });

  it("수천 행 중 보이는 행만 그리고 선택 변경은 다른 행을 다시 그리지 않는다", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    render(<Harness />);
    const tree = screen.getByRole("tree", { name: "큰 트리" });
    await waitFor(() => expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(2020);

    const first = screen.getByRole("treeitem", { name: "item-0-0" });
    const neighbor = "item-0-1";
    const beforeSelect = renderedRows.get(neighbor);
    fireEvent.click(first);
    await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"));
    expect(renderedRows.get(neighbor)).toBe(beforeSelect);

    tree.scrollTop = 1_200;
    fireEvent.scroll(tree);
    const scrolledItem = await screen.findByRole("treeitem", { name: "item-0-35" });
    expect(scrolledItem).toBeTruthy();
    const scrolledNeighborCount = renderedRows.get("item-0-36");
    fireEvent.click(scrolledItem);
    await waitFor(() => expect(scrolledItem.getAttribute("aria-selected")).toBe("true"));
    expect(renderedRows.get("item-0-36")).toBe(scrolledNeighborCount);
  });

  it("폴더를 펼쳐도 앞선 형제 행은 다시 그리지 않는다", async () => {
    render(<Harness initiallyExpanded={[]} />);
    const unchanged = await screen.findByRole("treeitem", { name: "folder-0" });
    const before = renderedRows.get("dir-0");
    const target = await screen.findByRole("treeitem", { name: "folder-10" });
    fireEvent.click(target);

    expect(await screen.findByRole("treeitem", { name: "item-10-0" })).toBeTruthy();
    expect(renderedRows.get("dir-0")).toBe(before);
    expect(unchanged.getAttribute("aria-expanded")).toBe("false");
  });

  it("포커스 행이 가상 창 밖으로 나가도 포커스와 roving tab stop을 유지한다", async () => {
    render(<Harness />);
    const tree = screen.getByRole("tree", { name: "큰 트리" });
    const first = await screen.findByRole("treeitem", { name: "item-0-0" });
    first.focus();
    tree.scrollTop = 20_000;
    fireEvent.scroll(tree);

    await waitFor(() => expect(screen.getByRole("treeitem", { name: "item-0-0" })).toBeTruthy());
    expect(document.activeElement).toBe(first);
    expect(first.tabIndex).toBe(0);
  });

  it("보조 행을 트리 항목과 키보드 이동에서 제외하고 안의 입력은 유지한다", async () => {
    const nodes: TreeNode[] = [
      { id: "first", label: "첫 행" },
      { id: "creating", label: "새 파일", selectable: false, interactiveContent: true, content: <input aria-label="새 파일 이름" /> },
      { id: "last", label: "마지막 행" },
    ];
    const { rerender } = render(<div style={{ height: "480px" }}><TreeView
      className="ks-file-tree-list"
      expanded={new Set()}
      label="입력 트리"
      nodes={nodes}
      onActivate={() => {}}
      onExpandedChange={() => {}}
    /></div>);
    const tree = screen.getByRole("tree", { name: "입력 트리" });
    expect(tree.getAttribute("aria-rowcount")).toBe("2");
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
    const first = screen.getByRole("treeitem", { name: "첫 행" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "마지막 행" })));
    const input = screen.getByRole("textbox", { name: "새 파일 이름" });
    input.focus();
    expect(document.activeElement).toBe(input);
    rerender(<div style={{ height: "480px" }}><TreeView
      className="ks-file-tree-list"
      expanded={new Set()}
      label="입력 트리"
      nodes={nodes}
      onActivate={() => {}}
      onExpandedChange={() => {}}
    /></div>);
    expect(screen.getByRole("textbox", { name: "새 파일 이름" })).toBeTruthy();
  });
});
