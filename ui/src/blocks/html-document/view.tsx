import { useCallback, type KeyboardEvent } from "react";
import type { Block, DocumentRef } from "../../contract/contract";
import { Dialog } from "../../components/dialog";
import { FileCode } from "../../components/icons";
import { Button, EmptyState, Notice, StatusText } from "../../components/primitives";
import { useShareDescriber } from "../../share/visible";
import type { BlockContext } from "../block-context";
import { CommentFace } from "./comments";
import { useHtmlDocument } from "./controller";
import { HtmlHeader } from "./header";
import { PropertyFace } from "./properties";

type HtmlBlock = Extract<Block, { type: "html_view" }> & { document: DocumentRef };

export function HtmlDocumentViewBlock({ block, context }: { block: HtmlBlock; context: BlockContext }) {
  const model = useHtmlDocument(block, context);
  useShareDescriber(model.root, () => ({ text: model.share(true), visual: true }));
  const host = model.root.current?.closest<HTMLElement>(".ks-data-window");
  const cancelChange = useCallback(() => model.setPendingChange(null), [model.setPendingChange]);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    if (!event.ctrlKey) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? model.redoEdit() : model.undoEdit(); }
    else if (event.key.toLowerCase() === "y") { event.preventDefault(); model.redoEdit(); }
  };
  return <section className="ks-html-view" ref={model.root} onKeyDown={keyboard}>
    {!model.loaded ? <div className="ks-html-state"><StatusText>불러오는 중</StatusText></div> : !model.active ? <div className="ks-html-state">{model.error ? <Notice role="alert">{model.error}</Notice> : <EmptyState icon={<FileCode size="empty" />} text="문서가 없습니다" />}</div> : <>
      <HtmlHeader model={model} />
      {model.error ? <div className="ks-html-notice"><Notice role="alert" actions={model.saveFailed ? [<Button key="retry" onClick={() => void model.saveRevision()}>다시 시도</Button>] : undefined}>{model.error}{model.errorCode ? <> <StatusText>{model.errorCode}</StatusText></> : null}</Notice></div> : null}
      <div className="ks-html-content">
        {model.source ? <iframe ref={model.frame} title="HTML 보기" sandbox="allow-scripts" srcDoc={model.source} /> : <StatusText>불러오는 중</StatusText>}
        {model.face ? <aside className="ks-html-rail">{model.face === "comments" ? <CommentFace model={model} /> : <PropertyFace model={model} />}</aside> : null}
      </div>
      {model.pendingChange && host ? <Dialog host={host} title={`저장 안 한 변경 ${model.undo.length}건을 버릴까요?`} ok="버리기" danger onCancel={cancelChange} onConfirm={model.confirmChange} /> : null}
    </>}
  </section>;
}
