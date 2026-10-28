import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";

const markdownHighlighting = HighlightStyle.define([
  { tag: tags.heading, color: "var(--ks-color-text)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.monospace, fontFamily: "var(--ks-font-code)" },
  { tag: [tags.link, tags.url], color: "var(--ks-color-accent)" },
  { tag: tags.quote, color: "var(--ks-color-muted)" },
  { tag: tags.processingInstruction, color: "var(--ks-color-muted)" },
]);

export function createMarkdownEditorState(
  text: string,
  onChange: (text: string) => void = () => undefined,
  onSave: () => void = () => undefined,
): EditorState {
  const extensions = [
    ...(text.includes("\r\n") ? [EditorState.lineSeparator.of("\r\n")] : []),
    markdown({ extensions: GFM }),
    syntaxHighlighting(markdownHighlighting),
    history(),
    keymap.of([
      { key: "Mod-s", run: () => { onSave(); return true; } },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
    EditorView.contentAttributes.of({ "aria-label": "마크다운 편집기" }),
  ];
  return EditorState.create({ doc: text, extensions });
}
