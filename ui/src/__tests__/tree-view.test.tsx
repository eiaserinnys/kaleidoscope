import { memo, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../components/tree/tree-view";
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
});
