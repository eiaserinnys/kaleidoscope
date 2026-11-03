import { memo, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { DataState } from "../components/data-state";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { IconButton } from "../components/primitives";
import { MarkdownText } from "./markdown-text";
import { renderBlock } from "../render/render-block";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../data/window-state";
import { eventModifiers } from "../runtime/shortcuts";
import { formatClockTime, isClock, useClockPosition } from "../data/clock";
import { SplitPaneContext } from "./split-pane-context";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }

export function StackBlock({ block, context, pointer }: Props<"stack">) {
  const fill = block.place === "center" ? -1 : block.fill ?? block.children.length - 1;
  const direction = block.place === "center" ? "column" : block.direction;
  const align = block.place === "center" || block.align === undefined ? "" : ` align-${block.align}`;
  return <div className={`ks-data-stack is-${direction} gap-${block.gap ?? "none"}${block.wrap && block.place !== "center" ? " is-wrap" : ""}${block.place === "center" ? " is-center" : ""}${align}`}>
    {block.children.map((child, index) => <div className={`ks-data-stack-item${index === fill ? " is-fill" : ""}`} key={index}>{renderBlock(child, context, `${pointer}/children/${index}`)}</div>)}
  </div>;
}

export function TabsBlock({ block, context, pointer }: Props<"tabs">) {
  const pane = useContext(SplitPaneContext);
  const [local, setLocal] = useState(0);
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const restoreToggleFocus = useRef(false);
  const selected = useWindowStateValue(context, block.selected?.state ?? null);
  const value = block.selected ? selected : local;
  const index = typeof value === "number" && value >= 0 && value < block.tabs.length ? value : 0;
  const [visited, setVisited] = useState(() => new Set([index]));
  useEffect(() => {
    if (!block.keep_mounted) return;
    setVisited((previous) => previous.has(index) ? previous : new Set(previous).add(index));
  }, [block.keep_mounted, index]);
  const select = (next: number) => {
    if (!block.selected) setLocal(next);
    if (block.on_change) void patchWindowState(context, { [block.on_change.set_state]: next });
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (current + (event.key === "ArrowRight" ? 1 : -1) + block.tabs.length) % block.tabs.length;
    setFocused(next); refs.current[next]?.focus();
  };
  const collapsed = Boolean(block.collapsible && pane?.collapsed);
  const showHeader = block.header !== false && !collapsed;
  useLayoutEffect(() => {
    if (!restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    const selector = collapsed ? ".ks-file-tree-expand button" : ".ks-file-tree-collapse button";
    tabsRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
  }, [collapsed]);
  const togglePane = () => {
    restoreToggleFocus.current = true;
    pane?.toggle();
  };
  const renderChild = (tabIndex: number) => <SplitPaneContext.Provider value={block.collapsible ? null : pane}>
    {renderBlock(block.tabs[tabIndex].child, context, `${pointer}/tabs/${tabIndex}/child`)}
  </SplitPaneContext.Provider>;
  return <div className={`ks-data-tabs${collapsed ? " is-collapsed" : ""}`} ref={tabsRef}>
    {collapsed ? <span className="ks-file-tree-expand"><IconButton aria-label="목록 펼치기" onClick={togglePane}><PanelLeftOpen /></IconButton></span> : null}
    {showHeader ? <div className="ks-data-tab-header">
      <div className="ks-data-tab-list" role="tablist">
        {block.tabs.map((tab, n) => <button className={`ks-button ks-button-default${n === index ? " is-selected" : ""}`} role="tab" aria-selected={n === index} tabIndex={n === focused ? 0 : -1} key={n} ref={(element) => { refs.current[n] = element; }} onFocus={() => setFocused(n)} onKeyDown={(event) => keyDown(event, n)} onClick={() => select(n)}><BoundTabLabel pointer={`${pointer}/tabs/${n}/label`} binding={tab.label} /></button>)}
      </div>
      {block.collapsible && pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
    </div> : null}
    {block.tabs.map((_, tabIndex) => <DormantPointer
      dormant={collapsed || tabIndex !== index}
      key={tabIndex}
      pointer={`${pointer}/tabs/${tabIndex}`}
    />)}
    {block.keep_mounted ? block.tabs.map((tab, tabIndex) => {
      const selectedTab = tabIndex === index;
      if (!selectedTab && !visited.has(tabIndex)) return null;
      return <BoundTabPanel key={tabIndex} pointer={`${pointer}/tabs/${tabIndex}/label`} binding={tab.label} showHeader={showHeader} selected={selectedTab} collapsed={collapsed}>{renderChild(tabIndex)}</BoundTabPanel>;
    }) : <BoundTabPanel pointer={`${pointer}/tabs/${index}/label`} binding={block.tabs[index].label} showHeader={showHeader} selected={true} collapsed={collapsed}>{renderChild(index)}</BoundTabPanel>}
  </div>;
}

export function ToolbarBlock({ block, context, pointer }: Props<"toolbar">) {
  const children = (items: Block[], name: string) => items.map((child, index) => <div className={`ks-data-toolbar-item${child.type === "input" ? " is-input" : ""}`} key={index}>{renderBlock(child, context, `${pointer}/${name}/${index}`)}</div>);
  return <div className="ks-data-toolbar"><div className="ks-data-toolbar-group is-start">{children(block.start, "start")}</div><div className="ks-data-toolbar-group is-end">{children(block.end ?? [], "end")}</div></div>;
}

export function SectionBlock({ block, context, pointer }: Props<"section">) {
  const title = useBinding(`${pointer}/title`, block.title);
  const meta = useBinding(`${pointer}/meta`, block.meta ?? null);
  const [collapsed, setCollapsed] = useState(Boolean(block.collapsed));
  // 머리 전체가 접기 단추다(빈 곳을 눌러도 접힌다). 상태 단추(로그인, 다시 받기)는 단추 밖 형제로 둔다.
  const titleText = title.status === "ready" && title.value !== null ? <span className="ks-data-section-title">{display(title.value)}</span> : null;
  const metaText = block.meta !== undefined && meta.status === "ready" && meta.value !== null ? <span className="ks-data-section-meta">{display(meta.value)}</span> : null;
  const actions = block.actions?.map((action, index) => <div className="ks-data-section-action" key={index}>{renderBlock(action, context, `${pointer}/actions/${index}`)}</div>);
  return <section className="ks-data-section">
    <div className="ks-data-section-header">
      {block.collapsible
        ? <button className="ks-data-section-toggle" aria-expanded={!collapsed} aria-label={titleText === null ? collapsed ? "펼치기" : "접기" : undefined} onClick={() => setCollapsed(!collapsed)} type="button">
          {collapsed ? <ChevronRight size="inline" /> : <ChevronDown size="inline" />}
          <span className="ks-data-section-heading">{titleText}{metaText}</span>
        </button>
        : block.actions?.length ? <div className="ks-data-section-heading">{titleText}{metaText}</div> : <>{titleText}{metaText}</>}
      {actions?.length ? <div className="ks-data-section-actions">{actions}</div> : null}
    </div>
    <DormantPointer dormant={collapsed} pointer={`${pointer}/child`} />
    {!collapsed ? <div className="ks-data-section-child">{renderBlock(block.child, context, `${pointer}/child`)}</div> : null}
  </section>;
}

export function display(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null"; }

function DormantPointer({ pointer, dormant }: { pointer: string; dormant: boolean }) {
  useDormant(pointer, dormant);
  return null;
}

function tabLabelText(value: ReturnType<typeof useBinding>): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : "";
}

const BoundTabLabel = memo(function BoundTabLabel({ pointer, binding }: {
  pointer: string;
  binding: Extract<Block, { type: "tabs" }>["tabs"][number]["label"];
}) {
  return <>{tabLabelText(useBinding(pointer, binding))}</>;
});

const BoundTabPanel = memo(function BoundTabPanel({ pointer, binding, showHeader, selected, collapsed, children }: {
  pointer: string;
  binding: Extract<Block, { type: "tabs" }>["tabs"][number]["label"];
  showHeader: boolean;
  selected: boolean;
  collapsed: boolean;
  children: ReactNode;
}) {
  const label = tabLabelText(useBinding(pointer, binding));
  return <div aria-label={showHeader ? undefined : label} className="ks-data-tab-panel" hidden={!selected || collapsed} inert={!selected || collapsed} role="tabpanel">{children}</div>;
});

export function TextBlock({ block, context, pointer }: Props<"text">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  if (value.status !== "ready") return <DataState value={value} />;
  if (block.format === "time" && isClock(value.value)) return <ClockText block={block} context={context} pointer={pointer} clock={value.value} data={data} />;
  const text = block.format === "time" && typeof value.value === "number" ? formatClockTime(value.value) : display(value.value);
  return <TextValue block={block} pointer={pointer} text={text} data={data} />;
}

function ClockText({ block, context, pointer, clock, data }: {
  block: Extract<Block, { type: "text" }>;
  context: BlockContext;
  pointer: string;
  clock: import("../contract/contract").Clock;
  data: ReturnType<typeof useWindowData>;
}) {
  const visible = useWindowVisible(context);
  const time = useClockPosition(clock, visible);
  return <TextValue block={block} pointer={pointer} text={formatClockTime(time)} data={data} />;
}

function TextValue({ block, pointer, text, data }: {
  block: Extract<Block, { type: "text" }>;
  pointer: string;
  text: string;
  data: ReturnType<typeof useWindowData>;
}) {
  const interactive = Boolean(block.on_click || block.on_double_click);
  const keyboardPointer = block.on_click ? `${pointer}/on_click` : block.on_double_click ? `${pointer}/on_double_click` : null;
  const onClick = block.on_click ? (event: React.MouseEvent<HTMLElement>) => { void data.act(`${pointer}/on_click`, null, undefined, eventModifiers(event)); } : undefined;
  const onDoubleClick = block.on_double_click ? (event: React.MouseEvent<HTMLElement>) => { void data.act(`${pointer}/on_double_click`, null, undefined, eventModifiers(event)); } : undefined;
  const onKeyDown = keyboardPointer ? (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) void data.act(keyboardPointer, null, undefined, eventModifiers(event));
  } : undefined;
  const content = block.format === "markdown" ? <MarkdownText>{text}</MarkdownText> : text;
  return <div className={`ks-data-text is-${block.style ?? "body"}${interactive ? " is-interactive" : ""}`}
    role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined}
    onClick={onClick} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown}>{content}</div>;
}
