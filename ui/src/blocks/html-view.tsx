import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { Badge } from "../components/badge";
import { Button, Notice, StatusText } from "../components/primitives";
import { Select } from "../components/select-toggle";
import { TextInput } from "../components/text-input";
import { toCoreError } from "../core/core-transport";
import { useShareDescriber } from "../share/visible";
import type { BlockContext } from "./block-context";
import { htmlViewSource } from "./html-view-frame";
import { editedHtml, reportDocuments, shareHtmlReport, type HtmlElementSelection, type HtmlReportComment, type HtmlReportDocument, type HtmlReportRevision, type HtmlSelection } from "./html-view-model";

type HtmlViewData = Extract<Block, { type: "html_view" }>;
const label: Record<HtmlReportComment["status"], string> = { needs_agent_review: "검토 요청", needs_user_reply: "답변 도착", resolved: "해결됨" };
const makeId = () => crypto.randomUUID();

function Field({ name, value, onEdit, onBegin, onCancel }: { name: string; value: string; onEdit: (value: string) => void; onBegin?: () => void; onCancel?: () => void }) {
  const baseline = useRef(value);
  return <label className="ks-html-field"><span>{name}</span><TextInput aria-label={name} persistent value={value} onFocus={() => { baseline.current = value; onBegin?.(); }} onEdit={onEdit} onCommit={(next) => { baseline.current = next; onEdit(next); onBegin?.(); }} onCancel={() => { if (onCancel) onCancel(); else onEdit(baseline.current); }} /></label>;
}

