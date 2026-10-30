import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { useShareDescriber } from "../share/visible";
import { describeEditor } from "../share/editor";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import type { Block, CodeLanguage, FileRef } from "../contract/contract";
import { Notice, StatusText } from "../components/primitives";
import { DataState } from "../components/data-state";
import { toCoreError } from "../core/core-transport";
import { useBinding } from "../data/window-data";
import type { BlockContext } from "./block-context";
import { resolveFilePath } from "./file-path";
import { codeHighlighting, codeLanguageForPath, codeViewText, languageExtension } from "./code-language";
import { FileGrant } from "./file-grant";

type Data = Extract<Block, { type: "code_view" }>;
export function CodeViewBlock({ block, context, pointer }: { block: Data; context: BlockContext; pointer: string }) {
  if (block.file) return <FileCodeView block={block} file={block.file} context={context} />;
  return <BoundCodeView block={block} pointer={pointer} />;
}
function BoundCodeView({ block, pointer }: { block: Data; pointer: string }) {
  const value = useBinding(`${pointer}/value`, block.value ?? null);
  if (value.status !== "ready") return <DataState value={value} />;
  return <ReadOnlyCode text={codeViewText(value.value)} language={codeLanguageForPath(null, block.language)} follow={!!block.follow} wrap={!!block.wrap} />;
}
function FileCodeView({ block, file, context }: { block: Data; file: FileRef; context: BlockContext }) {
  const path = resolveFilePath(file, context.window);
  const emptyShareRef = useRef<HTMLDivElement>(null);
  useShareDescriber(emptyShareRef, () => ({ text: "[코드 보기]", visual: false }));
  const root = context.snapshot.device.grants.find((g) => g.window_id === context.window.id && g.permission === file.permission)?.root_path ?? null;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const read = useCallback(async (initial = false) => {
    const current = ++version.current;
    if (!root || path === null) { setText(""); setLoading(false); return; }
    if (initial) setLoading(true);
    try {
      const result = await context.store.call({ op: "files.read", window_id: context.window.id, permission: file.permission, path });
      if (current === version.current) { setText(result.text); setError(null); }
    } catch (reason) { if (current === version.current) setError(toCoreError(reason).message); }
    finally { if (current === version.current) setLoading(false); }
  }, [root, path, context.store, context.window.id, file.permission]);
  useEffect(() => { void read(true); return () => { version.current++; }; }, [read]);
  useEffect(() => { const refresh = () => void read(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [read]);
  if (!root) return <FileGrant context={context} permission={file.permission} />;
  if (path === null) return <div className="ks-code-view" ref={emptyShareRef} />;
  if (loading) return <div className="ks-editor-loading"><StatusText>불러오는 중</StatusText></div>;
  if (error) return <div className="ks-editor-error"><Notice role="alert">{error}</Notice></div>;
  return <ReadOnlyCode path={path} text={text} language={codeLanguageForPath(path, block.language)} follow={!!block.follow} wrap={!!block.wrap} />;
}
function ReadOnlyCode({ text, language, follow, wrap, path = null }: { text: string; language: CodeLanguage; follow: boolean; wrap: boolean; path?: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  useShareDescriber(host, () => describeEditor(view.current, path, "코드 보기"));
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), languageExtension(language), codeHighlighting,
      search(), keymap.of([...defaultKeymap, ...searchKeymap]), ...(wrap ? [EditorView.lineWrapping] : []), EditorView.contentAttributes.of({ "aria-label": "코드 보기", tabindex: "0" }),
    ] }) });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [language, wrap]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === text) return;
    const scroller = editor.scrollDOM;
    const top = scroller.scrollTop;
    const left = scroller.scrollLeft;
    const atEnd = Math.ceil(top + scroller.clientHeight) >= scroller.scrollHeight;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    requestAnimationFrame(() => {
      if (view.current !== editor) return;
      scroller.scrollTop = follow && atEnd ? scroller.scrollHeight : top;
      scroller.scrollLeft = left;
    });
  }, [text, follow]);
  return <div className="ks-code-view" ref={host} />;
}
