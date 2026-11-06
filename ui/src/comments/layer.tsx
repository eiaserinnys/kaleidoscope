import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppCommentOrigin, AppWindow, CoreError } from "../contract/contract";
import { BUILTIN_APP_IDS } from "../contract/limits";
import { toCoreError } from "../core/core-transport";
import { useShellSelector, type ShellStore } from "../core/shell-store";
import { useWindowVisible } from "../data/window-state";
import { useDefaultMessageApp } from "../shell/message-target";
import { suspendWebSurfaces } from "../blocks/web-surface-layer";
import { CountBadge } from "../components/badge";
import { Check, List, LoaderCircle, MessageSquare, TriangleAlert, X } from "../components/icons";
import { Button, EmptyState, ErrorId, IconButton, Notice } from "../components/primitives";
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
import { useCommentBarPosition } from "./bar-position";

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
  const session = commentSession(window.id);
  const [target, setTarget] = useState<TargetDescription | null>(() => session.getDraft(window.app_version)?.target ?? null);
  const [targetChanged, setTargetChanged] = useState(() => session.getDraft(window.app_version)?.targetChanged ?? false);
  const [hover, setHover] = useState<HTMLElement | null>(null);
  const [rail, setRail] = useState(false);
  const [activeId, setActive] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<CoreError | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const placeThreadRef = useRef<() => boolean>(() => false);
  const onPinsPositioned = useCallback(() => placeThreadRef.current(), []);
  const onError = useCallback((error: CoreError) => {
    setProblem(error);
    void store.call({ op: "window.raise", window_id: window.id }).catch((cause) => console.error("커멘트 오류가 난 창을 앞으로 가져오지 못했습니다.", cause));
  }, [store, window.id]);
  const showBar = Boolean(meta?.unsent_count || (mode && ((meta?.open_count ?? 0) || (meta?.unread_reply_count ?? 0) || list.items.length)));
  useCommentBarPosition(content, barRef, showBar && visible, mode);
  const position = useCommentPositions(content, window.id, mode && visible && ready, definition, list.items, rail, activeId ?? hoveredId, target, hover, onPinsPositioned);
  useEffect(() => { if (meta === undefined) data.reset(); }, [meta === undefined, data]);
  useEffect(() => {
    if (!mode || !visible || meta === undefined) { setReady(false); return; }
    let live = true; let release: (() => void) | undefined;
    void suspendWebSurfaces(window.id).then((end) => { if (live) { release = end; setReady(true); content.focus({ preventScroll: true }); } else end(); }).catch((error) => onError(toCoreError(error)));
    return () => { live = false; release?.(); };
  }, [mode, visible, meta === undefined, window.id, content, onError]);
  useEffect(() => { if (mode && visible && meta !== undefined && !list.error) void data.load(meta?.revision ?? 0); }, [mode, visible, meta, list.revision, list.loading, list.error, data]);
  useEffect(() => { if (!mode) { setTarget(null); setTargetChanged(false); setRail(false); setActive(null); setHoveredId(null); setCluster(null); } }, [mode]);
  const pick = useCallback((next: TargetDescription) => { if (next.range) document.getSelection()?.removeAllRanges(); session.pick(window.app_version, next); setTarget(next); setTargetChanged(false); setActive(null); setCluster(null); setRail(false); }, [session, window.app_version]);
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
      if (event.key !== "Escape" || event.defaultPrevented || content.closest(".ks-window")?.querySelector(".ks-comment-dialog")) return;
      const owner = event.target instanceof Element ? event.target.closest(".ks-window") : null;
      if (owner !== content.closest(".ks-window") && !(event.target === document.body && content.closest(".ks-window")?.querySelector(".ks-window-frame-active"))) return;
      event.preventDefault(); event.stopPropagation();
      if (target || targetChanged) {
        const input = content.closest(".ks-window")?.querySelector<HTMLTextAreaElement>(".ks-comment-composer textarea");
        if (input) {
          input.focus({ preventScroll: true });
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        }
      } else if (activeId) setActive(null); else if (cluster) setCluster(null); else if (rail) setRail(false); else commentSession(window.id).set(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [activeId, cluster, mode, rail, target, targetChanged, visible, window.id, content]);
  useEffect(() => { if ((meta?.unsent_count ?? 0) > 0) setSent(false); }, [meta?.unsent_count]);
  useEffect(() => { if (cluster && !activeId) requestAnimationFrame(() => threadRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })); }, [cluster, activeId]);
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
      if (!(event.target instanceof Element) || event.target.closest(".ks-comment-thread, .ks-comment-pin, .ks-comment-dialog")) return;
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
    session.clearDraft(); setTargetChanged(false);
    setTarget(null);
    if (element) requestAnimationFrame(() => {
      const hadTabIndex = element.hasAttribute("tabindex");
      if (!hadTabIndex && element.tabIndex < 0) element.tabIndex = -1;
      element.focus({ preventScroll: true });
      if (!hadTabIndex) element.removeAttribute("tabindex");
    });
  };
  const send = async () => {
    setProblem(null); setSending(true);
    try { await sendComments({ store, appId: window.app_id, appName, windowId: window.id }); setSent(true); }
    catch (error) { onError(toCoreError(error)); }
    finally { setSending(false); }
  };
  return <div className={`ks-comment-layer${mode ? " is-on" : ""}`} data-ks-share-skip>
    {mode && visible ? <>
      <div className="ks-comment-ring" />
      {hover ? <span ref={position.hoverBox} className="ks-comment-box is-hover" style={{ display: "none" }} /> : null}
      {target || activeId || hoveredId ? <span ref={position.selectedBox} className="ks-comment-box is-selected" style={{ display: "none" }} /> : null}
      {target ? <span ref={(node) => position.setPin("__draft__", node)} className="ks-comment-pin is-draft is-preview" aria-label="초안 커멘트 자리" /> : null}
      {position.groups.map((group) => {
        const grouped = list.items.filter((item) => group.ids.includes(item.id)), first = grouped[0];
        if (!first) return null;
        const button = <button ref={group.ids.length === 1 ? (node) => position.setPin(group.id, node) : undefined} type="button" className={`ks-comment-pin ${grouped.every((item) => !item.sent_at) ? "is-draft" : "is-sent"}${group.ids.length > 1 ? " is-cluster" : ""}`} aria-label={group.ids.length > 1 ? `커멘트 ${group.ids.length}개` : `커멘트 ${first.number}`} onPointerEnter={() => setHoveredId(group.ids.length === 1 ? group.id : null)} onPointerLeave={() => setHoveredId(null)} onClick={() => { setTarget(null); setCluster(group.ids.length > 1 ? group.ids : null); setActive(group.ids.length === 1 ? group.id : null); }}>{group.ids.length > 1 ? group.ids.length : first.number}{grouped.some((item) => item.unread_reply) ? <span className="ks-comment-pin-dot" /> : null}{group.ids.length === 1 && position.statuses[first.id] === "moved" ? <span className="ks-comment-pin-dot is-moved" /> : null}</button>;
        return group.ids.length > 1 ? <span key={group.id} ref={(node) => position.setPin(group.id, node)} className="ks-comment-pin-cluster"><span className="ks-comment-pin-stack" />{button}</span> : <span key={group.id}>{button}</span>;
      })}
      {(target || targetChanged) && position.index ? <CommentComposer store={store} content={content} windowId={window.id} appId={window.app_id} appName={appName} version={window.app_version} shellVersion={shellVersion} origin={origin} digest={position.index.digest} index={position.index.entries} target={target} targetChanged={targetChanged} onRetarget={pick} onClose={closeTarget} onError={onError} onPositioned={position.refresh} /> : null}
      {rail ? <aside className="ks-comment-rail" aria-label="커멘트 목록">{list.error ? <div className="ks-data-state" role="alert"><EmptyState icon={<TriangleAlert size="empty" />} text={<>{list.error.message}{list.error.id ? <> <ErrorId id={list.error.id} /></> : null}</>} action={<Button onClick={() => void data.load(meta?.revision ?? 0, true)}>다시 받기</Button>} /></div> : <CommentCards items={list.items} statuses={position.statuses} activeId={activeId} setActive={activate} host={content} store={store} windowId={window.id} onError={onError} more={() => void data.more()} hasMore={!!list.nextCursor} loading={list.loading} />}</aside> : null}
      {!rail && current ? <div ref={threadRef} className="ks-comment-surface ks-comment-thread"><CommentCard item={current} status={position.statuses[current.id]} active host={content} store={store} windowId={window.id} open={() => {}} close={() => { setActive(null); requestAnimationFrame(() => { const pin = position.pins.current.get(cluster?.[0] ?? current.id); (pin?.querySelector<HTMLButtonElement>("button") ?? pin)?.focus({ preventScroll: true }); }); }} error={onError} /></div> : null}
      {!rail && cluster && !current ? <div ref={threadRef} className="ks-comment-surface ks-comment-thread"><CommentCards items={list.items.filter((item) => cluster.includes(item.id))} statuses={position.statuses} activeId={activeId} setActive={setActive} host={content} store={store} windowId={window.id} onError={onError} more={() => {}} hasMore={false} loading={false} /></div> : null}
    </> : null}
    {showBar ? <div ref={barRef} className="ks-comment-bar" role="toolbar" aria-label="커멘트"><button type="button" className="ks-comment-bar-item" aria-label={`커멘트 목록 ${meta?.open_count ?? 0}개`} aria-pressed={rail} onClick={() => { commentSession(window.id).set(true); setRail(!rail); }}><List size="inline" />{meta?.open_count ?? 0}{orphans ? <span className="ks-comment-pin is-rail is-orphan is-away is-mini">{orphans}</span> : null}</button>{receiver ? <button type="button" className={`ks-comment-bar-item${meta?.unsent_count ? " is-primary" : ""}`} title={`받는 앱: ${receiver.name}`} disabled={!meta?.unsent_count || sending} aria-busy={sending || undefined} onClick={() => void send()}>{sending ? <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="inline" /></span> : null}{sent ? <><Check size="inline" />보냈습니다</> : `에이전트에게 보내기${meta?.unsent_count ? ` ${meta.unsent_count}` : ""}`}</button> : <button type="button" className="ks-comment-bar-item" onClick={(event) => chooseAgent(event.currentTarget)}>기본 에이전트 고르기…</button>}</div> : null}
    {problem ? <div className="ks-comment-notice"><Notice role="alert" errorId={problem.id} onDismiss={() => setProblem(null)} actions={[<IconButton key="close" aria-label="닫기" onClick={() => setProblem(null)}><X size="inline" /></IconButton>]}>{problem.message}</Notice></div> : null}
  </div>;
}
