import type { AppCommentAnchor, AppCommentPoint } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { overlayOwner } from "../share/overlay-owner";
import { decodeCommentKey } from "./key";
import { frameSurfaces } from "./frame";
import { commentAncestors } from "./ancestry";
import { measureTarget } from "./measure";

import { blockName as nameOfBlock } from "./label";
const frames = new Set(["canvas", "sandbox", "html_view", "web_view"]);
const controls = 'button, input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], [role="slider"]';
export type TargetDescription = { anchor: AppCommentAnchor; path: string; name?: string; element: HTMLElement; rect: DOMRect | null; range?: Range };

/** Selects only DOM belonging to this window; a frame's contents are never inspected. */
export function describeTarget(element: HTMLElement, windowRoot: HTMLElement, frameRel?: AppCommentPoint, elementRel?: AppCommentPoint): TargetDescription | null {
  const overlay = overlayOwner(element);
  const windowId = windowRoot.closest<HTMLElement>("[data-window-id]")?.dataset.windowId ?? windowRoot.dataset.windowId;
  if (!windowRoot.contains(element) && (!overlay || overlay.windowId !== windowId)) return null;
  const block = element.closest<HTMLElement>("[data-ks-block]");
  if (!block) return null;
  const pointer = block.dataset.ksBlock!, type = block.dataset.ksBlockType!;
  const rows: JsonValue[] = []; let row: HTMLElement | null = null;
  for (const node of commentAncestors(element)) {
    const raw = node.getAttribute("data-ks-comment-key");
    if (raw !== null) { const key = decodeCommentKey(raw); if (key !== undefined) { if (node.hasAttribute("data-repeat-key")) { if (type === "repeat" && block.contains(node) && !row && node instanceof HTMLElement) row = node; else rows.unshift(key); } else if (!row && node instanceof HTMLElement) row = node; } }
    if (node === windowRoot) break;
  }
  const selection = element.ownerDocument.getSelection();
  const selected = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined;
  const range = selected && block.contains(selected.commonAncestorContainer) && (!row || row.contains(selected.commonAncestorContainer)) ? selected.cloneRange() : undefined;
  const unkeyedRow = element.closest<HTMLElement>('[role="row"], [role="option"], [role="treeitem"], .ks-feed-entry, [data-repeat-key]');
  const control = unkeyedRow && !unkeyedRow.hasAttribute("data-ks-comment-key") ? null : element.closest<HTMLElement>(controls);
  const surface = frames.has(type) ? frameSurfaces(block, type).find((candidate) => candidate === element || candidate.contains(element) || (frameRel && element.contains(candidate))) : undefined;
  const selectedControl = control && block.contains(control) ? control : null;
  const target = range ? row ?? block : surface ?? row ?? selectedControl ?? block;
  const kind: AppCommentAnchor["kind"] = range ? "text" : surface ? "point" : row ? "row" : selectedControl ? "control" : "block";
  const rect = measureTarget(target);
  const cells = row ? [...row.querySelectorAll<HTMLElement>('[role="cell"], [role="gridcell"]')].map((cell) => cell.textContent?.trim() ?? "").filter((text) => text && /\D/.test(text)) : [];
  const primary = row?.querySelector<HTMLElement>(".ks-feed-body")?.textContent?.trim() ?? cells.sort((a, b) => b.length - a.length)[0];
  const position = row?.getAttribute("aria-rowindex") ?? row?.getAttribute("aria-posinset");
  const blockName = nameOfBlock(type);
  const rawName = target.getAttribute("aria-label") ?? target.getAttribute("title") ?? (target.textContent?.trim() || "").slice(0, 200);
  const name = row ? `“${(primary ?? rawName).slice(0, 200)}”` : rawName;
  const path = `${blockName}${row ? ` › ${position ? `${position}행` : "행"}` : ""}`;
  const description = row ? `${path.replace(" › ", " ")}${range ? ` “${range.toString()}”` : name ? ` ${name}` : ""}` : name;
  const anchor: AppCommentAnchor = { schema_version: 1, kind, pointer, normalized_type: type,
    ...(rows.length ? { repeat_chain: rows } : {}),
    ...(row ? { row_identity: decodeCommentKey(row.getAttribute("data-ks-comment-key")!) } : {}),
    ...(elementRel ? { element_rel: elementRel } : {}),
    element: { tag: target.tagName.toLowerCase(), ...(target.getAttribute("role") ? { role: target.getAttribute("role")! } : {}), ...(description ? { description } : {}) },
  };
  if (range) {
    const container = row ?? block; const before = element.ownerDocument.createRange(); before.selectNodeContents(container); before.setEnd(range.startContainer, range.startOffset);
    const content = container.textContent ?? "", start = before.toString().length, exact = range.toString();
    anchor.quote = { exact, prefix: content.slice(Math.max(0, start - 32), start), suffix: content.slice(start + exact.length, start + exact.length + 32) };
  }
  if (kind === "point") { if (rect) { anchor.frame_css_width = rect.width; anchor.frame_css_height = rect.height; } if (frameRel) anchor.frame_rel = frameRel; }
  return { anchor, path, name: row ? name : name === blockName ? "" : name, element: target, rect, ...(range ? { range } : {}) };
}
