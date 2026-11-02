import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block, DocumentRef } from "../../contract/contract";
import type { JsonValue } from "../../contract/serde_json/JsonValue";
import { useShellSelector } from "../../core/shell-store";
import { toCoreError } from "../../core/core-transport";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../../data/window-state";
import type { BlockContext } from "../block-context";
import { htmlViewSource, sanitizeFragment } from "../html-view-frame";
import { applyEdit, findNumber, invertEdit, numberElements, serializeOriginal, type HtmlEdit } from "../html-bridge/edit";
import type { AnchorStatus, FrameSelection, FrameToParent, ParentToFrame } from "../html-bridge/frame-protocol";
import { emptyThread, readThread, writeThreadChange } from "./storage";
import { anchorRevision, listRevisions, type Comment, type Thread, type ThreadChange } from "./thread";

type HtmlBlock = Extract<Block, { type: "html_view" }> & { document: DocumentRef };
const nOf = (element: Element | null) => element ? Number(element.getAttribute("data-ks-n")) || null : null;
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function useHtmlDocument(block: HtmlBlock, context: BlockContext) {
  const entry = block.document.entry; const windowId = context.window.id; const store = context.store;
  const visible = useWindowVisible(context);
  const docState = useWindowStateValue(context, block.selected_doc?.state ?? null);
  const revState = useWindowStateValue(context, block.selected_revision?.state ?? null);
  const [docs, setDocs] = useState<{ name: string; revisions: number[] }[]>([]);
  const [active, setActive] = useState<{ name: string; rev: number } | null>(null);
  const [thread, setThread] = useState<Thread>(emptyThread);
  const [source, setSource] = useState("");
  const [selection, setSelection] = useState<FrameSelection | null>(null);
  const [results, setResults] = useState<Record<string, AnchorStatus>>({});
  const [text, setText] = useState(""); const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false); const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"select" | "view">("select");
  const [undo, setUndo] = useState<HtmlEdit[]>([]); const [redo, setRedo] = useState<HtmlEdit[]>([]);
  const [pendingChange, setPendingChange] = useState<{ name: string; rev: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null); const root = useRef<HTMLElement>(null);
  const work = useRef<Document | null>(null); const cache = useRef(new Map<string, string>());
  const readSequence = useRef(0); const latestRef = useRef<{ name: string; rev: number } | null>(null);
  const selectors = useRef(new Map<number, string>()); const undoRef = useRef(undo); undoRef.current = undo;
  const pendingStyles = useRef(new Map<string, HtmlEdit>()); const editFrame = useRef(0);
  const activeRef = useRef(active); activeRef.current = active;
  const threadRef = useRef(thread); threadRef.current = thread;
  const dirty = undo.length > 0; const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const activeDoc = docs.find((item) => item.name === active?.name); const latest = activeDoc?.revisions.at(-1) ?? 0;
  const agentWindow = useShellSelector(store, (snapshot) => {
    if (!snapshot) return null;
    const workspace = snapshot.shared.desktops.find((desktop) => desktop.id === context.window.desktop_id)?.workspace_id;
    return snapshot.shared.windows.find((item) => {
      if (snapshot.shared.desktops.find((desktop) => desktop.id === item.desktop_id)?.workspace_id !== workspace) return false;
      return Boolean(snapshot.shared.app_versions.find((app) => app.app_id === item.app_id && app.version === item.app_version)?.definition.agent);
    })?.id ?? null;
  });
  const send = useCallback((message: ParentToFrame) => frame.current?.contentWindow?.postMessage(message, "*"), []);
  const patchState = useCallback((name: string, rev: number | null) => {
    const changes: Record<string, JsonValue> = {};
    if (block.on_select_doc) changes[block.on_select_doc.set_state] = name;
    if (block.on_select_revision) changes[block.on_select_revision.set_state] = rev;
    if (Object.keys(changes).length) void patchWindowState(context, changes).catch((reason) => setError(toCoreError(reason).message));
  }, [block.on_select_doc, block.on_select_revision, context.store, windowId]);
  const refreshList = useCallback(async () => {
    try {
      const reply = await store.call({ op: "storage.list", window_id: windowId, entry });
      if (reply.op === "storage.list") { setDocs(listRevisions(reply.result.items.map((item) => item.doc))); setError(null); }
    } catch (reason) { setError(toCoreError(reason).message); }
    finally { setLoaded(true); }
  }, [entry, store, windowId]);
  const refreshThread = useCallback(async (name: string) => {
    try { const result = await readThread(store, windowId, entry, name); if (activeRef.current?.name === name) setThread(result.thread); }
    catch (reason) { setError(toCoreError(reason).message); }
  }, [entry, store, windowId]);
  useEffect(() => { if (visible) { void refreshList(); if (activeRef.current) void refreshThread(activeRef.current.name); } }, [visible, refreshList, refreshThread]);
  useEffect(() => store.subscribeEvents((event) => {
    if (!visible || event.event !== "storage.update" || event.window_id !== windowId) return;
    if (event.update.kind === "snapshot") { void refreshList(); if (activeRef.current) void refreshThread(activeRef.current.name); return; }
    if (event.update.kind !== "changed" || event.update.changed.item.entry_id !== entry) return;
    const key = event.update.changed.item.key; const name = activeRef.current?.name;
    if (name && key.endsWith(`/${name}/thread.json`)) void refreshThread(name);
    else if (/\/r[1-9]\d*\.html$/.test(key)) void refreshList();
  }), [entry, refreshList, refreshThread, store, visible, windowId]);
  useEffect(() => {
    if (!docs.length) { setActive(null); return; }
    const preferred = docs.find((item) => item.name === docState) ?? docs[0];
    const newest = preferred.revisions.at(-1)!;
    const previous = latestRef.current;
    const current = activeRef.current;
    if (current && previous?.name === current.name && current.name === preferred.name && current.rev === previous.rev && newest > previous.rev && !dirtyRef.current && block.on_select_revision && revState != null) {
      patchState(preferred.name, null);
    }
    setActive((current) => {
      if (!current || current.name !== preferred.name) {
        const requested = Number(revState); return { name: preferred.name, rev: preferred.revisions.includes(requested) ? requested : newest };
      }
      if (previous?.name === current.name && current.rev === previous.rev && newest > previous.rev && !dirtyRef.current) return { ...current, rev: newest };
      return current;
    });
    latestRef.current = { name: preferred.name, rev: newest };
  }, [docs, docState, revState, block.on_select_revision, patchState]);
  useEffect(() => {
    const item = active; const sequence = ++readSequence.current;
    setSelection(null); setResults({}); setText(""); setUndo([]); setRedo([]); selectors.current.clear(); work.current = null; setSource("");
    if (!item) return;
    void refreshThread(item.name);
    const path = `${item.name}/r${item.rev}.html`;
    const load = async () => {
      try {
        let html = cache.current.get(path);
        if (html === undefined) {
          const reply = await store.call({ op: "storage.get", window_id: windowId, entry, doc: path });
          if (reply.op !== "storage.get" || typeof reply.result.content !== "string") throw new Error("HTML 리비전을 읽을 수 없습니다");
          html = reply.result.content; cache.current.set(path, html);
        }
        if (sequence !== readSequence.current) return;
        const doc = new DOMParser().parseFromString(html, "text/html"); numberElements(doc); work.current = doc;
        setSource(htmlViewSource(doc.documentElement.outerHTML)); setError(null);
      } catch (reason) { if (sequence === readSequence.current) setError(toCoreError(reason).message); }
    };
    void load(); return () => { readSequence.current++; };
  }, [active?.name, active?.rev, entry, refreshThread, store, windowId]);
  const comments = useMemo(() => active ? thread.comments.filter((comment) => comment.rev <= active.rev) : [], [thread, active]);
  const structuralEdits = undo.some((edit) => edit.kind === "insert" || edit.kind === "remove" || edit.kind === "move");
  const frameComments = useMemo(() => comments.map((comment, index) => ({ id: comment.id, anchor: comment.anchor, number: index + 1, sameRevision: anchorRevision(comment) === active?.rev && !structuralEdits })), [active?.rev, comments, structuralEdits]);
  useEffect(() => { send({ type: "ks-html-comments", comments: frameComments }); }, [frameComments, send]);
  useEffect(() => { send({ type: "ks-html-mode", mode }); }, [mode, send]);
  const writeChange = useCallback(async (change: ThreadChange) => {
    const current = activeRef.current; if (!current) return false;
    setSaving(true);
    try { const result = await writeThreadChange(store, windowId, entry, current.name, change); if (activeRef.current?.name === current.name) setThread(result); setError(null); return true; }
    catch (reason) { setError(toCoreError(reason).message); return false; }
    finally { setSaving(false); }
  }, [entry, store, windowId]);
  const flushEdits = useCallback(() => {
    if (editFrame.current) cancelAnimationFrame(editFrame.current);
    editFrame.current = 0;
    for (const edit of pendingStyles.current.values()) send({ type: "ks-html-edit", edit });
    pendingStyles.current.clear();
  }, [send]);
  useEffect(() => () => { if (editFrame.current) cancelAnimationFrame(editFrame.current); }, []);
  const sendEdit = useCallback((edit: HtmlEdit) => {
    if (edit.kind === "style") {
      pendingStyles.current.set(`${edit.n}:${edit.prop}`, edit);
      if (!editFrame.current) editFrame.current = requestAnimationFrame(flushEdits);
      return;
    }
    flushEdits();
    const safe = edit.kind === "insert" ? { ...edit, html: sanitizeFragment(edit.html) } : edit;
    send({ type: "ks-html-edit", edit: safe });
  }, [flushEdits, send]);
  const record = useCallback((edit: HtmlEdit) => {
    if (!work.current) return;
    applyEdit(work.current, edit); sendEdit(edit);
    setUndo((previous) => {
      const last = previous.at(-1);
      if (last && edit.kind === "style" && last.kind === "style" && last.n === edit.n && last.prop === edit.prop) return [...previous.slice(0, -1), { ...edit, before: last.before }];
      if (last && edit.kind === "text" && last.kind === "text" && last.n === edit.n) return [...previous.slice(0, -1), { ...edit, before: last.before }];
      return [...previous, edit];
    });
    setRedo([]);
  }, [sendEdit]);
  const undoEdit = useCallback(() => {
    const edit = undoRef.current.at(-1); if (!edit || !work.current) return;
    const inverse = invertEdit(edit); applyEdit(work.current, inverse); sendEdit(inverse);
    setUndo((items) => items.slice(0, -1)); setRedo((items) => [...items, edit]);
  }, [sendEdit]);
  const redoEdit = useCallback(() => {
    const edit = redo.at(-1); if (!edit || !work.current) return;
    applyEdit(work.current, edit); sendEdit(edit); setRedo((items) => items.slice(0, -1)); setUndo((items) => [...items, edit]);
  }, [redo, sendEdit]);
  const editStyle = useCallback((prop: string, value: string) => {
    const target = selection && work.current ? findNumber(work.current, selection.n) : null;
    if (!(target instanceof HTMLElement) || !selection) return;
    const before = target.style.getPropertyValue(prop); if (before === value) return;
    record({ kind: "style", n: selection.n, prop, before, after: value });
    setSelection((current) => current ? { ...current, styles: { ...current.styles, [prop]: value } } : null);
  }, [record, selection]);
  const keyAction = useCallback((data: Extract<FrameToParent, { type: "ks-html-key" }>) => {
    if (data.ctrl && data.key.toLowerCase() === "z") { data.shift ? redoEdit() : undoEdit(); return; }
    if (data.ctrl && data.key.toLowerCase() === "y") { redoEdit(); return; }
    if (data.key === "Escape") { send({ type: "ks-html-select-number", n: null }); return; }
    const doc = work.current; const target = selection && doc ? findNumber(doc, selection.n) : null;
    if (!doc || !target || !selection) return;
    let next: Element | null = null;
    if (data.key === "Enter") next = data.shift ? target.parentElement : target.firstElementChild;
    else if (data.key === "Tab") next = data.shift ? target.previousElementSibling : target.nextElementSibling;
    if (next) { send({ type: "ks-html-select-number", n: nOf(next) }); return; }
    const parent = target.parentElement; const parentN = nOf(parent); if (!parent || parentN === null) return;
    if (data.key === "Delete" || data.key === "Backspace") {
      record({ kind: "remove", n: selection.n, parent: parentN, next: nOf(target.nextElementSibling), html: target.outerHTML });
      send({ type: "ks-html-select-number", n: null });
    } else if (data.ctrl && data.key.toLowerCase() === "d") {
      const copy = target.cloneNode(true) as Element;
      let max = Math.max(...[...doc.querySelectorAll("[data-ks-n]")].map((el) => Number(el.getAttribute("data-ks-n"))));
      [copy, ...copy.querySelectorAll("*")].forEach((el) => el.setAttribute("data-ks-n", String(++max)));
      record({ kind: "insert", n: nOf(copy)!, parent: parentN, next: nOf(target.nextElementSibling), html: copy.outerHTML, source: selection.n });
    } else if (data.alt && (data.key === "ArrowUp" || data.key === "ArrowDown")) {
      const before = nOf(target.nextElementSibling);
      const after = data.key === "ArrowUp" ? nOf(target.previousElementSibling) : nOf(target.nextElementSibling?.nextElementSibling ?? null);
      if ((data.key === "ArrowUp" && !target.previousElementSibling) || (data.key === "ArrowDown" && !target.nextElementSibling)) return;
      record({ kind: "move", n: selection.n, parent: parentN, next_before: before, next_after: after });
    }
  }, [record, redoEdit, selection, send, undoEdit]);
  useEffect(() => {
    const receive = (event: MessageEvent<FrameToParent>) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data;
      if (data.type === "ks-html-ready") { send({ type: "ks-html-mode", mode }); send({ type: "ks-html-comments", comments: frameComments }); }
      else if (data.type === "ks-html-visible-text") setText(data.text);
      else if (data.type === "ks-html-select") { setSelection(data.selection); if (data.selection) selectors.current.set(data.selection.n, data.selection.anchor.selector); }
      else if (data.type === "ks-html-anchor-results") setResults(data.results);
      else if (data.type === "ks-html-select-comment") document.getElementById(`ks-html-comment-${data.id}`)?.scrollIntoView({ block: "nearest" });
      else if (data.type === "ks-html-key") keyAction(data);
      else if (data.type === "ks-html-text-edit") record({ kind: "text", n: data.n, before: data.before, after: data.after });
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [frameComments, keyAction, mode, record, send]);
  const addComment = useCallback(async (body: string) => {
    const current = activeRef.current; if (!current || !selection || !body.trim()) return false;
    const comment: Comment = { id: makeId("c"), rev: current.rev, anchor_rev: current.rev, status: "needs_agent_review", anchor: selection.anchor, comment: body.trim(), created_at: new Date().toISOString(), resolved_rev: null, replies: [] };
    return writeChange({ kind: "add", comment });
  }, [selection, writeChange]);
  const edits = useMemo(() => undo.map((edit) => {
    const selector = selectors.current.get(edit.kind === "insert" && edit.source ? edit.source : edit.n) ?? `[data-ks-n="${edit.n}"]`;
    if (edit.kind === "style") return { selector, prop: edit.prop, before: edit.before, after: edit.after };
    if (edit.kind === "text") return { selector, text: { before: edit.before, after: edit.after } };
    return { selector, dom: edit.kind === "insert" && edit.source ? "duplicate" : edit.kind };
  }), [undo]);
  const saveRevision = useCallback(async (note: string) => {
    const current = activeRef.current; const doc = work.current; if (!current || !doc || !latest) return;
    const rev = latest + 1; const html = serializeOriginal(doc); const path = `${current.name}/r${rev}.html`;
    setSaving(true);
    try {
      await store.call({ op: "storage.write", window_id: windowId, entry, doc: path, content: html, expected_revision: null });
      cache.current.set(path, html);
      await writeThreadChange(store, windowId, entry, current.name, { kind: "revision", rev, meta: { ...(note.trim() ? { title: note.trim(), note: note.trim() } : {}), author: "user", base_rev: current.rev, edits } });
      setUndo([]); setRedo([]); setActive({ name: current.name, rev }); patchState(current.name, rev); await refreshList(); await refreshThread(current.name); setError(null);
    } catch (reason) { setError(toCoreError(reason).message); }
    finally { setSaving(false); }
  }, [edits, entry, latest, patchState, refreshList, refreshThread, store, windowId]);
  const choose = useCallback((name: string, rev: number) => { if (activeRef.current?.name === name && activeRef.current.rev === rev) return; if (dirtyRef.current) { setPendingChange({ name, rev }); return; } setActive({ name, rev }); patchState(name, rev); }, [patchState]);
  const confirmChange = useCallback(() => { if (!pendingChange) return; setActive(pendingChange); patchState(pendingChange.name, pendingChange.rev); setPendingChange(null); }, [patchState, pendingChange]);
  const share = useCallback((includeText: boolean) => {
    if (!active) return `[${context.definition.name || "HTML 보기"}]`;
    const lines = [`[${context.definition.name || "HTML 보기"}: ${active.name} - v${active.rev}/${latest}]`, `저장: entry ${entry}, ${active.name}/r${active.rev}.html, ${active.name}/thread.json`];
    if (includeText && selection) lines.push(`고른 요소: ${selection.anchor.selector} "${selection.anchor.text}"`);
    if (includeText && edits.length) {
      lines.push(`저장 안 한 수정 ${edits.length}건:`);
      edits.forEach((edit) => {
        if ("prop" in edit) lines.push(`- ${edit.selector} ${edit.prop} ${edit.before} → ${edit.after}`);
        else if ("text" in edit && edit.text) lines.push(`- ${edit.selector} 문구 "${edit.text.before}" → "${edit.text.after}"`);
        else lines.push(`- ${edit.selector} ${edit.dom}`);
      });
    }
    const open = comments.map((comment, index) => ({ comment, index })).filter(({ comment }) => comment.status !== "resolved");
    if (open.length) { lines.push(`미해결 커멘트 ${open.length}건:`); open.forEach(({ comment, index }) => lines.push(`- ${comment.id} #${index + 1} [${comment.status === "needs_agent_review" ? "검토 요청" : "답변 도착"}] v${comment.rev}${anchorRevision(comment) !== comment.rev ? `, 앵커 v${anchorRevision(comment)}` : ""}, ${results[comment.id] === "orphan" ? "못 찾음" : "제자리"}: ${comment.anchor.label} "${comment.anchor.quote?.exact ?? comment.anchor.text}": ${comment.comment}`)); }
    if (includeText && text) lines.push(text);
    return lines.join("\n");
  }, [active, comments, context.definition.name, edits, entry, latest, results, selection, text]);
  const sendAgent = useCallback(async () => {
    if (!agentWindow) return;
    try { await store.call({ op: "conversation.send", window_id: agentWindow, request_id: crypto.randomUUID(), text: share(false), attachments: [] }); setError(null); }
    catch (reason) { setError(toCoreError(reason).message); }
  }, [agentWindow, share, store]);
  return { active, docs, latest, thread, comments, selection, results, source, error, loaded, saving, mode, setMode, frame, root, dirty, undo, redo, edits, pendingChange, setPendingChange, choose, confirmChange, keyAction, record, editStyle, undoEdit, redoEdit, addComment, writeChange, saveRevision, send, share, sendAgent, agentWindow };
}
