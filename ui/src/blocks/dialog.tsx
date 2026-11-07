import { useBlockRootProps } from "../comments/block-root";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { Dialog } from "../components/dialog";
import { BindingFailureNotice } from "../components/data-state";
import { BUTTON_PROGRESS_DELAY_MS, BUTTON_PROGRESS_MIN_MS } from "./data-input";
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressShownAt = useRef<number | null>(null);
  const runId = useRef(0);
  const mounted = useRef(true);

  useDormant(childPointer, !isOpen);

  useLayoutEffect(() => {
    setHost(root.current?.closest<HTMLElement>(".ks-data-window") ?? null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (progressTimer.current) clearTimeout(progressTimer.current); };
  }, []);

  useLayoutEffect(() => {
    if (busy) progressShownAt.current = performance.now();
  }, [busy]);

  // 대화상자가 닫히면 진행 표시를 거둔다. 다음에 열 때 busy가 남아 있으면 안 된다.
  useEffect(() => {
    if (isOpen) return;
    runId.current += 1;
    if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null; }
    progressShownAt.current = null;
    busyRef.current = false;
    setBusy(false);
  }, [isOpen]);

  const close = useCallback(() => { void data.act(`${pointer}/on_close`, null); }, [data, pointer]);
  const confirm = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const id = ++runId.current;
    progressShownAt.current = null;
    // 지난 실패를 다시 보내는 것이면 결과를 기다리지 않고 바로 진행을 보인다. 처음 누름은 지금처럼 잠시 기다린다.
    if (data.hasActionFailure(`${pointer}/on_confirm`)) setBusy(true);
    else progressTimer.current = setTimeout(() => { progressTimer.current = null; setBusy(true); }, BUTTON_PROGRESS_DELAY_MS);
    void (async () => {
      try {
        await data.act(`${pointer}/on_confirm`, null);
      } finally {
        if (!mounted.current || runId.current !== id) return;
        if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null; }
        const finish = () => {
          progressTimer.current = null;
          busyRef.current = false;
          setBusy(false);
        };
        const remaining = progressShownAt.current === null ? 0 : BUTTON_PROGRESS_MIN_MS - (performance.now() - progressShownAt.current);
        if (remaining > 0) progressTimer.current = setTimeout(finish, remaining);
        else finish();
      }
    })();
  }, [data, pointer]);

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
      busy={busy}
    /> : null}
  </div>;
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function boundLabel(value: ReturnType<typeof useBinding>, fallback: string): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : fallback;
}
