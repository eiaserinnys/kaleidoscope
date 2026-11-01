import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useShareDescriber } from "../share/visible";
import { describeEditor } from "../share/editor";
import { EditorView } from "@codemirror/view";
import type { Block, FileRef } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { FileEditorSession, type FileEditorSnapshot } from "./file-editor-session";
import { documentEditorSession } from "./document-editor-session";
import { EditorConflict } from "./editor-conflict";
import { createMarkdownEditorState } from "./markdown-editor-state";

type MarkdownEditorBlockData = Extract<Block, { type: "markdown" }>;
type FileMarkdownEditorBlockData = MarkdownEditorBlockData & { file: FileRef };

export function MarkdownEditorBlock({ block, context }: { block: MarkdownEditorBlockData; context: BlockContext }) {
  if (block.document) return <DocumentMarkdownEditorBlock entry={block.document.entry} context={context} />;
  if (!block.file) return null;
  return <FileMarkdownEditorBlock block={{ ...block, file: block.file }} context={context} />;
}

function FileMarkdownEditorBlock({ block, context }: { block: FileMarkdownEditorBlockData; context: BlockContext }) {
  const path = resolveFilePath(block.file, context.window);
  const emptyShareRef = useRef<HTMLDivElement>(null);
  useShareDescriber(emptyShareRef, () => ({ text: "[마크다운 편집기]", visual: false }));
  const grantRoot = context.snapshot.device.grants.find(
    (item) => item.window_id === context.window.id && item.permission === block.file.permission,
  )?.root_path ?? null;
  const hasGrant = grantRoot !== null;
  const session = useMemo(
    () => new FileEditorSession(context.store, context.window.id, block.file.permission),
    [block.file.permission, context.store, context.window.id],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const previousRoot = useRef(grantRoot);

  useEffect(() => {
    const rootChanged = previousRoot.current !== grantRoot;
    previousRoot.current = grantRoot;
    if (!hasGrant) {
      void session.open(null);
    } else if (rootChanged && session.getSnapshot().path === path) {
      void session.refreshOnFocus();
    } else {
      void session.open(path);
    }
  }, [grantRoot, hasGrant, path, session]);

  useEffect(() => () => session.dispose(), [session]);

  useEffect(() => {
    const refresh = () => void session.refreshOnFocus();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [session]);

  if (!hasGrant) return null;
  if (path === null) return <div className="ks-markdown-editor" ref={emptyShareRef} />;
  return <EditorContent path={path} session={session} state={state} />;
}

function DocumentMarkdownEditorBlock({ entry, context }: { entry: string; context: BlockContext }) {
  const session = useMemo(
    () => documentEditorSession(context.store, context.window.id, entry),
    [context.store, context.window.id, entry],
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { void session.open(entry); }, [entry, session]);
  return <EditorContent path={entry} session={session} state={state} />;
}

function EditorContent({ path, session, state }: { path: string; session: FileEditorSession; state: FileEditorSnapshot }) {
  if (!state.loaded) {
    return <div className="ks-editor-loading"><StatusText>불러오는 중</StatusText></div>;
  }
  if (state.error && state.revision === null && !state.dirty) {
    return <div className="ks-editor-error"><Notice role="alert">{state.error}</Notice></div>;
  }

  return (
    <div className="ks-markdown-editor">
      {state.error ? <Notice role="alert">{state.error}</Notice> : null}
      {state.conflict ? <EditorConflict session={session} /> : null}
      <div className="ks-editor-content">
        <CodeEditor
          key={`${path}:${state.lineSeparator}`}
          path={path}
          session={session}
          text={state.text}
        />
        {state.status !== "saved" && !state.error && !state.conflict ? (
          <span
            aria-label={state.status === "saving" ? "저장 중" : "저장 대기"}
            className="ks-editor-save-indicator"
            role="status"
            title={state.status === "saving" ? "저장 중" : "저장 대기"}
          />
        ) : null}
      </div>
    </div>
  );
}

function CodeEditor({ path, session, text }: { path: string; session: FileEditorSession; text: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useShareDescriber(hostRef, () => describeEditor(viewRef.current, path, "마크다운 편집기"));

  useEffect(() => {
    if (!hostRef.current) return;
    const state = createMarkdownEditorState(
      text,
      (nextText) => session.setText(nextText),
      () => { void session.saveNow(); },
    );
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, session]);

  useEffect(() => {
    const view = viewRef.current;
    // sliceDoc()은 lineSeparator(CRLF 파일이면 "\r\n")로 이어 준다. doc.toString()은 늘 "\n"이라
    // CRLF 파일에서 매번 다르다고 보고 문서를 통째로 바꿔 커서가 맨 앞으로 갔다.
    if (!view || view.state.sliceDoc() === text) return;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    view.dispatch({ selection: { anchor: Math.min(head, view.state.doc.length) } });
  }, [text]);

  return <div className="ks-editor-view" ref={hostRef} />;
}
