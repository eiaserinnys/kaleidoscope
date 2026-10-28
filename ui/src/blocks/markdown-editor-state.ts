import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";

export function createMarkdownEditorState(
  text: string,
  onChange: (text: string) => void = () => undefined,
  onSave: () => void = () => undefined,
): EditorState {
  const extensions = [
    ...(text.includes("\r\n") ? [EditorState.lineSeparator.of("\r\n")] : []),
    markdown(),
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
