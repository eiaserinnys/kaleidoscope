import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";
import type { Block } from "../contract/contract";
import { EmptyState, Notice, Button, StatusText } from "../components/primitives";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { FileEditorSession } from "./file-editor-session";
import { createMarkdownEditorState } from "./markdown-editor-state";

type MarkdownEditorBlockData = Extract<Block, { type: "markdown_editor" }>;

export function MarkdownEditorBlock({ block, context }: { block: MarkdownEditorBlockData; context: BlockContext }) {
  const path = resolveFilePath(block.file, context.window);
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

  if (!hasGrant) {
    return <EmptyState icon={<DocumentIcon />} text="폴더를 먼저 선택하세요" />;
  }
  if (path === null) {
    return <EmptyState icon={<DocumentIcon />} text="파일을 선택하세요" />;
  }
  if (!state.loaded) {
    return <div className="ks-editor-loading"><StatusText>불러오는 중</StatusText></div>;
  }
  if (state.error && state.revision === null) {
    return <div className="ks-editor-error"><Notice role="alert">{state.error}</Notice></div>;
  }

  return (
    <div className="ks-markdown-editor">
      {state.error ? <Notice role="alert">{state.error}</Notice> : null}
      {state.conflict ? (
        <Notice
          actions={[
            <Button key="reload" onClick={() => void session.reload()}>다시 불러오기</Button>,
            <Button key="overwrite" onClick={() => void session.overwrite()} variant="emphasis">덮어쓰기</Button>,
          ]}
          role="alert"
        >
          {state.conflict.message}
        </Notice>
      ) : null}
      <div className="ks-editor-content">
        <CodeEditor
          key={`${path}:${state.lineSeparator}`}
          path={path}
          session={session}
          text={state.text}
        />
      </div>
      <div className="ks-editor-status">
        <StatusText>
          {state.status === "saving" ? "저장 중" : state.status === "saved" ? "저장됨" : "저장 안 됨"}
        </StatusText>
      </div>
    </div>
  );
}

function CodeEditor({ path, session, text }: { path: string; session: FileEditorSession; text: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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

function DocumentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 3.5h8l4 4v13H6z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M14 3.5v4h4M9 12h6M9 15.5h6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}
