import { useBlockRootProps } from "../comments/block-root";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Binding, Block, TreeItem } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { isBadge } from "../components/badge";
import { Check, ChevronRight, FileText } from "../components/icons";
import { DataState } from "../components/data-state";
import { TreeView, type TreeFocusController } from "../components/tree/tree-view";
import { TreeEditRow } from "../components/tree/tree-edit-row";
import type { TreeNode, TreeRowModel } from "../components/tree/tree-model";
import { useBinding, useWindowData } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { useItemMenu } from "./item-menu";
import { useDataTreeDrag } from "./data-tree-drag";
import { Badges, NoItems, asArray, isObject } from "./data-view-common";
import { useWindowStateValue } from "../data/window-state";

export type DataTreeBlockData = Extract<Block, { type: "tree" }> & { items: Binding };

function valid(value: unknown, byPath: boolean): value is TreeItem {
  if (!isObject(value) || typeof value.key !== "string") return false;
  if (value.title != null && typeof value.title !== "string") return false;
  if (byPath ? typeof value.path !== "string" : value.path != null && typeof value.path !== "string") return false;
  if (value.meta != null && typeof value.meta !== "string") return false;
  if (value.checked != null && typeof value.checked !== "boolean") return false;
  if (value.editing != null && typeof value.editing !== "boolean") return false;
  if (value.children != null && !Array.isArray(value.children) && !isObject(value.children)) return false;
  return asArray(value.badges).every((badge) => isBadge(badge) && (typeof badge === "string" || badge.color == null || typeof badge.color === "string"));
}

/** 바로 입력 상태. 끝난 행(ended)과 확정했지만 앱 값이 아직 오지 않은 제목(titles)을 지역으로 기억한다. */
interface InlineEditing {
  ended: ReadonlySet<string>;
  titles: ReadonlyMap<string, { text: string; base: string }>;
  checkEnabled: boolean;
  commit: (item: TreeItem, draft: string) => void;
  cancel: (item: TreeItem) => void;
}

function titleOf(item: TreeItem, editing: InlineEditing | undefined): string | undefined {
  const pending = editing?.titles.get(item.key);
  if (pending !== undefined && (item.title ?? "") === pending.base) return pending.text;
  return item.title ?? item.path?.split("/").pop();
}

function isEditing(item: TreeItem, editing: InlineEditing | undefined): boolean {
  return editing !== undefined && item.editing === true && !editing.ended.has(item.key);
}

/** 그 항목의 바로 입력 글칸이 지금 초점을 쥐고 있는지. 초점을 잃어 확정한 경우에는 초점을 빼앗지 않는다. */
function editingInputActive(key: string): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches("input, textarea")) return false;
  return active.closest<HTMLElement>("[data-tree-row]")?.dataset.treeRow === `item:${key}`;
}

/** 바로 입력 행의 표식 열. 트리 행과 같은 두 열 규칙을 쓴다. 상자는 눌러도 확인 동작을 하지 않는다. */
function editColumns(checked: boolean | undefined, hasChildren: boolean, checkEnabled: boolean, expanded: boolean) {
  const check = checked !== undefined
    ? <span className={`ks-tree-check${checked ? " is-checked" : ""}`} data-tree-check="">{checked ? <Check size="chrome" /> : null}</span>
    : undefined;
  const marker = check ?? (hasChildren ? undefined : <FileText size="inline" />);
  const chevron = hasChildren ? <ChevronRight className={`ks-chevron${expanded ? " is-expanded" : ""}`} size="inline" /> : undefined;
  return checkEnabled && !(check === undefined && hasChildren) ? [chevron, marker] : [chevron ?? marker];
}

/** 편집 행이 그 행의 펼침 상태를 그리게 하는 조회 함수. 펼침 상태는 행 모형을 다시 만들지 않으므로 문맥으로 건넨다. */
const TreeEditExpansion = createContext<((id: string) => boolean) | null>(null);

