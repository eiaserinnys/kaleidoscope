import { finder } from "@medv/finder";
import search from "approx-string-match";
import { sourceHash } from "./identity";
import type { HtmlAnchor, AnchorStatus } from "./frame-protocol";

export interface ResolvedAnchor { status: AnchorStatus; element: Element | null; range?: Range }
const orphan = (): ResolvedAnchor => ({ status: "orphan", element: null });
const textOf = (element: Element) => (element.textContent ?? "").trim().slice(0, 200);
const numText = (element: Element) => element.tagName.toLowerCase();

function attrs(element: Element): HtmlAnchor["attrs"] {
  return { id: element.getAttribute("id"), role: element.getAttribute("role"), aria_label: element.getAttribute("aria-label"), alt: element.getAttribute("alt"), href: element.getAttribute("href") ?? element.getAttribute("data-ks-href"), src_hash: sourceHash(element.getAttribute("src")) ?? element.getAttribute("data-ks-src-hash") };
}
function pathOf(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node && node.tagName.toLowerCase() !== "html"; node = node.parentElement) {
    const tag = numText(node);
    const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.tagName === node!.tagName) : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
  }
  return parts.join(" > ");
}
function nodes(body: HTMLElement): Text[] {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const result: Text[] = [];
  while (walker.nextNode()) result.push(walker.currentNode as Text);
  return result;
}
function offsets(body: HTMLElement, range: Range): { start: number; end: number } {
  const before = body.ownerDocument.createRange();
  before.selectNodeContents(body); before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}
function makeRange(doc: Document, start: number, end: number): Range | null {
  const texts = nodes(doc.body); let cursor = 0; let first: Text | undefined; let last: Text | undefined; let a = 0; let b = 0;
  for (const node of texts) {
    const next = cursor + node.length;
    if (!first && start >= cursor && start < next) { first = node; a = start - cursor; }
    if (end > cursor && end <= next) { last = node; b = end - cursor; break; }
    cursor = next;
  }
  if (!first || !last) return null;
  const range = doc.createRange(); range.setStart(first, a); range.setEnd(last, b); return range;
}

export function createAnchor(element: Element, range?: Range): HtmlAnchor {
  const doc = element.ownerDocument;
  const selector = finder(element, { root: doc as unknown as Element, attr: (name) => ["role", "aria-label", "alt", "href", "name"].includes(name) });
  const selector_stable = /(?:#[\w-]|\.[\w-]|\[)/.test(selector) && !/:nth-/.test(selector);
  const rect = element.getBoundingClientRect();
  const body = doc.body.textContent ?? "";
  const position = range ? offsets(doc.body, range) : undefined;
  const quote = position ? { exact: range!.toString(), prefix: body.slice(Math.max(0, position.start - 32), position.start), suffix: body.slice(position.end, position.end + 32) } : null;
  const heading = element.closest("section, article, main")?.querySelector("h1,h2,h3,h4,h5,h6")?.textContent?.trim() ?? "";
  return { kind: range ? "text" : "element", selector, selector_stable, path: pathOf(element), tag: numText(element), text: textOf(element), attrs: attrs(element), quote, ...(position ? { position } : {}), label: selector, heading, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, vw: doc.defaultView?.innerWidth ?? 0 } };
}

function contextScore(text: string, start: number, end: number, anchor: HtmlAnchor): number {
  const quote = anchor.quote!; let prefix = 0; let suffix = 0;
  while (prefix < quote.prefix.length && start > prefix && text[start - prefix - 1] === quote.prefix[quote.prefix.length - prefix - 1]) prefix++;
  while (suffix < quote.suffix.length && end + suffix < text.length && text[end + suffix] === quote.suffix[suffix]) suffix++;
  const context = (quote.prefix.length ? prefix / quote.prefix.length : 1) + (quote.suffix.length ? suffix / quote.suffix.length : 1);
  return context + 0.1 / (1 + Math.abs(start - (anchor.position?.start ?? start)));
}

export function resolveAnchor(doc: Document, anchor: HtmlAnchor, sameRevision = false): ResolvedAnchor {
  if (anchor.kind === "text" && anchor.quote?.exact) {
    const text = doc.body.textContent ?? ""; const quote = anchor.quote; const matches: { start: number; end: number; errors: number }[] = [];
    let index = text.indexOf(quote.exact);
    while (index >= 0) { matches.push({ start: index, end: index + quote.exact.length, errors: 0 }); index = text.indexOf(quote.exact, index + 1); }
    const exactCount = matches.length;
    if (!matches.length && quote.exact.length >= 12) matches.push(...search(text, quote.exact, Math.floor(quote.exact.length * 0.2)));
    if (!matches.length) return orphan();
    const ranked = matches.map((item) => ({ ...item, score: contextScore(text, item.start, item.end, anchor) + 2 * (1 - item.errors / quote.exact.length) })).sort((a, b) => b.score - a.score);
    if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.05) return orphan();
    const best = ranked[0];
    if (best.errors && 1 - best.errors / quote.exact.length < 0.8) return orphan();
    const fullContext = text.slice(Math.max(0, best.start - quote.prefix.length), best.start) === quote.prefix && text.slice(best.end, best.end + quote.suffix.length) === quote.suffix;
    if (quote.exact.length < 12 && !fullContext) return orphan();
    const range = makeRange(doc, best.start, best.end);
    if (!range) return orphan();
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return { status: exactCount === 1 && fullContext ? "exact" : "moved", element, range };
  }
  const query = (selector: string): Element[] => { try { return [...doc.querySelectorAll(selector)]; } catch { return []; } };
  if (sameRevision) {
    const found = query(anchor.path);
    if (found.length === 1 && numText(found[0]) === anchor.tag) return { status: "exact", element: found[0] };
  }
  const selected = query(anchor.selector);
  if (selected.length === 1 && numText(selected[0]) === anchor.tag) {
    const text = textOf(selected[0]);
    if ((text && text === anchor.text) || (!text && !anchor.text && anchor.selector_stable)) return { status: pathOf(selected[0]) === anchor.path ? "exact" : "moved", element: selected[0] };
    if (anchor.selector_stable) return { status: "moved", element: selected[0] };
  }
  const candidates = [...doc.querySelectorAll(anchor.tag)];
  if (anchor.text) {
    const same = candidates.filter((item) => textOf(item) === anchor.text);
    return same.length === 1 ? { status: "moved", element: same[0] } : orphan();
  }
  const keys = ["id", "aria_label", "alt", "href", "src_hash"] as const;
  const same = candidates.filter((item) => { const actual = attrs(item); return keys.some((key) => anchor.attrs[key] && anchor.attrs[key] === actual[key]); });
  return same.length === 1 ? { status: "moved", element: same[0] } : orphan();
}
