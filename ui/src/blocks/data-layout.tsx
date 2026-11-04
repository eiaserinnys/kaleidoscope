import { memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { BindingFailureNotice, DataState, isMessageBindingFailure } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from "../components/icons";
import { ErrorId, IconButton } from "../components/primitives";
import { Menu } from "../components/menu";
import { MarkdownText } from "./markdown-text";
import { renderBlock } from "../render/render-block";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../data/window-state";
import { eventModifiers } from "../runtime/shortcuts";
import { formatClockTime, isClock, useClockPosition } from "../data/clock";
import { SplitPaneContext } from "./split-pane-context";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }

export function isMultilineInput(block: Extract<Block, { type: "input" }>): boolean {
  return Boolean(block.multiline || (block.rows ?? 0) >= 2);
}

function isFixedHeightControl(block: Block | undefined): boolean {
  if (!block) return false;
  if (block.type === "input") return !isMultilineInput(block);
  if (block.type === "when" || block.type === "anchor") return isFixedHeightControl(block.child);
  if (block.type === "stack") return block.place !== "center" && block.children.length > 0 && block.children.every(isFixedHeightControl);
  return ["button", "select", "toggle", "slider", "color", "toolbar"].includes(block.type);
}

function isFixedWidthControl(block: Block | undefined): boolean {
  if (!block) return false;
  if (block.type === "when" || block.type === "anchor") return isFixedWidthControl(block.child);
  if (block.type === "stack") return block.place !== "center" && block.children.length > 0 && block.children.every(isFixedWidthControl);
  return ["button", "toggle", "color"].includes(block.type);
}

export function StackBlock({ block, context, pointer }: Props<"stack">) {
  const last = block.children.length - 1;
  const fill = block.place === "center" ? [] : block.fill === undefined
    ? ((block.direction === "column" ? isFixedHeightControl(block.children[last]) : isFixedWidthControl(block.children[last])) ? [] : [last])
    : Array.isArray(block.fill) ? block.fill : [block.fill];
  const explicitFill = block.place !== "center" && block.fill !== undefined;
  const filled = new Set(fill);
  for (const index of fill) {
    let firstFill = index;
    let lastFill = index;
    const selected = block.children[index];
    if (!(explicitFill && selected?.type === "when" && (selected.min_width !== undefined || selected.max_width !== undefined))) continue;
    while (firstFill > 0) {
      const previous = block.children[firstFill - 1];
      if (previous.type !== "when" || (previous.min_width === undefined && previous.max_width === undefined)) break;
      firstFill -= 1;
      filled.add(firstFill);
    }
    while (lastFill < last) {
      const next = block.children[lastFill + 1];
      if (next.type !== "when" || (next.min_width === undefined && next.max_width === undefined)) break;
      lastFill += 1;
      filled.add(lastFill);
    }
  }
  const direction = block.place === "center" ? "column" : block.direction;
  const align = block.place === "center" || block.align === undefined ? "" : ` align-${block.align}`;
  return <div className={`ks-data-stack is-${direction} gap-${block.gap ?? "none"}${block.wrap && block.place !== "center" ? " is-wrap" : ""}${block.place === "center" ? " is-center" : ""}${explicitFill ? " has-explicit-fill" : ""}${Array.isArray(block.fill) && block.place !== "center" ? " has-fill-list" : ""}${align}`}>
    {block.children.map((child, index) => <div className={`ks-data-stack-item${filled.has(index) ? " is-fill" : ""}`} key={index}>{renderBlock(child, context, `${pointer}/children/${index}`)}</div>)}
  </div>;
}

