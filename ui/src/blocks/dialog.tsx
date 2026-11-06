import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { Dialog } from "../components/dialog";
import { BindingFailureNotice } from "../components/data-state";
import { renderBlock } from "../render/render-block";

export type DialogBlockData = Extract<Block, { type: "dialog" }>;

function hasPicker(block: Block): boolean {
  switch (block.type) {
    case "table": return true;
    case "list": return block.layout === "grid";
    case "stack": case "split": return block.children.some(hasPicker);
    case "tabs": return block.tabs.some((tab) => hasPicker(tab.child));
    case "toolbar": return [...block.start, ...(block.end ?? [])].some(hasPicker);
    case "section": return hasPicker(block.child) || (block.actions ?? []).some(hasPicker);
    case "when": case "anchor": return hasPicker(block.child);
    case "repeat": return hasPicker(block.template);
    case "chat": return block.footer ? hasPicker(block.footer) : false;
    case "button": return block.preview ? hasPicker(block.preview) : false;
    default: return false;
  }
}

export function DialogBlock({ block, context, pointer }: { block: DialogBlockData; context: BlockContext; pointer: string }) {
  const blockRoot = useBlockRootProps();
  const data = useWindowData();
  const open = useBinding(`${pointer}/open`, block.open);
  const title = useBinding(`${pointer}/title`, block.title);
  const closeLabel = useBinding(`${pointer}/close_label`, block.close_label ?? null);
  const cancelLabel = useBinding(`${pointer}/cancel_label`, block.cancel_label ?? null);
  const isOpen = open.status === "ready" && open.value === true;
  const titleText = title.status === "ready" && title.value !== null ? display(title.value) : "";
  const closeText = boundLabel(closeLabel, "닫기");
  const cancelText = boundLabel(cancelLabel, "취소");
  const root = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const childPointer = `${pointer}/child`;
  const hasConfirm = block.on_confirm !== undefined;

  useDormant(childPointer, !isOpen);

  useLayoutEffect(() => {
    setHost(root.current?.closest<HTMLElement>(".ks-data-window") ?? null);
  }, []);

  const close = useCallback(() => { void data.act(`${pointer}/on_close`, null); }, [data, pointer]);
  const confirm = useCallback(() => { void data.act(`${pointer}/on_confirm`, null); }, [data, pointer]);

  return <div ref={root} style={{ display: "contents" }}>
    {isOpen && host ? <Dialog
      rootProps={blockRoot}
      ownerAnchor={root.current}
      noticeSlotRef={data.setNoticeSlot}
      host={host}
      overlayClassName={hasPicker(block.child) ? "is-picker" : ""}
      title={titleText}
      body={<>{renderBlock(block.child, context, childPointer)}<BindingFailureNotice value={title} /><BindingFailureNotice value={closeLabel} /><BindingFailureNotice value={cancelLabel} /></>}
      ok={closeText}
      danger={block.danger}
      showCancel={hasConfirm}
      cancelLabel={cancelText}
      onCancel={close}
      onConfirm={hasConfirm ? confirm : close}
    /> : null}
  </div>;
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function boundLabel(value: ReturnType<typeof useBinding>, fallback: string): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : fallback;
}
