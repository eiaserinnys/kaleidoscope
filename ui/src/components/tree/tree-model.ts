import type { ReactNode } from "react";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  after?: TreeNode;
  expandable?: boolean;
  selectable?: boolean;
  ariaSelectable?: boolean;
  checked?: boolean;
  leading?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  content?: ReactNode;
  interactiveContent?: boolean;
  revealOnInsert?: boolean;
  data?: unknown;
  currentOnSelection?: boolean;
  rowClassName?: string;
  // 깊이와 상관없이 행 전체 폭으로 그리는 안내 행(읽기 실패, 폴더 작업 안내). 들여쓰기를 받지 않는다.
  fullWidth?: boolean;
  commentKey?: import("../../contract/serde_json/JsonValue").JsonValue;
}

export interface TreeRowModel {
  id: string;
  node: TreeNode;
  parentId: string | null;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  position: number;
  setSize: number;
  indent?: string;
}

export function flattenTreeModel(nodes: TreeNode[], expanded: ReadonlySet<string>): TreeRowModel[] {
  const rows: TreeRowModel[] = [];
  const visit = (siblings: TreeNode[], parentId: string | null, depth: number) => {
    const treeSiblings = siblings.filter((node) => node.content === undefined);
    let position = 0;
    siblings.forEach((node) => {
      const children = node.children ?? [];
      const hasChildren = Boolean(node.expandable || children.length);
      const isExpanded = expanded.has(node.id);
      const treePosition = node.content === undefined ? ++position : 0;
      rows.push({
        id: node.id,
        node,
        parentId,
        depth,
        expanded: isExpanded,
        hasChildren,
        position: treePosition,
        setSize: treeSiblings.length,
        indent: depth && !node.fullWidth ? `calc(${Array.from({ length: depth }, () => "var(--ks-space-4)").join(" + ")})` : undefined,
      });
      if (node.after) visit([node.after], parentId, depth);
      if (isExpanded && children.length) visit(children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 0);
  return rows;
}
