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
    siblings.forEach((node, siblingIndex) => {
      const children = node.children ?? [];
      const hasChildren = Boolean(node.expandable || children.length);
      const isExpanded = expanded.has(node.id);
      rows.push({
        id: node.id,
        node,
        parentId,
        depth,
        expanded: isExpanded,
        hasChildren,
        position: siblingIndex + 1,
        setSize: siblings.length,
        indent: depth ? `calc(${Array.from({ length: depth }, () => "var(--ks-space-4)").join(" + ")})` : undefined,
      });
      if (isExpanded && children.length) visit(children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 0);
  return rows;
}
