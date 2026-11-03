import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { BlockContext } from "./block-context";
import { useBinding, useDormant, useWindowData } from "../data/window-data";
import { Dialog } from "../components/dialog";
import { renderBlock } from "../render/render-block";

export type DialogBlockData = Extract<Block, { type: "dialog" }>;

export function DialogBlock({ block, context, pointer }: { block: DialogBlockData; context: BlockContext; pointer: string }) {
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
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const childPointer = `${pointer}/child`;

  useDormant(childPointer, !isOpen);

  useLayoutEffect(() => {
    setHost(root.current?.closest<HTMLElement>(".ks-data-window") ?? null);
  }, []);

  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      const windowHost = root.current?.closest<HTMLElement>(".ks-data-window");
      if (!(target instanceof HTMLElement) || !windowHost?.contains(target) || target.closest(".ks-dialog")) return;
      opener.current = target;
    };
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    opener.current?.focus();
  }, [isOpen]);

  const close = useCallback(() => { void data.act(`${pointer}/on_close`, null); }, [data, pointer]);

  return <div ref={root} style={{ display: "contents" }}>
    {isOpen && host ? <Dialog
      host={host}
      title={titleText}
      body={renderBlock(block.child, context, childPointer)}
      ok={closeText}
      cancelLabel={cancelText}
      onCancel={close}
      onConfirm={close}
    /> : null}
  </div>;
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function boundLabel(value: ReturnType<typeof useBinding>, fallback: string): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : fallback;
}
