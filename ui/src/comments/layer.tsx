import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppCommentOrigin, AppWindow, CoreError } from "../contract/contract";
import { BUILTIN_APP_IDS } from "../contract/limits";
import { toCoreError } from "../core/core-transport";
import { useShellSelector, type ShellStore } from "../core/shell-store";
import { useWindowVisible } from "../data/window-state";
import { useDefaultMessageApp } from "../shell/message-target";
import { suspendWebSurfaces } from "../blocks/web-surface-layer";
import { CountBadge } from "../components/badge";
import { Check, List, MessageSquare } from "../components/icons";
import { Button, IconButton, Notice } from "../components/primitives";
import { CommentCard, CommentCards } from "./cards";
import { CommentComposer } from "./composer";
import { registerCommentEntry } from "./context-entry";
import { targetAt, useCommentPick } from "./pick";
import { resolveDefinition } from "./definition";
import { resolveScreen } from "./screen";
import { useCommentPositions } from "./positions";
import { sendComments } from "./send";
import { commentSession, useCommentSession } from "./session";
import { appCommentStore } from "./store";
import type { TargetDescription } from "./target";

export function useCommentMeta(store: ShellStore, appId: string) {
  return useShellSelector(store, (snapshot) => snapshot?.shared.app_comments == null ? undefined : snapshot.shared.app_comments[appId] ?? null);
}

export function CommentTitle({ store, window }: { store: ShellStore; window: AppWindow }) {
  const meta = useCommentMeta(store, window.app_id);
  const mode = useCommentSession(window.id);
  if (meta === undefined) return null;
  const count = meta?.open_count ?? 0, unread = meta?.unread_reply_count ?? 0;
  return <IconButton className={`ks-comment-title-button${count ? " has-count" : ""}`} aria-label={`커멘트${count ? ` ${count}개` : ""}${unread ? `, 답변 ${unread}개 도착` : ""}`} pressed={mode} onClick={() => commentSession(window.id).set(!mode)}><span className="ks-badge-anchor"><MessageSquare size="chrome" />{unread ? <CountBadge dot count={unread} /> : null}</span>{count ? <span className="ks-comment-title-count">{count}</span> : null}</IconButton>;
}

