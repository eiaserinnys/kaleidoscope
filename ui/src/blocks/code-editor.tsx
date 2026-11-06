import { useBlockRootProps } from "../comments/block-root";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useShareDescriber } from "../share/visible";
import { describeEditor } from "../share/editor";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import type { Block } from "../contract/contract";
import { ErrorNotice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { FileEditorSession } from "./file-editor-session";
import { EditorConflict } from "./editor-conflict";
import { codeHighlighting, codeLanguageForPath, languageExtension } from "./code-language";
import { FileGrant } from "./file-grant";
import { useWindowGrant, useWindowStateValue } from "../data/window-state";
import { useFileEditorEvents } from "./file-editor-events";

export type CodeEditorBlockData = Extract<Block, { type: "code" }> & { file: NonNullable<Extract<Block, { type: "code" }>["file"]> };
export function CodeEditorBlock({ block, context }: { block: CodeEditorBlockData; context: BlockContext }) {
  const blockRoot = useBlockRootProps();
  const stateValue = useWindowStateValue(context, typeof block.file.path === "string" ? null : block.file.path.state);
  const path = resolveFilePath(block.file, stateValue);
  const emptyShareRef = useRef<HTMLDivElement>(null);
  useShareDescriber(emptyShareRef, () => ({ text: "[코드 편집기]", visual: false }));
  const root = useWindowGrant(context, block.file.permission)?.root_path ?? null;
  const session = useMemo(() => new FileEditorSession(context.store, context.window.id, block.file.permission), [block.file.permission, context.store, context.window.id]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useFileEditorEvents(session, context, block.file, root);
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
  if (!root) return <FileGrant rootProps={blockRoot} context={context} permission={block.file.permission} />;
  if (path === null) return <div {...blockRoot} className="ks-markdown-editor" ref={emptyShareRef} />;
  if (!state.loaded) return <div {...blockRoot} className="ks-editor-loading"><StatusText>불러오는 중</StatusText></div>;
  if (state.error && state.revision === null) return <div {...blockRoot} className="ks-editor-error"><ErrorNotice error={state.error} /></div>;
  return <div {...blockRoot} className="ks-markdown-editor">
    {state.error ? <ErrorNotice error={state.error} /> : null}
    {state.conflict ? <EditorConflict session={session} /> : null}
    <div className="ks-editor-content">
      <EditableCode key={`${state.contentIdentity}:${state.lineSeparator}`} path={state.path ?? path} contentIdentity={state.contentIdentity} language={codeLanguageForPath(state.path ?? path, block.language)} text={state.text} session={session} wrap={block.wrap !== false} />
      {state.status !== "saved" && !state.error && !state.conflict ? <span aria-label={state.status === "saving" ? "저장 중" : "저장 대기"} className="ks-editor-save-indicator" role="status" /> : null}
    </div>
  </div>;
}
function EditableCode({ path, contentIdentity, language, text, session, wrap }: { path: string; contentIdentity: number; language: ReturnType<typeof codeLanguageForPath>; text: string; session: FileEditorSession; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  useShareDescriber(host, () => describeEditor(view.current, path, "코드 편집기"));
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({ doc: text, extensions: [
      ...(text.includes("\r\n") ? [EditorState.lineSeparator.of("\r\n")] : []),
      languageSlot.current.of(languageExtension(language)), codeHighlighting, lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), search(),
      ...(wrap ? [EditorView.lineWrapping] : []),
      keymap.of([{ key: "Mod-s", run: () => { void session.saveNow(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of((update) => { if (update.docChanged) session.setText(update.state.sliceDoc()); }),
      EditorView.contentAttributes.of({ "aria-label": "코드 편집기" }),
    ] });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [contentIdentity, session, wrap]);
  useEffect(() => { view.current?.dispatch({ effects: languageSlot.current.reconfigure(languageExtension(language)) }); }, [language, contentIdentity]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === text) return;
    const head = editor.state.selection.main.head;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    editor.dispatch({ selection: { anchor: Math.min(head, editor.state.doc.length) } });
  }, [text]);
  return <div className="ks-code-view" ref={host} />;
}
