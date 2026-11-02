import type { ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import { FileTreeBlock } from "../blocks/file-tree";
import type { FileTreeBlockData } from "../blocks/file-tree";
import { MarkdownEditorBlock } from "../blocks/markdown-editor";
import { MarkdownViewBlock } from "../blocks/markdown-view";
import { HtmlViewBlock } from "../blocks/html-view";
import { SplitBlock } from "../blocks/split";
import { StackBlock, TabsBlock, ToolbarBlock, SectionBlock, TextBlock } from "../blocks/data-layout";
import { InputBlock, SelectBlock, ToggleBlock, ButtonBlock, SliderBlock, ColorBlock } from "../blocks/data-input";
import { ListBlock } from "../blocks/data-list";
import { TableBlock } from "../blocks/data-table";
import { PropertiesBlock } from "../blocks/data-properties";
import { TreeBlock } from "../blocks/data-tree";
import type { DataTreeBlockData } from "../blocks/data-tree";
import { FeedBlock } from "../blocks/data-feed";
import { AgentChatBlock } from "../blocks/agent-chat";
import type { AgentChatBlockData } from "../blocks/agent-chat";
import { AgentSessionBlock } from "../blocks/agent-session";
import type { AgentSessionBlockData } from "../blocks/agent-session";
import { WebViewBlock } from "../blocks/web-view";
import { ExplorerBlock } from "../blocks/explorer";
import { CodeEditorBlock } from "../blocks/code-editor";
import type { CodeEditorBlockData } from "../blocks/code-editor";
import { CodeViewBlock } from "../blocks/code-view";
import type { CodeViewBlockData } from "../blocks/code-view";
import { ImageBlock } from "../blocks/data-image";
import { MediaBlock } from "../blocks/data-media";
import { MetricsBlock } from "../blocks/data-metrics";
import { DataKeypadBlock } from "../blocks/data-keypad";
import { ChartBlock } from "../blocks/data-chart";
import { MapBlock } from "../blocks/data-map";
import { SandboxBlock } from "../blocks/sandbox";
import { CanvasBlock } from "../blocks/canvas";
import { TimelineBlock } from "../blocks/timeline";

export function renderBlock(block: Block, context: BlockContext, pointer = "/ui"): ReactNode {
  const normalized = normalizeBlock(block);
  switch (normalized.type) {
    case "canvas": return <CanvasBlock block={normalized} pointer={pointer} />;
    case "timeline": return <TimelineBlock block={normalized} pointer={pointer} />;
    case "split":
      return <SplitBlock block={normalized} context={context} pointer={pointer} />;
    case "tree":
      if (normalized.root) return <FileTreeBlock block={normalized as FileTreeBlockData} context={context} />;
      if (normalized.items !== undefined) return <TreeBlock block={normalized as DataTreeBlockData} context={context} pointer={pointer} />;
      return <div className="ks-unknown-block" role="alert">지원하지 않는 tree 블록 구성</div>;
    case "markdown":
      return normalized.read_only || normalized.value !== undefined
        ? <MarkdownViewBlock block={normalized} context={context} pointer={pointer} />
        : <MarkdownEditorBlock block={normalized} context={context} />;
    case "html_view":
      return <HtmlViewBlock block={normalized} context={context} pointer={pointer} />;
    case "sandbox":
      return <SandboxBlock block={normalized} context={context} pointer={pointer} />;
    case "chat":
      return normalized.permission !== undefined || normalized.root !== undefined || normalized.agents !== undefined || normalized.selected !== undefined || normalized.on_select !== undefined
        ? <AgentSessionBlock block={normalized as AgentSessionBlockData} context={context} pointer={pointer} />
        : <AgentChatBlock block={normalized as AgentChatBlockData} context={context} />;
    case "stack": return <StackBlock block={normalized} context={context} pointer={pointer} />;
    case "tabs": return <TabsBlock block={normalized} context={context} pointer={pointer} />;
    case "toolbar": return <ToolbarBlock block={normalized} context={context} pointer={pointer} />;
    case "section": return <SectionBlock block={normalized} context={context} pointer={pointer} />;
    case "list": return <ListBlock block={normalized} context={context} pointer={pointer} />;
    case "table": return <TableBlock block={normalized} context={context} pointer={pointer} />;
    case "properties": return <PropertiesBlock block={normalized} pointer={pointer} />;
    case "feed": return <FeedBlock block={normalized} context={context} pointer={pointer} />;
    case "text": return <TextBlock block={normalized} context={context} pointer={pointer} />;
    case "input": return <InputBlock block={normalized} context={context} pointer={pointer} />;
    case "slider": return <SliderBlock block={normalized} context={context} pointer={pointer} />;
    case "color": return <ColorBlock block={normalized} context={context} pointer={pointer} />;
    case "select": return <SelectBlock block={normalized} context={context} pointer={pointer} />;
    case "toggle": return <ToggleBlock block={normalized} context={context} pointer={pointer} />;
    case "button": return <ButtonBlock block={normalized} context={context} pointer={pointer} />;
    case "code": return normalized.read_only || normalized.value !== undefined
      ? <CodeViewBlock block={normalized as CodeViewBlockData} context={context} pointer={pointer} />
      : <CodeEditorBlock block={normalized as CodeEditorBlockData} context={context} />;
    case "image": return <ImageBlock block={normalized} pointer={pointer} />;
    case "media": return <MediaBlock block={normalized} pointer={pointer} />;
    case "metrics": return <MetricsBlock block={normalized} pointer={pointer} />;
    case "button_grid": return <DataKeypadBlock block={normalized} context={context} pointer={pointer} />;
    case "chart": return <ChartBlock block={normalized} pointer={pointer} />;
    case "map": return <MapBlock block={normalized} context={context} pointer={pointer} />;
    case "web_view":
      return <WebViewBlock block={normalized} context={context} />;
    case "explorer":
      return <ExplorerBlock block={normalized} context={context} />;
    default: {
      const unknown = normalized as unknown as { type?: unknown };
      return <div className="ks-unknown-block" role="alert">지원하지 않는 블록: {String(unknown.type)}</div>;
    }
  }
}

export function normalizeBlock(block: Block): Block {
  const raw = block as unknown as Record<string, unknown>;
  const type = raw.type;
  if (type === "interactive_html") return { ...raw, type: "sandbox" } as Block;
  if (type === "textarea") return { ...raw, type: "input", multiline: true } as Block;
  if (type === "file_tree") return {
    type: "tree", root: raw.root as Extract<Block, { type: "tree" }>["root"], extensions: raw.extensions as string[],
    by: "children", selected: raw.selected as Extract<Block, { type: "tree" }>["selected"],
    on_select: { set_state: (raw.on_select as { set_state: string }).set_state },
  } as Block;
  if (type === "markdown_editor") return { type: "markdown", file: raw.file as never, document: raw.document as never } as Block;
  if (type === "markdown_view") return { type: "markdown", file: raw.file as never, document: raw.document as never, value: raw.value as never, read_only: true } as Block;
  if (type === "code_editor") return { type: "code", file: raw.file as never, language: raw.language as never, wrap: raw.wrap as never } as Block;
  if (type === "code_view") return { type: "code", value: raw.value as never, file: raw.file as never, language: raw.language as never, read_only: true, follow: raw.follow as never, wrap: raw.wrap as never } as Block;
  if (type === "agent_chat") return { type: "chat" };
  if (type === "agent_session") return {
    type: "chat", permission: raw.permission as string, root: raw.root as never, agents: raw.agents as never,
    selected: raw.selected as never, on_select: raw.on_select as never,
  } as Block;
  if (type === "keypad") return { type: "button_grid", columns: raw.columns as number, buttons: raw.buttons as never, on_press: raw.on_press as never };
  return block;
}
