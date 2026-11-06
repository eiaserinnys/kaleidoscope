import { useEffect, useRef, useState } from "react";
import type { AppCommentSummary, AppCommentThread, CoreError } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import { CommentCardBody } from "../components/comment-card";
import { Check, Ellipsis, RotateCcw } from "../components/icons";
import { Menu } from "../components/menu";
import { Dialog } from "../components/dialog";
import { IconButton } from "../components/primitives";
import { Compose, Group } from "../blocks/html-document/parts";
import { ImagePreview } from "../blocks/agent-attachments";
import { appCommentStore } from "./store";
import { sendCommentReply } from "./send";
import type { PositionStatus } from "./positions";

type CardProps = { item: AppCommentSummary; status?: PositionStatus; active: boolean; host: HTMLElement; store: ShellStore; windowId: string; open: () => void; close: () => void; error: (value: CoreError) => void };

export function CommentCard({ item, status, active, host, store, windowId, open, close, error }: CardProps) {
  const [thread, setThread] = useState<AppCommentThread>();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [image, setImage] = useState<string>();
  const [preview, setPreview] = useState<HTMLButtonElement | null>(null);
  const targetButton = useRef<HTMLButtonElement>(null);
  const replyInFlight = useRef(false);
  const data = appCommentStore(store, item.app_id);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void data.thread(item.id).then((value) => { if (live) setThread(value); }).catch((cause) => error(toCoreError(cause)));
    if (item.unread_reply) void store.call({ op: "comment.mark_read", app_id: item.app_id, id: item.id }).catch((cause) => error(toCoreError(cause)));
    if (status === "orphan" && item.image) void store.call({ op: "comment.image", app_id: item.app_id, id: item.id }).then((value) => { if (live) setImage(value.image.image_base64); }).catch((cause) => error(toCoreError(cause)));
    return () => { live = false; };
  }, [active, item.id, item.revision, item.unread_reply, item.image, item.app_id, status, data, store, error]);
  const change = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); return true; } catch (cause) { error(toCoreError(cause)); return false; } finally { setBusy(false); }
  };
  const reply = async (text: string) => {
    if (replyInFlight.current) return false;
    replyInFlight.current = true; setReplyBusy(true);
    try {
      const result = await store.call({ op: "comment.reply", app_id: item.app_id, id: item.id, request: { id: crypto.randomUUID(), text: text.trim() } });
      setThread((current) => current ? { ...current, replies: [...current.replies, result.reply] } : current);
      try { await sendCommentReply(store, windowId, item, text.trim()); } catch (cause) { error(toCoreError(cause)); }
      return true;
    } catch (cause) { error(toCoreError(cause)); return false; }
    finally { replyInFlight.current = false; setReplyBusy(false); }
  };
  const label = item.anchor.quote?.exact ? `“${item.anchor.quote.exact}”` : item.anchor.element?.description ?? item.anchor.normalized_type ?? "블록";
  const title = `${status === "orphan" ? `${item.created_app_version}판 ` : status === "moved" ? "옮겨 찾음, " : ""}${label}`;
  const away = status === "not_visible" || status === "orphan";
  const pinClass = item.resolved ? "is-resolved" : status === "orphan" ? "is-orphan" : item.sent_at ? "is-sent" : "is-draft";
  const last = item.last_reply ? { author: item.last_reply.author, text: item.last_reply.text } : undefined;
  const closeCard = () => { close(); requestAnimationFrame(() => targetButton.current?.focus({ preventScroll: true })); };
  return <CommentCardBody className="ks-comment-card" active={active} resolved={item.resolved} target={title} targetRef={targetButton} activate={open} unread={item.unread_reply} text={item.text} last={last}
    onKeyDown={(event) => { if (active && event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closeCard(); } }}
    pin={<span title={status === "not_visible" ? "지금 화면에 없음" : undefined} className={`ks-comment-pin is-rail ${pinClass}${away ? " is-away" : ""}`}>{item.number}{item.unread_reply ? <span className="ks-comment-pin-dot" /> : null}{status === "moved" ? <span className="ks-comment-pin-dot is-moved" /> : null}</span>}
    tools={<span className="ks-html-comment-tools" onClick={(event) => event.stopPropagation()}>
      <IconButton aria-label={item.resolved ? "다시 열기" : "해결"} disabled={busy} onClick={() => void change(() => store.call({ op: "comment.resolve", app_id: item.app_id, id: item.id, request: { resolved: !item.resolved } }))}>{item.resolved ? <RotateCcw /> : <Check />}</IconButton>
      <IconButton aria-label="더 보기" onClick={(event) => setMenu(event.currentTarget)}><Ellipsis /></IconButton>
    </span>}>
    {thread?.replies.map((entry) => <div key={entry.id} className="ks-html-reply"><span className="ks-html-reply-role">{entry.author === "agent" ? "에이전트" : "나"}</span><p>{entry.text}</p></div>)}
    {image ? <span className="ks-comment-thumb"><button type="button" onClick={(event) => setPreview(event.currentTarget)} aria-label="그때의 창 그림 크게 보기"><img src={`data:image/png;base64,${image}`} alt="그때의 창 그림" /></button></span> : null}
    {image && preview ? <ImagePreview preview={{ src: `data:image/png;base64,${image}`, name: "그때의 창 그림", trigger: preview }} onClose={() => setPreview(null)} /> : null}
    <Compose label="답글" disabled={replyBusy} initialValue={data.draft(item.id)} onDraftChange={(value) => data.setDraft(item.id, value)} onSubmit={reply} onEscape={closeCard} />
    {menu ? <Menu anchor={menu} onClose={() => setMenu(null)} items={[{ id: "delete", label: "삭제", danger: true, onSelect: () => setConfirm(true) }]} /> : null}
    {confirm ? <Dialog host={host} title={`커멘트 ${item.number}을 지울까요?`} ok="지우기" danger onCancel={() => setConfirm(false)} onConfirm={() => void change(async () => { await store.call({ op: "comment.delete", app_id: item.app_id, id: item.id }); setConfirm(false); close(); })} /> : null}
  </CommentCardBody>;
}

