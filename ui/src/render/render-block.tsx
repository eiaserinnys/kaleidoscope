import { Component, memo, type ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "../blocks/block-context";
import { FolderBlock } from "../blocks/folder";
import { MarkdownEditorBlock } from "../blocks/markdown-editor";
import { MarkdownViewBlock } from "../blocks/markdown-view";
import { HtmlViewBlock } from "../blocks/html-view";
import { SplitBlock } from "../blocks/split";
import { StackBlock, TabsBlock, ToolbarBlock, SectionBlock, TextBlock } from "../blocks/data-layout";
import { InputBlock, SelectBlock, ToggleBlock, ButtonBlock, SliderBlock, ColorBlock } from "../blocks/data-input";
import { ListBlock } from "../blocks/data-list";
import { TableBlock } from "../blocks/data-table";
import { PropertiesBlock } from "../blocks/data-properties";
import { NoticeBlock } from "../blocks/data-notice";
import { TreeBlock } from "../blocks/data-tree";
import type { DataTreeBlockData } from "../blocks/data-tree";
import { FeedBlock } from "../blocks/data-feed";
import { AgentChatBlock } from "../blocks/agent-chat";
import type { AgentChatBlockData } from "../blocks/agent-chat";
import { ClientChatBlock, type ClientChatBlockData } from "../blocks/client-chat";
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
import { ProgressBlock } from "../blocks/progress";
import { WhenBlock } from "../blocks/conditional";
import { DialogBlock } from "../blocks/dialog";
import { AnchorBlock } from "../blocks/anchor";
import { TourBlock } from "../blocks/tour";
import { RepeatBlock } from "../blocks/repeat";
import { BlockRenderContext, useBlockRenderProbe } from "./render-probe";
import { useItemScope } from "../data/item-scope";
import { Notice } from "../components/primitives";
import { SHELL_BLOCK_RENDER_FAILED } from "../contract/shell-errors";

export { renderProbe } from "./render-probe";

export function renderBlock(block: Block, context: BlockContext, pointer = "/ui"): ReactNode {
  return <BlockNode block={block} context={context} pointer={pointer} />;
}

const BlockNode = memo(function BlockNode({ block, context, pointer }: { block: Block; context: BlockContext; pointer: string }) {
  return <BlockBoundary block={block}><BlockNodeContent block={block} context={context} pointer={pointer} /></BlockBoundary>;
});

class BlockBoundary extends Component<{ block: Block; children: ReactNode }, { block: Block; error: unknown; failed: boolean }> {
  state = { block: this.props.block, error: null as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) { return { error, failed: true }; }
  static getDerivedStateFromProps(props: { block: Block }, state: { block: Block }) {
    return props.block !== state.block ? { block: props.block, error: null, failed: false } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const reason = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    const error = SHELL_BLOCK_RENDER_FAILED({ block: this.props.block.type, reason });
    return <Notice role="alert" errorId={error.id}>{error.message}</Notice>;
  }
}

function BlockNodeContent({ block, context, pointer }: { block: Block; context: BlockContext; pointer: string }) {
  const normalized = normalizeBlock(block);
  const scope = useItemScope();
  return <BlockRenderContext.Provider value={{ windowId: context.window.id, pointer, type: normalized.type, instance: scope?.instance }}>
    <BlockContent block={normalized} context={context} pointer={pointer} />
  </BlockRenderContext.Provider>;
}

function BlockContent({ block: normalized, context, pointer }: { block: Block; context: BlockContext; pointer: string }) {
  useBlockRenderProbe();
  switch (normalized.type) {
    case "repeat": return <RepeatBlock block={normalized} context={context} pointer={pointer} />;
    case "progress": return <ProgressBlock block={normalized} pointer={pointer} />;
    case "when": return <WhenBlock block={normalized} context={context} pointer={pointer} />;
    case "dialog": return <DialogBlock block={normalized} context={context} pointer={pointer} />;
    case "anchor": return <AnchorBlock block={normalized} context={context} pointer={pointer} />;
    case "tour": return <TourBlock block={normalized} context={context} pointer={pointer} />;
    case "canvas": return <CanvasBlock block={normalized} pointer={pointer} />;
    case "timeline": return <TimelineBlock block={normalized} pointer={pointer} context={context} />;
    case "split":
      return <SplitBlock block={normalized} context={context} pointer={pointer} />;
    case "tree":
      if (normalized.items !== undefined) return <TreeBlock block={normalized as DataTreeBlockData} context={context} pointer={pointer} />;
      return <div className="ks-unknown-block" role="alert">지원하지 않는 tree 블록 구성</div>;
    case "folder":
      return <FolderBlock block={normalized} context={context} pointer={pointer} />;
    case "markdown":
      return normalized.read_only || normalized.value !== undefined
        ? <MarkdownViewBlock block={normalized} context={context} pointer={pointer} />
        : <MarkdownEditorBlock block={normalized} context={context} />;
    case "html_view":
      return <HtmlViewBlock block={normalized} context={context} pointer={pointer} />;
    case "sandbox":
      return <SandboxBlock block={normalized} context={context} pointer={pointer} />;
    case "chat":
      return normalized.client
        ? <ClientChatBlock block={normalized as ClientChatBlockData} context={context} pointer={pointer} />
        : <AgentChatBlock block={normalized as AgentChatBlockData} context={context} />;
    case "stack": return <StackBlock block={normalized} context={context} pointer={pointer} />;
    case "tabs": return <TabsBlock block={normalized} context={context} pointer={pointer} />;
    case "toolbar": return <ToolbarBlock block={normalized} context={context} pointer={pointer} />;
    case "section": return <SectionBlock block={normalized} context={context} pointer={pointer} />;
    case "list": return <ListBlock block={normalized} context={context} pointer={pointer} />;
    case "table": return <TableBlock block={normalized} context={context} pointer={pointer} />;
    case "properties": return <PropertiesBlock block={normalized} pointer={pointer} />;
    case "notice": return <NoticeBlock block={normalized} pointer={pointer} />;
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
  if (type === "file_tree" || (type === "tree" && raw.root !== undefined)) return {
    type: "folder",
    root: raw.root as { permission: string },
    extensions: raw.extensions as string[],
    selected: raw.selected as Extract<Block, { type: "folder" }>["selected"],
    on_select: raw.on_select as Extract<Block, { type: "folder" }>["on_select"],
    read_only: true,
    legacyTreeRoot: true,
  } as unknown as Block;
  if (type === "markdown_editor") return { type: "markdown", file: raw.file as never, document: raw.document as never } as Block;
  if (type === "markdown_view") return { type: "markdown", file: raw.file as never, document: raw.document as never, value: raw.value as never, read_only: true } as Block;
  if (type === "code_editor") return { type: "code", file: raw.file as never, language: raw.language as never, wrap: raw.wrap as never } as Block;
  if (type === "code_view") return { type: "code", value: raw.value as never, file: raw.file as never, language: raw.language as never, read_only: true, follow: raw.follow as never, wrap: raw.wrap as never } as Block;
  if (type === "agent_chat") return { type: "chat" };
  if (type === "keypad") return { type: "button_grid", columns: raw.columns as number, buttons: raw.buttons as never, on_press: raw.on_press as never };
  return block;
}
