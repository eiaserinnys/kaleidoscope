import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolve"]>;

const focusEffect = StateEffect.define<boolean>();
const refreshEffect = StateEffect.define<null>();

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) { super(); }
  eq(other: TextWidget) { return this.text === other.text && this.className === other.className; }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function labelBounds(node: SyntaxNode): [number, number] | null {
  const marks = children(node).filter((child) => child.name === "LinkMark");
  return marks.length >= 2 ? [marks[0].to, marks[1].from] : null;
}

// 표 안에서도 구문 트리의 텍스트만 DOM에 넣는다. HTML은 해석하지 않는다.
function appendInline(parent: HTMLElement, node: SyntaxNode, state: EditorState, from = node.from, to = node.to) {
  let cursor = from;
  for (const child of children(node)) {
    if (child.from < from || child.to > to) continue;
    if (child.from > cursor) parent.append(document.createTextNode(state.sliceDoc(cursor, child.from)));
    const tags: Record<string, string> = { StrongEmphasis: "strong", Emphasis: "em", Strikethrough: "s", InlineCode: "code", Link: "span", Image: "span" };
    const tag = tags[child.name];
    if (tag) {
      const el = document.createElement(tag);
      if (child.name === "Link") el.className = "ks-live-link";
      if (child.name === "Image") el.className = "ks-live-image";
      const label = child.name === "Link" || child.name === "Image" ? labelBounds(child) : null;
      if (label) appendInline(el, child, state, label[0], label[1]);
      else {
        const marks = children(child).filter((item) => /Mark$/.test(item.name));
        if (marks.length >= 2) appendInline(el, child, state, marks[0].to, marks[marks.length - 1].from);
        else el.textContent = state.sliceDoc(child.from, child.to);
      }
      parent.append(el);
    } else {
      parent.append(document.createTextNode(state.sliceDoc(child.from, child.to)));
    }
    cursor = child.to;
  }
  if (cursor < to) parent.append(document.createTextNode(state.sliceDoc(cursor, to)));
}

class TableWidget extends WidgetType {
  constructor(readonly node: SyntaxNode, readonly state: EditorState) { super(); }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "ks-live-table-wrap";
    const table = document.createElement("table");
    table.className = "ks-live-table";
    const parts = children(this.node);
    const separator = parts.find((part) => part.name === "TableDelimiter");
    const alignment = separator ? this.state.sliceDoc(separator.from, separator.to).trim().replace(/^\||\|$/g, "").split("|").map((cell) => {
      const value = cell.trim();
      return value.startsWith(":") && value.endsWith(":") ? "center" : value.endsWith(":") ? "right" : "left";
    }) : [];
    for (const row of parts.filter((part) => part.name === "TableHeader" || part.name === "TableRow")) {
      const tr = document.createElement("tr");
      const rowChildren = children(row);
      const delimiters = rowChildren.filter((part) => part.name === "TableDelimiter");
      const cells: { from: number; to: number; node?: SyntaxNode }[] = [];
      let from = row.from;
      for (const [index, delimiter] of delimiters.entries()) {
        if (index > 0 || this.state.sliceDoc(from, delimiter.from).trim()) {
          cells.push({ from, to: delimiter.from });
        }
        from = delimiter.to;
      }
      if (!delimiters.length || this.state.sliceDoc(from, row.to).trim()) cells.push({ from, to: row.to });
      for (const cell of cells) {
        cell.node = rowChildren.find((part) => part.name === "TableCell" && part.from >= cell.from && part.to <= cell.to);
      }
      for (const [index, cell] of cells.entries()) {
        const td = document.createElement(row.name === "TableHeader" ? "th" : "td");
        td.style.textAlign = alignment[index] ?? "left";
        if (cell.node) appendInline(td, cell.node, this.state);
        td.addEventListener("mousedown", (event) => {
          event.preventDefault();
          view.focus();
          view.dispatch({ selection: { anchor: cell.node?.from ?? cell.from }, scrollIntoView: true });
        });
        tr.append(td);
      }
      table.append(tr);
    }
    wrap.append(table);
    wrap.addEventListener("mousedown", (event) => {
      if (event.target !== wrap && event.target !== table) return;
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: this.node.from }, scrollIntoView: true });
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

