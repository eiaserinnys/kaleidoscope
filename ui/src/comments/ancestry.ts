import { overlayOwner } from "../share/overlay-owner";

/** Follow a window-owned portal back to its logical DOM anchor. */
export function* commentAncestors(element: Element): Generator<Element> {
  const seen = new Set<Element>();
  let current: Element | null = element;
  while (current && !seen.has(current)) {
    seen.add(current); yield current;
    const owner = overlayOwner(current);
    if (owner && current.parentElement && overlayOwner(current.parentElement) !== owner && owner.anchor) current = owner.anchor;
    else current = current.parentElement;
  }
}
