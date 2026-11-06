const ranges = new Map<string, Range[]>();
let suspended = 0;

function update() {
  if (typeof CSS === "undefined") return;
  const css = CSS as unknown as { highlights?: Map<string, unknown> };
  const ctor = (globalThis as unknown as { Highlight?: new (...items: Range[]) => unknown }).Highlight;
  if (!css.highlights || !ctor) return;
  const all = [...ranges.values()].flat();
  if (suspended || !all.length) css.highlights.delete("ks-comment");
  else css.highlights.set("ks-comment", new ctor(...all));
}
export function setCommentHighlights(windowId: string, value: Range[]) {
  if (value.length) ranges.set(windowId, value); else ranges.delete(windowId);
  update();
}
export function suspendCommentHighlights() {
  suspended++; update(); let released = false;
  return () => { if (released) return; released = true; suspended--; update(); };
}