function makeDecorations(state: EditorState, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const selection = focused ? state.selection.ranges : [];
  const active = (from: number, to: number) => selection.some((range) => range.from <= to && range.to >= from);
  const lineActive = (position: number) => {
    const line = state.doc.lineAt(position);
    return active(line.from, line.to);
  };
  const replace = (from: number, to: number, widget?: WidgetType, block = false) => {
    if (from < to) ranges.push(Decoration.replace({ widget, block }).range(from, to));
  };
  const mark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to));
  };
  const line = (pos: number, className: string) => ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(pos).from));
  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      if (name === "Table") {
        if (!active(node.from, node.to)) replace(node.from, node.to, new TableWidget(node, state), true);
        return false;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        if (name === "FencedCode" && active(node.from, node.to)) return false;
        let current = state.doc.lineAt(node.from);
        const end = state.doc.lineAt(node.to).number;
        while (current.number <= end) {
          if (!lineActive(current.from)) line(current.from, "ks-live-code-block");
          if (current.number === end) break;
          current = state.doc.line(current.number + 1);
        }
        if (name === "FencedCode") {
          for (const child of children(node).filter((part) => part.name === "CodeMark" || part.name === "CodeInfo")) mark(child.from, child.to, "ks-live-muted");
        }
        return false;
      }
      if (name === "HTMLBlock" || name === "HTMLTag") return false;
      if (lineActive(node.from)) return;
      if (/^ATXHeading[1-6]$/.test(name)) {
        line(node.from, `ks-live-heading-${name.slice(-1)}`);
        const marker = node.getChild("HeaderMark");
        if (marker) replace(marker.from, Math.min(marker.to + 1, state.doc.lineAt(marker.to).to));
      } else if (/^SetextHeading[12]$/.test(name)) {
        line(node.from, `ks-live-heading-${name.slice(-1)}`);
        const marker = node.getChild("HeaderMark");
        if (marker && !lineActive(marker.from)) line(marker.from, "ks-live-muted");
      } else if (name === "HorizontalRule") {
        replace(node.from, node.to, new TextWidget("", "ks-live-rule"));
      } else if (name === "QuoteMark") {
        line(node.from, "ks-live-quote");
        replace(node.from, Math.min(node.to + 1, state.doc.lineAt(node.to).to));
      } else if (name === "ListMark" && /^[*+-]$/.test(state.sliceDoc(node.from, node.to))) {
        replace(node.from, node.to, new TextWidget("•", "ks-live-bullet"));
      } else if (name === "TaskMarker") {
        replace(node.from, node.to, new TextWidget(/x/i.test(state.sliceDoc(node.from, node.to)) ? "☑" : "☐", "ks-live-task"));
      } else if (name === "Image") {
        const bounds = labelBounds(node);
        if (bounds) replace(node.from, node.to, new TextWidget(state.sliceDoc(bounds[0], bounds[1]), "ks-live-image"));
        return false;
      } else if (name === "Link") {
        const bounds = labelBounds(node);
        if (bounds) {
          replace(node.from, bounds[0]);
          replace(bounds[1], node.to);
          mark(bounds[0], bounds[1], "ks-live-link");
        }
      } else if (["StrongEmphasis", "Emphasis", "Strikethrough", "InlineCode"].includes(name)) {
        const marks = children(node).filter((child) => /Mark$/.test(child.name));
        if (marks.length >= 2) {
          replace(marks[0].from, marks[0].to);
          replace(marks[marks.length - 1].from, marks[marks.length - 1].to);
          mark(marks[0].to, marks[marks.length - 1].from, `ks-live-${name.toLowerCase()}`);
        }
      } else if (name === "Autolink" || name === "URL") {
        if (node.parent?.name !== "Link" && node.parent?.name !== "Image") mark(node.from, node.to, "ks-live-link");
      }
    },
  });
  return Decoration.set(ranges, true);
}

interface PreviewState { focused: boolean; decorations: DecorationSet }
const previewField = StateField.define<PreviewState>({
  create(state) { return { focused: false, decorations: makeDecorations(state, false) }; },
  update(value, transaction) {
    let focused = value.focused;
    let refresh = transaction.docChanged || transaction.selection !== undefined;
    for (const effect of transaction.effects) {
      if (effect.is(focusEffect)) { focused = effect.value; refresh = true; }
      if (effect.is(refreshEffect)) refresh = true;
    }
    return refresh ? { focused, decorations: makeDecorations(transaction.state, focused) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const treeUpdates = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined;
  update(update: { startState: EditorState; state: EditorState; view: EditorView }) {
    if (syntaxTree(update.startState) !== syntaxTree(update.state)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => update.view.dispatch({ effects: refreshEffect.of(null) }), 0);
    }
  }
  destroy() { clearTimeout(this.timer); }
});

export const markdownLivePreview: Extension = [
  previewField,
  treeUpdates,
  EditorView.domEventHandlers({
    focus: (_event, view) => { view.dispatch({ effects: focusEffect.of(true) }); },
    blur: (_event, view) => { view.dispatch({ effects: focusEffect.of(false) }); },
  }),
];