export function HtmlViewBlock({ block, context }: { block: HtmlViewData; context: BlockContext }) {
  const [documents, setDocuments] = useState<HtmlReportDocument[]>([]);
  const [revisionToken, setRevisionToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<HtmlSelection | null>(null);
  const [element, setElement] = useState<HtmlElementSelection | null>(null);
  const [mode, setMode] = useState("코멘트");
  const [filter, setFilter] = useState("전체");
  const [commentText, setCommentText] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [visibleText, setVisibleText] = useState("");
  const [draftHtml, setDraftHtml] = useState("");
  const [frameRestore, setFrameRestore] = useState<{ html: string; sequence: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const root = useRef<HTMLElement>(null);
  const readSeq = useRef(0);
  const editSeq = useRef(0);
  const textBaseline = useRef<{ html: string; element: HtmlElementSelection } | null>(null);
  const previousLatest = useRef<{ id: string; rev: number } | null>(null);

  const read = useCallback(async () => {
    const seq = ++readSeq.current;
    try {
      const reply = await context.store.call({ op: "storage.get", window_id: context.window.id, entry: block.document.entry });
      if (reply.op === "storage.get" && seq === readSeq.current) {
        setDocuments(reportDocuments(reply.result.content)); setRevisionToken(reply.result.revision); setError(null);
      }
    } catch (reason) { if (seq === readSeq.current) setError(toCoreError(reason).message); }
    finally { if (seq === readSeq.current) setLoaded(true); }
  }, [context.store, context.window.id, block.document.entry]);

  useEffect(() => {
    void read();
    const unsubscribe = context.store.subscribeEvents((event) => {
      if (event.event === "storage.update" && event.window_id === context.window.id && (event.update.kind === "snapshot" || event.update.changed.item.entry_id === block.document.entry)) void read();
    });
    return () => { readSeq.current++; unsubscribe(); };
  }, [read, context.store, context.window.id, block.document.entry]);

  const state = context.window.state;
  const doc = documents.find((item) => item.id === (block.selected_doc ? state[block.selected_doc.state] : null)) ?? documents[0];
  const latest = doc?.revisions.reduce<HtmlReportRevision | undefined>((best, item) => !best || item.rev > best.rev ? item : best, undefined);
  const selectedValue = block.selected_revision ? state[block.selected_revision.state] : null;
  const revision = doc?.revisions.find((item) => selectedValue !== null && selectedValue !== undefined && String(item.rev) === String(selectedValue)) ?? latest;
  const comments = revision?.comments ?? [];
  const source = useMemo(() => revision ? htmlViewSource(frameRestore?.html ?? revision.html) : "", [revision?.html, frameRestore?.html]);

  const setWindowState = useCallback((changes: Record<string, JsonValue>) => {
    const current = context.store.getSnapshot()?.shared.windows.find((item) => item.id === context.window.id)?.state ?? context.window.state;
    void context.store.call({ op: "window.set_state", window_id: context.window.id, state: { ...current, ...changes } }).catch((reason) => setError(toCoreError(reason).message));
  }, [context.store, context.window]);

  useEffect(() => {
    if (!doc || !latest) return;
    const previous = previousLatest.current;
    if (previous?.id === doc.id && previous.rev !== latest.rev && String(selectedValue) === String(previous.rev) && block.on_select_revision) {
      setWindowState({ [block.on_select_revision.set_state]: null });
    }
    previousLatest.current = { id: doc.id, rev: latest.rev };
  }, [doc?.id, latest?.rev, selectedValue, block.on_select_revision, setWindowState]);

  useLayoutEffect(() => { setSelection(null); setElement(null); setVisibleText(""); setDraftHtml(revision?.html ?? ""); setFrameRestore(null); textBaseline.current = null; setNote(""); }, [doc?.id, revision?.rev, revision?.html]);
  const sendFrame = useCallback((message: object) => frame.current?.contentWindow?.postMessage(message, "*"), []);
  useEffect(() => { sendFrame({ type: "ks-html-comments", comments }); }, [comments, sendFrame]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data;
      if (data.type === "ks-html-ready") sendFrame({ type: "ks-html-comments", comments });
      if (data.type === "ks-html-visible-text" && typeof data.text === "string") setVisibleText(data.text);
      if (data.type === "ks-html-selection" && typeof data.selected_text === "string") setSelection(data);
      if (data.type === "ks-html-element-select" && typeof data.selector === "string" && typeof data.text === "string" && data.styles) { setElement(data); setSelection(data); }
      if (data.type === "ks-html-serialized" && data.sequence === editSeq.current && typeof data.html === "string") setDraftHtml(data.html);
      if (data.type === "ks-html-select-comment" && typeof data.id === "string") document.getElementById(`ks-html-comment-${data.id}`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [comments, sendFrame]);
  useShareDescriber(root, () => ({ text: doc && revision ? shareHtmlReport(doc, revision, selection, visibleText || new DOMParser().parseFromString(revision.html, "text/html").body.textContent || "") : "[시안과 리포트]", visual: true }));

  const save = async (next: HtmlReportDocument[]) => {
    setSaving(true);
    try {
      const reply = await context.store.call({ op: "storage.write", window_id: context.window.id, entry: block.document.entry, content: { documents: next } as unknown as JsonValue, expected_revision: revisionToken });
      if (reply.op === "storage.write") { setDocuments(next); setRevisionToken(reply.revision); setError(null); return true; }
    } catch (reason) { setError(toCoreError(reason).message); }
    finally { setSaving(false); }
    return false;
  };
  const updateComments = async (next: HtmlReportComment[]) => {
    if (!doc || !revision) return false;
    return save(documents.map((item) => item.id === doc.id ? { ...item, revisions: item.revisions.map((rev) => rev.rev === revision.rev ? { ...rev, comments: next } : rev) } : item));
  };
  const updateComment = (id: string, update: (value: HtmlReportComment) => HtmlReportComment) => updateComments(comments.map((item) => item.id === id ? update(item) : item));
  const addComment = async (textOverride?: string) => {
    const text = (textOverride ?? commentText).trim();
    if (saving || !selection || !text) return;
    if (await updateComments([...comments, { id: makeId(), selected_text: selection.selected_text, ...(selection.prefix ? { prefix: selection.prefix } : {}), ...(selection.suffix ? { suffix: selection.suffix } : {}), ...(selection.selector ? { selector: selection.selector } : {}), comment: text, status: "needs_agent_review", created_at: new Date().toISOString(), replies: [] }])) {
      setCommentText(""); setSelection(null);
    }
  };
  const submitReply = async (commentId: string, textOverride?: string) => {
    const body = (textOverride ?? replyText[commentId] ?? "").trim();
    if (saving || !body) return;
    if (await updateComment(commentId, (item) => ({ ...item, status: "needs_agent_review", replies: [...(item.replies ?? []), { id: makeId(), role: "user", body, created_at: new Date().toISOString() }] }))) {
      setReplyText((previous) => ({ ...previous, [commentId]: "" }));
    }
  };
  const editElement = (next: HtmlElementSelection) => {
    if (!element) return;
    const styles = Object.fromEntries(Object.entries(next.styles).filter(([key, value]) => value !== element.styles[key as keyof typeof element.styles]));
    setElement(next); setDraftHtml((current) => editedHtml(current, next, element));
    sendFrame({ type: "ks-html-apply-edit", sequence: ++editSeq.current, selector: next.selector, ...(next.text !== element.text ? { text: next.text } : {}), styles });
  };
  const beginTextEdit = () => { if (element) textBaseline.current = { html: draftHtml, element }; };
  const cancelTextEdit = () => {
    const baseline = textBaseline.current;
    if (!baseline) return;
    editSeq.current++;
    setElement(baseline.element);
    setDraftHtml(baseline.html);
    setFrameRestore((previous) => ({ html: baseline.html, sequence: (previous?.sequence ?? 0) + 1 }));
  };
  const saveRevision = async () => {
    if (!doc || !latest) return;
    const rev = latest.rev + 1;
    const next = { rev, html: draftHtml, title: note.trim() || `v${rev} 요소 다듬기`, ...(note.trim() ? { note: note.trim() } : {}), created_at: new Date().toISOString(), comments: [] };
    if (await save(documents.map((item) => item.id === doc.id ? { ...item, revisions: [...item.revisions, next] } : item))) {
      if (block.on_select_revision) setWindowState({ [block.on_select_revision.set_state]: rev });
    }
  };
  const shown = comments.map((comment, index) => ({ comment, index })).filter(({ comment }) => filter === "전체" || (filter === "해결됨" ? comment.status === "resolved" : comment.status !== "resolved"));

  return <section className="ks-html-view" ref={root}>
    {!loaded ? <div className="ks-html-state"><StatusText>불러오는 중</StatusText></div> : error && !doc ? <div className="ks-html-state"><Notice role="alert">{error}</Notice></div> : !doc || !revision ? <div className="ks-html-state"><StatusText>문서가 없습니다</StatusText></div> : <>
      <header className="ks-file-tree-header ks-html-header">
        <Select label="문서" items={documents.map((item) => ({ value: item.id, label: item.title }))} value={doc.id} onChange={(value) => { const changes: Record<string, JsonValue> = {}; if (block.on_select_doc) changes[block.on_select_doc.set_state] = value; if (block.on_select_revision) changes[block.on_select_revision.set_state] = null; setWindowState(changes); }} />
        <Select label="리비전" items={doc.revisions.map((item) => ({ value: item.rev, label: `v${item.rev}${item.title ? ` ${item.title}` : ""}` }))} value={revision.rev} onChange={(value) => { if (block.on_select_revision) setWindowState({ [block.on_select_revision.set_state]: value }); }} />
      </header>
      {error ? <div className="ks-html-notice"><Notice role="alert">{error}</Notice></div> : null}
      <div className="ks-html-content">
        <iframe key={frameRestore?.sequence ?? 0} ref={frame} title="HTML 보기" sandbox="allow-scripts" srcDoc={source} />
        <aside className="ks-html-rail">
          <Select segmented items={["코멘트", "요소 다듬기"]} value={mode} onChange={(value) => setMode(String(value))} />
          {mode === "코멘트" ? <>
            {selection ? <div className="ks-html-compose"><span>{selection.selected_text || selection.selector}</span><TextInput aria-label="코멘트" placeholder="코멘트 입력" persistent commitOnBlur={false} cancelOnEscape value={commentText} onEdit={setCommentText} onCommit={(value) => { setCommentText(value); void addComment(value); }} onCancel={() => { setCommentText(""); setSelection(null); }} /><div className="ks-html-actions"><Button disabled={saving || !commentText.trim()} onClick={() => void addComment()}>등록</Button><Button disabled={saving} onClick={() => { setCommentText(""); setSelection(null); }}>취소</Button></div></div> : null}
            <Select segmented items={["전체", "미해결", "해결됨"]} value={filter} onChange={(value) => setFilter(String(value))} />
            {shown.length === 0 ? <div className="ks-html-empty"><StatusText>코멘트가 없습니다</StatusText></div> : null}
            {shown.map(({ comment, index }) => <article className="ks-html-comment" data-status={comment.status} id={`ks-html-comment-${comment.id}`} key={comment.id} onClick={(event) => { if (!(event.target as HTMLElement).closest("button, input")) sendFrame({ type: "ks-html-focus-comment", id: comment.id, comments }); }}>
              <button className="ks-html-comment-target" onClick={() => sendFrame({ type: "ks-html-focus-comment", id: comment.id, comments })}><Badge value={String(index + 1)} /><Badge value={label[comment.status]} /><span>{comment.selected_text || comment.selector}</span></button>
              <p>{comment.comment}</p>
              {(comment.replies ?? []).map((reply) => <p key={reply.id} className="ks-html-reply">{reply.author ?? (reply.role === "agent" ? "에이전트" : "나")}: {reply.body}</p>)}
              <TextInput aria-label={`답글 ${index + 1}`} placeholder="답글 입력" persistent commitOnBlur={false} syncWhileFocused cancelOnEscape value={replyText[comment.id] ?? ""} onEdit={(value) => setReplyText((previous) => ({ ...previous, [comment.id]: value }))} onCommit={(value) => { setReplyText((previous) => ({ ...previous, [comment.id]: value })); void submitReply(comment.id, value); }} onCancel={() => { setReplyText((previous) => ({ ...previous, [comment.id]: "" })); return ""; }} />
              <div className="ks-html-actions"><Button disabled={saving || !replyText[comment.id]?.trim()} onClick={() => void submitReply(comment.id)}>답글</Button>
                <Button disabled={saving} onClick={() => updateComment(comment.id, (item) => ({ ...item, status: item.status === "resolved" ? "needs_agent_review" : "resolved" }))}>{comment.status === "resolved" ? "다시 열기" : "해결"}</Button>
                <Button disabled={saving} onClick={() => updateComments(comments.filter((item) => item.id !== comment.id))}>삭제</Button></div>
            </article>)}
          </> : element ? <div className="ks-html-inspector">
            <code className="ks-html-selector">{element.selector}</code>
            <Field name="문구" value={element.text} onEdit={(text) => editElement({ ...element, text })} onBegin={beginTextEdit} onCancel={cancelTextEdit} />
            {([ ["글자 색", "color"], ["배경 색", "backgroundColor"], ["안쪽 여백", "padding"], ["바깥 여백", "margin"] ] as const).map(([name, key]) => <Field key={key} name={name} value={element.styles[key]} onEdit={(value) => editElement({ ...element, styles: { ...element.styles, [key]: value } })} />)}
            <Field name="리비전 메모" value={note} onEdit={setNote} />
            <Button disabled={saving} onClick={() => void saveRevision()}>새 리비전으로 저장</Button>
          </div> : <div className="ks-html-empty"><StatusText>요소를 선택하세요</StatusText></div>}
        </aside>
      </div>
    </>}
  </section>;
}
