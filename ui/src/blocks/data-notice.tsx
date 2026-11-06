import { useBlockRootProps } from "../comments/block-root";
import type { Block } from "../contract/contract";
import { BindingFailureNotice, DataState } from "../components/data-state";
import { Button, Notice } from "../components/primitives";
import { useBinding, useWindowData } from "../data/window-data";

interface Props { block: Extract<Block, { type: "notice" }>; pointer: string }

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function NoticeActionButton({ action, pointer, index }: { action: Extract<Block, { type: "notice" }>['actions'][number]; pointer: string; index: number }) {
  const data = useWindowData();
  const label = useBinding(`${pointer}/actions/${index}/label`, action.label);
  const text = label.status === "ready" ? display(label.value) : "";
  return <><Button disabled={label.status !== "ready"} onClick={() => { void data.act(`${pointer}/actions/${index}/on_click`, null); }}><span className="ks-truncate-label">{text}</span></Button><BindingFailureNotice value={label} /></>;
}

export function NoticeBlock({ block, pointer }: Props) {
  const blockRoot = useBlockRootProps();
  const message = useBinding(`${pointer}/message`, block.message);
  const errorId = useBinding(`${pointer}/error_id`, block.error_id ?? null);

  if (block.kind === "loading") return <div {...blockRoot} className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div>;
  if (message.status !== "ready") return <DataState rootProps={blockRoot} value={message} compact />;

  const id = errorId.status === "ready" && typeof errorId.value === "string" ? errorId.value : null;
  const actions = block.actions.map((action, index) => <NoticeActionButton key={index} action={action} pointer={pointer} index={index} />);
  return <Notice rootProps={blockRoot} role={block.kind === "error" ? "alert" : "status"} errorId={id} actions={actions.length ? actions : undefined}>{display(message.value)}</Notice>;
}
