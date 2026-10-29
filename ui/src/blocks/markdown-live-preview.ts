import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorSelection, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { MarkdownReferenceIndex } from "./markdown-reference-index";
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolve"]>;

const focusEffect = StateEffect.define<boolean>();
const refreshEffect = StateEffect.define<null>();
const pointerEffect = StateEffect.define<{ focused: boolean; selection: EditorSelection } | null>();
type TableCell = { table: number; from: number; to: number };
const tableCells = new WeakMap<Element, TableCell>();
const tableTextPositions = new WeakMap<Node, number>();

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

function resolvedLink(node: SyntaxNode, state: EditorState, references: MarkdownReferenceIndex): boolean {
  const bounds = labelBounds(node);
  if (!bounds) return false;
  if (state.sliceDoc(bounds[1] + 1, bounds[1] + 2) === "(") {
    return children(node).some((child) => child.name === "LinkMark" && child.to === node.to && state.sliceDoc(child.from, child.to) === ")");
  }
  const label = node.getChild("LinkLabel");
  const reference = label ? state.sliceDoc(label.from + 1, label.to - 1) : state.sliceDoc(bounds[0], bounds[1]);
  return references.has(reference || state.sliceDoc(bounds[0], bounds[1]), state);
}

function appendSourceText(parent: HTMLElement, state: EditorState, from: number, to: number) {
  const text = document.createTextNode(state.sliceDoc(from, to));
  tableTextPositions.set(text, from);
  parent.append(text);
}

// 표 안에서도 구문 트리의 텍스트만 DOM에 넣는다. HTML은 해석하지 않는다.
function appendInline(parent: HTMLElement, node: SyntaxNode, state: EditorState, references: MarkdownReferenceIndex, from = node.from, to = node.to) {
  let cursor = from;
  for (const child of children(node)) {
    if (child.from < from || child.to > to) continue;
    if (child.from > cursor) appendSourceText(parent, state, cursor, child.from);
    const tags: Record<string, string> = { StrongEmphasis: "strong", Emphasis: "em", Strikethrough: "s", InlineCode: "code", Link: "span", Image: "span" };
    const tag = child.name === "Link" && !resolvedLink(child, state, references) ? undefined : tags[child.name];
    if (tag) {
      const el = document.createElement(tag);
      if (child.name === "Link") el.className = "ks-live-link";
      if (child.name === "Image") el.className = "ks-live-image";
      const label = child.name === "Link" || child.name === "Image" ? labelBounds(child) : null;
      if (label) appendInline(el, child, state, references, label[0], label[1]);
      else {
        const marks = children(child).filter((item) => /Mark$/.test(item.name));
        if (marks.length >= 2) appendInline(el, child, state, references, marks[0].to, marks[marks.length - 1].from);
        else appendSourceText(el, state, child.from, child.to);
      }
      parent.append(el);
    } else {
      appendSourceText(parent, state, child.from, child.to);
    }
    cursor = child.to;
  }
  if (cursor < to) appendSourceText(parent, state, cursor, to);
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
        const raw = this.state.sliceDoc(cell.from, cell.to);
        const from = cell.from + raw.length - raw.trimStart().length;
        const bounds = { table: this.node.from, from, to: Math.max(from, cell.from + raw.trimEnd().length) };
        tableCells.set(td, bounds);
        if (cell.node) appendInline(td, cell.node, this.state, view.plugin(referencePreview)!.index);
        td.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          view.plugin(pointerPreview)?.selectTableOnRelease(cell.node?.from ?? cell.from, bounds);
        });
        tr.append(td);
      }
      table.append(tr);
    }
    wrap.append(table);
    wrap.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || (event.target !== wrap && event.target !== table)) return;
      event.preventDefault();
      view.plugin(pointerPreview)?.selectTableOnRelease(this.node.from);
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

