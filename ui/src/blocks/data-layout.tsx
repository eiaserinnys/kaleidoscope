import { useRef, useState, type KeyboardEvent } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant } from "../data/window-data";
import { DataState } from "../components/data-state";
import { ChevronDown, ChevronRight } from "../components/icons";
import { MarkdownText } from "./markdown-text";
import { renderBlock } from "../render/render-block";
import { patchWindowState, useWindowStateValue } from "../data/window-state";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }

export function StackBlock({ block, context, pointer }: Props<"stack">) {
  const fill = block.fill ?? block.children.length - 1;
  return <div className={`ks-data-stack is-${block.direction} gap-${block.gap ?? "none"}`}>
    {block.children.map((child, index) => <div className={`ks-data-stack-item${index === fill ? " is-fill" : ""}`} key={index}>{renderBlock(child, context, `${pointer}/children/${index}`)}</div>)}
  </div>;
}

export function TabsBlock({ block, context, pointer }: Props<"tabs">) {
  const [local, setLocal] = useState(0);
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = useWindowStateValue(context, block.selected?.state ?? null);
  const value = block.selected ? selected : local;
  const index = typeof value === "number" && value >= 0 && value < block.tabs.length ? value : 0;
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
  return <div className="ks-data-tabs"><div className="ks-data-tab-list" role="tablist">
    {block.tabs.map((tab, n) => <button className={`ks-button ks-button-default${n === index ? " is-selected" : ""}`} role="tab" aria-selected={n === index} tabIndex={n === focused ? 0 : -1} key={n} ref={(element) => { refs.current[n] = element; }} onFocus={() => setFocused(n)} onKeyDown={(event) => keyDown(event, n)} onClick={() => select(n)}>{tab.label}</button>)}
  </div>{block.tabs.map((_, tabIndex) => <DormantPointer
    dormant={tabIndex !== index}
    key={tabIndex}
    pointer={`${pointer}/tabs/${tabIndex}/child`}
  />)}<div className="ks-data-tab-panel" role="tabpanel">{renderBlock(block.tabs[index].child, context, `${pointer}/tabs/${index}/child`)}</div></div>;
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
  const titleText = title.status === "ready" ? <span className="ks-data-section-title">{display(title.value)}</span> : null;
  const titleState = title.status !== "ready" ? <DataState value={title} compact /> : null;
  const metaText = block.meta !== undefined && meta.status === "ready" ? <span className="ks-data-section-meta">{display(meta.value)}</span> : null;
  const metaState = block.meta !== undefined && meta.status !== "ready" ? <div className="ks-data-section-meta"><DataState value={meta} compact /></div> : null;
  return <section className="ks-data-section">
    <div className="ks-data-section-header">
      {block.collapsible
        ? <button className="ks-data-section-toggle" aria-expanded={!collapsed} aria-label={title.status === "ready" ? undefined : collapsed ? "펼치기" : "접기"} onClick={() => setCollapsed(!collapsed)} type="button">
          {collapsed ? <ChevronRight size="inline" /> : <ChevronDown size="inline" />}
          {titleText}
          {metaText}
        </button>
        : <>{titleText}{metaText}</>}
      {titleState}
      {metaState}
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

export function TextBlock({ block, pointer }: Props<"text">) {
  const value = useBinding(`${pointer}/value`, block.value);
  if (value.status !== "ready") return <DataState value={value} />;
  const text = display(value.value);
  return <div className={`ks-data-text is-${block.style ?? "body"}`}>{block.format === "markdown" ? <MarkdownText>{text}</MarkdownText> : text}</div>;
}
