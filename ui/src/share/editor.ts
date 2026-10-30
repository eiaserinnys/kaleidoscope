import type { EditorView } from "@codemirror/view";
import { visibleClip } from "./visible";

export function describeEditor(view: EditorView | null, path: string | null, name: string) {
  if (!view) return { text: `[${name}]`, visual: false };
  const clip = visibleClip(view.scrollDOM);
  const doc = view.state.doc;
  const visible: number[] = [];
  for (const range of view.visibleRanges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) {
      if (visible.includes(number)) continue;
      const line = doc.line(number);
      const block = view.lineBlockAt(line.from);
      const top = view.documentTop + block.top;
      if (top < clip.bottom && top + block.height > clip.top) visible.push(number);
    }
  }
  const header = path ? `파일 ${path}` : name;
  if (!visible.length) return { text: `[${header}]`, visual: false };
  return { text: `[${header}, ${visible[0]}~${visible[visible.length - 1]}줄 / 전체 ${doc.lines}줄]\n${visible.map((number) => doc.line(number).text).join("\n")}`, visual: false };
}