function selectionTouches(selection: EditorSelection, focused: boolean, from: number, to: number): boolean {
  return focused && selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function findDocumentBlocks(state: EditorState): SyntaxNode[] {
  const tables: SyntaxNode[] = [];
  const containers = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
  syntaxTree(state).iterate({ enter(ref) {
    if (ref.name === "Table") { tables.push(ref.node); return false; }
    return containers.has(ref.name);
  } });
  return tables;
}

const referencePreview = ViewPlugin.fromClass(class {
  readonly index: MarkdownReferenceIndex;
  constructor(view: EditorView) { this.index = new MarkdownReferenceIndex(view.state); }
  update(update: ViewUpdate) { for (const transaction of update.transactions) this.index.update(transaction); }
});

function tableSelection(selection: EditorSelection, focused: boolean, tables: SyntaxNode[]): string {
  return tables.filter((table) => selectionTouches(selection, focused, table.from, table.to)).map((table) => table.from).join(",");
}

function makeTableDecorations(state: EditorState, selection: EditorSelection, focused: boolean, tables: SyntaxNode[]): DecorationSet {
  return Decoration.set(tables.filter((table) => !selectionTouches(selection, focused, table.from, table.to)).map((table) =>
    Decoration.replace({ widget: new TableWidget(table, state), block: true }).range(table.from, table.to)), true);
}

function makeInlineDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const pointer = state.field(previewField).pointer;
  const active = (from: number, to: number) => selectionTouches(pointer?.selection ?? state.selection, pointer?.focused ?? view.hasFocus, from, to);
  const lineActive = (position: number) => {
    const line = state.doc.lineAt(position);
    return active(line.from, line.to);
  };
  const replace = (from: number, to: number, widget?: WidgetType) => {
    if (from < to && !lineActive(from) && state.doc.lineAt(from).number === state.doc.lineAt(to).number) {
      ranges.push(Decoration.replace({ widget }).range(from, to));
    }
  };
  const mark = (from: number, to: number, className: string) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to));
  };
  const line = (pos: number, className: string) => ranges.push(Decoration.line({ class: className }).range(state.doc.lineAt(pos).from));
  const seen = new Set<string>();
  for (const visible of view.visibleRanges) syntaxTree(state).iterate({
    from: visible.from,
    to: visible.to,
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      if (name === "Table") return false;
      const key = `${name}:${node.from}:${node.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (name === "FencedCode" || name === "CodeBlock") {
        const rawCode = active(node.from, node.to);
        const done = new Set<number>();
        const fenceLines = new Set(children(node).filter((child) => child.name === "CodeMark").map((child) => state.doc.lineAt(child.from).number));
        for (const visiblePart of view.visibleRanges) {
          if (visiblePart.to < node.from || visiblePart.from > node.to) continue;
          let current = state.doc.lineAt(Math.max(node.from, visiblePart.from));
          const end = state.doc.lineAt(Math.min(node.to, visiblePart.to)).number;
          while (current.number <= end) {
            if (!done.has(current.number)) {
              const first = state.doc.lineAt(node.from).number;
              const last = state.doc.lineAt(node.to).number;
              line(current.from, `ks-live-code-block${current.number === first ? " ks-live-code-start" : ""}${current.number === last ? " ks-live-code-end" : ""}`);
              if (name === "FencedCode" && fenceLines.has(current.number)) {
                if (rawCode) mark(current.from, current.to, "ks-live-muted");
                else replace(current.from, current.to);
              } else if (name === "CodeBlock") {
                const indent = current.text.match(/^ {1,4}/)?.[0].length ?? 0;
                if (indent && !rawCode) {
                  replace(current.from, current.from + indent);
                  atomic.push(Decoration.replace({}).range(current.from, current.from + indent));
                }
              }
              done.add(current.number);
            }
            if (current.number === end) break;
            current = state.doc.line(current.number + 1);
          }
        }
        return false;
      }
      if (name === "HTMLBlock" || name === "HTMLTag") return false;
      if (name === "LinkReference") {
        let current = state.doc.lineAt(node.from);
        const end = state.doc.lineAt(node.to).number;
        while (current.number <= end) {
          replace(current.from, current.to);
          if (current.number === end) break;
          current = state.doc.line(current.number + 1);
        }
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name)) {
        line(node.from, `ks-live-heading-${name.slice(-1)}`);
        const marker = node.getChild("HeaderMark");
        if (marker) {
          if (lineActive(marker.from)) mark(marker.from, marker.to, "ks-live-muted");
          else replace(marker.from, Math.min(marker.to + 1, state.doc.lineAt(marker.to).to));
        }
      } else if (/^SetextHeading[12]$/.test(name)) {
        line(node.from, `ks-live-heading-${name.slice(-1)}`);
        const marker = node.getChild("HeaderMark");
        if (marker) {
          if (lineActive(marker.from)) mark(marker.from, marker.to, "ks-live-muted");
          else replace(marker.from, marker.to);
        }
      } else if (name === "HorizontalRule") {
        replace(node.from, node.to, new TextWidget("", "ks-live-rule"));
      } else if (name === "QuoteMark") {
        line(node.from, "ks-live-quote");
        if (lineActive(node.from)) mark(node.from, node.to, "ks-live-quote-marker");
        else replace(node.from, Math.min(node.to + 1, state.doc.lineAt(node.to).to));
      } else if (name === "ListMark" && /^[*+-]$/.test(state.sliceDoc(node.from, node.to))) {
        replace(node.from, node.to, new TextWidget("•", "ks-live-bullet"));
      } else if (name === "TaskMarker") {
        replace(node.from, node.to, new TextWidget("", `ks-live-task${/x/i.test(state.sliceDoc(node.from, node.to)) ? " is-checked" : ""}`));
      } else if (name === "Image") {
        if (state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number || lineActive(node.from)) return false;
        const bounds = labelBounds(node);
        if (bounds) replace(node.from, node.to, new TextWidget(state.sliceDoc(bounds[0], bounds[1]), "ks-live-image"));
        return false;
      } else if (name === "Link") {
        if (!resolvedLink(node, state, view.plugin(referencePreview)!.index)) {
          mark(node.from, node.to, "ks-live-unresolved");
          return false;
        }
        if (state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number) return false;
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
        if (node.parent?.name !== "Link" && node.parent?.name !== "Image") {
          mark(node.from, node.to, "ks-live-link");
          if (name === "Autolink") for (const marker of children(node).filter((child) => child.name === "LinkMark")) replace(marker.from, marker.to);
        }
      }
    },
  });
  return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) };
}

interface PreviewState {
  focused: boolean;
  pointer: { focused: boolean; selection: EditorSelection } | null;
  tables: SyntaxNode[];
  selected: string;
  decorations: DecorationSet;
}
const previewField = StateField.define<PreviewState>({
  create(state) {
    const tables = findDocumentBlocks(state);
    return { focused: false, pointer: null, tables, selected: "", decorations: makeTableDecorations(state, state.selection, false, tables) };
  },
  update(value, transaction) {
    let focused = value.focused;
    let pointer = value.pointer;
    if (pointer && transaction.docChanged) pointer = { ...pointer, selection: pointer.selection.map(transaction.changes) };
    let refresh = transaction.docChanged;
    for (const effect of transaction.effects) {
      if (effect.is(focusEffect)) focused = effect.value;
      if (effect.is(refreshEffect)) refresh = true;
      if (effect.is(pointerEffect)) pointer = effect.value;
    }
    const tables = refresh ? findDocumentBlocks(transaction.state) : value.tables;
    const renderSelection = pointer?.selection ?? transaction.state.selection;
    const renderFocused = pointer?.focused ?? focused;
    const selected = tableSelection(renderSelection, renderFocused, tables);
    const decorations = refresh || selected !== value.selected
      ? makeTableDecorations(transaction.state, renderSelection, renderFocused, tables) : value.decorations;
    return { focused, pointer, tables, selected, decorations };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const inlinePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  atomic: DecorationSet;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(view: EditorView) { ({ decorations: this.decorations, atomic: this.atomic } = makeInlineDecorations(view)); }
  update(update: ViewUpdate) {
    const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshEffect) || effect.is(pointerEffect)));
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || refreshed || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      ({ decorations: this.decorations, atomic: this.atomic } = makeInlineDecorations(update.view));
    }
    if (syntaxTree(update.startState) !== syntaxTree(update.state)) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => update.view.dispatch({ effects: refreshEffect.of(null) }), 0);
    }
  }
  destroy() { clearTimeout(this.timer); }
}, { decorations: (plugin) => plugin.decorations });

const pointerPreview = ViewPlugin.fromClass(class {
  private listening = false;
  private clickStart: { focused: boolean; selection: EditorSelection } | null = null;
  private tableSelection: { anchor: number; head: number } | null = null;
  private tableStart: TableCell | null = null;
  private readonly window: Window;
  constructor(private readonly view: EditorView) {
    this.window = view.dom.ownerDocument.defaultView!;
    // 위젯이 CodeMirror 이벤트를 무시해도 누름 시작을 먼저 잡는다.
    view.contentDOM.addEventListener("mousedown", this.start, true);
    this.window.addEventListener("blur", this.cancel);
    this.window.addEventListener("pointercancel", this.cancel, true);
    this.window.addEventListener("pointermove", this.move);
  }
  private readonly release = (event: MouseEvent) => {
    if (event.button !== 0) return;
    this.finish(true);
  };
  private finish(openTable: boolean) {
    if (!this.listening) return;
    this.window.removeEventListener("mouseup", this.release);
    this.listening = false;
    const selection = this.tableSelection;
    this.tableSelection = null;
    if (openTable && selection) {
      this.view.focus();
      this.view.dispatch({ selection, effects: pointerEffect.of(null), scrollIntoView: true });
    } else {
      this.view.dispatch({ effects: pointerEffect.of(null) });
    }
  }
  private readonly cancel = () => { this.clickStart = null; this.tableStart = null; this.finish(false); };
  private readonly move = (event: PointerEvent) => {
    if (this.listening && event.buttons === 0) this.cancel();
  };
  private readonly start = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (this.listening) this.cancel();
    const current = { focused: this.view.hasFocus, selection: this.view.state.selection };
    if (event.detail < 2 || !this.clickStart) { this.clickStart = current; this.tableStart = null; }
    this.listening = true;
    this.view.dispatch({ effects: pointerEffect.of(current) });
    // CodeMirror는 document 버블에서 mouseup을 처리하므로 window 버블은 그 뒤다.
    this.window.addEventListener("mouseup", this.release);
  };
  beforeSelection(event: MouseEvent) {
    // 대상 판정 뒤, CodeMirror가 클릭 좌표를 읽기 전에 첫 누름의 배치를 복원한다.
    if (event.detail >= 2 && this.listening && this.clickStart) {
      this.view.dispatch({ effects: pointerEffect.of(this.clickStart) });
      if (this.tableStart) {
        const doc = this.view.dom.ownerDocument;
        const element = doc.elementFromPoint(event.clientX, event.clientY)?.closest("td, th");
        const hit = element && tableCells.get(element);
        const cell = hit?.table === this.tableStart.table ? hit : this.tableStart;
        const caret = doc.caretPositionFromPoint(event.clientX, event.clientY);
        const textFrom = caret && element?.contains(caret.offsetNode) ? tableTextPositions.get(caret.offsetNode) : undefined;
        const word = event.detail === 2 && caret && textFrom !== undefined ? this.view.state.wordAt(textFrom + caret.offset) : null;
        this.tableSelection = word && word.from >= cell.from && word.to <= cell.to
          ? { anchor: word.from, head: word.to } : { anchor: cell.from, head: cell.to };
        event.preventDefault();
        return true;
      }
    }
    return false;
  }
  selectTableOnRelease(position: number, cell?: TableCell) {
    this.tableSelection = { anchor: position, head: position };
    if (cell) this.tableStart = cell;
  }
  update(update: ViewUpdate) { if (update.docChanged) { this.clickStart = null; this.tableStart = null; } }
  destroy() {
    this.view.contentDOM.removeEventListener("mousedown", this.start, true);
    this.window.removeEventListener("mouseup", this.release);
    this.window.removeEventListener("blur", this.cancel);
    this.window.removeEventListener("pointercancel", this.cancel, true);
    this.window.removeEventListener("pointermove", this.move);
  }
}, { eventHandlers: { mousedown(event) { return this.beforeSelection(event); } } });

function enterTable(view: EditorView, forward: boolean): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const next = view.moveVertically(selection, forward).head;
  const tables = view.state.field(previewField).tables;
  const ordered = forward ? tables : [...tables].reverse();
  const table = ordered.find((item) => forward
    ? selection.head < item.from && next >= item.to
    : selection.head > item.to && next <= item.from);
  if (!table) return false;
  view.dispatch({ selection: { anchor: forward ? table.from : table.to }, scrollIntoView: true });
  return true;
}

export const markdownLivePreview: Extension = [
  previewField,
  referencePreview,
  inlinePreview,
  pointerPreview,
  EditorView.atomicRanges.of((view) => view.plugin(inlinePreview)?.atomic ?? Decoration.none),
  keymap.of([
    { key: "ArrowDown", run: (view) => enterTable(view, true) },
    { key: "ArrowUp", run: (view) => enterTable(view, false) },
  ]),
  EditorView.domEventHandlers({
    focus: (_event, view) => { view.dispatch({ effects: focusEffect.of(true) }); },
    blur: (_event, view) => { view.dispatch({ effects: focusEffect.of(false) }); },
  }),
];
