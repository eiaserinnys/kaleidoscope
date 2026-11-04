import { Button } from "../../components/primitives";
import { Select } from "../../components/select-toggle";
import { Eye, MessageSquare, MousePointer2, Redo2, Save, SlidersHorizontal, Undo2 } from "../../components/icons";
import type { useHtmlDocument } from "./controller";

type Model = ReturnType<typeof useHtmlDocument>;

export function HtmlHeader({ model }: { model: Model }) {
  const active = model.active;
  const revisions = model.docs.find((doc) => doc.name === active?.name)?.revisions ?? [];
  const comments = model.comments.filter((comment) => comment.status !== "resolved").length;
  const arrived = model.dirty && model.latest > (active?.rev ?? 0);
  return <header className="ks-file-tree-header ks-html-header">
    <div className="ks-data-segmented">
      <Button className="ks-html-icon" aria-label="보기" title="보기" aria-pressed={model.mode === "view"} onClick={() => model.setMode("view")}><Eye /></Button>
      <Button className="ks-html-icon" aria-label="고르기" title="고르기" aria-pressed={model.mode === "select"} onClick={() => model.setMode("select")}><MousePointer2 /></Button>
    </div>
    <div className="ks-html-header-group is-docs">
      <Select className="ks-html-doc" label="문서" placeholder="문서" disabled={model.locked || !active} groups={[{ options: model.docs.map((doc) => ({ value: doc.name, label: doc.name })) }]} value={active?.name} onChange={(value) => { const doc = model.docs.find((item) => item.name === value); if (doc) model.choose(doc.name, doc.revisions.at(-1)!); }} />
      <Select className="ks-html-rev" label="리비전" placeholder="리비전" disabled={model.locked || !active} groups={[{ options: [...revisions].reverse().map((rev) => ({ value: rev, label: `v${rev}`, description: [model.thread.revisions[rev]?.title, model.thread.revisions[rev]?.note].filter((value, index, all) => value && all.indexOf(value) === index).join(", ") || undefined })) }]} value={active?.rev} suffix={active && active.rev < model.latest && (!arrived || model.narrow) ? `/ ${model.latest}` : undefined} onChange={(value) => { if (active) model.choose(active.name, Number(value)); }} />
      {arrived && !model.narrow && active ? <Button className="ks-html-new-rev" disabled={model.locked} aria-label={`v${model.latest} 도착, 이동`} onClick={() => model.choose(active.name, model.latest)}>v{model.latest} 도착</Button> : null}
    </div>
    <div className="ks-data-segmented ks-html-header-edit">
      <Button className="ks-html-icon" aria-label="되돌리기" title="되돌리기 Ctrl+Z" disabled={model.locked || !model.undo.length} onClick={model.undoEdit}><Undo2 /></Button>
      <Button className="ks-html-icon" aria-label="다시 실행" title="다시 실행 Ctrl+Shift+Z" disabled={model.locked || !model.redo.length} onClick={model.redoEdit}><Redo2 /></Button>
    </div>
    {model.dirty ? <Button variant="emphasis" className="ks-html-save ks-html-header-save" aria-label={`변경 ${model.undo.length}건 새 리비전으로 저장`} disabled={model.saving} onClick={() => void model.saveRevision()}><span className="ks-html-save-label">저장 {model.undo.length}</span><span className="ks-html-save-icon"><Save /></span></Button> : null}
    {model.compact && model.mode === "select" ? <div className="ks-data-segmented ks-html-header-faces">
      <Button className="ks-html-face" aria-label={comments ? `커멘트 ${comments}건` : "커멘트"} title="커멘트" aria-pressed={model.face === "comments"} onClick={() => model.setFace(model.face === "comments" ? null : "comments")}><MessageSquare />{comments ? <span className="ks-html-face-count">{comments}</span> : null}</Button>
      <Button className="ks-html-face" aria-label="속성" title="속성" aria-pressed={model.face === "props"} onClick={() => model.setFace(model.face === "props" ? null : "props")}><SlidersHorizontal /></Button>
    </div> : null}
  </header>;
}
