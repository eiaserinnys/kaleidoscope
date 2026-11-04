import { useCallback, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, DocumentRef } from "../../contract/contract";
import { Dialog } from "../../components/dialog";
import { FileCode } from "../../components/icons";
import { Button, EmptyState, Notice, StatusText } from "../../components/primitives";
import { useShareDescriber } from "../../share/visible";
import type { BlockContext } from "../block-context";
import { CommentFace } from "./comments";
import { useHtmlDocument } from "./controller";
import { HtmlHeader } from "./header";
import { DocumentLayout } from "./layout";
import { DIVIDER_WIDTH, DOCUMENT_MIN, SIDE_MIN } from "./metrics";
import { PropertyFace } from "./properties";

type HtmlBlock = Extract<Block, { type: "html_view" }> & { document: DocumentRef };

export function HtmlDocumentViewBlock({ block, context }: { block: HtmlBlock; context: BlockContext }) {
  const model = useHtmlDocument(block, context);
  useShareDescriber(model.root, () => ({ text: model.share(true), visual: true }));
  const host = model.root.current?.closest<HTMLElement>(".ks-data-window");
  const cancelChange = useCallback(() => model.setPendingChange(null), [model.setPendingChange]);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (model.locked) { event.preventDefault(); return; }
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    if (!event.ctrlKey) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? model.redoEdit() : model.undoEdit(); }
    else if (event.key.toLowerCase() === "y") { event.preventDefault(); model.redoEdit(); }
  };
  const focusSurface = (event: PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button, input, textarea, select, a, [role='button'], [contenteditable]")) return;
    if (target === event.currentTarget || target.closest(".ks-html-header, .ks-html-rail")) event.currentTarget.focus({ preventScroll: true });
  };
  const documentError = model.error && (model.errorSource === "load" || (model.errorSource === "list" && !model.active && model.docs.length === 0));
  const documentContent = model.source ? <iframe ref={model.frame} title="HTML 보기" sandbox="allow-scripts" srcDoc={model.source} />
    : documentError ? <Notice role="alert" errorId={model.error!.id} actions={[<Button key="retry" onClick={model.errorSource === "load" ? model.retryLoad : model.retryList}>다시 시도</Button>]}>{model.error!.message}</Notice>
    : model.loaded && !model.active && model.docs.length === 0 ? <EmptyState icon={<FileCode size="empty" />} text="문서가 없습니다" />
    : <StatusText>불러오는 중</StatusText>;
  const style = { "--ks-html-side-min": `${SIDE_MIN}px`, "--ks-html-document-min": `${DOCUMENT_MIN}px`, "--ks-html-divider-width": `${DIVIDER_WIDTH}px` } as CSSProperties;
  return <section className="ks-html-view" ref={model.root} style={style} tabIndex={-1} onKeyDown={keyboard} onPointerDown={focusSurface}>
    <HtmlHeader model={model} />
    {model.error && !documentError ? <div className="ks-html-notice"><Notice role="alert" errorId={model.error.id} actions={model.saveFailed ? [<Button key="retry" onClick={() => void model.saveRevision()}>다시 시도</Button>] : model.errorSource === "list" ? [<Button key="retry" onClick={model.retryList}>다시 시도</Button>] : undefined}>{model.error.message}</Notice></div> : null}
    <DocumentLayout selecting={model.mode === "select"} compact={model.compact} face={model.face} locked={model.locked}
      left={model.active ? <PropertyFace model={model} /> : null}
      right={model.active ? <CommentFace model={model} /> : null}
      document={documentContent} />
    {model.pendingChange && host ? <Dialog host={host} title={`저장 안 한 변경 ${model.undo.length}건을 버릴까요?`} ok="버리기" danger onCancel={cancelChange} onConfirm={model.confirmChange} /> : null}
  </section>;
}
