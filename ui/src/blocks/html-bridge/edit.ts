export type HtmlEdit =
  | { kind: "style"; n: number; prop: string; before: string; after: string }
  | { kind: "text"; n: number; before: string; after: string }
  | { kind: "remove"; n: number; parent: number; next: number | null; html: string }
  | { kind: "insert"; n: number; parent: number; next: number | null; html: string; source?: number }
  | { kind: "move"; n: number; parent: number; next_before: number | null; next_after: number | null };

export function numberElements(doc: Document): void {
  doc.querySelectorAll("*").forEach((element, index) => element.setAttribute("data-ks-n", String(index + 1)));
}

export function serializeOriginal(doc: Document): string {
  const root = doc.documentElement.cloneNode(true) as Element;
  root.removeAttribute("data-ks-n");
  root.querySelectorAll("[data-ks-n]").forEach((element) => element.removeAttribute("data-ks-n"));
  const dt = doc.doctype;
  const doctype = dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : dt.systemId ? " SYSTEM" : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>` : "";
  return doctype + root.outerHTML;
}

export function findNumber(root: Document, n: number): Element | null {
  return root.querySelector(`[data-ks-n="${n}"]`);
}

export function applyEdit(root: Document, edit: HtmlEdit): void {
  const element = findNumber(root, edit.n);
  switch (edit.kind) {
    case "style":
      if (element instanceof HTMLElement) edit.after ? element.style.setProperty(edit.prop, edit.after) : element.style.removeProperty(edit.prop);
      break;
    case "text":
      if (element) element.textContent = edit.after;
      break;
    case "remove":
      element?.remove();
      break;
    case "insert": {
      const parent = findNumber(root, edit.parent);
      if (!parent) break;
      const range = root.createRange();
      range.selectNodeContents(parent);
      parent.insertBefore(range.createContextualFragment(edit.html), edit.next === null ? null : findNumber(root, edit.next));
      break;
    }
    case "move": {
      const parent = findNumber(root, edit.parent);
      if (parent && element) parent.insertBefore(element, edit.next_after === null ? null : findNumber(root, edit.next_after));
      break;
    }
  }
}

export function invertEdit(edit: HtmlEdit): HtmlEdit {
  switch (edit.kind) {
    case "style":
    case "text": return { ...edit, before: edit.after, after: edit.before };
    case "remove": return { ...edit, kind: "insert" };
    case "insert": return { ...edit, kind: "remove" };
    case "move": return { ...edit, next_before: edit.next_after, next_after: edit.next_before };
  }
}
