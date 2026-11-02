import { memo, useCallback, useState } from "react";
import type { Block, DocumentRef } from "../../contract/contract";
import { Badge } from "../../components/badge";
import { Button, Notice, StatusText } from "../../components/primitives";
import { Select } from "../../components/select-toggle";
import { TextInput } from "../../components/text-input";
import { Dialog } from "../../components/dialog";
import { useShareDescriber } from "../../share/visible";
import type { BlockContext } from "../block-context";
import type { AnchorStatus } from "../html-bridge/frame-protocol";
import { useHtmlDocument } from "./controller";
import type { Comment, ThreadChange } from "./thread";

type HtmlBlock = Extract<Block, { type: "html_view" }> & { document: DocumentRef };
const labels = { needs_agent_review: "검토 요청", needs_user_reply: "답변 도착", resolved: "해결됨" } as const;

const CommentCard = memo(function CommentCard({ comment, index, status, selected, rev, saving, change, focus }: {
  comment: Comment; index: number; status: AnchorStatus | undefined; selected: ReturnType<typeof useHtmlDocument>["selection"]; rev: number; saving: boolean;
  change: (change: ThreadChange) => Promise<boolean>; focus: (id: string) => void;
}) {
  const [reply, setReply] = useState("");
  const submit = async (value: string) => {
    if (!value.trim()) return;
    if (await change({ kind: "reply", id: comment.id, reply: { id: `r-${crypto.randomUUID()}`, role: "user", rev, body: value.trim(), created_at: new Date().toISOString() } })) setReply("");
  };
  return <article className="ks-html-comment" data-status={comment.status} id={`ks-html-comment-${comment.id}`}>
    <button className="ks-html-comment-target" onClick={() => focus(comment.id)}><Badge value={String(index + 1)} /><Badge value={labels[comment.status]} />{status === "moved" ? <Badge value="옮겨 찾음" /> : null}<span>{comment.anchor.quote?.exact || comment.anchor.text || comment.anchor.label}</span></button>
    <p>{comment.comment}</p>
    {comment.replies.map((item) => <p key={item.id} className="ks-html-reply">{item.role === "agent" ? "에이전트" : "나"}: {item.body}</p>)}
    <TextInput aria-label={`답글 ${index + 1}`} placeholder="답글 입력" persistent commitOnBlur={false} syncWhileFocused cancelOnEscape value={reply} onEdit={setReply} onCommit={(value) => void submit(value)} onCancel={() => { setReply(""); return ""; }} />
    <div className="ks-html-actions">
      <Button disabled={saving || !reply.trim()} onClick={() => void submit(reply)}>답글</Button>
      <Button disabled={saving} onClick={() => void change({ kind: "status", id: comment.id, status: comment.status === "resolved" ? "needs_agent_review" : "resolved", resolved_rev: comment.status === "resolved" ? null : rev })}>{comment.status === "resolved" ? "다시 열기" : "해결"}</Button>
      {status === "orphan" ? <Button disabled={saving || !selected} onClick={() => { if (selected) void change({ kind: "anchor", id: comment.id, anchor: selected.anchor, anchor_rev: rev }); }}>여기로 옮기기</Button> : null}
      <Button disabled={saving} onClick={() => void change({ kind: "delete", id: comment.id })}>삭제</Button>
    </div>
  </article>;
});

