import type { ReactNode } from "react";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  expandable?: boolean;
  selectable?: boolean;
  ariaSelectable?: boolean;
  leading?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  content?: ReactNode;
  interactiveContent?: boolean;
  data?: unknown;
  currentOnSelection?: boolean;
  rowClassName?: string;
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
        indent: depth ? `calc(${Array.from({ length: depth }, () => "var(--ks-space-4)").join(" + ")})` : undefined,
      });
      if (isExpanded && children.length) visit(children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 0);
  return rows;
}