export function TabsBlock({ block, context, pointer }: Props<"tabs">) {
  const pane = useContext(SplitPaneContext);
  const [local, setLocal] = useState(0);
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const id = useId();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  const [measure, setMeasure] = useState<{ width: number; widths: number[]; labels: string[]; gap: number; more: number } | null>(null);
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
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? block.tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + block.tabs.length) % block.tabs.length;
    pendingFocus.current = next;
    setFocused(next); select(next);
  };
  const collapsed = Boolean(block.collapsible && pane?.collapsed);
  const showHeader = block.header !== false && !collapsed;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !showHeader) return;
    const update = () => {
      const style = getComputedStyle(list);
      const width = list.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      const widths = refs.current.slice(0, block.tabs.length).map((tab) => {
        if (!tab) return 0;
        const label = tab.querySelector<HTMLElement>(".ks-truncate-label");
        const tabStyle = getComputedStyle(tab);
        const inset = parseFloat(tabStyle.paddingLeft) + parseFloat(tabStyle.paddingRight)
          + parseFloat(tabStyle.borderLeftWidth) + parseFloat(tabStyle.borderRightWidth);
        return Math.max(tab.getBoundingClientRect().width, (label?.scrollWidth ?? 0) + (inset || 0));
      });
      const labels = refs.current.slice(0, block.tabs.length).map((tab) => tab?.textContent ?? "");
      const next = { width, widths, labels, gap: parseFloat(style.columnGap) || 0, more: probeRef.current?.getBoundingClientRect().width ?? 0 };
      setMeasure((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(list);
    refs.current.slice(0, block.tabs.length).forEach((tab) => { if (tab) observer?.observe(tab); });
    const mutations = new MutationObserver(update);
    mutations.observe(list, { childList: true, characterData: true, subtree: true });
    update();
    return () => { observer?.disconnect(); mutations.disconnect(); };
  }, [showHeader, block.tabs.length]);
  const visible = new Set(block.tabs.map((_, n) => n));
  if (measure && measure.width > 0 && measure.widths.length === block.tabs.length) {
    const total = measure.widths.reduce((sum, width) => sum + width, 0) + measure.gap * (block.tabs.length - 1);
    if (total > measure.width) {
      visible.clear();
      let used = measure.more;
      for (let n = 0; n < block.tabs.length; n++) {
        if (used + measure.gap + measure.widths[n] > measure.width) break;
        visible.add(n); used += measure.gap + measure.widths[n];
      }
      if (!visible.has(index)) {
        while (visible.size && used + measure.gap + measure.widths[index] > measure.width) {
          const last = Math.max(...visible); visible.delete(last); used -= measure.widths[last] + measure.gap;
        }
        visible.add(index);
      }
    }
  }
  const overflow = block.tabs.map((_, n) => n).filter((n) => !visible.has(n));
  const constrained = Boolean(measure && overflow.length && measure.widths[index] + measure.gap + measure.more > measure.width);
  useLayoutEffect(() => {
    const next = pendingFocus.current;
    if (next === null || next !== index || !visible.has(next)) return;
    pendingFocus.current = null;
    refs.current[next]?.focus();
  });
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
      <div className="ks-data-tab-list" role="tablist" ref={listRef}>
        {block.tabs.map((tab, n) => <button className={`ks-button ks-button-default${n === index ? " is-selected" : ""}${n === index && constrained ? " is-constrained" : ""}${visible.has(n) ? "" : " is-overflow"}`} role="tab" id={`${id}-tab-${n}`} aria-controls={`${id}-panel-${n}`} aria-hidden={!visible.has(n) || undefined} aria-selected={n === index} tabIndex={n === (visible.has(focused) ? focused : index) ? 0 : -1} key={n} ref={(element) => { refs.current[n] = element; }} onFocus={() => setFocused(n)} onKeyDown={(event) => keyDown(event, n)} onClick={() => select(n)}>{n === index && constrained ? <span className="ks-truncate-label"><BoundTabLabel pointer={`${pointer}/tabs/${n}/label`} binding={tab.label} /></span> : <BoundTabLabel pointer={`${pointer}/tabs/${n}/label`} binding={tab.label} />}</button>)}
        <span className="ks-data-tab-more-probe" ref={probeRef} aria-hidden="true" />
        {overflow.length ? <IconButton aria-label="탭 더 보기" onClick={(event) => setMenuAnchor(event.currentTarget)}><DataIcon name="ellipsis" size="inline" /></IconButton> : null}
      </div>
      {menuAnchor && overflow.length ? <Menu anchor={menuAnchor} onClose={closeMenu} items={overflow.map((n) => ({ id: String(n), label: measure?.labels[n] ?? "", checked: n === index, onSelect: () => { pendingFocus.current = n; setFocused(n); select(n); } }))} /> : null}
      {block.collapsible && pane ? <span className="ks-file-tree-collapse"><IconButton aria-label="목록 접기" onClick={togglePane}><PanelLeftClose /></IconButton></span> : null}
    </div> : null}
    {block.tabs.map((_, tabIndex) => <DormantPointer
      dormant={collapsed || tabIndex !== index}
      key={tabIndex}
      pointer={`${pointer}/tabs/${tabIndex}`}
    />)}
    {block.tabs.map((tab, tabIndex) => {
      const selectedTab = tabIndex === index;
      if (!selectedTab && (!block.keep_mounted || !visited.has(tabIndex))) {
        return <div key={tabIndex} id={`${id}-panel-${tabIndex}`} aria-labelledby={showHeader ? `${id}-tab-${tabIndex}` : undefined} className="ks-data-tab-panel" hidden inert role="tabpanel" />;
      }
      return <BoundTabPanel key={tabIndex} id={`${id}-panel-${tabIndex}`} labelledBy={`${id}-tab-${tabIndex}`} pointer={`${pointer}/tabs/${tabIndex}/label`} binding={tab.label} showHeader={showHeader} selected={selectedTab} collapsed={collapsed}>{renderChild(tabIndex)}</BoundTabPanel>;
    })}
  </div>;
}

