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
  /// 줄 앞의 그림. 트리에 하나라도 있으면 모든 줄이 펼침 화살표 열 다음에 같은 크기의 그림 열을 두고, 없는 줄은 그 자리를 비운다.
  leadingImage?: ReactNode;
  /// 제목 아래의 작은 보조색 한 줄. 있으면 그 줄은 두 줄 높이가 된다.
  subtitle?: ReactNode;
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

/** 들여쓰기 한 단. 트리 뿌리가 `--ks-tree-indent`를 두면 그 값, 없으면 --ks-space-4다. */
export const TREE_INDENT_STEP = "var(--ks-tree-indent, var(--ks-space-4))";
/** 큰 그림 트리(subtitle이 있는 그림 트리)의 한 단: 그림 열 폭(--ks-control-height) + 열 사이 간격(.ks-row gap, --ks-space-2).
 *  자식 줄 그림의 왼쪽 끝이 부모 줄 제목 시작과 같아진다. */
export const LARGE_IMAGE_TREE_INDENT_STEP = "calc(var(--ks-control-height) + var(--ks-space-2))";

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

/** 접힌 자식과 `after` 줄까지 포함한 트리 전체에 조건을 만족하는 항목이 있는지 본다. */
export function treeHasNode(nodes: readonly TreeNode[], predicate: (node: TreeNode) => boolean): boolean {
  return nodes.some((node) => predicate(node)
    || (node.after !== undefined && treeHasNode([node.after], predicate))
    || (node.children !== undefined && treeHasNode(node.children, predicate)));
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
        indent: depth && !node.fullWidth ? `calc(${depth} * ${TREE_INDENT_STEP})` : undefined,
      });
      if (node.after) visit([node.after], parentId, depth);
      if (isExpanded && children.length) visit(children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 0);
  return rows;
}
