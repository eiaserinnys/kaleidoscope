import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Binding, Block, TreeItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { isBadge } from "../components/badge";
import { ChevronRight, FileText } from "../components/icons";
import { DataState } from "../components/data-state";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { Badges, NoItems, asArray, isObject } from "./data-view-common";

type Node = { id: string; title: string; item?: TreeItem; children: Node[] };
export type DataTreeBlockData = Extract<Block, { type: "tree" }> & { items: Binding };
function valid(value: unknown, byPath: boolean): value is TreeItem {
  if (!isObject(value) || typeof value.key !== "string") return false;
  if (value.title != null && typeof value.title !== "string") return false;
  if (byPath ? typeof value.path !== "string" : value.path != null && typeof value.path !== "string") return false;
  if (value.meta != null && typeof value.meta !== "string") return false;
  if (value.children != null && !Array.isArray(value.children) && !isObject(value.children)) return false;
  return asArray(value.badges).every((badge) => isBadge(badge) && (typeof badge === "string" || badge.color == null || typeof badge.color === "string"));
}
function tree(value: unknown, byPath: boolean): Node[] {
  const items = asArray(value).filter((item): item is TreeItem => valid(item, byPath));
  if (!byPath) return items.flatMap((item): Node[] => {
    const title = item.title ?? item.path?.split("/").pop();
    return typeof title === "string" ? [{ id: item.key, title, item, children: tree(item.children, false) }] : [];
  });
  const root: Node[] = [];
  for (const item of items) {
    if (typeof item.path !== "string" || !item.path) continue;
    const parts = item.path.split("/").filter(Boolean); let siblings = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) siblings.push({ id: `item:${item.key}`, title: item.title ?? part, item, children: [] });
      else {
        let node = siblings.find((n) => n.id === `folder:${path}`);
        if (!node) { node = { id: `folder:${path}`, title: part, children: [] }; siblings.push(node); }
        siblings = node.children;
      }
    });
  }
  const sort = (nodes: Node[]) => { nodes.sort((a, b) => Number(Boolean(b.children.length)) - Number(Boolean(a.children.length)) || a.title.localeCompare(b.title, "ko")); nodes.forEach((node) => sort(node.children)); };
  sort(root); return root;
}
function ancestors(nodes: Node[], key: unknown, parents: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.item?.key === key) return parents;
    const found = ancestors(node.children, key, [...parents, node.id]);
    if (found) return found;
  }
  return null;
}
export function TreeBlock({ block, context, pointer }: { block: DataTreeBlockData; context: BlockContext; pointer: string }) {
  const value = useBinding(`${pointer}/items`, block.items);
  if (value.status !== "ready") return <DataState value={value} />;
  return <TreeReady block={block} context={context} pointer={pointer} value={value.value} />;
}
function TreeReady({ block, context, pointer, value }: { block: DataTreeBlockData; context: BlockContext; pointer: string; value: unknown }) {
  const data = useWindowData();
  const nodes = useMemo(() => tree(value, block.by === "path"), [value, block.by]);
  const selected = block.selected ? context.window.state[block.selected.state] : null;
  const [expanded, setExpanded] = useState(() => new Set(ancestors(nodes, selected) ?? []));
  const [focus, setFocus] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const path = ancestors(nodes, selected);
    if (!path?.length) return;
    setExpanded((old) => {
      if (path.every((id) => old.has(id))) return old;
      const next = new Set(old);
      path.forEach((id) => next.add(id));
      return next;
    });
  }, [nodes, selected]);
  const visible: Array<{ node: Node; parent: string | null }> = [];
  const collect = (items: Node[], parent: string | null) => items.forEach((node) => { visible.push({ node, parent }); if (expanded.has(node.id)) collect(node.children, node.id); });
  collect(nodes, null);
  const entry = visible.find(({ node }) => node.id === focus)?.node.id
    ?? visible.find(({ node }) => node.item?.key === selected)?.node.id
    ?? visible[0]?.node.id ?? null;
  useEffect(() => { if (focus !== null && focus !== entry) setFocus(entry); }, [focus, entry]);
  const move = (id: string) => { setFocus(id); const element = [...(container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((el) => el.dataset.treeId === id); element?.focus(); };
  const toggle = (id: string) => setExpanded((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const choose = (node: Node) => { if (node.children.length) toggle(node.id); if (node.item && block.on_select) void data.act(`${pointer}/on_select`, node.item.key, node.item as unknown as JsonValue); };
  const keyDown = (event: KeyboardEvent, node: Node, parent: string | null) => {
    const index = visible.findIndex((v) => v.node.id === node.id);
    if (event.key === "ArrowDown") move(visible[Math.min(index + 1, visible.length - 1)].node.id);
    else if (event.key === "ArrowUp") move(visible[Math.max(index - 1, 0)].node.id);
    else if (event.key === "ArrowRight" && node.children.length) { if (!expanded.has(node.id)) toggle(node.id); else move(node.children[0].id); }
    else if (event.key === "ArrowLeft") { if (expanded.has(node.id)) toggle(node.id); else if (parent) move(parent); }
    else if (event.key === "Enter") choose(node);
    else return;
    event.preventDefault();
  };
  const renderNodes = (items: Node[], parent: string | null): React.ReactNode => items.map((node) => {
    const folder = node.children.length > 0; const open = expanded.has(node.id); const active = node.item !== undefined && node.item.key === selected;
    return <div className="ks-file-tree-entry" key={node.id}>
      <button className={`ks-row ks-file-tree-row${active ? " is-selected" : ""}`} role="treeitem" aria-setsize={visible.length} aria-posinset={visible.findIndex((item) => item.node.id === node.id) + 1} aria-expanded={folder ? open : undefined} aria-selected={active} data-tree-id={node.id} tabIndex={entry === node.id ? 0 : -1} onFocus={() => setFocus(node.id)} onKeyDown={(e) => keyDown(e, node, parent)} onClick={() => choose(node)} type="button">
        <span aria-hidden="true" className="ks-file-tree-icon">{folder ? <ChevronRight className={`ks-chevron${open ? " is-expanded" : ""}`} size="inline" /> : <FileText size="inline" />}</span>
        <span className="ks-file-tree-name ks-tree-name">{node.title}</span>{node.item?.meta && <span className="ks-view-meta">{node.item.meta}</span>}<Badges values={node.item?.badges} />
      </button>
      {folder && open && <div className="ks-file-tree-children" role="group">{renderNodes(node.children, node.id)}</div>}
    </div>;
  });
  if (!nodes.length) return <NoItems />;
  return <div className="ks-data-view ks-data-tree" role="tree" aria-label="트리" ref={container}>{renderNodes(nodes, null)}</div>;
}
