import overlayCss from "./overlay.css?raw";
import { createAnchor, elementName, resolveAnchor } from "./anchor";
import { applyEdit, findNumber } from "./edit";
import type { FrameComment, FrameSelection, FrameToParent, ParentToFrame } from "./frame-protocol";

const send = (message: FrameToParent) => parent.postMessage(message, "*");
let mode: "select" | "view" | "readonly" = "readonly";
let locked = false;
let colors: string[] = [];
let selected: Element | null = null;
let hover: Element | null = null;
let pending: Range | null = null;
let comments: FrameComment[] = [];
let located: { comment: FrameComment; result: ReturnType<typeof resolveAnchor> }[] = [];
let anchorsDirty = true;
let editing: { element: HTMLElement; before: string } | null = null;
let frame = 0;
let lastResults = "{}";
const host = document.createElement("div");
host.setAttribute("data-ks-overlay", "");
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = overlayCss;
const layer = document.createElement("div");
shadow.append(style, layer);
document.documentElement.append(host);
const resize = new ResizeObserver(() => schedule());
const mutation = new MutationObserver((records) => {
  anchorsDirty = true;
  if (records.some((item) => item.type === "childList" || item.type === "characterData")) visible();
  schedule();
});
let observing = false;
function visible() { send({ type: "ks-html-visible-text", text: document.body?.innerText || "" }); }
function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
function updateObservation(active: boolean) {
  if (active === observing) return;
  observing = active;
  if (active) { resize.observe(document.documentElement); mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); }
  else { resize.disconnect(); mutation.disconnect(); }
}
function token(name: string, fallback: number) { return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback; }
function box(element: Element | null, kind: "is-hover" | "is-selected", labels: HTMLElement[]) {
  if (!element || !element.isConnected) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const width = token(kind === "is-hover" ? "--ks-line-width" : "--ks-focus-width", kind === "is-hover" ? 1 : 2);
  const left = rect.left - width; const top = rect.top - width;
  const outline = document.createElement("div"); outline.className = `ks-o-box ${kind}`;
  Object.assign(outline.style, { left: `${left}px`, top: `${top}px`, width: `${rect.width + 2 * width}px`, height: `${rect.height + 2 * width}px` });
  layer.append(outline);
  const label = document.createElement("div"); label.className = `ks-o-tag${kind === "is-hover" ? " is-hover" : ""}`;
  label.textContent = elementName(element); labels.push(label);
  label.dataset.left = String(left); label.dataset.top = String(top);
}
function highlights(ranges: Range[], active: Range[]) {
  const registry = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void } }).highlights;
  const HighlightClass = (window as unknown as { Highlight?: new (...items: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightClass) return;
  registry.set("ks-comment", new HighlightClass(...ranges));
  registry.set("ks-comment-active", new HighlightClass(...active));
  registry.set("ks-pending", new HighlightClass(...(pending ? [pending] : [])));
}
function draw() {
  frame = 0; layer.replaceChildren();
  const labels: HTMLElement[] = [];
  box(mode === "select" ? hover : null, "is-hover", labels);
  box(mode === "select" && !pending ? selected : null, "is-selected", labels);
  const gap = token("--ks-space-1", 4); const size = token("--ks-space-5", 24);
  for (const label of labels) {
    layer.append(label);
    const top = Number(label.dataset.top); const height = label.getBoundingClientRect().height;
    const inside = top < height;
    if (inside) label.classList.add("is-inside");
    label.style.top = `${inside ? top : top - height}px`;
    label.style.left = `${Math.max(gap, Math.min(Number(label.dataset.left), innerWidth - label.getBoundingClientRect().width - gap))}px`;
  }
  if (anchorsDirty) { located = comments.map((comment) => ({ comment, result: resolveAnchor(document, comment.anchor, comment.sameRevision) })); anchorsDirty = false; }
  const results: Record<string, "exact" | "moved" | "orphan"> = {}; const ranges: Range[] = []; const activeRanges: Range[] = [];
  const pinPositions = new Map<string, number>();
  for (const { comment, result } of located) {
    results[comment.id] = result.status;
    if (!result.element || (comment.resolved && !comment.active)) continue;
    if (result.range) (comment.active ? activeRanges : ranges).push(result.range);
    const rect = result.range?.getClientRects()[0] ?? result.range?.getBoundingClientRect() ?? result.element.getBoundingClientRect();
    const x = Math.min(Math.max(rect.right - gap, gap), innerWidth - size - gap);
    const y = Math.max(rect.top + gap - size, gap);
    const position = `${Math.round(x)}:${Math.round(y)}`; const offset = pinPositions.get(position) ?? 0;
    pinPositions.set(position, offset + 1);
    const pin = document.createElement("button"); pin.className = `ks-o-pin${result.status === "moved" ? " is-moved" : ""}${comment.active ? " is-active" : ""}`;
    pin.textContent = String(comment.number); pin.style.left = `${Math.max(gap, x - offset * (size + gap))}px`; pin.style.top = `${y}px`;
    pin.addEventListener("click", (event) => { event.stopPropagation(); if (!locked) send({ type: "ks-html-select-comment", id: comment.id }); });
    layer.append(pin);
  }
  highlights(ranges, activeRanges);
  const encoded = JSON.stringify(results);
  if (encoded !== lastResults) { lastResults = encoded; send({ type: "ks-html-anchor-results", results }); }
  updateObservation(Boolean(hover || selected || comments.length));
}
const styleNames = ["font-size", "font-weight", "line-height", "letter-spacing", "text-align", "color", "background-color", "background-image", "border-color", "border-width", "border-style", "border-radius", "opacity", "box-shadow", "display", "flex-direction", "grid-auto-flow", "gap", "justify-content", "align-items", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "width", "height"];
function documentColors() {
  const counts = new Map<string, number>();
  for (const item of document.body.querySelectorAll("*")) {
    const computed = getComputedStyle(item);
    for (const name of ["color", "background-color", "border-color"]) {
      const value = computed.getPropertyValue(name).trim();
      if (value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)") counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([color]) => color);
}
function selectionOf(element: Element, range?: Range): FrameSelection | null {
  const n = Number(element.getAttribute("data-ks-n")); if (!n) return null;
  const computed = getComputedStyle(element); const rect = element.getBoundingClientRect();
  const ancestors: FrameSelection["ancestors"] = [];
  for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const number = Number(node.getAttribute("data-ks-n")); if (number) ancestors.unshift({ n: number, label: elementName(node, 1) });
  }
  return { n, anchor: createAnchor(element, range), name: elementName(element), ancestors, hasChildren: element.children.length > 0,
    text: element.children.length ? "" : element.textContent ?? "", first: !element.previousElementSibling, last: !element.nextElementSibling,
    rect: { width: Math.round(rect.width), height: Math.round(rect.height) }, colors,
    styles: Object.fromEntries(styleNames.map((name) => [name, computed.getPropertyValue(name)])) };
}
function select(element: Element | null, range?: Range) {
  if (element === document.documentElement) element = document.body;
  selected = element; pending = range?.cloneRange() ?? null;
  hover = null;
  document.documentElement.toggleAttribute("data-ks-pending", Boolean(range));
  if (!range) getSelection()?.removeAllRanges();
  schedule();
  send({ type: "ks-html-select", selection: element ? selectionOf(element, range) : null });
}
function finishEdit(cancel: boolean) {
  if (!editing) return;
  const { element, before } = editing; editing = null;
  const after = element.textContent ?? "";
  element.removeAttribute("contenteditable"); element.textContent = before;
  if (!cancel && before !== after) send({ type: "ks-html-text-edit", n: Number(element.getAttribute("data-ks-n")), before, after });
}
function startEdit(element: Element | null) {
  if (!(element instanceof HTMLElement) || element.children.length || !element.textContent?.trim()) return;
  finishEdit(false); editing = { element, before: element.textContent }; element.setAttribute("contenteditable", "plaintext-only"); element.focus();
}
document.addEventListener("pointermove", (event) => {
  if (locked || mode !== "select" || editing) return;
  const target = event.target; const next = target === document.documentElement ? document.body : target instanceof Element && target.hasAttribute("data-ks-n") ? target : null;
  if (next !== hover) { hover = next; schedule(); }
}, true);
document.documentElement.addEventListener("pointerleave", () => { if (hover) { hover = null; schedule(); } });
const isPinEvent = (event: Event) => {
  const first = event.composedPath()[0];
  return first === host || (first instanceof Element && first.classList.contains("ks-o-pin"));
};
document.addEventListener("pointerdown", (event) => { if (locked) { event.preventDefault(); event.stopPropagation(); } }, true);
document.addEventListener("mousedown", (event) => {
  if (locked) { event.preventDefault(); event.stopPropagation(); return; }
  if (mode !== "select" || isPinEvent(event)) return;
  document.documentElement.removeAttribute("data-ks-pending");
  if (editing && event.target !== editing.element) finishEdit(false);
  const current = getSelection();
  if (current?.rangeCount && event.target instanceof Node && !current.getRangeAt(0).intersectsNode(event.target)) {
    current.removeAllRanges();
  }
}, true);
document.addEventListener("mouseup", (event) => {
  if (locked || mode !== "select" || editing) return;
  if (event.detail >= 2 && event.target instanceof HTMLElement && !event.target.children.length && event.target.textContent?.trim()) return;
  const current = getSelection(); if (!current || current.isCollapsed || !current.toString().trim() || !current.rangeCount) return;
  const range = current.getRangeAt(0); const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if (element) select(element, range);
}, true);
document.addEventListener("click", (event) => {
  if (locked) { event.preventDefault(); event.stopPropagation(); return; }
  if (isPinEvent(event)) return;
  if (mode === "view" && event.target instanceof Element) {
    const link = event.target.closest("a");
    if (link) {
      event.preventDefault();
      const href = link.getAttribute("data-ks-href") ?? link.getAttribute("href") ?? "";
      if (href.startsWith("#")) document.getElementById(href.slice(1))?.scrollIntoView();
      return;
    }
  }
  if (mode === "readonly") { if (event.target instanceof Element && event.target.closest("a")) event.preventDefault(); return; }
  if (mode !== "select" || editing) return;
  event.preventDefault(); event.stopPropagation();
  if (getSelection()?.toString().trim()) return;
  if (event.target instanceof Element) select(event.target.closest("[data-ks-n]"));
}, true);
document.addEventListener("dblclick", (event) => { if (!locked && mode === "select" && event.target instanceof Element) { event.preventDefault(); startEdit(event.target); } }, true);
document.addEventListener("focusout", (event) => { if (editing && event.target === editing.element) finishEdit(false); }, true);
document.addEventListener("keydown", (event) => {
  if (locked) { event.preventDefault(); event.stopPropagation(); return; }
  if (isPinEvent(event)) return;
  if (editing) {
    if (event.key === "Escape") { event.preventDefault(); finishEdit(true); }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finishEdit(false); }
    return;
  }
  if (mode !== "select") return;
  if (event.key === "Tab" && !selected) return;
  if (event.key === "Enter" && !event.shiftKey && selected && !selected.children.length && selected.textContent?.trim()) { event.preventDefault(); startEdit(selected); return; }
  if (["Escape", "Enter", "Tab", "Delete", "Backspace"].includes(event.key) || (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) || (event.ctrlKey && ["d", "z", "y"].includes(event.key.toLowerCase()))) {
    event.preventDefault(); event.stopPropagation();
    send({ type: "ks-html-key", key: event.key, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey });
  }
}, true);
window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
window.addEventListener("message", (event: MessageEvent<ParentToFrame>) => {
  if (event.source !== parent || !event.data || typeof event.data !== "object") return;
  const data = event.data;
  if (data.type === "ks-html-mode") { mode = data.mode; hover = null; if (mode === "view") select(null); schedule(); }
  else if (data.type === "ks-html-lock") {
    locked = data.locked;
    if (locked) { finishEdit(true); hover = null; schedule(); }
  }
  else if (data.type === "ks-html-select-number") {
    const element = data.n === null ? null : findNumber(document, data.n);
    if (element) element.scrollIntoView({ block: "nearest" });
    select(element);
  }
  else if (data.type === "ks-html-comments") { comments = data.comments; anchorsDirty = true; schedule(); }
  else if (data.type === "ks-html-theme") { for (const [name, value] of Object.entries(data.tokens)) document.documentElement.style.setProperty(name, value); schedule(); }
  else if (data.type === "ks-html-edit") {
    applyEdit(document, data.edit);
    if (data.edit.kind === "style" && ["color", "background-color", "border-color"].includes(data.edit.prop)) colors = documentColors();
    if (data.edit.kind !== "style" || data.edit.prop === "display") visible();
    schedule();
  }
  else if (data.type === "ks-html-refresh-selection") send({ type: "ks-html-select", selection: selected ? selectionOf(selected, pending ?? undefined) : null });
  else if (data.type === "ks-html-focus-comment") { const comment = comments.find((item) => item.id === data.id); if (comment) resolveAnchor(document, comment.anchor, comment.sameRevision).element?.scrollIntoView({ block: "center" }); }
});
const ready = () => { colors = documentColors(); visible(); send({ type: "ks-html-ready" }); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
