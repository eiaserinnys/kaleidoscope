import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Transaction } from "@codemirror/state";

export function normalizeReference(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

// Candidates are indexed before the background Markdown parser reaches them.
// The parser still decides whether a candidate in the parsed region is real.
function candidate(text: string): { label: string; offset: number } | null {
  const match = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(\[([^\]\n]+)\]):/.exec(text);
  return match ? { label: normalizeReference(match[2]), offset: match.index + match[0].indexOf(match[1]) } : null;
}

class Reference {
  left: Reference | null = null;
  right: Reference | null = null;
  parent: Reference | null = null;
  shift = 0;
  constructor(readonly label: string, public position: number, readonly priority: number) {}
}

function shift(node: Reference | null, by: number) {
  if (node) { node.position += by; node.shift += by; }
}

function push(node: Reference) {
  if (node.shift) { shift(node.left, node.shift); shift(node.right, node.shift); node.shift = 0; }
}

function leftChild(node: Reference, child: Reference | null) { node.left = child; if (child) child.parent = node; }
function rightChild(node: Reference, child: Reference | null) { node.right = child; if (child) child.parent = node; }

// A positional treap makes a suffix move one lazy operation rather than one
// update per definition. Nodes remain stable for the label lookup map.
function split(node: Reference | null, position: number): [Reference | null, Reference | null] {
  if (!node) return [null, null];
  push(node);
  if (node.position < position) {
    const [left, right] = split(node.right, position);
    rightChild(node, left); node.parent = null; if (right) right.parent = null;
    return [node, right];
  }
  const [left, right] = split(node.left, position);
  leftChild(node, right); node.parent = null; if (left) left.parent = null;
  return [left, node];
}

function merge(left: Reference | null, right: Reference | null): Reference | null {
  if (!left || !right) { const node = left ?? right; if (node) node.parent = null; return node; }
  if (left.priority < right.priority) {
    push(left); rightChild(left, merge(left.right, right)); left.parent = null; return left;
  }
  push(right); leftChild(right, merge(left, right.left)); right.parent = null; return right;
}

function actualPosition(node: Reference): number {
  let position = node.position;
  for (let parent = node.parent; parent; parent = parent.parent) position += parent.shift;
  return position;
}

export class MarkdownReferenceIndex {
  private root: Reference | null = null;
  private labels = new Map<string, Set<Reference>>();
  private serial = 0;

  constructor(state: EditorState) {
    const lines = state.doc.iterLines();
    let from = 0;
    while (!lines.next().done) {
      this.addLine(lines.value, from);
      from += lines.value.length + 1;
    }
  }

  private addLine(text: string, from: number) {
    const match = candidate(text);
    if (!match) return;
    // Multiplicative hashing distributes even sequential definition positions.
    let priority = ++this.serial;
    priority = Math.imul(priority ^ (priority >>> 16), 0x45d9f3b);
    priority = Math.imul(priority ^ (priority >>> 16), 0x45d9f3b);
    priority = (priority ^ (priority >>> 16)) >>> 0;
    const node = new Reference(match.label, from + match.offset, priority);
    const [left, right] = split(this.root, node.position);
    this.root = merge(merge(left, node), right);
    const refs = this.labels.get(node.label) ?? new Set<Reference>();
    refs.add(node); this.labels.set(node.label, refs);
  }

  private removeLine(text: string, from: number) {
    const match = candidate(text);
    if (!match) return;
    const position = from + match.offset;
    const [left, rest] = split(this.root, position);
    const [removed, right] = split(rest, position + 1);
    this.root = merge(left, right);
    if (removed) {
      const refs = this.labels.get(removed.label)!;
      refs.delete(removed);
      if (!refs.size) this.labels.delete(removed.label);
    }
  }

  update(transaction: Transaction) {
    if (!transaction.docChanged) return;
    const oldLines = new Set<number>();
    const newLines = new Set<number>();
    const changes: { to: number; delta: number }[] = [];
    const collect = (state: EditorState, from: number, to: number, result: Set<number>) => {
      let line = state.doc.lineAt(from);
      const last = state.doc.lineAt(to).number;
      while (line.number <= last) {
        result.add(line.number);
        if (line.number === last) break;
        line = state.doc.line(line.number + 1);
      }
    };
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
      collect(transaction.startState, fromA, toA, oldLines);
      collect(transaction.state, fromB, toB, newLines);
      changes.push({ to: toA, delta: (toB - fromB) - (toA - fromA) });
    });
    for (const number of oldLines) {
      const line = transaction.startState.doc.line(number); this.removeLine(line.text, line.from);
    }
    for (const change of changes.reverse()) {
      const [left, right] = split(this.root, change.to);
      shift(right, change.delta);
      this.root = merge(left, right);
    }
    for (const number of newLines) {
      const line = transaction.state.doc.line(number); this.addLine(line.text, line.from);
    }
  }

  has(label: string, state: EditorState): boolean {
    const references = this.labels.get(normalizeReference(label));
    if (!references) return false;
    const tree = syntaxTree(state);
    for (const reference of references) {
      const position = actualPosition(reference);
      if (state.doc.lineAt(position).to > tree.length) return true;
      for (let node = tree.resolveInner(position + 1, 1); node; node = node.parent!) {
        if (node.name === "LinkReference") return true;
      }
    }
    return false;
  }
}
