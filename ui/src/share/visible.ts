import { useLayoutEffect, type RefObject } from "react";
import { SHARE_TEXT_CUT_MARK, SHARE_TEXT_MAX_BYTES } from "../contract/limits";

type Description = { text: string; visual: boolean; image_base64?: string; continue?: boolean };
const describers = new WeakMap<HTMLElement, () => Description>();

export function useShareDescriber(ref: RefObject<HTMLElement | null>, describe: () => Description) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    describers.set(element, describe);
    return () => { describers.delete(element); };
  });
}

type Clip = { left: number; top: number; right: number; bottom: number };
const intersect = (a: Clip, b: Clip): Clip => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const overlaps = (r: Clip, clip: Clip) => r.right > clip.left && r.left < clip.right && r.bottom > clip.top && r.top < clip.bottom;

export function visibleClip(element: HTMLElement): Clip {
  let clip: Clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent === element || style.overflowX !== "visible" || style.overflowY !== "visible") clip = intersect(clip, parent.getBoundingClientRect());
  }
  return clip;
}

export function limitShareText(text: string): string {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  const encoder = new TextEncoder();
  if (encoder.encode(normalized).length <= SHARE_TEXT_MAX_BYTES) return normalized;
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (encoder.encode([...lines, line, SHARE_TEXT_CUT_MARK].join("\n")).length > SHARE_TEXT_MAX_BYTES) break;
    lines.push(line);
  }
  return [...lines, SHARE_TEXT_CUT_MARK].join("\n");
}

const roles: Record<string, { label: string; selector: string; unit: string }> = {
  table: { label: "표", selector: '[role="row"]', unit: "줄" },
  grid: { label: "표", selector: '[role="row"]', unit: "줄" },
  treegrid: { label: "표", selector: '[role="row"]', unit: "줄" },
  listbox: { label: "목록", selector: '[role="option"]', unit: "개" },
  list: { label: "목록", selector: '[role="listitem"]', unit: "개" },
  tree: { label: "트리", selector: '[role="treeitem"]', unit: "개" },
  feed: { label: "흐름", selector: 'article', unit: "개" },
};