function DataTreeEditRow({ id, checked, hasChildren, checkEnabled, value, onCommit, onCancel }: {
  id: string;
  checked: boolean | undefined;
  hasChildren: boolean;
  checkEnabled: boolean;
  value: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  const isExpanded = useContext(TreeEditExpansion);
  return <TreeEditRow
    ariaLabel="항목 이름"
    columns={editColumns(checked, hasChildren, checkEnabled, hasChildren && (isExpanded?.(id) ?? false))}
    onCancel={onCancel}
    onCommit={onCommit}
    value={value}
  />;
}

interface DataNode extends TreeNode {
  item?: TreeItem;
  children: DataNode[];
}

function tree(value: unknown, byPath: boolean, parent: string[] = [], pending: ReadonlyMap<string, boolean> = new Map(), editing?: InlineEditing): DataNode[] {
  const items = asArray(value).filter((item): item is TreeItem => valid(item, byPath));
  if (!byPath) return items.flatMap((item): DataNode[] => {
    const editingState = isEditing(item, editing) ? editing : undefined;
    const title = titleOf(item, editing);
    // 새 항목은 제목이 없다. 바로 입력 중이면 빈 글칸 행으로 그린다.
    if (typeof title !== "string" && editingState === undefined) return [];
    const children = tree(item.children, false, [...parent, item.key], pending, editing);
    const checked = pending.get(item.key) ?? item.checked;
    return [{
      id: `item:${item.key}`,
      label: title ?? "",
      item,
      data: item,
      commentKey: [...parent, item.key],
      children,
      selectable: true,
      checked,
      leading: <FileText size="inline" />,
      meta: item.meta,
      trailing: <Badges values={item.badges} />,
      content: editingState === undefined ? undefined : <DataTreeEditRow
        id={`item:${item.key}`}
        checked={checked}
        hasChildren={children.length > 0}
        checkEnabled={editingState.checkEnabled}
        onCancel={() => editingState.cancel(item)}
        onCommit={(draft) => editingState.commit(item, draft)}
        value={item.title ?? ""}
      />,
      interactiveContent: editingState === undefined ? undefined : true,
    }];
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
  // empty_text가 없으면 null로 두어 지금의 빈 상태 상자를 그리고, 있으면 계산한 값을 문자열로만 받아들인다.
  const emptyText = useBinding(`${pointer}/empty_text`, block.empty_text ?? null);
  const emptyTextValue = emptyText.status === "ready" ? emptyText.value : null;
  if (value.status !== "ready") return <DataState rootProps={blockRoot} value={value} loading="tree" />;
  return <TreeReady block={block} context={context} pointer={pointer} value={value.value} emptyText={block.empty_text === undefined ? null : typeof emptyTextValue === "string" ? emptyTextValue : ""} />;
}

function TreeReady({ block, context, pointer, value, emptyText }: { block: DataTreeBlockData; context: BlockContext; pointer: string; value: unknown; emptyText: string | null }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const menu = useItemMenu(block.item_menu, pointer);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => new Set());
  const [titles, setTitles] = useState<ReadonlyMap<string, { text: string; base: string }>>(() => new Map());
  const editable = block.on_edit !== undefined && block.by !== "path";
  const focusRef = useRef<TreeFocusController | null>(null);
  const setFocusController = useCallback((focus: TreeFocusController) => { focusRef.current = focus; }, []);
  // 글칸이 초점을 받기 직전에 초점을 쥐고 있던 요소. 바로 입력을 연 자리로 되돌릴 때 쓴다.
  const opener = useRef<HTMLElement | null>(null);
  const lastExternalFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editable) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('input[aria-label="항목 이름"], textarea[aria-label="항목 이름"]')) {
        opener.current = lastExternalFocus.current;
        return;
      }
      // 메뉴 항목은 곧 사라진다. 메뉴를 연 행이 그 앞에 초점을 쥐었으므로 그대로 둔다.
      if (target.closest('[role="menu"]')) return;
      lastExternalFocus.current = target;
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [editable]);
  const inline = useMemo<InlineEditing | undefined>(() => {
    if (!editable) return undefined;
    return {
      ended,
      titles,
      checkEnabled: block.on_check !== undefined,
      commit: (item, draft) => {
        const keyboard = editingInputActive(item.key);
        const next = draft.trim();
        const base = item.title ?? "";
        setEnded((old) => old.has(item.key) ? old : new Set(old).add(item.key));
        opener.current = null;
        if (next.length === 0 || next === base) {
          void data.act(`${pointer}/on_edit_cancel`, null, item as unknown as JsonValue);
        } else {
          setTitles((old) => new Map(old).set(item.key, { text: next, base }));
          void data.act(`${pointer}/on_edit`, next, item as unknown as JsonValue);
        }
        if (keyboard) focusRef.current?.row(`item:${item.key}`, true);
      },
      cancel: (item) => {
        const keyboard = editingInputActive(item.key);
        const target = opener.current;
        opener.current = null;
        setEnded((old) => old.has(item.key) ? old : new Set(old).add(item.key));
        void data.act(`${pointer}/on_edit_cancel`, null, item as unknown as JsonValue);
        if (!keyboard) return;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else focusRef.current?.row(`item:${item.key}`);
      },
    };
  }, [block.on_check, data, editable, ended, pointer, titles]);
  const nodes = useMemo(() => tree(value, block.by === "path", [], pending, inline), [value, block.by, pending, inline]);
  // 앱이 항목의 editing을 끄면 지역 종료 표시를 거둔다. 같은 키가 다시 editing이 참이 되면 새 글칸을 연다.
  const editingFlags = useRef(new Map<string, boolean>());
  useEffect(() => {
    const live = new Set<string>();
    const current = new Map<string, boolean>();
    const visit = (list: DataNode[]) => list.forEach((node) => {
      const item = node.item;
      if (item) { if (item.editing === true) live.add(item.key); current.set(item.key, item.editing === true); }
      visit(node.children);
    });
    visit(nodes);
    const previous = editingFlags.current;
    editingFlags.current = current;
    setEnded((old) => {
      if (!old.size) return old;
      const next = new Set([...old].filter((key) => live.has(key)));
      return next.size === old.size ? old : next;
    });
    // 확정한 제목은 앱 값이 그 처음 값에서 바뀌면 거둔다. 앱이 editing을 끄면서 값도 그대로 두면 받아들이지 않은 것이므로 거둔다.
    setTitles((old) => {
      if (!old.size) return old;
      const titles = new Map<string, string>();
      const collect = (list: DataNode[]) => list.forEach((node) => { if (node.item) titles.set(node.item.key, node.item.title ?? ""); collect(node.children); });
      collect(nodes);
      let changed = false;
      const next = new Map(old);
      for (const [key, entry] of old) {
        const title = titles.get(key);
        const rejected = previous.get(key) === true && current.get(key) === false && title === entry.base;
        if (title !== entry.base || rejected) { next.delete(key); changed = true; }
      }
      return changed ? next : old;
    });
  }, [nodes]);
  const drag = useDataTreeDrag({
    enabled: block.on_move !== undefined && block.by !== "path",
    windowId: data.windowId,
    onMove: (event, item) => { void data.act(`${pointer}/on_move`, event, item); },
  });
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

  // 편집할 항목이 새로 나타나면 그 조상을 펼친다. 편집 도중에 사용자가 부모를 다시 접는 것은 막지 않는다.
  const editingKeys = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const current = new Set<string>();
    const visit = (list: DataNode[]) => list.forEach((node) => {
      if (node.item && isEditing(node.item, inline)) current.add(node.item.key);
      visit(node.children);
    });
    visit(nodes);
    const appeared = [...current].filter((key) => !editingKeys.current.has(key));
    editingKeys.current = current;
    if (!appeared.length) return;
    const path = new Set(appeared.flatMap((key) => ancestors(nodes, key) ?? []));
    if (!path.size) return;
    if (block.default_expanded) {
      setCollapsed((old) => {
        if (![...path].some((id) => old.has(id))) return old;
        const next = new Set(old);
        path.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }
    setExpanded((old) => {
      if ([...path].every((id) => old.has(id))) return old;
      const next = new Set(old);
      path.forEach((id) => next.add(id));
      return next;
    });
  }, [block.default_expanded, inline, nodes]);

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
    const item = row.node.data as TreeItem | undefined;
    // 확인 상자가 없는 행은 확인 모드에서도 확인 모드가 아닐 때처럼 접고 펼친다. 확인 상자가 있는 행은 고르기만 한다.
    if (row.hasChildren && (!block.on_check || row.node.checked === undefined)) toggle(row.id, !row.expanded);
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

  // on_move가 있는 트리는 항목이 없어도 빈 상태 자체를 놓을 자리로 받는다. 놓으면 트리 끝(end)과 같다.
  // empty_text가 있으면 빈 상태는 트리 행 하나 높이의 한 줄이고, 그 한 줄이 놓을 자리 표시를 받는다.
  const expandedOf = useCallback((id: string) => visibleExpanded.has(id), [visibleExpanded]);
  const emptyLine = emptyText === null ? undefined : <div
    className="ks-row ks-file-tree-row ks-tree-empty"
    data-drop-state={drag.targetId === "" ? drag.valid ? "valid" : "invalid" : undefined}
  >
    <span aria-hidden="true" className="ks-file-tree-icon" />
    {block.on_check !== undefined ? <span aria-hidden="true" className="ks-file-tree-icon" /> : null}
    {emptyText ? <span className="ks-view-meta">{emptyText}</span> : null}
  </div>;
  if (!nodes.length && !drag.enabled && emptyText === null) return <NoItems rootProps={blockRoot} />;
  return <><TreeEditExpansion.Provider value={expandedOf}><TreeView
    rootProps={blockRoot}
    className="ks-data-view ks-data-tree"
    drag={drag}
    emptyContent={nodes.length ? undefined : emptyLine ?? <NoItems />}
    emptyContentDropTarget={!nodes.length && emptyText !== null}
    expanded={visibleExpanded}
    label="트리"
    nodes={nodes}
    onActivate={activate}
    onCheck={block.on_check ? check : undefined}
    onExpandedChange={toggle}
    onFocusController={setFocusController}
    onContextMenu={(row, anchor, _point, _focus, event) => { if (row) { const item = row.node.data as TreeItem | undefined; menu.open(event, anchor, item as unknown as JsonValue | undefined, item?.key ?? row.id, "제목 복사", row.node.label); } }}
    selectedId={selected === null ? null : `item:${selected}`}
  /></TreeEditExpansion.Provider>{menu.dialog}</>;
}
