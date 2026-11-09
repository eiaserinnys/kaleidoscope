import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Binding, Block, TreeItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { isBadge } from "../components/badge";
import { FileText } from "../components/icons";
import { DataState } from "../components/data-state";
import { TreeView } from "../components/tree/tree-view";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { Badges, NoItems, asArray, isObject } from "./data-view-common";
import { useWindowStateValue } from "../data/window-state";

export type DataTreeBlockData = Extract<Block, { type: "tree" }> & { items: Binding };

function valid(value: unknown, byPath: boolean): value is TreeItem {
  if (!isObject(value) || typeof value.key !== "string") return false;
  if (value.title != null && typeof value.title !== "string") return false;
  if (byPath ? typeof value.path !== "string" : value.path != null && typeof value.path !== "string") return false;
  if (value.meta != null && typeof value.meta !== "string") return false;
  if (value.checked != null && typeof value.checked !== "boolean") return false;
  if (value.children != null && !Array.isArray(value.children) && !isObject(value.children)) return false;
  return asArray(value.badges).every((badge) => isBadge(badge) && (typeof badge === "string" || badge.color == null || typeof badge.color === "string"));
}

interface DataNode extends TreeNode {
  item?: TreeItem;
  children: DataNode[];
}

function tree(value: unknown, byPath: boolean, parent: string[] = [], pending: ReadonlyMap<string, boolean> = new Map()): DataNode[] {
  const items = asArray(value).filter((item): item is TreeItem => valid(item, byPath));
  if (!byPath) return items.flatMap((item): DataNode[] => {
    const title = item.title ?? item.path?.split("/").pop();
    return typeof title === "string" ? [{
      id: `item:${item.key}`,
      label: title,
      item,
      data: item,
      commentKey: [...parent, item.key],
      children: tree(item.children, false, [...parent, item.key], pending),
      selectable: true,
      checked: pending.get(item.key) ?? item.checked,
      leading: <FileText size="inline" />,
      meta: item.meta,
      trailing: <Badges values={item.badges} />,
    }] : [];
  });

  const root: DataNode[] = [];
  for (const item of items) {
    if (typeof item.path !== "string" || !item.path) continue;
    const parts = item.path.split("/").filter(Boolean);
    let siblings = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) siblings.push({
        id: `item:${item.key}`,
        label: item.title ?? part,
        item,
        data: item,
        commentKey: [item.key],
        children: [],
        selectable: true,
        checked: pending.get(item.key) ?? item.checked,
        leading: <FileText size="inline" />,
        meta: item.meta,
        trailing: <Badges values={item.badges} />,
      });
      else {
        let node = siblings.find((candidate) => candidate.id === `folder:${path}`);
        if (!node) {
          node = { id: `folder:${path}`, label: part, children: [], selectable: false };
          siblings.push(node);
        }
        siblings = node.children;
      }
    });
  }
  const sort = (nodes: DataNode[]) => {
    nodes.sort((left, right) => Number(Boolean(right.children.length)) - Number(Boolean(left.children.length)) || left.label.localeCompare(right.label, "ko"));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root);
  return root;
}

function ancestors(nodes: DataNode[], key: unknown, parents: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.item?.key === key) return parents;
    const found = ancestors(node.children, key, [...parents, node.id]);
    if (found) return found;
  }
  return null;
}

export function TreeBlock({ block, context, pointer }: { block: DataTreeBlockData; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} loading="tree" />;
  return <TreeReady block={block} context={context} pointer={pointer} value={value.value} />;
}

function TreeReady({ block, context, pointer, value }: { block: DataTreeBlockData; context: BlockContext; pointer: string; value: unknown }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const menu = useItemMenu(block.item_menu, pointer);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const nodes = useMemo(() => tree(value, block.by === "path", [], pending), [value, block.by, pending]);
  const selectedValue = useWindowStateValue(context, block.selected?.state ?? null);
  const selected = typeof selectedValue === "string" ? selectedValue : null;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(ancestors(nodes, selected) ?? []));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (block.default_expanded) return;
    const path = ancestors(nodes, selected);
    if (!path?.length) return;
    setExpanded((old) => {
      if (path.every((id) => old.has(id))) return old;
      const next = new Set(old);
      path.forEach((id) => next.add(id));
      return next;
    });
  }, [block.default_expanded, nodes, selected]);

  const visibleExpanded = useMemo(() => {
    if (!block.default_expanded) return expanded;
    const next = new Set<string>();
    const visit = (list: DataNode[]) => list.forEach((node) => {
      if (node.children.length) next.add(node.id);
      visit(node.children);
    });
    visit(nodes);
    collapsed.forEach((id) => next.delete(id));
    return next;
  }, [block.default_expanded, collapsed, expanded, nodes]);

  const toggle = (id: string, open: boolean) => {
    if (block.default_expanded) {
      setCollapsed((old) => {
        if (old.has(id) === !open) return old;
        const next = new Set(old);
        if (open) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setExpanded((old) => {
      if (old.has(id) === open) return old;
      const next = new Set(old);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  };
  const activate = (row: TreeRowModel) => {
    if (row.hasChildren && !block.on_check) toggle(row.id, !row.expanded);
    const item = row.node.data as TreeItem | undefined;
    if (item && block.on_select) void data.act(`${pointer}/on_select`, item.key, item as unknown as JsonValue);
  };
  const check = useCallback((row: TreeRowModel) => {
    const item = row.node.data as TreeItem | undefined;
    if (!item || !block.on_check || row.node.checked === undefined) return;
    const next = !row.node.checked;
    setPending((old) => new Map(old).set(item.key, next));
    void data.act(`${pointer}/on_check`, next, item as unknown as JsonValue).finally(() => {
      setPending((old) => {
        if (!old.has(item.key)) return old;
        const cleared = new Map(old);
        cleared.delete(item.key);
        return cleared;
      });
    });
  }, [block.on_check, data, pointer]);

  if (!nodes.length) return <NoItems rootProps={blockRoot} />;
  return <><TreeView
    rootProps={blockRoot}
    className="ks-data-view ks-data-tree"
    expanded={visibleExpanded}
    label="트리"
    nodes={nodes}
    onActivate={activate}
    onCheck={block.on_check ? check : undefined}
    onExpandedChange={toggle}
    onContextMenu={(row, anchor, _point, _focus, event) => { if (row) { const item = row.node.data as TreeItem | undefined; menu.open(event, anchor, item as unknown as JsonValue | undefined, item?.key ?? row.id, "제목 복사", row.node.label); } }}
    selectedId={selected === null ? null : `item:${selected}`}
  />{menu.dialog}</>;
}
