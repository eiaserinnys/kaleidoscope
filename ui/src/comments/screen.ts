import type { AppCommentAnchor, AppCommentQuote } from "../contract/contract";
import { ownedOverlays, overlayOwner } from "../share/overlay-owner";
import { visibleClip } from "../share/visible";
import { decodeCommentKey } from "./key";
import type { DefinitionResult } from "./definition";
import { frameSurfaces } from "./frame";
import { commentAncestors } from "./ancestry";
import { measureTarget } from "./measure";

export type ScreenContext = { windowId: string; sourceWindowId: string };
export type ScreenResult = { kind: "orphan" | "not_visible" } | { kind: "exact" | "moved"; rect: DOMRect; element: HTMLElement; range?: Range };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const scopeRoots = (root: HTMLElement, windowId: string) => [root, ...ownedOverlays(windowId).filter((e): e is HTMLElement => e instanceof HTMLElement && !root.contains(e))];
function repeatChain(element: Element): unknown[] {
  const keys: unknown[] = [];
  for (const node of commentAncestors(element)) {
    if (node.hasAttribute("data-repeat-key") && node.hasAttribute("data-ks-comment-key")) keys.unshift(decodeCommentKey(node.getAttribute("data-ks-comment-key")!));
  }
  return keys;
}
function visible(element: HTMLElement, rect: DOMRect, includeOffscreen = false): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden") return false;
  }
  let clipElement: HTMLElement | null = element;
  while (clipElement && !clipElement.getClientRects().length) clipElement = clipElement.parentElement;
  if (!clipElement) return false;
  const clip = visibleClip(clipElement);
  return rect.width > 0 && rect.height > 0 && (includeOffscreen || (rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom));
}
function exactQuote(root: HTMLElement, quote: AppCommentQuote): Range | "ambiguous" | null {
  if (!quote.exact) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const content = nodes.map((node) => node.data).join(""); const positions: number[] = [];
  for (let at = content.indexOf(quote.exact); at !== -1; at = content.indexOf(quote.exact, at + 1)) {
    if (content.slice(Math.max(0, at - quote.prefix.length), at) === quote.prefix && content.slice(at + quote.exact.length, at + quote.exact.length + quote.suffix.length) === quote.suffix) positions.push(at);
  }
  if (positions.length > 1) return "ambiguous";
  if (positions.length === 0) return null;
  const start = positions[0], end = start + quote.exact.length; let offset = 0; let first: Text | undefined, last: Text | undefined, a = 0, b = 0;
  for (const node of nodes) { const next = offset + node.length; if (!first && start >= offset && start < next) { first = node; a = start - offset; } if (end > offset && end <= next) { last = node; b = end - offset; break; } offset = next; }
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange(); range.setStart(first, a); range.setEnd(last, b); return range;
}
export function resolveScreen(anchor: AppCommentAnchor, definition: DefinitionResult, windowRoot: HTMLElement, context: ScreenContext, options?: { includeOffscreen?: boolean }): ScreenResult {
  if (definition.kind === "orphan") return { kind: "orphan" };
  const blocks = scopeRoots(windowRoot, context.windowId).flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>("[data-ks-block]")]).filter((el) => el.getAttribute("data-ks-block") === definition.pointer && (!overlayOwner(el) || overlayOwner(el)?.windowId === context.windowId) && same(repeatChain(el), anchor.repeat_chain ?? []));
  let targets: HTMLElement[] = blocks;
  if (anchor.row_identity !== undefined) targets = blocks.flatMap((block) => [block, ...block.querySelectorAll<HTMLElement>("[data-ks-comment-key]")].filter((el) => (anchor.normalized_type === "repeat" || !el.hasAttribute("data-repeat-key")) && same(decodeCommentKey(el.getAttribute("data-ks-comment-key") ?? ""), anchor.row_identity)));
  if (anchor.kind === "control" && anchor.element) targets = targets.flatMap((el) => [el, ...el.querySelectorAll<HTMLElement>(anchor.element!.tag)].filter((candidate) => candidate.tagName.toLowerCase() === anchor.element!.tag && (candidate.getAttribute("role") ?? undefined) === anchor.element!.role && (!anchor.element!.description || (candidate.getAttribute("aria-label") ?? candidate.getAttribute("title") ?? candidate.textContent?.trim()) === anchor.element!.description)));
  if (anchor.kind === "point") {
    if (context.windowId !== context.sourceWindowId || anchor.frame_css_width === undefined || anchor.frame_css_height === undefined || !anchor.frame_rel) return { kind: "not_visible" };
    targets = targets.flatMap((el) => frameSurfaces(el, anchor.normalized_type ?? ""));
    targets = targets.filter((el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) === Math.round(anchor.frame_css_width!) && Math.round(r.height) === Math.round(anchor.frame_css_height!); });
  }
  if (anchor.kind === "text") {
    if (!anchor.quote) return { kind: "not_visible" };
    const results = targets.map((element) => ({ element, range: exactQuote(element, anchor.quote!) }));
    if (results.some(({ range }) => range === "ambiguous")) return { kind: "not_visible" };
    const found = results.filter((item): item is { element: HTMLElement; range: Range } => item.range instanceof Range);
    if (found.length !== 1) return { kind: "not_visible" };
    const { element, range } = found[0]; const rect = range.getBoundingClientRect();
    return visible(element, rect, options?.includeOffscreen) ? { kind: definition.kind, element, range, rect } : { kind: "not_visible" };
  }
  const shown = targets.flatMap((element) => { const rect = measureTarget(element); return rect && visible(element, rect, options?.includeOffscreen) ? [{ element, rect }] : []; });
  if (!shown.length || (anchor.row_identity !== undefined && shown.length !== 1) || ((anchor.kind === "control" || anchor.kind === "point") && shown.length !== 1)) return { kind: "not_visible" };
  const rects = shown.map(({ rect }) => rect); const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top)), right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
  if (anchor.kind === "point" && anchor.frame_rel) return { kind: definition.kind, element: shown[0].element, rect: new DOMRect(left + (right - left) * anchor.frame_rel.x, top + (bottom - top) * anchor.frame_rel.y, 0, 0) };
  return { kind: definition.kind, element: shown[0].element, rect: new DOMRect(left, top, right - left, bottom - top) };
}
