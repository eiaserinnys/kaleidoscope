/** The marker may use display: contents, which has no box of its own. */
export function measureTarget(element: Element): DOMRect | null {
  if (element.getClientRects().length) return element.getBoundingClientRect();
  const rects = Array.from(element.children, measureTarget).filter((rect): rect is DOMRect => rect !== null && rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}
