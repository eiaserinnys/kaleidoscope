import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block, CoreError, DocumentRef } from "../../contract/contract";
import type { JsonValue } from "../../contract/serde_json/JsonValue";
import { useShellSelector } from "../../core/shell-store";
import { openFrameContextMenu } from "../../components/context-menu";
import { toCoreError } from "../../core/core-transport";
import { patchWindowState, useWindowStateValue, useWindowVisible } from "../../data/window-state";
import type { BlockContext } from "../block-context";
import { htmlViewSource, htmlViewTokens, sanitizeFragment, useHtmlFramePoint } from "../html-view-frame";
import { applyEdit, findNumber, invertEdit, numberElements, serializeOriginal, type HtmlEdit } from "../html-bridge/edit";
import type { AnchorStatus, FrameSelection, FrameToParent, ParentToFrame } from "../html-bridge/frame-protocol";
import { emptyThread, readThread, writeThreadChange } from "./storage";
import { THREE_COLUMN_MIN } from "./metrics";
import * as shellErrors from "../../contract/shell-errors";
import { anchorRevision, anchorRevisionFor, listRevisions, type Comment, type Thread, type ThreadChange } from "./thread";

type HtmlBlock = Extract<Block, { type: "html_view" }> & { document: DocumentRef };
type PendingRevision = { name: string; rev: number; change: Extract<ThreadChange, { kind: "revision" }> };
type DisplayError = { value: CoreError; source: "state" | "list" | "thread" | "load" | "write" | "save" | "send" };
export type HtmlFace = "comments" | "props" | null;
const nOf = (element: Element | null) => element ? Number(element.getAttribute("data-ks-n")) || null : null;
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const reviewSignature = (comment: Comment) => comment.replies.at(-1)?.id ?? "";