export function ToolbarBlock({ block, context, pointer }: Props<"toolbar">) {
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaX !== 0 || event.deltaY === 0) return;
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (maxScroll <= 0 || (event.deltaY > 0 ? track.scrollLeft >= maxScroll : track.scrollLeft <= 0)) return;
      event.preventDefault();
      track.scrollLeft += event.deltaY;
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, []);
  const children = (items: Block[], name: string) => items.map((child, index) => <div className={`ks-data-toolbar-item${child.type === "input" ? " is-input" : child.type === "text" ? " is-text" : ""}`} key={index}>{renderBlock(child, context, `${pointer}/${name}/${index}`)}</div>);
  const revealFocus = (event: FocusEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    if (!track.contains(event.target)) return;
    const bounds = track.getBoundingClientRect();
    const focused = event.target.getBoundingClientRect();
    const style = getComputedStyle(track);
    const left = bounds.left + parseFloat(style.scrollPaddingInlineStart);
    const right = bounds.right - parseFloat(style.scrollPaddingInlineEnd);
    if (focused.left < left) track.scrollLeft += focused.left - left;
    else if (focused.right > right) track.scrollLeft += focused.right - right;
  };
  return <div className="ks-data-toolbar" onFocus={revealFocus} ref={trackRef}><div className="ks-data-toolbar-group is-start">{children(block.start, "start")}</div><div className="ks-data-toolbar-group is-end">{children(block.end ?? [], "end")}</div></div>;
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
    <BindingFailureNotice value={title} />
    <DormantPointer dormant={collapsed} pointer={`${pointer}/child`} />
    {!collapsed ? <div className="ks-data-section-child">{renderBlock(block.child, context, `${pointer}/child`)}</div> : null}
  </section>;
}

export function display(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null"; }

function DormantPointer({ pointer, dormant }: { pointer: string; dormant: boolean }) {
  useDormant(pointer, dormant);
  return null;
}

function tabLabelText(value: ReturnType<typeof useBinding>): ReactNode {
  if (value.status === "ready") return value.value !== null && value.value !== undefined ? display(value.value) : "";
  if (isMessageBindingFailure(value)) return <span className="ks-inline-error" role="alert">{value.message} <ErrorId id={value.id} /></span>;
  return "";
}

const BoundTabLabel = memo(function BoundTabLabel({ pointer, binding }: {
  pointer: string;
  binding: Extract<Block, { type: "tabs" }>["tabs"][number]["label"];
}) {
  return <>{tabLabelText(useBinding(pointer, binding))}</>;
});

const BoundTabPanel = memo(function BoundTabPanel({ id, labelledBy, pointer, binding, showHeader, selected, collapsed, children }: {
  id: string;
  labelledBy: string;
  pointer: string;
  binding: Extract<Block, { type: "tabs" }>["tabs"][number]["label"];
  showHeader: boolean;
  selected: boolean;
  collapsed: boolean;
  children: ReactNode;
}) {
  const value = useBinding(pointer, binding);
  const label = value.status === "ready"
    ? value.value !== null && value.value !== undefined ? display(value.value) : ""
    : isMessageBindingFailure(value) ? value.message : "";
  return <div id={id} aria-labelledby={showHeader ? labelledBy : undefined} aria-label={showHeader ? undefined : label} className="ks-data-tab-panel" hidden={!selected || collapsed} inert={!selected || collapsed} role="tabpanel">{children}</div>;
});

export function TextBlock({ block, context, pointer }: Props<"text">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  if (value.status !== "ready") {
    if (isMessageBindingFailure(value)) return <div className="ks-data-text is-body ks-data-text-error" role="alert"><DataIcon name="triangle-alert" size="inline" /><span>{value.message} <ErrorId id={value.id} /></span></div>;
    return <DataState value={value} />;
  }
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