export function describeVisible(root: HTMLElement): { text: string; visual: boolean; image_base64?: string } {
  const rootClip = visibleClip(root);
  let output = "";
  let visual = false;
  let image_base64: string | undefined;
  const newline = () => { if (output && !output.endsWith("\n") && !output.endsWith("› ")) output += "\n"; };
  const append = (text: string, pre = false) => {
    if (pre) { output += text; return; }
    const collapsed = text.replace(/\s+/g, " ");
    if (collapsed === " " && (!output || /[ \n]$/.test(output))) return;
    output += collapsed;
  };

  const walk = (node: Node, clip: Clip, inline = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const pre = getComputedStyle(node.parentElement!).whiteSpace.startsWith("pre");
      const range = document.createRange();
      for (const match of text.matchAll(/\S+|\s+/g)) {
        const start = match.index; const end = start + match[0].length;
        range.setStart(node, start); range.setEnd(node, end);
        const rects = Array.from(range.getClientRects());
        if (!rects.some((rect) => overlaps(rect, clip))) continue;
        if (rects.every((rect) => rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom)) {
          append(match[0], pre);
        } else {
          for (let offset = start; offset < end;) {
            const size = text.codePointAt(offset)! > 0xffff ? 2 : 1;
            range.setStart(node, offset); range.setEnd(node, offset + size);
            if (Array.from(range.getClientRects()).some((rect) => overlaps(rect, clip))) append(text.slice(offset, offset + size), pre);
            offset += size;
          }
        }
      }
      return;
    }
    if (!(node instanceof HTMLElement) || node.hidden || node.getAttribute("aria-hidden") === "true" || node.hasAttribute("data-ks-share-skip")) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || !overlaps(rect, clip)) return;
    const childClip = style.overflowX !== "visible" || style.overflowY !== "visible" ? intersect(clip, rect) : clip;
    const description = describers.get(node)?.();
    if (description) {
      newline(); append(description.text, true); newline(); visual ||= description.visual;
      image_base64 ||= description.image_base64;
      if (!description.continue) return;
    }
    const role = node.getAttribute("role") ?? "";
    const group = roles[role];
    if (group) {
      const items = Array.from(node.querySelectorAll<HTMLElement>(group.selector)).filter((item) => {
        if (item.closest('[role="table"], [role="grid"], [role="treegrid"], [role="listbox"], [role="list"], [role="tree"], [role="feed"]') !== node) return false;
        const row = role === "tree" && item.firstElementChild instanceof HTMLElement && item.firstElementChild.tagName === "BUTTON" ? item.firstElementChild : item;
        const itemStyle = getComputedStyle(row);
        return itemStyle.display !== "none" && itemStyle.visibility !== "hidden" && overlaps(row.getBoundingClientRect(), visibleClip(row));
      });
      const indexed = items.filter((item) => !(group.label === "표" && item.querySelector('[role="columnheader"]')));
      const position = (item: HTMLElement) => Number(item.getAttribute("aria-rowindex") ?? item.getAttribute("aria-posinset") ?? (item.dataset.index === undefined ? 0 : Number(item.dataset.index) + 1));
      const positions = indexed.map(position).filter(Boolean);
      const total = Number(node.getAttribute("aria-rowcount") ?? indexed[0]?.getAttribute("aria-setsize") ?? indexed.length);
      if (positions.length) { newline(); append(`[${group.label}, 전체 ${total}${group.unit} 중 ${Math.min(...positions)}~${Math.max(...positions)}번째]`); newline(); }
      else { newline(); append(`[${group.label}, 전체 ${total}${group.unit}]`); newline(); }
    }
    const block = /^(block|flex|grid|list-item|table|table-row|table-cell|flow-root)/.test(style.display);
    if (block && !inline) newline();
    if (node.getAttribute("aria-selected") === "true" || (node.hasAttribute("aria-current") && node.getAttribute("aria-current") !== "false")) append("› ", true);
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || role === "checkbox" || role === "switch") {
      const label = node.getAttribute("aria-label") || ("labels" in node ? Array.from((node as HTMLInputElement).labels ?? []).map((el) => el.textContent).join(" ") : "") || node.getAttribute("placeholder") || "";
      if ((node instanceof HTMLInputElement && node.type === "checkbox") || role === "checkbox" || role === "switch") {
        const checked = node instanceof HTMLInputElement ? node.checked : node.getAttribute("aria-checked") === "true";
        append(`${checked ? "[x]" : "[ ]"} ${label || node.textContent || ""}`);
      } else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) append(`${label}: ${node.value}`);
    } else if (node instanceof HTMLImageElement) {
      append(`[이미지: ${node.alt || node.currentSrc.split("/").pop() || ""}]`);
      if (rect.width > 24 || rect.height > 24) visual = true;
    } else if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
      append(`[${node instanceof HTMLVideoElement ? "영상" : "소리"}: ${node.getAttribute("aria-label") || node.getAttribute("title") || node.currentSrc.split("/").pop() || ""}]`);
      if (node instanceof HTMLVideoElement) visual = true;
    } else if (node instanceof HTMLCanvasElement) {
      visual = true;
      if (!image_base64) {
        try {
          const dataUrl = node.toDataURL("image/png");
          const prefix = "data:image/png;base64,";
          if (dataUrl.startsWith(prefix)) image_base64 = dataUrl.slice(prefix.length);
        } catch { /* 캔버스 원본이 외부 출처일 수 있다. */ }
      }
    }
    else if (role === "row") {
      const cells = Array.from(node.children).filter((child) => ["cell", "gridcell", "columnheader", "rowheader"].includes(child.getAttribute("role") ?? ""));
      if (cells.length) cells.forEach((cell, index) => { if (index) append(" | ", true); walk(cell, childClip, true); });
      else node.childNodes.forEach((child) => walk(child, childClip, inline));
    } else node.childNodes.forEach((child) => walk(child, childClip, inline));
    if (block && !inline) newline();
  };
  walk(root, rootClip);
  return { text: limitShareText(output), visual, ...(image_base64 ? { image_base64 } : {}) };
}
