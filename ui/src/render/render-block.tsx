import type { ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import { FileTreeBlock } from "../blocks/file-tree";
import { MarkdownEditorBlock } from "../blocks/markdown-editor";
import { MarkdownViewBlock } from "../blocks/markdown-view";
import { SplitBlock } from "../blocks/split";

export function renderBlock(block: Block, context: BlockContext): ReactNode {
  switch (block.type) {
    case "split":
      return <SplitBlock block={block} context={context} />;
    case "file_tree":
      return <FileTreeBlock block={block} context={context} />;
    case "markdown_editor":
      return <MarkdownEditorBlock block={block} context={context} />;
    case "markdown_view":
      return <MarkdownViewBlock block={block} context={context} />;
    default: {
      const unknown = block as unknown as { type?: unknown };
      return <div className="ks-unknown-block" role="alert">지원하지 않는 블록: {String(unknown.type)}</div>;
    }
  }
}