function Rail({ model }: { model: ReturnType<typeof useHtmlDocument> }) {
  const [panel, setPanel] = useState("커멘트");
  const [filter, setFilter] = useState("미해결");
  const [body, setBody] = useState(""); const [note, setNote] = useState("");
  const focus = useCallback((id: string) => model.send({ type: "ks-html-focus-comment", id }), [model.send]);
  const submit = async (value: string) => { if (await model.addComment(value)) setBody(""); };
  const shown = model.comments.map((comment, index) => ({ comment, index })).filter(({ comment }) => filter === "전체" || (filter === "해결됨" ? comment.status === "resolved" : comment.status !== "resolved"));
  const orphaned = shown.filter(({ comment }) => model.results[comment.id] === "orphan" && comment.status !== "resolved");
  const rest = shown.filter((item) => !orphaned.includes(item));
  const card = ({ comment, index }: { comment: Comment; index: number }) => <CommentCard key={comment.id} comment={comment} index={index} status={model.results[comment.id]} selected={model.selection} rev={model.active!.rev} saving={model.saving} change={model.writeChange} focus={focus} />;
  const key = (value: string, options: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => model.keyAction({ type: "ks-html-key", key: value, ctrl: false, alt: false, shift: false, ...options });
  return <aside className="ks-html-rail">
    <Select segmented items={["커멘트", "요소 다듬기"]} value={panel} onChange={(value) => setPanel(String(value))} />
    {panel === "커멘트" ? <>
      {model.selection ? <div className="ks-html-compose"><span>{model.selection.anchor.quote?.exact || model.selection.anchor.text || model.selection.anchor.label}</span>
        <TextInput aria-label="커멘트" placeholder="커멘트 입력" persistent commitOnBlur={false} cancelOnEscape value={body} onEdit={setBody} onCommit={(value) => void submit(value)} onCancel={() => { setBody(""); return ""; }} />
        <div className="ks-html-actions"><Button disabled={model.saving || !body.trim()} onClick={() => void submit(body)}>등록</Button></div>
      </div> : null}
      <Select segmented items={["전체", "미해결", "해결됨"]} value={filter} onChange={(value) => setFilter(String(value))} />
      <Button disabled={!model.agentWindow || !model.comments.some((comment) => comment.status === "needs_agent_review")} onClick={() => void model.sendAgent()}>에이전트에게 보내기</Button>
      {orphaned.length ? <><StatusText>제자리 없음</StatusText>{orphaned.map(card)}</> : null}
      {rest.map(card)}
      {!shown.length ? <div className="ks-html-empty"><StatusText>커멘트가 없습니다</StatusText></div> : null}
    </> : <div className="ks-html-inspector">
      <div className="ks-html-actions"><Button disabled={!model.undo.length} onClick={model.undoEdit}>되돌리기</Button><Button disabled={!model.redo.length} onClick={model.redoEdit}>다시 실행</Button><Button disabled={!model.selection} onClick={() => key("d", { ctrl: true })}>복제</Button><Button disabled={!model.selection} onClick={() => key("Delete")}>삭제</Button></div>
      {model.selection ? <><code className="ks-html-selector">{model.selection.anchor.selector}</code>
      <div className="ks-html-actions"><Button onClick={() => key("ArrowUp", { alt: true })}>위로</Button><Button onClick={() => key("ArrowDown", { alt: true })}>아래로</Button></div>
      {([
        ["글꼴", "font-family"], ["글자 크기", "font-size"], ["글자 굵기", "font-weight"], ["줄 간격", "line-height"],
        ["글자 색", "color"], ["배경 색", "background-color"], ["안쪽 여백", "padding"], ["바깥 여백", "margin"],
        ["너비", "width"], ["높이", "height"], ["테두리", "border"], ["모서리", "border-radius"], ["그림자", "box-shadow"], ["투명도", "opacity"],
      ] as const).map(([name, prop]) => <label className="ks-html-field" key={prop}><span>{name}</span><TextInput aria-label={name} persistent value={model.selection!.styles[prop] ?? ""} onEdit={(value) => model.editStyle(prop, value)} /></label>)}
      </> : <div className="ks-html-empty"><StatusText>요소를 선택하세요</StatusText></div>}
      <label className="ks-html-field"><span>리비전 메모</span><TextInput aria-label="리비전 메모" persistent value={note} onEdit={setNote} /></label>
      <Button disabled={model.saving || !model.dirty} onClick={() => void model.saveRevision(note)}>새 리비전으로 저장</Button>
    </div>}
  </aside>;
}

export function HtmlDocumentViewBlock({ block, context }: { block: HtmlBlock; context: BlockContext }) {
  const model = useHtmlDocument(block, context);
  useShareDescriber(model.root, () => ({ text: model.share(true), visual: true }));
  const host = model.root.current?.closest<HTMLElement>(".ks-data-window");
  const cancelChange = useCallback(() => model.setPendingChange(null), [model.setPendingChange]);
  return <section className="ks-html-view" ref={model.root}>
    {!model.loaded ? <div className="ks-html-state"><StatusText>불러오는 중</StatusText></div> : !model.active ? <div className="ks-html-state">{model.error ? <Notice role="alert">{model.error}</Notice> : <StatusText>문서가 없습니다</StatusText>}</div> : <>
      <header className="ks-file-tree-header ks-html-header">
        <Select label="문서" items={model.docs.map((doc) => ({ value: doc.name, label: doc.name }))} value={model.active.name} onChange={(value) => { const doc = model.docs.find((item) => item.name === value); if (doc) model.choose(doc.name, doc.revisions.at(-1)!); }} />
        <Select label="리비전" items={(model.docs.find((doc) => doc.name === model.active?.name)?.revisions ?? []).map((rev) => ({ value: rev, label: `v${rev}${model.thread.revisions[rev]?.title ? ` ${model.thread.revisions[rev].title}` : ""}` }))} value={model.active.rev} onChange={(value) => model.choose(model.active!.name, Number(value))} />
        <Select segmented items={[{ value: "select", label: "고르기" }, { value: "view", label: "보기" }]} value={model.mode} onChange={(value) => model.setMode(value === "view" ? "view" : "select")} />
      </header>
      {model.error ? <div className="ks-html-notice"><Notice role="alert">{model.error}</Notice></div> : null}
      {model.dirty && model.latest > model.active.rev ? <div className="ks-html-notice"><StatusText>새 리비전 v{model.latest}이 도착했습니다</StatusText></div> : null}
      <div className="ks-html-content">
        {model.source ? <iframe ref={model.frame} title="HTML 보기" sandbox="allow-scripts" srcDoc={model.source} /> : <StatusText>불러오는 중</StatusText>}
        <Rail model={model} />
      </div>
      {model.pendingChange && host ? <Dialog host={host} title="저장하지 않은 수정이 있습니다" body="다른 문서나 리비전으로 이동하면 수정이 사라집니다." ok="이동" onCancel={cancelChange} onConfirm={model.confirmChange} /> : null}
    </>}
  </section>;
}