export function CommentLayer({ store, window, appName, content, shellVersion, chooseAgent }: { store: ShellStore; window: AppWindow; appName: string; content: HTMLElement; shellVersion: string; chooseAgent: (anchor: HTMLElement) => void }) {
  const meta = useCommentMeta(store, window.app_id);
  const mode = useCommentSession(window.id);
  const visible = useWindowVisible({ store, window });
  const receiver = useDefaultMessageApp(store);
  const definition = useShellSelector(store, (snapshot) => snapshot?.shared.app_versions.find((entry) => entry.app_id === window.app_id && entry.version === window.app_version)?.definition);
  const app = useShellSelector(store, (snapshot) => snapshot?.shared.apps.find((entry) => entry.id === window.app_id));
  const data = appCommentStore(store, window.app_id);
  const list = useSyncExternalStore(data.subscribe, data.snapshot, data.snapshot);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<TargetDescription | null>(null);
  const [hover, setHover] = useState<HTMLElement | null>(null);
  const [rail, setRail] = useState(false);
  const [activeId, setActive] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<CoreError | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const placeThreadRef = useRef<() => boolean>(() => false);
  const onPinsPositioned = useCallback(() => placeThreadRef.current(), []);
  const onError = useCallback((error: CoreError) => setProblem(error), []);
  const position = useCommentPositions(content, window.id, mode && visible && ready, definition, list.items, rail, activeId ?? hoveredId, target, hover, onPinsPositioned);
  useEffect(() => { if (meta === undefined) data.reset(); }, [meta === undefined, data]);
  useEffect(() => {
    if (!mode || !visible || meta === undefined) { setReady(false); return; }
    let live = true; let release: (() => void) | undefined;
    void suspendWebSurfaces(window.id).then((end) => { if (live) { release = end; setReady(true); content.focus({ preventScroll: true }); } else end(); }).catch((error) => onError(toCoreError(error)));
    return () => { live = false; release?.(); };
  }, [mode, visible, meta === undefined, window.id, content, onError]);
  useEffect(() => { if (mode && visible && meta !== undefined && !list.error) void data.load(meta?.revision ?? 0); }, [mode, visible, meta, list.revision, list.loading, list.error, data]);
  useEffect(() => { if (!mode) { setTarget(null); setRail(false); setActive(null); setHoveredId(null); setCluster(null); } }, [mode]);
  const pick = useCallback((next: TargetDescription) => { if (next.range) document.getSelection()?.removeAllRanges(); setTarget(next); setActive(null); setCluster(null); setRail(false); }, []);
  const onHover = useCallback((value: HTMLElement | null) => setHover(value), []);
  useCommentPick(content, mode && visible && ready, pick, onHover);
  useEffect(() => {
    if (meta === undefined) return;
    return registerCommentEntry(content, (element, point) => {
      commentSession(window.id).set(true);
      const next = targetAt(content, element, point.x, point.y);
      if (next) pick(next);
    });
  }, [content, meta === undefined, pick, window.id]);
  useEffect(() => {
    if (!mode || !visible) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!(event.target instanceof Element) || event.target.closest(".ks-window") !== content.closest(".ks-window")) return;
      event.preventDefault(); event.stopPropagation();
      if (target) setTarget(null); else if (activeId) setActive(null); else if (cluster) setCluster(null); else if (rail) setRail(false); else commentSession(window.id).set(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [activeId, cluster, mode, rail, target, visible, window.id, content]);
  useEffect(() => { if ((meta?.unsent_count ?? 0) > 0) setSent(false); }, [meta?.unsent_count]);
  useLayoutEffect(() => {
    const place = () => {
      const pinId = cluster?.[0] ?? activeId;
      const element = threadRef.current, pin = pinId && position.pins.current.get(pinId), win = content.closest<HTMLElement>(".ks-window");
      if (!element || !pin || !win || rail) return false;
      const c = content.getBoundingClientRect(), w = win.getBoundingClientRect(), p = pin.getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(content).getPropertyValue("--ks-space-2"));
      const left = Math.max(c.left + margin, Math.min(p.right - element.offsetWidth, c.right - element.offsetWidth - margin));
      const top = p.bottom + margin + element.offsetHeight <= c.bottom - margin ? p.bottom + margin : Math.max(c.top + margin, p.top - element.offsetHeight - margin);
      const transform = `translate(${left - w.left}px, ${top - w.top}px)`;
      if (element.style.transform === transform) return false;
      element.style.transform = transform;
      return true;
    };
    placeThreadRef.current = place;
    if (place()) position.refresh();
    return () => { placeThreadRef.current = () => false; };
  }, [activeId, cluster, content, rail, position.statuses, position.groups, position.refresh]);
  useEffect(() => {
    if (!mode || rail || (!activeId && !cluster) || target) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(".ks-comment-thread, .ks-comment-pin")) return;
      if (event.target.closest(".ks-window") !== content.closest(".ks-window")) return;
      event.preventDefault(); event.stopPropagation(); setActive(null); setCluster(null);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [activeId, cluster, content, mode, rail, target]);
  if (meta === undefined || (!mode && !(meta?.unsent_count))) return null;
  const origin: AppCommentOrigin = (BUILTIN_APP_IDS as readonly string[]).includes(window.app_id) ? { kind: "builtin" } : app?.origin ? { kind: "store", origin: app.origin } : { kind: "personal" };
  const orphans = list.items.filter((item) => !item.resolved && position.statuses[item.id] === "orphan").length;
  const current = list.items.find((item) => item.id === activeId);
  const activate = (id: string | null) => {
    setActive(id);
    const item = list.items.find((entry) => entry.id === id);
    if (!item || !position.index) return;
    const definitionResult = resolveDefinition(item.anchor, item.created_definition_digest, position.index.entries, position.index.digest);
    const result = resolveScreen(item.anchor, definitionResult, content, { windowId: window.id, sourceWindowId: item.source_window_id }, { includeOffscreen: true });
    if ("element" in result) result.element.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const closeTarget = () => {
    const element = target?.element;
    setTarget(null);
    if (element) requestAnimationFrame(() => {
      const hadTabIndex = element.hasAttribute("tabindex");
      if (!hadTabIndex && element.tabIndex < 0) element.tabIndex = -1;
      element.focus({ preventScroll: true });
      if (!hadTabIndex) element.removeAttribute("tabindex");
    });
  };
  const showBar = Boolean(meta?.unsent_count || (mode && ((meta?.open_count ?? 0) || (meta?.unread_reply_count ?? 0) || list.items.length)));
  const send = async () => { setSending(true); try { await sendComments({ store, appId: window.app_id, appName, windowId: window.id }); setSent(true); } catch (error) { onError(toCoreError(error)); } finally { setSending(false); } };
  return <div className={`ks-comment-layer${mode ? " is-on" : ""}`} data-ks-share-skip>
    {mode && visible ? <>
      <div className="ks-comment-ring" />
      {hover ? <span ref={position.hoverBox} className="ks-comment-box is-hover" style={{ display: "none" }} /> : null}
      {target || activeId || hoveredId ? <span ref={position.selectedBox} className="ks-comment-box is-selected" style={{ display: "none" }} /> : null}
      {position.groups.map((group) => {
        const grouped = list.items.filter((item) => group.ids.includes(item.id)), first = grouped[0];
        if (!first) return null;
        return <button key={group.id} ref={(node) => position.setPin(group.id, node)} type="button" className={`ks-comment-pin ${grouped.every((item) => !item.sent_at) ? "is-draft" : "is-sent"}${group.ids.length > 1 ? " is-cluster" : ""}`} aria-label={group.ids.length > 1 ? `커멘트 ${group.ids.length}개` : `커멘트 ${first.number}`} onPointerEnter={() => setHoveredId(group.ids.length === 1 ? group.id : null)} onPointerLeave={() => setHoveredId(null)} onClick={() => { setTarget(null); setCluster(group.ids.length > 1 ? group.ids : null); setActive(group.ids.length === 1 ? group.id : null); }}>{group.ids.length > 1 ? group.ids.length : first.number}{group.ids.length > 1 ? <span className="ks-comment-pin-stack" /> : null}{grouped.some((item) => item.unread_reply) ? <span className="ks-comment-pin-dot" /> : null}{group.ids.length === 1 && position.statuses[first.id] === "moved" ? <span className="ks-comment-pin-dot is-moved" /> : null}</button>;
      })}
      {target && position.index ? <CommentComposer store={store} content={content} windowId={window.id} appId={window.app_id} appName={appName} version={window.app_version} shellVersion={shellVersion} origin={origin} digest={position.index.digest} index={position.index.entries} target={target} onRetarget={pick} onClose={closeTarget} onError={onError} onPositioned={position.refresh} /> : null}
      {rail ? <aside className="ks-comment-rail" aria-label="커멘트 목록">{list.error ? <Notice role="alert" errorId={list.error.id} actions={[<Button key="retry" onClick={() => void data.load(meta?.revision ?? 0, true)}>다시 받기</Button>]}>{list.error.message}</Notice> : <CommentCards items={list.items} statuses={position.statuses} activeId={activeId} setActive={activate} host={content} store={store} windowId={window.id} onError={onError} more={() => void data.more()} hasMore={!!list.nextCursor} loading={list.loading} />}</aside> : null}
      {!rail && current ? <div ref={threadRef} className="ks-comment-surface ks-comment-thread"><CommentCard item={current} status={position.statuses[current.id]} active host={content} store={store} windowId={window.id} open={() => {}} close={() => { setActive(null); requestAnimationFrame(() => position.pins.current.get(cluster?.[0] ?? current.id)?.focus({ preventScroll: true })); }} error={onError} /></div> : null}
      {!rail && cluster && !current ? <div ref={threadRef} className="ks-comment-surface ks-comment-thread"><CommentCards items={list.items.filter((item) => cluster.includes(item.id))} statuses={position.statuses} activeId={activeId} setActive={setActive} host={content} store={store} windowId={window.id} onError={onError} more={() => {}} hasMore={false} loading={false} /></div> : null}
    </> : null}
    {showBar ? <div className="ks-comment-bar" role="toolbar" aria-label="커멘트"><button type="button" className="ks-comment-bar-item" aria-label={`커멘트 목록 ${meta?.open_count ?? 0}개`} aria-pressed={rail} onClick={() => { commentSession(window.id).set(true); setRail(!rail); }}><List size="inline" />{meta?.open_count ?? 0}{orphans ? <span className="ks-comment-pin is-rail is-orphan is-away is-mini">{orphans}</span> : null}</button>{receiver ? <button type="button" className={`ks-comment-bar-item${meta?.unsent_count ? " is-primary" : ""}`} title={`받는 앱: ${receiver.name}`} disabled={!meta?.unsent_count || sending} onClick={() => void send()}>{sent ? <><Check size="inline" />보냈습니다</> : `에이전트에게 보내기${meta?.unsent_count ? ` ${meta.unsent_count}` : ""}`}</button> : <button type="button" className="ks-comment-bar-item" onClick={(event) => chooseAgent(event.currentTarget)}>기본 에이전트 고르기…</button>}</div> : null}
    {problem ? <Notice role="alert" errorId={problem.id} onDismiss={() => setProblem(null)}>{problem.message}</Notice> : null}
  </div>;
}
