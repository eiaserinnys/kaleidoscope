import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useShareDescriber } from "../share/visible";
import { describeEditor } from "../share/editor";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import type { Block } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { FileEditorSession } from "./file-editor-session";
import { EditorConflict } from "./editor-conflict";
import { codeHighlighting, codeLanguageForPath, languageExtension } from "./code-language";
import { FileGrant } from "./file-grant";
import { useWindowGrant, useWindowStateValue } from "../data/window-state";

export type CodeEditorBlockData = Extract<Block, { type: "code" }> & { file: NonNullable<Extract<Block, { type: "code" }>["file"]> };
export function CodeEditorBlock({ block, context }: { block: CodeEditorBlockData; context: BlockContext }) {
  const stateValue = useWindowStateValue(context, typeof block.file.path === "string" ? null : block.file.path.state);
  const path = resolveFilePath(block.file, stateValue);
  const emptyShareRef = useRef<HTMLDivElement>(null);
  useShareDescriber(emptyShareRef, () => ({ text: "[코드 편집기]", visual: false }));
  const root = useWindowGrant(context, block.file.permission)?.root_path ?? null;
  const session = useMemo(() => new FileEditorSession(context.store, context.window.id, block.file.permission), [block.file.permission, context.store, context.window.id]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const previousRoot = useRef(root);
  useEffect(() => {
    const changed = previousRoot.current !== root;
    previousRoot.current = root;
    if (!root) void session.open(null);
    else if (changed && session.getSnapshot().path === path) void session.refreshOnFocus();
    else void session.open(path);
  }, [root, path, session]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => { const refresh = () => void session.refreshOnFocus(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [session]);
  if (!root) return <FileGrant context={context} permission={block.file.permission} />;
  if (path === null) return <div className="ks-markdown-editor" ref={emptyShareRef} />;
  if (!state.loaded) return <div className="ks-editor-loading"><StatusText>불러오는 중</StatusText></div>;
  if (state.error && state.revision === null) return <div className="ks-editor-error"><Notice role="alert">{state.error}</Notice></div>;
  return <div className="ks-markdown-editor">
    {state.error ? <Notice role="alert">{state.error}</Notice> : null}
    {state.conflict ? <EditorConflict session={session} /> : null}
    <div className="ks-editor-content">
      <EditableCode key={`${path}:${state.lineSeparator}`} path={path} language={codeLanguageForPath(path, block.language)} text={state.text} session={session} wrap={!!block.wrap} />
      {state.status !== "saved" && !state.error && !state.conflict ? <span aria-label={state.status === "saving" ? "저장 중" : "저장 대기"} className="ks-editor-save-indicator" role="status" /> : null}
    </div>
  </div>;
}
function EditableCode({ path, language, text, session, wrap }: { path: string; language: ReturnType<typeof codeLanguageForPath>; text: string; session: FileEditorSession; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  useShareDescriber(host, () => describeEditor(view.current, path, "코드 편집기"));
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({ doc: text, extensions: [
      ...(text.includes("\r\n") ? [EditorState.lineSeparator.of("\r\n")] : []),
      languageExtension(language), codeHighlighting, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), search(),
      ...(wrap ? [EditorView.lineWrapping] : []),
      keymap.of([{ key: "Mod-s", run: () => { void session.saveNow(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((update) => { if (update.docChanged) session.setText(update.state.sliceDoc()); }),
      EditorView.contentAttributes.of({ "aria-label": "코드 편집기" }),
    ] });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [path, language, session, wrap]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === text) return;
    const head = editor.state.selection.main.head;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    editor.dispatch({ selection: { anchor: Math.min(head, editor.state.doc.length) } });
  }, [text]);
  return <div className="ks-code-view" ref={host} />;
}
