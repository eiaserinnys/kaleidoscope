import { useEffect, useRef, useState } from "react";
import type { AppCommentImage, AppCommentOrigin, CoreError } from "../contract/contract";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import { ArrowUp, Image, X } from "../components/icons";
import { ErrorId, IconButton } from "../components/primitives";
import { SHELL_COMMENT_TARGET_CHANGED } from "../contract/shell-errors";
import { captureWindowForComment } from "../share/share-view";
import { ImagePreview } from "../blocks/agent-attachments";
import { describeTarget, type TargetDescription } from "./target";
import type { DefinitionIndex } from "./definition";
import { commentLabel } from "./label";
import { commentSession } from "./session";

type Props = { store: ShellStore; content: HTMLElement; windowId: string; appId: string; appName: string; version: number; shellVersion: string; origin: AppCommentOrigin; digest: string; index: DefinitionIndex; target: TargetDescription | null; targetChanged?: boolean; onRetarget: (target: TargetDescription) => void; onClose: () => void; onError: (error: CoreError) => void; onPositioned: () => void };

export function CommentComposer({ store, content, windowId, appId, appName, version, shellVersion, origin, digest, index, target, targetChanged, onRetarget, onClose, onError, onPositioned }: Props) {
  const session = commentSession(windowId);
  const saved = session.getDraft(version);
  const id = useRef(crypto.randomUUID());
  const [text, setText] = useState(saved?.text ?? "");
  const [image, setImage] = useState<AppCommentImage | undefined>(saved?.image);
  const [includeImage, setIncludeImage] = useState(saved?.includeImage ?? true);
  const [captureError, setCaptureError] = useState<CoreError>();
  const [capturing, setCapturing] = useState(Boolean(target));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<HTMLButtonElement | null>(null);
  const capturePromise = useRef<Promise<AppCommentImage | undefined>>(Promise.resolve(undefined));
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [target]);
  useEffect(() => {
    if (!target) { setImage(undefined); setCaptureError(undefined); setCapturing(false); return; }
    let live = true;
    setImage(undefined); setCaptureError(undefined); setCapturing(true);
    const bounds = content.getBoundingClientRect();
    const rect = target.range?.getBoundingClientRect() ?? target.rect ?? bounds;
    const capture = target.anchor.kind === "point" && target.anchor.frame_rel ? {
      x: rect.left - bounds.left + rect.width * target.anchor.frame_rel.x, y: rect.top - bounds.top + rect.height * target.anchor.frame_rel.y, width: 0, height: 0,
    } : { x: rect.left - bounds.left, y: rect.top - bounds.top, width: rect.width, height: rect.height };
    capturePromise.current = captureWindowForComment(store, windowId, content, capture).then((value) => { if (live) { setImage(value); session.updateDraft({ image: value }); } return value; }).catch((error) => { if (live) setCaptureError(toCoreError(error)); return undefined; }).finally(() => { if (live) setCapturing(false); });
    return () => { live = false; };
  }, [content, store, target, windowId, session]);
  useEffect(() => {
    const node = box.current, win = content.closest<HTMLElement>(".ks-window");
    if (!node || !win) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const targetRect = target?.range?.getBoundingClientRect() ?? target?.element.getBoundingClientRect() ?? content.getBoundingClientRect();
      const outer = win.getBoundingClientRect(), inner = content.getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(content).getPropertyValue("--ks-space-2"));
      const left = Math.max(inner.left + margin, Math.min(targetRect.left, inner.right - margin - node.offsetWidth));
      const below = targetRect.bottom + margin, above = targetRect.top - node.offsetHeight - margin;
      const top = below + node.offsetHeight <= inner.bottom - margin ? below : above >= inner.top + margin ? above : Math.max(inner.top + margin, inner.bottom - margin - node.offsetHeight);
      node.style.transform = `translate(${left - outer.left}px, ${top - outer.top}px)`;
      onPositioned();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(content);
    content.addEventListener("scroll", schedule, true); schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); content.removeEventListener("scroll", schedule, true); };
  }, [content, target, image, capturing, captureError, onPositioned]);
  const submit = async () => {
    const entry = target?.anchor.pointer && index.get(target.anchor.pointer);
    if (!target || !text.trim() || !entry || busy) return;
    setBusy(true);
    try {
      const captured = includeImage ? image ?? await capturePromise.current : undefined;
      await store.call({ op: "comment.create", app_id: appId, request: { id: id.current, anchor: { ...target.anchor, own_fingerprint: entry.own_fingerprint, parent_child_types: entry.parent_child_types }, text: text.trim(), origin, created_app_version: version, created_definition_digest: digest, created_shell_version: shellVersion, source_window_id: windowId, ...(captured ? { image: captured } : {}) } });
      onClose();
    } catch (error) { onError(toCoreError(error)); } finally { setBusy(false); }
  };
  const quote = target?.anchor.quote?.exact;
  const [blockName, rowName] = target?.path.split(" › ") ?? ["", ""];
  const selectParent = (element: HTMLElement | null) => { if (element) { const parent = describeTarget(element, content); if (parent) onRetarget(parent); } };
  const sends = `${appName} ${version}판${quote ? ", 고른 글" : ""}${includeImage && (image || capturing) ? ", 창 그림" : ""}이 에이전트에게 갑니다`;
  return <div ref={box} role="dialog" aria-label="커멘트 쓰기" className="ks-comment-surface ks-comment-composer" onPointerUp={(event) => {
    if (!(event.target instanceof Element) || event.target.closest("button, input, textarea, a") || !document.getSelection()?.isCollapsed) return;
    input.current?.focus({ preventScroll: true });
  }}>
    {target ? <div className="ks-html-target"><nav className="ks-html-crumbs" aria-label="부모 경로">{rowName || quote ? <button type="button" className="ks-html-crumb" onClick={() => selectParent(target.element.closest<HTMLElement>("[data-ks-block]"))}>{blockName}</button> : blockName}{rowName ? <><span aria-hidden="true">›</span>{quote ? <button type="button" className="ks-html-crumb" onClick={() => selectParent(target.element)}>{rowName}</button> : rowName}</> : null}</nav><div className={`ks-html-target-name${quote || rowName ? " is-quote" : ""}`}>{quote ? `“${quote}”` : rowName ? target.name ?? target.anchor.element?.description : commentLabel(target.anchor, true)}</div><IconButton aria-label="취소" onClick={onClose}><X size="inline" /></IconButton></div> : <div className="ks-html-target"><span>{targetChanged ? "자리를 다시 골라 주세요" : "자리를 골라 주세요"}</span><IconButton aria-label="취소" onClick={onClose}><X size="inline" /></IconButton></div>}
    {targetChanged ? <p className="ks-comment-sends-text" role="alert">{SHELL_COMMENT_TARGET_CHANGED().message} <ErrorId id="SHELL_COMMENT_TARGET_CHANGED" /></p> : null}
    <div className="ks-html-compose"><textarea ref={input} aria-label="커멘트" className="ks-text-input ks-agent-chat-input" rows={1} placeholder="커멘트" value={text} onChange={(event) => { setText(event.target.value); session.updateDraft({ text: event.target.value }); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (text) { setText(""); session.updateDraft({ text: "" }); } else onClose(); } }} /><IconButton aria-label="추가" disabled={!target || !text.trim() || busy} onClick={() => void submit()}><ArrowUp /></IconButton></div>
    <div className="ks-comment-sends">{capturing ? <span className="ks-comment-thumb ks-media-skeleton" aria-busy="true" /> : image && includeImage ? <span className="ks-comment-thumb"><button type="button" onClick={(event) => setPreview(event.currentTarget)} aria-label="창 그림 크게 보기"><img src={`data:image/png;base64,${image.image_base64}`} alt="창 그림" /></button><IconButton className="ks-list-remove" aria-label="창 그림 빼기" onClick={() => { setIncludeImage(false); session.updateDraft({ includeImage: false }); }}><X /></IconButton></span> : <span className="ks-comment-thumb is-removed"><IconButton aria-label="창 그림 넣기" disabled={!image} onClick={() => { setIncludeImage(true); session.updateDraft({ includeImage: true }); }}><Image /></IconButton></span>}<p className="ks-comment-sends-text">{sends}</p></div>
    {captureError ? <p className="ks-comment-sends-text">창 그림을 찍지 못했습니다{captureError.id ? <> <ErrorId id={captureError.id} /></> : null}</p> : null}
    {preview && image ? <ImagePreview preview={{ src: `data:image/png;base64,${image.image_base64}`, name: "창 그림", trigger: preview }} onClose={() => setPreview(null)} /> : null}
  </div>;
}
