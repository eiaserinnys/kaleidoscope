import type { HtmlAnchor, AnchorStatus } from "./frame-protocol";
export interface ResolvedAnchor { status: AnchorStatus; element: Element | null; range?: Range }
export function createAnchor(_element: Element, _range?: Range): HtmlAnchor { throw new Error("구현 전"); }
export function resolveAnchor(_doc: Document, _anchor: HtmlAnchor): ResolvedAnchor { throw new Error("구현 전"); }
