import { createAnchor, resolveAnchor } from "./anchor";
import { applyEdit, findNumber } from "./edit";
import type { FrameComment, FrameSelection, FrameToParent, ParentToFrame } from "./frame-protocol";

const send = (message: FrameToParent) => parent.postMessage(message, "*");
let mode: "select" | "view" | "readonly" = "readonly";
let selected: Element | null = null;
let hover: Element | null = null;
let comments: FrameComment[] = [];
let editing: { element: HTMLElement; before: string } | null = null;
let frame = 0;
let lastResults = "";
const host = document.createElement("div");
host.setAttribute("data-ks-overlay", "");
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `<style>
:host { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.outline { position: fixed; box-sizing: border-box; border: var(--ks-line-width) solid var(--ks-color-accent); pointer-events: none; }
.outline.selected { border-width: var(--ks-focus-width); }
.label { position: absolute; left: 0; top: 0; transform: translateY(-100%); background: var(--ks-color-accent); color: var(--ks-color-accent-contrast); font: var(--ks-type-meta) var(--ks-font-family); padding: var(--ks-space-1) var(--ks-space-2); pointer-events: auto; }
.pin { position: fixed; transform: translate(-50%, -50%); min-width: var(--ks-space-5); height: var(--ks-space-5); border: 0; border-radius: var(--ks-radius-large); padding: 0 var(--ks-space-1); background: var(--ks-color-accent); color: var(--ks-color-accent-contrast); font: var(--ks-type-meta) var(--ks-font-family); cursor: pointer; pointer-events: auto; }
</style><div id="layer"></div>`;
const layer = shadow.querySelector("#layer")!;
document.documentElement.append(host);
const resize = new ResizeObserver(() => schedule());
const mutation = new MutationObserver(() => { visible(); schedule(); });
let observing = false;
function visible() { send({ type: "ks-html-visible-text", text: document.body?.innerText || "" }); }
function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
function updateObservation(active: boolean) {
  if (active === observing) return;
  observing = active;
  if (active) { resize.observe(document.documentElement); mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); }
  else { resize.disconnect(); mutation.disconnect(); }
}
function outline(element: Element | null, name: string) {
  if (!element || !element.isConnected) return;
  const rect = element.getBoundingClientRect();
  const box = document.createElement("div"); box.className = `outline ${name}`;
  Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const label = document.createElement("span"); label.className = "label"; label.textContent = element.tagName.toLowerCase(); box.append(label); layer.append(box);
}
function draw() {
  frame = 0; layer.replaceChildren();
  outline(mode === "select" ? hover : null, "hover"); outline(mode === "select" ? selected : null, "selected");
  const results: Record<string, "exact" | "moved" | "orphan"> = {}; const ranges: Range[] = [];
  for (const comment of comments) {
    const result = resolveAnchor(document, comment.anchor, comment.sameRevision); results[comment.id] = result.status;
    if (!result.element) continue;
    if (result.range) ranges.push(result.range);
    const rect = result.range?.getBoundingClientRect() ?? result.element.getBoundingClientRect();
    const pin = document.createElement("button"); pin.className = "pin"; pin.textContent = `${comment.number}${result.status === "moved" ? "·" : ""}`;
    pin.style.left = `${rect.right}px`; pin.style.top = `${rect.top}px`;
    pin.addEventListener("click", (event) => { event.stopPropagation(); send({ type: "ks-html-select-comment", id: comment.id }); });
    layer.append(pin);
  }
  const highlights = (CSS as unknown as { highlights?: { set(name: string, value: unknown): void } }).highlights;
  const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (highlights && HighlightClass) highlights.set("ks-html-comments", new HighlightClass(...ranges));
  const encoded = JSON.stringify(results);
  if (encoded !== lastResults) { lastResults = encoded; send({ type: "ks-html-anchor-results", results }); }
  updateObservation(Boolean(hover || selected || comments.length));
}
function selectionOf(element: Element, range?: Range): FrameSelection | null {
  const n = Number(element.getAttribute("data-ks-n")); if (!n) return null;
  const computed = getComputedStyle(element);
  const names = ["color", "background-color", "font-family", "font-size", "font-weight", "line-height", "margin", "padding", "width", "height", "border", "border-radius", "box-shadow", "opacity"];
  return { n, anchor: createAnchor(element, range), styles: Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name)])) };
}
function select(element: Element | null, range?: Range) {
  selected = element; schedule();
  send({ type: "ks-html-select", selection: element ? selectionOf(element, range) : null });
}
function finishEdit(cancel: boolean) {
  if (!editing) return;
  const { element, before } = editing; editing = null;
  const after = element.textContent ?? "";
  element.removeAttribute("contenteditable");
  element.textContent = before;
  if (!cancel && before !== after) send({ type: "ks-html-text-edit", n: Number(element.getAttribute("data-ks-n")), before, after });
}
function startEdit(element: Element | null) {
  if (!(element instanceof HTMLElement) || element.children.length || !element.textContent?.trim()) return;
  finishEdit(false); editing = { element, before: element.textContent }; element.setAttribute("contenteditable", "plaintext-only"); element.focus();
}
document.addEventListener("pointermove", (event) => {
  if (mode !== "select" || editing) return;
  const target = event.target; const next = target instanceof Element && target.hasAttribute("data-ks-n") ? target : null;
  if (next !== hover) { hover = next; schedule(); }
}, true);
document.addEventListener("mousedown", (event) => {
  if (mode !== "select") return;
  if (editing && event.target !== editing.element) finishEdit(false);
  const current = getSelection();
  if (current?.rangeCount && event.target instanceof Node && !current.getRangeAt(0).intersectsNode(event.target)) current.removeAllRanges();
}, true);
document.addEventListener("mouseup", () => {
  if (mode !== "select" || editing) return;
  const current = getSelection(); if (!current || current.isCollapsed || !current.toString().trim() || !current.rangeCount) return;
  const range = current.getRangeAt(0); const node = range.commonAncestorContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if (element) select(element, range);
}, true);
document.addEventListener("click", (event) => {
  if (mode === "readonly") { if (event.target instanceof Element && event.target.closest("a")) event.preventDefault(); return; }
  if (mode !== "select" || editing) return;
  event.preventDefault(); event.stopPropagation();
  if (getSelection()?.toString().trim()) return;
  if (event.target instanceof Element) select(event.target.closest("[data-ks-n]"));
}, true);
document.addEventListener("dblclick", (event) => { if (mode === "select" && event.target instanceof Element) { event.preventDefault(); startEdit(event.target); } }, true);
document.addEventListener("focusout", (event) => { if (editing && event.target === editing.element) finishEdit(false); }, true);
document.addEventListener("keydown", (event) => {
  if (editing) {
    if (event.key === "Escape") { event.preventDefault(); finishEdit(true); }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finishEdit(false); }
    return;
  }
  if (mode !== "select") return;
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
  if (data.type === "ks-html-mode") { mode = data.mode; hover = null; schedule(); }
  else if (data.type === "ks-html-select-number") select(data.n === null ? null : findNumber(document, data.n));
  else if (data.type === "ks-html-comments") { comments = data.comments; schedule(); }
  else if (data.type === "ks-html-edit") { applyEdit(document, data.edit); visible(); schedule(); }
  else if (data.type === "ks-html-focus-comment") { const comment = comments.find((item) => item.id === data.id); if (comment) resolveAnchor(document, comment.anchor, comment.sameRevision).element?.scrollIntoView({ block: "center" }); }
});
const ready = () => { visible(); send({ type: "ks-html-ready" }); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
