import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
import { Check, Ellipsis, MessageSquare, RotateCcw } from "../../components/icons";
import { Menu } from "../../components/menu";
import { Button, EmptyState, IconButton, StatusText } from "../../components/primitives";
import type { AnchorStatus } from "../html-bridge/frame-protocol";
import type { useHtmlDocument } from "./controller";
import { Compose, Group, Target } from "./parts";
import { anchorRevisionFor, type Comment, type ThreadChange } from "./thread";

type Model = ReturnType<typeof useHtmlDocument>;

const CommentCard = memo(function CommentCard({ comment, index, status, active, selected, rev, dirty, saving, change, activate, deactivate, deleted }: {
  comment: Comment; index: number; status: AnchorStatus | undefined; active: boolean; selected: Model["selection"]; rev: number; dirty: boolean; saving: boolean;
  change: (value: ThreadChange) => Promise<boolean>; activate: (id: string) => void; deactivate: () => void; deleted: (id: string) => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const targetButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeCard = useCallback(() => { deactivate(); targetButton.current?.focus(); }, [deactivate]);
  const resolved = comment.status === "resolved";
  const label = comment.anchor.kind === "text" ? `“${comment.anchor.quote?.exact ?? comment.anchor.text}”` : comment.anchor.label;
  const target = `${status === "orphan" && comment.rev !== rev ? `v${comment.rev} ` : ""}${status === "moved" ? "옮겨 찾음, " : ""}${label}`;
  const last = comment.replies.at(-1);
  const reply = useCallback(async (body: string) => change({ kind: "reply", id: comment.id, reply: { id: `r-${crypto.randomUUID()}`, role: "user", rev, body: body.trim(), created_at: new Date().toISOString() } }), [change, comment.id, rev]);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <article className={`ks-html-comment${active ? " is-active" : ""}${resolved ? " is-resolved" : ""}`} id={`ks-html-comment-${comment.id}`} onClick={() => { if (!active) activate(comment.id); }} onKeyDown={(event) => { if (active && event.key === "Escape") { event.stopPropagation(); closeCard(); } }}>
    <span className={`ks-html-pin${status === "moved" ? " is-moved" : ""}${status === "orphan" ? " is-orphan" : ""}${resolved ? " is-resolved" : ""}`}>{index + 1}</span>
    <div className="ks-html-comment-head"><button ref={targetButton} type="button" className="ks-html-comment-target" onClick={(event) => { event.stopPropagation(); activate(comment.id); }}>{target}</button>
      {active ? <span className="ks-html-comment-tools" onClick={stop}>
        <IconButton aria-label={resolved ? "다시 열기" : "해결"} disabled={saving} onClick={() => void change({ kind: "status", id: comment.id, status: resolved ? "needs_agent_review" : "resolved", resolved_rev: resolved ? null : rev })}>{resolved ? <RotateCcw /> : <Check />}</IconButton>
        <IconButton aria-label="더 보기" onClick={(event) => setMenu(event.currentTarget)}><Ellipsis /></IconButton>
      </span> : comment.status === "needs_user_reply" ? <span className="ks-badge is-accent">답변 도착</span> : null}
    </div>
    <p className="ks-html-comment-text">{comment.comment}</p>
    {!active && last ? <span className="ks-html-comment-last">{last.role === "agent" ? "에이전트" : "나"}: {last.body}</span> : null}
    {active ? <>
      {comment.replies.map((item) => <div key={item.id} className="ks-html-reply"><span className="ks-html-reply-role">{item.role === "agent" ? "에이전트" : "나"}</span><p>{item.body}</p></div>)}
      {status === "orphan" ? <Button disabled={saving || !selected} onClick={(event) => { event.stopPropagation(); if (selected) void change({ kind: "anchor", id: comment.id, anchor: selected.anchor, anchor_rev: anchorRevisionFor(rev, dirty) }); }}>여기로 옮기기</Button> : null}
      <Compose label="답글" onSubmit={reply} onEscape={closeCard} />
    </> : null}
    {menu ? <Menu anchor={menu} onClose={closeMenu} items={[{ id: "delete", label: "삭제", danger: true, onSelect: () => { void change({ kind: "delete", id: comment.id }).then((ok) => { if (ok) deleted(comment.id); }); } }]} /> : null}
  </article>;
});

export function CommentFace({ model }: { model: Model }) {
  const [orphansOpen, setOrphansOpen] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const clear = useCallback(() => model.send({ type: "ks-html-select-number", n: null }), [model.send]);
  const deactivate = useCallback(() => model.setActiveComment(null), [model.setActiveComment]);
  const deleted = useCallback((id: string) => {
    const cards = [...(model.root.current?.querySelectorAll<HTMLElement>(".ks-html-comment") ?? [])];
    const index = cards.findIndex((item) => item.id === `ks-html-comment-${id}`);
    deactivate();
    requestAnimationFrame(() => {
      const remaining = [...(model.root.current?.querySelectorAll<HTMLElement>(".ks-html-comment") ?? [])];
      remaining[Math.min(index, remaining.length - 1)]?.querySelector<HTMLButtonElement>(".ks-html-comment-target")?.focus();
    });
  }, [deactivate, model.root]);
  const indexed = model.comments.map((comment, index) => ({ comment, index }));
  const orphans = indexed.filter(({ comment }) => comment.status !== "resolved" && model.results[comment.id] === "orphan");
  const unresolved = indexed.filter(({ comment }) => comment.status !== "resolved" && model.results[comment.id] !== "orphan");
  const resolved = indexed.filter(({ comment }) => comment.status === "resolved");
  const card = ({ comment, index }: { comment: Comment; index: number }) => <CommentCard key={comment.id} comment={comment} index={index} status={model.results[comment.id]} active={model.activeComment === comment.id} selected={model.selection} rev={model.active!.rev} dirty={model.dirty} saving={model.saving} change={model.writeChange} activate={model.openComment} deactivate={deactivate} deleted={deleted} />;
  return <>
    <div className="ks-html-rail-body">
      {model.selection ? <><Target selection={model.selection} choose={(n) => model.send({ type: "ks-html-select-number", n })} /><Compose label="커멘트" focus={model.selection.anchor.kind === "text"} onSubmit={model.addComment} onEscape={clear} /></> : null}
      {orphans.length ? <Group title="제자리 없음" count={orphans.length} open={orphansOpen} onToggle={() => setOrphansOpen((value) => !value)}>{orphans.map(card)}</Group> : null}
      {unresolved.length ? <div className="ks-html-group">{unresolved.map(card)}</div> : null}
      {resolved.length ? <Group title="해결됨" count={resolved.length} open={resolvedOpen} onToggle={() => setResolvedOpen((value) => !value)}>{resolved.map(card)}</Group> : null}
      {!model.comments.length && !model.selection ? <div className="ks-html-rail-empty"><EmptyState icon={<MessageSquare size="empty" />} text="요소나 글을 고르세요" /></div> : null}
    </div>
    {model.reviewComments.length ? <div className="ks-html-rail-foot"><Button disabled={!model.agentWindow || !model.hasUnsentReview || model.sending} onClick={() => void model.sendAgent()}>{model.sentReview ? <><Check size="inline" />보냈습니다</> : `에이전트에게 보내기 ${model.reviewComments.length}`}</Button>{!model.agentWindow ? <StatusText>대화 창이 없습니다</StatusText> : null}</div> : null}
  </>;
}
