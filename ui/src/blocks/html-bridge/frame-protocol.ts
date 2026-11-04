import type { HtmlEdit } from "./edit";

export interface HtmlAnchor {
  kind: "element" | "text";
  selector: string;
  selector_stable: boolean;
  path: string;
  tag: string;
  text: string;
  attrs: { id: string | null; role: string | null; aria_label: string | null; alt: string | null; href: string | null; src_hash: string | null };
  quote: { exact: string; prefix: string; suffix: string } | null;
  position?: { start: number; end: number };
  label: string;
  heading: string;
  rect: { x: number; y: number; w: number; h: number; vw: number };
}
export type AnchorStatus = "exact" | "moved" | "orphan";
export interface FrameSelection {
  n: number; anchor: HtmlAnchor; styles: Record<string, string>;
  name: string; ancestors: { n: number; label: string }[]; hasChildren: boolean;
  text: string; first: boolean; last: boolean; rect: { width: number; height: number }; colors: string[];
}
export interface FrameComment { id: string; anchor: HtmlAnchor; number: number; sameRevision: boolean; resolved: boolean; active: boolean }
export type FrameToParent =
  | { type: "ks-html-point-done"; requestId: string }
  | { type: "ks-html-ready" }
  | { type: "ks-html-visible-text"; text: string }
  | { type: "ks-html-context-menu"; requestId: number; x: number; y: number; text: string; editable: boolean; readOnly: boolean; password: boolean }
  | { type: "ks-html-select"; selection: FrameSelection | null }
  | { type: "ks-html-anchor-results"; results: Record<string, AnchorStatus> }
  | { type: "ks-html-select-comment"; id: string }
  | { type: "ks-html-key"; key: string; shift: boolean; alt: boolean; ctrl: boolean }
  | { type: "ks-html-text-edit"; n: number; before: string; after: string };
export type ParentToFrame =
  | { type: "ks-html-point"; requestId: string; x: number; y: number; gesture: "click" | "double_click" }
  | { type: "ks-html-context-command"; requestId: number; action: "delete" | "insertText" | "selectAll"; text?: string }
  | { type: "ks-html-mode"; mode: "select" | "view" }
  | { type: "ks-html-lock"; locked: boolean }
  | { type: "ks-html-select-number"; n: number | null }
  | { type: "ks-html-comments"; comments: FrameComment[] }
  | { type: "ks-html-focus-comment"; id: string }
  | { type: "ks-html-theme"; tokens: Record<string, string> }
  | { type: "ks-html-refresh-selection" }
  | { type: "ks-html-edit"; edit: HtmlEdit };