export function CommentCards({ items, statuses, activeId, setActive, host, store, windowId, onError, more, hasMore, loading }: { items: AppCommentSummary[]; statuses: Record<string, PositionStatus>; activeId: string | null; setActive: (id: string | null) => void; host: HTMLElement; store: ShellStore; windowId: string; onError: (error: CoreError) => void; more: () => void; hasMore: boolean; loading: boolean }) {
  const [orphanOpen, setOrphanOpen] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const hasUnreadResolved = items.some((item) => item.resolved && item.unread_reply);
  useEffect(() => { if (hasUnreadResolved) setResolvedOpen(true); }, [hasUnreadResolved]);
  const orphan = items.filter((item) => !item.resolved && statuses[item.id] === "orphan");
  const open = items.filter((item) => !item.resolved && statuses[item.id] !== "orphan");
  const resolved = items.filter((item) => item.resolved);
  const card = (item: AppCommentSummary) => <CommentCard key={item.id} item={item} status={statuses[item.id]} active={activeId === item.id} host={host} store={store} windowId={windowId} open={() => setActive(item.id)} close={() => setActive(null)} error={onError} />;
  return <div className="ks-html-rail-body" onScroll={(event) => { const el = event.currentTarget; if (hasMore && !loading && el.scrollHeight - el.scrollTop <= el.clientHeight + 1) more(); }}>
    {orphan.length ? <Group title="제자리 없음" count={orphan.length} open={orphanOpen} onToggle={() => setOrphanOpen(!orphanOpen)}>{orphan.map(card)}</Group> : null}
    {open.length ? <div className="ks-html-group">{open.map(card)}</div> : null}
    {resolved.length ? <Group title="해결됨" count={resolved.length} open={resolvedOpen} onToggle={() => setResolvedOpen(!resolvedOpen)}>{resolved.map(card)}</Group> : null}
    {loading ? <div className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div> : null}
  </div>;
}