export function useHtmlDocument(block: HtmlBlock, context: BlockContext) {
  const entry = block.document.entry; const windowId = context.window.id; const store = context.store;
  const visible = useWindowVisible(context);
  const docState = useWindowStateValue(context, block.selected_doc?.state ?? null);
  const revState = useWindowStateValue(context, block.selected_revision?.state ?? null);
  const [docs, setDocs] = useState<{ name: string; revisions: number[] }[]>([]);
  const [storageReadRetry, setStorageReadRetry] = useState(0);
  const [active, setActive] = useState<{ name: string; rev: number } | null>(null);
  const [thread, setThread] = useState<Thread>(emptyThread);
  const [source, setSource] = useState("");
  const [selection, setSelection] = useState<FrameSelection | null>(null);
  const [results, setResults] = useState<Record<string, AnchorStatus>>({});
  const [text, setText] = useState(""); const [failure, setFailure] = useState<DisplayError | null>(null);
  const [loaded, setLoaded] = useState(false); const [saving, setSaving] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<PendingRevision | null>(null);
  const [sending, setSending] = useState(false);
  const [sentReviews, setSentReviews] = useState<Record<string, Record<string, string>>>({});
  const [mode, setMode] = useState<"select" | "view">("view");
  const [narrow, setNarrow] = useState(false);
  const [compact, setCompact] = useState(false);
  const [wideFace, setWideFace] = useState<HtmlFace>("comments");
  const [narrowFace, setNarrowFace] = useState<HtmlFace>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [propertyGroups, setPropertyGroups] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<HtmlEdit[][]>([]); const [redo, setRedo] = useState<HtmlEdit[][]>([]);
  const [pendingChange, setPendingChange] = useState<{ name: string; rev: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null); const root = useRef<HTMLElement>(null);
  useHtmlFramePoint(frame, source || null);
  const work = useRef<Document | null>(null); const cache = useRef(new Map<string, string>());
  const readSequence = useRef(0); const latestRef = useRef<{ name: string; rev: number } | null>(null);
  const selectors = useRef(new Map<number, string>()); const undoRef = useRef(undo); undoRef.current = undo;
  const pendingStyles = useRef(new Map<string, HtmlEdit>()); const editFrame = useRef(0);
  const activeRef = useRef(active); activeRef.current = active;
  const threadRef = useRef(thread); threadRef.current = thread;
  const dirty = undo.length > 0; const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const savingRevisionRef = useRef(false);
  const pendingRevisionRef = useRef<PendingRevision | null>(null);
  const locked = savingRevision || pendingRevision !== null;
  const lockedRef = useRef(locked); lockedRef.current = locked;
  const activeDoc = docs.find((item) => item.name === active?.name); const latest = activeDoc?.revisions.at(-1) ?? 0;
  const face = narrow ? narrowFace : wideFace;
  const setFace = useCallback((next: HtmlFace) => { if (narrow) setNarrowFace(next); else setWideFace(next); }, [narrow]);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([item]) => { if (item.contentRect.width > 0) { setNarrow(item.contentRect.width <= 560); setCompact(item.contentRect.width < THREE_COLUMN_MIN); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const agentWindow = useShellSelector(store, (snapshot) => {
    if (!snapshot) return null;
    const workspace = snapshot.shared.desktops.find((desktop) => desktop.id === context.window.desktop_id)?.workspace_id;
    return snapshot.shared.windows.filter((item) => {
      if (snapshot.shared.desktops.find((desktop) => desktop.id === item.desktop_id)?.workspace_id !== workspace) return false;
      return Boolean(snapshot.shared.app_versions.find((app) => app.app_id === item.app_id && app.version === item.app_version)?.definition.agent);
    }).sort((left, right) => Number(right.desktop_id === context.window.desktop_id) - Number(left.desktop_id === context.window.desktop_id) || right.z - left.z)[0]?.id ?? null;
  });
  const linkTarget = useShellSelector(store, (snapshot) => snapshot?.link.state === "connected"
    ? `${snapshot.link.mode}:${snapshot.link.server_url}`
    : null);
  const previousLinkTarget = useRef(linkTarget);
  const send = useCallback((message: ParentToFrame) => frame.current?.contentWindow?.postMessage(message, "*"), []);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    let scheduled = 0;
    const update = () => { if (scheduled) cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => send({ type: "ks-html-theme", tokens: htmlViewTokens() })); };
    media.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); if (scheduled) cancelAnimationFrame(scheduled); };
  }, [send]);
  const patchState = useCallback((name: string, rev: number | null) => {
    const changes: Record<string, JsonValue> = {};
    if (block.on_select_doc) changes[block.on_select_doc.set_state] = name;
    if (block.on_select_revision) changes[block.on_select_revision.set_state] = rev;
    if (Object.keys(changes).length) void patchWindowState(context, changes).catch((reason) => setFailure({ value: toCoreError(reason), source: "state" }));
  }, [block.on_select_doc, block.on_select_revision, context.store, windowId]);
  const refreshList = useCallback(async () => {
    try {
      const reply = await store.call({ op: "storage.list", window_id: windowId, entry });
      if (reply.op === "storage.list") { setDocs(listRevisions(reply.result.items.map((item) => item.doc))); setFailure((previous) => previous?.source === "list" ? null : previous); }
    } catch (reason) { setFailure({ value: toCoreError(reason), source: "list" }); }
    finally { setLoaded(true); }
  }, [entry, store, windowId]);
  const retryList = useCallback(() => { setFailure(null); setLoaded(false); void refreshList(); }, [refreshList]);
  const refreshThread = useCallback(async (name: string) => {
    try {
      const result = await readThread(store, windowId, entry, name);
      if (activeRef.current?.name === name) { setThread(result.thread); setFailure((previous) => previous?.source === "thread" || previous?.source === "write" ? null : previous); }
    } catch (reason) {
      if (activeRef.current?.name === name) setFailure({ value: toCoreError(reason), source: "thread" });
    }
  }, [entry, store, windowId]);
  useEffect(() => {
    const previous = previousLinkTarget.current;
    if (previous === linkTarget || linkTarget === null || !visible) {
      if (linkTarget === null || visible) previousLinkTarget.current = linkTarget;
      return;
    }
    previousLinkTarget.current = linkTarget;
    cache.current.clear();
    void refreshList();
    if (activeRef.current) {
      void refreshThread(activeRef.current.name);
      if (failure?.source === "load") setStorageReadRetry((value) => value + 1);
    }
  }, [failure?.source, linkTarget, refreshList, refreshThread, visible]);
  useEffect(() => { if (visible) { void refreshList(); if (activeRef.current) void refreshThread(activeRef.current.name); } }, [visible, refreshList, refreshThread]);
  useEffect(() => store.subscribeEvents((event) => {
    if (!visible || event.event !== "storage.update" || event.window_id !== windowId) return;
    if (event.update.kind === "snapshot") {
      cache.current.clear();
      void refreshList();
      if (activeRef.current) {
        void refreshThread(activeRef.current.name);
        if (failure?.source === "load") setStorageReadRetry((value) => value + 1);
      }
      return;
    }
    if (event.update.kind !== "changed" || event.update.changed.item.entry_id !== entry) return;
    const key = event.update.changed.item.key; const name = activeRef.current?.name;
    if (name && key.endsWith(`/${name}/thread.json`)) void refreshThread(name);
    else if (/\/r[1-9]\d*\.html$/.test(key)) void refreshList();
  }), [entry, failure?.source, refreshList, refreshThread, store, visible, windowId]);
  useEffect(() => {
    if (lockedRef.current) return;
    if (!docs.length) { if (!dirtyRef.current) setActive(null); return; }
    const current = activeRef.current;
    const preferred = docs.find((item) => item.name === docState) ?? docs.find((item) => item.name === current?.name) ?? docs[0];
    const newest = preferred.revisions.at(-1)!;
    const previous = latestRef.current;
    if (current && current.name !== preferred.name && dirtyRef.current) { setPendingChange({ name: preferred.name, rev: newest }); return; }
    if (!docState) patchState(preferred.name, typeof revState === "number" ? revState : null);
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
  }, [docs, docState, revState, block.on_select_revision, patchState, locked]);
  useEffect(() => {
    const item = active; const sequence = ++readSequence.current;
    setSelection(null); setActiveComment(null); setResults({}); setText(""); setUndo([]); setRedo([]); selectors.current.clear(); work.current = null; setSource(""); setFailure(null);
    if (!item) return;
    void refreshThread(item.name);
    const path = `${item.name}/r${item.rev}.html`;
    const load = async () => {
      try {
        let html = cache.current.get(path);
        if (html === undefined) {
          const reply = await store.call({ op: "storage.get", window_id: windowId, entry, doc: path });
          if (reply.op !== "storage.get" || typeof reply.result.content !== "string") throw shellErrors.SHELL_HTML_REVISION_REPLY_INVALID();
          html = reply.result.content; cache.current.set(path, html);
        }
        if (sequence !== readSequence.current) return;
        const doc = new DOMParser().parseFromString(html, "text/html"); numberElements(doc); work.current = doc;
        setSource(htmlViewSource(doc.documentElement.outerHTML)); setFailure((previous) => previous?.source === "load" ? null : previous);
      } catch (reason) { if (sequence === readSequence.current) setFailure({ value: toCoreError(reason), source: "load" }); }
    };
    void load(); return () => { readSequence.current++; };
  }, [active?.name, active?.rev, entry, refreshThread, storageReadRetry, store, windowId]);
  const comments = useMemo(() => active ? thread.comments.filter((comment) => comment.rev <= active.rev) : [], [thread, active]);
  const reviewComments = comments.filter((comment) => comment.status === "needs_agent_review");
  const hasUnsentReview = reviewComments.some((comment) => sentReviews[active?.name ?? ""]?.[comment.id] !== reviewSignature(comment));
  const sentReview = reviewComments.length > 0 && !hasUnsentReview;
  const structuralEdits = undo.some((group) => group.some((edit) => edit.kind === "insert" || edit.kind === "remove" || edit.kind === "move"));
  const frameComments = useMemo(() => comments.map((comment, index) => ({ id: comment.id, anchor: comment.anchor, number: index + 1, sameRevision: anchorRevision(comment) === active?.rev && !structuralEdits, resolved: comment.status === "resolved", active: comment.id === activeComment })), [active?.rev, activeComment, comments, structuralEdits]);
  useEffect(() => { send({ type: "ks-html-comments", comments: frameComments }); }, [frameComments, send]);
  useEffect(() => { send({ type: "ks-html-mode", mode }); }, [mode, send]);
  const writeChange = useCallback(async (change: ThreadChange) => {
    const current = activeRef.current; if (!current) return false;
    setSaving(true);
    try {
      const result = await writeThreadChange(store, windowId, entry, current.name, change);
      if (activeRef.current?.name === current.name) setThread(result);
      if (change.kind === "status") setSentReviews((previous) => {
        if (!previous[current.name] || !(change.id in previous[current.name])) return previous;
        const remaining = { ...previous[current.name] }; delete remaining[change.id];
        return { ...previous, [current.name]: remaining };
      });
      if (change.kind === "status" && change.status === "resolved") requestAnimationFrame(() => root.current?.focus());
      setFailure(null); return true;
    }
    catch (reason) { setFailure({ value: toCoreError(reason), source: "write" }); return false; }
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
  const record = useCallback((value: HtmlEdit | HtmlEdit[]) => {
    if (lockedRef.current || !work.current) return;
    const group = Array.isArray(value) ? value : [value];
    for (const edit of group) { applyEdit(work.current, edit); sendEdit(edit); }
    dirtyRef.current = true;
    setUndo((previous) => [...previous, group]);
    setRedo([]);
    requestAnimationFrame(() => { flushEdits(); send({ type: "ks-html-refresh-selection" }); });
  }, [flushEdits, send, sendEdit]);
  const undoEdit = useCallback(() => {
    const group = undoRef.current.at(-1); if (lockedRef.current || !group || !work.current) return;
    for (const edit of [...group].reverse()) { const inverse = invertEdit(edit); applyEdit(work.current, inverse); sendEdit(inverse); }
    flushEdits(); send({ type: "ks-html-refresh-selection" });
    dirtyRef.current = undoRef.current.length > 1;
    if (!dirtyRef.current) setFailure((previous) => previous?.source === "save" ? null : previous);
    setUndo((items) => items.slice(0, -1)); setRedo((items) => [...items, group]);
  }, [flushEdits, send, sendEdit]);
  const redoEdit = useCallback(() => {
    const group = redo.at(-1); if (lockedRef.current || !group || !work.current) return;
    for (const edit of group) { applyEdit(work.current, edit); sendEdit(edit); }
    flushEdits(); send({ type: "ks-html-refresh-selection" });
    dirtyRef.current = true;
    setRedo((items) => items.slice(0, -1)); setUndo((items) => [...items, group]);
  }, [flushEdits, redo, send, sendEdit]);
  const previewStyle = useCallback((prop: string, value: string) => {
    if (lockedRef.current || !selection || !work.current) return;
    const target = findNumber(work.current, selection.n);
    if (!(target instanceof HTMLElement)) return;
    if (prop === "border-width" && Number.parseFloat(value) > 0 && selection.styles["border-style"]?.split(/\s+/).includes("none")) sendEdit({ kind: "style", n: selection.n, prop: "border-style", before: target.style.getPropertyValue("border-style"), after: selection.styles["border-style"].split(/\s+/).map((part) => part === "none" ? "solid" : part).join(" ") });
    sendEdit({ kind: "style", n: selection.n, prop, before: target.style.getPropertyValue(prop), after: value });
  }, [selection, sendEdit]);
  const editStyle = useCallback((prop: string, value: string) => {
    const target = selection && work.current ? findNumber(work.current, selection.n) : null;
    if (lockedRef.current || !(target instanceof HTMLElement) || !selection) return;
    const before = target.style.getPropertyValue(prop); if (before === value) return;
    const group: HtmlEdit[] = [];
    if (prop === "border-width" && Number.parseFloat(value) > 0 && selection.styles["border-style"]?.split(/\s+/).includes("none")) {
      group.push({ kind: "style", n: selection.n, prop: "border-style", before: target.style.getPropertyValue("border-style"), after: selection.styles["border-style"].split(/\s+/).map((part) => part === "none" ? "solid" : part).join(" ") });
    }
    group.push({ kind: "style", n: selection.n, prop, before, after: value });
    record(group);
    setSelection((current) => current ? { ...current, styles: { ...current.styles, ...Object.fromEntries(group.map((item) => item.kind === "style" ? [item.prop, item.after] : ["", ""])) } } : null);
  }, [record, selection]);
  const editText = useCallback((value: string) => {
    const target = selection && work.current ? findNumber(work.current, selection.n) : null;
    if (lockedRef.current || !selection || !target || target.children.length || target.textContent === value) return;
    record({ kind: "text", n: selection.n, before: target.textContent ?? "", after: value });
    setSelection((current) => current ? { ...current, text: value } : null);
  }, [record, selection]);
  const keyAction = useCallback((data: Extract<FrameToParent, { type: "ks-html-key" }>) => {
    if (lockedRef.current) return;
    if (data.ctrl && data.key.toLowerCase() === "z") { data.shift ? redoEdit() : undoEdit(); return; }
    if (data.ctrl && data.key.toLowerCase() === "y") { redoEdit(); return; }
    if (data.key === "Escape") { send({ type: "ks-html-select-number", n: null }); return; }
    const doc = work.current; const target = selection && doc ? findNumber(doc, selection.n) : null;
    if (!doc || !target || !selection) return;
    if (selection.anchor.kind === "text" && (data.key === "Delete" || data.key === "Backspace" || (data.ctrl && data.key.toLowerCase() === "d") || (data.alt && (data.key === "ArrowUp" || data.key === "ArrowDown")))) return;
    if (target === doc.body && ((data.key === "Enter" && data.shift) || data.key === "Tab" || data.key === "Delete" || data.key === "Backspace" || data.alt || data.ctrl)) return;
    let next: Element | null = null;
    if (data.key === "Enter") next = data.shift ? target.parentElement : target.firstElementChild;
    else if (data.key === "Tab") next = data.shift ? target.previousElementSibling : target.nextElementSibling;
    if (next) { send({ type: "ks-html-select-number", n: nOf(next) }); return; }
    const parent = target.parentElement; const parentN = nOf(parent); if (!parent || parentN === null) return;
    if (data.key === "Delete" || data.key === "Backspace") {
      record({ kind: "remove", n: selection.n, parent: parentN, next: nOf(target.nextElementSibling), html: target.outerHTML });
      send({ type: "ks-html-select-number", n: null });
      frame.current?.focus();
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
  const openComment = useCallback((id: string) => {
    setMode("select"); setActiveComment(id); setFace("comments");
    send({ type: "ks-html-focus-comment", id });
    requestAnimationFrame(() => {
      const card = [...(root.current?.querySelectorAll<HTMLElement>(".ks-html-comment") ?? [])].find((item) => item.id === `ks-html-comment-${id}`);
      card?.scrollIntoView({ block: "nearest" });
      card?.querySelector<HTMLButtonElement>(".ks-html-comment-target")?.focus();
    });
  }, [send, setFace]);
  useEffect(() => {
    const receive = (event: MessageEvent<FrameToParent>) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data;
      if (data.type === "ks-html-ready") {
        send({ type: "ks-html-mode", mode });
        send({ type: "ks-html-comments", comments: frameComments });
        send({ type: "ks-html-lock", locked: lockedRef.current });
      }
      else if (data.type === "ks-html-visible-text") setText(data.text);
      else if (data.type === "ks-html-context-menu" && !lockedRef.current && frame.current && typeof data.x === "number" && typeof data.y === "number" && typeof data.text === "string" && (data.text || data.editable)) openFrameContextMenu(frame.current, data, (command) => send({ type: "ks-html-context-command", ...command }));
      else if (data.type === "ks-html-select") {
        if (lockedRef.current) return;
        setSelection(data.selection);
        if (data.selection) {
          selectors.current.set(data.selection.n, data.selection.anchor.selector);
          if (data.selection.anchor.kind === "text") setFace("comments");
        }
      }
      else if (data.type === "ks-html-anchor-results") setResults(data.results);
      else if (data.type === "ks-html-select-comment" && !lockedRef.current) openComment(data.id);
      else if (data.type === "ks-html-key") keyAction(data);
      else if (data.type === "ks-html-text-edit") record({ kind: "text", n: data.n, before: data.before, after: data.after });
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, [frameComments, keyAction, mode, openComment, record, send, setFace]);
  const addComment = useCallback(async (body: string) => {
    const current = activeRef.current; if (!current || !selection || !body.trim()) return false;
    const comment: Comment = { id: makeId("c"), rev: current.rev, anchor_rev: anchorRevisionFor(current.rev, dirtyRef.current), status: "needs_agent_review", anchor: selection.anchor, comment: body.trim(), created_at: new Date().toISOString(), resolved_rev: null, replies: [] };
    return writeChange({ kind: "add", comment });
  }, [selection, writeChange]);
  const edits = useMemo(() => undo.flatMap((group) => group.map((edit) => {
    const selector = selectors.current.get(edit.kind === "insert" && edit.source ? edit.source : edit.n) ?? `[data-ks-n="${edit.n}"]`;
    if (edit.kind === "style") return { selector, prop: edit.prop, before: edit.before, after: edit.after };
    if (edit.kind === "text") return { selector, text: { before: edit.before, after: edit.after } };
    return { selector, dom: edit.kind === "insert" && edit.source ? "duplicate" : edit.kind };
  })), [undo]);
  const saveRevision = useCallback(async () => {
    const current = activeRef.current;
    const doc = work.current;
    if (savingRevisionRef.current || !current || !doc || !latest || (!undoRef.current.length && !pendingRevisionRef.current)) return;
    savingRevisionRef.current = true;
    lockedRef.current = true;
    setSavingRevision(true);
    flushEdits();
    send({ type: "ks-html-lock", locked: true });
    try {
      let pending = pendingRevisionRef.current;
      if (!pending) {
        const rev = latest + 1;
        const html = serializeOriginal(doc);
        const path = `${current.name}/r${rev}.html`;
        const change: PendingRevision["change"] = { kind: "revision", rev, meta: { title: `직접 수정 ${undo.length}건`, author: "user", base_rev: current.rev, edits } };
        await store.call({ op: "storage.write", window_id: windowId, entry, doc: path, content: html, expected_revision: null });
        cache.current.set(path, html);
        pending = { name: current.name, rev, change };
        pendingRevisionRef.current = pending;
        setPendingRevision(pending);
      }
      await writeThreadChange(store, windowId, entry, pending.name, pending.change);
      pendingRevisionRef.current = null;
      setPendingRevision(null);
      dirtyRef.current = false;
      setUndo([]);
      setRedo([]);
      setActive({ name: pending.name, rev: pending.rev });
      patchState(pending.name, pending.rev);
      await refreshList();
      await refreshThread(pending.name);
      setFailure(null);
    } catch (reason) {
      const failure = toCoreError(reason);
      setFailure({ value: failure, source: "save" });
    } finally {
      savingRevisionRef.current = false;
      lockedRef.current = pendingRevisionRef.current !== null;
      send({ type: "ks-html-lock", locked: lockedRef.current });
      setSavingRevision(false);
    }
  }, [edits, entry, flushEdits, latest, patchState, refreshList, refreshThread, send, store, undo.length, windowId]);
  const choose = useCallback((name: string, rev: number) => { if (lockedRef.current || (activeRef.current?.name === name && activeRef.current.rev === rev)) return; if (dirtyRef.current) { setPendingChange({ name, rev }); return; } setActive({ name, rev }); patchState(name, rev); }, [patchState]);
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
    if (open.length) { lines.push(`미해결 커멘트 ${open.length}건:`); open.forEach(({ comment, index }) => lines.push(`- ${comment.id} #${index + 1} [${comment.status === "needs_agent_review" ? "검토 요청" : "답변 도착"}] v${comment.rev}${anchorRevision(comment) !== comment.rev ? `, 앵커 v${anchorRevision(comment)}` : ""}, ${results[comment.id] === "orphan" ? "못 찾음" : results[comment.id] === "moved" ? "옮겨 찾음" : "제자리"}: ${comment.anchor.label} "${comment.anchor.quote?.exact ?? comment.anchor.text}": ${comment.comment}`)); }
    if (includeText && text) lines.push(text);
    return lines.join("\n");
  }, [active, comments, context.definition.name, edits, entry, latest, results, selection, text]);
  const sendAgent = useCallback(async () => {
    if (!agentWindow || !active || !hasUnsentReview || sending) return;
    const name = active.name;
    const sent = Object.fromEntries(reviewComments.map((comment) => [comment.id, reviewSignature(comment)]));
    setSending(true);
    try {
      await store.call({ op: "conversation.send", window_id: agentWindow, request_id: crypto.randomUUID(), text: share(false), attachments: [] });
      setSentReviews((previous) => ({ ...previous, [name]: { ...previous[name], ...sent } }));
      setFailure((previous) => previous?.source === "send" ? null : previous);
    }
    catch (reason) { setFailure({ value: toCoreError(reason), source: "send" }); }
    finally { setSending(false); }
  }, [active, agentWindow, hasUnsentReview, reviewComments, sending, share, store]);
  return { active, docs, latest, thread, comments, selection, results, source, error: failure?.value ?? null, errorSource: failure?.source, retryList, retryLoad: () => setStorageReadRetry((value) => value + 1), saveFailed: failure?.source === "save", loaded, saving: saving || savingRevision, locked, sending, sentReview, hasUnsentReview, reviewComments, mode, setMode, face, setFace, narrow, compact, activeComment, setActiveComment, openComment, propertyGroups, setPropertyGroups, frame, root, dirty, undo, redo, edits, pendingChange, setPendingChange, choose, confirmChange, keyAction, record, previewStyle, editStyle, editText, undoEdit, redoEdit, addComment, writeChange, saveRevision, send, share, sendAgent, agentWindow };
}
