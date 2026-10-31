import type { ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import { FileTreeBlock } from "../blocks/file-tree";
import { MarkdownEditorBlock } from "../blocks/markdown-editor";
import { MarkdownViewBlock } from "../blocks/markdown-view";
import { SplitBlock } from "../blocks/split";
import { StackBlock, TabsBlock, ToolbarBlock, SectionBlock, TextBlock } from "../blocks/data-layout";
import { InputBlock, SelectBlock, ToggleBlock, ButtonBlock } from "../blocks/data-input";
import { ListBlock } from "../blocks/data-list";
import { TableBlock } from "../blocks/data-table";
import { PropertiesBlock } from "../blocks/data-properties";
import { TreeBlock } from "../blocks/data-tree";
import { FeedBlock } from "../blocks/data-feed";
import { AgentChatBlock } from "../blocks/agent-chat";
import { AgentSessionBlock } from "../blocks/agent-session";
import { WebViewBlock } from "../blocks/web-view";
import { ExplorerBlock } from "../blocks/explorer";
import { CodeEditorBlock } from "../blocks/code-editor";
import { CodeViewBlock } from "../blocks/code-view";
import { ImageBlock } from "../blocks/data-image";
import { MediaBlock } from "../blocks/data-media";

export function renderBlock(block: Block, context: BlockContext, pointer = "/ui"): ReactNode {
  switch (block.type) {
    case "split":
      return <SplitBlock block={block} context={context} pointer={pointer} />;
    case "file_tree":
      return <FileTreeBlock block={block} context={context} />;
    case "markdown_editor":
      return <MarkdownEditorBlock block={block} context={context} />;
    case "markdown_view":
      return <MarkdownViewBlock block={block} context={context} />;
    case "agent_chat":
      return <AgentChatBlock block={block} context={context} />;
    case "agent_session":
      return <AgentSessionBlock block={block} context={context} pointer={pointer} />;
    case "stack": return <StackBlock block={block} context={context} pointer={pointer} />;
    case "tabs": return <TabsBlock block={block} context={context} pointer={pointer} />;
    case "toolbar": return <ToolbarBlock block={block} context={context} pointer={pointer} />;
    case "section": return <SectionBlock block={block} context={context} pointer={pointer} />;
    case "list": return <ListBlock block={block} context={context} pointer={pointer} />;
    case "table": return <TableBlock block={block} context={context} pointer={pointer} />;
    case "properties": return <PropertiesBlock block={block} pointer={pointer} />;
    case "tree": return <TreeBlock block={block} context={context} pointer={pointer} />;
    case "feed": return <FeedBlock block={block} context={context} pointer={pointer} />;
    case "text": return <TextBlock block={block} context={context} pointer={pointer} />;
    case "input": return <InputBlock block={block} context={context} pointer={pointer} />;
    case "select": return <SelectBlock block={block} context={context} pointer={pointer} />;
    case "toggle": return <ToggleBlock block={block} context={context} pointer={pointer} />;
    case "button": return <ButtonBlock block={block} context={context} pointer={pointer} />;
    case "code_editor": return <CodeEditorBlock block={block} context={context} />;
    case "code_view": return <CodeViewBlock block={block} context={context} pointer={pointer} />;
    case "image": return <ImageBlock block={block} pointer={pointer} />;
    case "media": return <MediaBlock block={block} pointer={pointer} />;
    case "metrics":
    case "keypad":
    case "chart":
      return null;
    case "web_view":
      return <WebViewBlock block={block} context={context} />;
    case "explorer":
      return <ExplorerBlock block={block} context={context} />;
    default: {
      const unknown = block as unknown as { type?: unknown };
      return <div className="ks-unknown-block" role="alert">지원하지 않는 블록: {String(unknown.type)}</div>;
    }
  }
}
