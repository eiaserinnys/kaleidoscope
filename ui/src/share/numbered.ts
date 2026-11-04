import { describeVisible, limitShareText, visibleClip } from "./visible";
import { inConsent, ownedOverlays, overlayOwner } from "./overlay-owner";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

type Entry = { number: number; identity: string };
type Table = { elements: WeakMap<Element, Entry>; visible: Map<number, { ref: WeakRef<HTMLElement>; identity: string }>; next: number; root: HTMLElement };
const tables = new Map<string, Table>();

export type ResolveResult = { element: HTMLElement } | { reason: "stale" | "hidden" | "disabled" | "readonly" | "consent" };

const roles: Record<string, string> = {
  button: "단추", checkbox: "체크 상자", switch: "스위치", radio: "라디오", combobox: "고르기",
  listbox: "목록", option: "목록 항목", tab: "탭", menuitem: "메뉴 항목", treeitem: "트리 항목",
  slider: "슬라이더", separator: "분할선",
};

function kind(element: HTMLElement): string | null {
  const role = element.getAttribute("role") ?? "";
  if ((role === "row" || role === "option") && element.getAttribute("data-ks-share-readonly") === "true") return null;
  if (role === "row") return element.hasAttribute("aria-selected") ? "목록 행" : null;
  if (roles[role]) return roles[role];
  if (element instanceof HTMLButtonElement || (element instanceof HTMLAnchorElement && element.hasAttribute("href"))) return "단추";
  if (element instanceof HTMLInputElement) {
    if (element.type === "hidden") return null;
    if (element.type === "checkbox") return "체크 상자";
    if (element.type === "radio") return "라디오";
    if (element.type === "range") return "슬라이더";
    if (["button", "submit", "reset"].includes(element.type)) return "단추";
    return "입력칸";
  }
  if (element instanceof HTMLTextAreaElement) return "입력칸";
  if (element instanceof HTMLSelectElement) return "고르기";
  if (element.classList.contains("cm-content")) return "입력칸";
  if (element.getAttribute("contenteditable") === "true" || element.getAttribute("contenteditable") === "plaintext-only") return "입력칸";
  const style = getComputedStyle(element);
  if (["auto", "scroll"].includes(style.overflowY) || ["auto", "scroll"].includes(style.overflowX)) return "스크롤 영역";
  return null;
}

function identity(element: HTMLElement): string {
  for (const name of ["data-row-key", "data-tree-row", "data-file-path", "data-folder-path", "aria-posinset", "aria-rowindex"]) {
    const row = element.closest(`[${name}]`);
    if (!row) continue;
    const value = row.getAttribute(name);
    if (value !== null) return `${name}:${value}`;
  }
  return "";
}

function visible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || (node.hasAttribute("inert") && node.getAttribute("data-minimized") !== "true") || node.getAttribute("aria-hidden") === "true" || node.hasAttribute("data-ks-share-skip")) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  const rect = element.getBoundingClientRect(), clip = visibleClip(element);
  return rect.width > 0 && rect.height > 0 && rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom;
}

function disabled(element: HTMLElement): boolean {
  return element.matches(":disabled") || Boolean(element.closest('[aria-disabled="true"], fieldset:disabled'));
}

function readonly(element: HTMLElement): boolean {
  if (element.matches("input[readonly], textarea[readonly], [aria-readonly=true]") || element.closest('[aria-readonly="true"]')) return true;
  return element.classList.contains("cm-content") && Boolean(EditorView.findFromDOM(element)?.state.facet(EditorState.readOnly));
}

function label(element: HTMLElement): string {
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  const name = element.getAttribute("aria-label") || labelled || ("labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map((item) => item.textContent).join(" ") : "") || element.getAttribute("title") || element.getAttribute("placeholder");
  if (name?.trim()) return name.trim().replace(/\s+/g, " ");
  if (element.hasAttribute("contenteditable")) return "";
  if (["listbox", "combobox"].includes(element.getAttribute("role") ?? "") || kind(element) === "스크롤 영역") return "";
  return describeVisible(element, true).text.replace(/\s+/g, " ").trim();
}

export function describeNumbered(windowId: string, root: HTMLElement, publish = true): { text: string; visual: boolean; image_base64?: string } {
  let table = tables.get(windowId);
  if (!table || table.root !== root) {
    table = { elements: new WeakMap(), visible: new Map(), next: 1, root };
    tables.set(windowId, table);
  }
  const current = table;
  const entries = new Map<number, { ref: WeakRef<HTMLElement>; identity: string }>();
  const lines: string[] = [];
  const roots = [root, ...ownedOverlays(windowId).filter((overlay): overlay is HTMLElement => overlay instanceof HTMLElement && !root.contains(overlay))];
  for (const surface of roots) {
    for (const element of [surface, ...surface.querySelectorAll<HTMLElement>("*")]) {
      const overlay = overlayOwner(element);
      if ((overlay && overlay.windowId !== windowId) || inConsent(element) || !visible(element)) continue;
      const type = kind(element);
      if (!type) continue;
      const key = identity(element);
      let entry = current.elements.get(element);
      if (!entry || entry.identity !== key) {
        entry = { number: current.next++, identity: key };
        current.elements.set(element, entry);
      }
      entries.set(entry.number, { ref: new WeakRef(element), identity: key });
      const name = label(element);
      lines.push(`[${entry.number}] ${type}${name ? ` ${name}` : ""}${disabled(element) ? " (비활성)" : readonly(element) ? " (읽기 전용)" : ""}`);
    }
  }
  const descriptions = roots.filter((surface) => visible(surface) && !inConsent(surface)).map((surface) => describeVisible(surface, true));
  if (publish) current.visible = entries;
  return {
    text: limitShareText([...lines, ...descriptions.map((item) => item.text)].filter(Boolean).join("\n")),
    visual: descriptions.some((item) => item.visual),
    ...(descriptions.find((item) => item.image_base64)?.image_base64 ? { image_base64: descriptions.find((item) => item.image_base64)!.image_base64 } : {}),
  };
}

export function resolveNumbered(windowId: string, number: number, write = false): ResolveResult {
  const table = tables.get(windowId), entry = table?.visible.get(number), element = entry?.ref.deref();
  if (!table || !entry || !element || !element.isConnected || identity(element) !== entry.identity) return { reason: "stale" };
  const owner = overlayOwner(element);
  if ((!table.root.contains(element) && owner?.windowId !== windowId) || (owner && owner.windowId !== windowId)) return { reason: "stale" };
  if (inConsent(element)) return { reason: "consent" };
  if (!visible(element)) return { reason: "hidden" };
  if (disabled(element)) return { reason: "disabled" };
  if (write && readonly(element)) return { reason: "readonly" };
  return { element };
}

export function forgetNumbered(windowId: string): void { tables.delete(windowId); }
