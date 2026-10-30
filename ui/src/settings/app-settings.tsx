import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SelectOption, StorageEntryDecl } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "../blocks/block-context";
import { MarkdownEditorBlock } from "../blocks/markdown-editor";
import { documentEditorSession } from "../blocks/document-editor-session";
import { useBinding } from "../data/window-data";
import { DataState } from "../components/data-state";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Plus, RotateCcw, X } from "../components/icons";
import { Button, IconButton, Notice, StatusText } from "../components/primitives";
import { Select, Toggle, equalOption, optionValue } from "../components/select-toggle";
import { TextInput } from "../components/text-input";
import { SettingsEntrySession } from "./settings-entry-session";

export function AppSettings({ context, open, onClose, onProblem }: { context: BlockContext; open: boolean; onClose: () => void; onProblem?: (message: string | null) => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const problems = useRef(new Map<string, string>());
  const reportProblem = (id: string, message: string | null) => {
    if (message) problems.current.set(id, message); else problems.current.delete(id);
    onProblem?.(problems.current.values().next().value ?? null);
  };
  useEffect(() => { if (open) title.current?.focus(); }, [open]);
  const entries = context.definition.storage?.entries ?? [];
  const groups = [false, true].map((workspace) => entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.presentation === "settings" && entry.key.includes("{workspace_id}") === workspace));
  const close = () => { if (document.activeElement instanceof HTMLElement && root.current?.contains(document.activeElement)) document.activeElement.blur(); onClose(); };
  return <div className="ks-app-settings" data-ks-overlay data-ks-share-skip hidden={!open} ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header className="ks-data-toolbar"><IconButton aria-label="앱으로 돌아가기" onClick={close}><ArrowLeft /></IconButton><h2 ref={title} tabIndex={-1}>앱 설정</h2></header>
    <div className="ks-app-settings-scroll">{groups.map((items, group) => items.length ? <section className="ks-settings-group" key={group}>
      <h3 className="ks-data-section-title">{group ? "이 작업" : "모든 작업"}</h3>
      {items.map(({ entry, index }) => <SettingsEntry key={entry.id} context={context} entry={entry} index={index} open={open} onProblem={reportProblem} />)}
    </section> : null)}</div>
  </div>;
}

function SettingsEntry({ context, entry, index, open, onProblem }: { context: BlockContext; entry: StorageEntryDecl; index: number; open: boolean; onProblem: (id: string, message: string | null) => void }) {
  const session = useMemo(() => new SettingsEntrySession(context.store, context.window.id, entry), [context.store, context.window.id, context.window.app_version, entry.id]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const documentSession = useMemo(() => entry.kind === "md" ? documentEditorSession(context.store, context.window.id, entry.id) : null, [context.store, context.window.id, entry.id, entry.kind]);
  const documentState = useSyncExternalStore(documentSession?.subscribe ?? (() => () => undefined), documentSession?.getSnapshot ?? (() => null), documentSession?.getSnapshot ?? (() => null));
  const [expanded, setExpanded] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLButtonElement>(null);
  const focusDocument = useRef(false);
  const id = `settings-${context.window.id}-${entry.id}`;
  useEffect(() => { if (!open && documentSession) void documentSession.saveNow(); }, [open, documentSession]);
  useEffect(() => {
    if (!expanded || !focusDocument.current || !documentState?.loaded) return;
    const frame = requestAnimationFrame(() => { row.current?.querySelector<HTMLElement>(".cm-content")?.focus(); focusDocument.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [expanded, documentState?.loaded]);
  useEffect(() => { onProblem(entry.id, state.conflict || documentState?.conflict ? "다른 곳에서 바뀌었습니다" : state.error?.message ?? documentState?.error ?? null); }, [entry.id, state.conflict, state.error, documentState?.conflict, documentState?.error]);
  useEffect(() => {
    void session.load();
    const unsubscribe = context.store.subscribeEvents((event) => {
      if (event.event === "storage.update" && event.window_id === context.window.id && (event.update.kind === "snapshot" || event.update.changed.item.entry_id === entry.id)) void session.refresh();
    });
    return () => { unsubscribe(); session.dispose(); };
  }, [context.store, context.window.id, entry.id, session]);
  const restoreFocus = () => row.current?.querySelector<HTMLElement>("input, button[role=switch], .ks-settings-control button, .cm-content")?.focus();
  const reset = async () => {
    if (entry.kind === "md") {
      if (!await documentSession?.saveNow()) return;
      await session.load(true);
      if (session.getSnapshot().error) return;
    }
    await session.reset();
    if (documentSession) await documentSession.refreshOnFocus();
    restoreFocus();
  };
  const status = state.saving || documentState?.status === "saving" ? "저장 중" : state.saved ? "저장됨" : !state.exists && state.loaded && !state.dirty && !state.conflict && !state.error && !documentState?.dirty ? "기본값" : "";
  return <div className="ks-settings-entry" ref={row}>
    <div className="ks-settings-label-row">
      {entry.kind === "md" ? <button ref={heading} type="button" className="ks-data-section-toggle" aria-expanded={expanded} aria-controls={`${id}-document`} onClick={() => {
        if (expanded) { setExpanded(false); heading.current?.focus(); }
        else { focusDocument.current = true; setExpanded(true); }
      }}>{expanded ? <ChevronDown size="inline" /> : <ChevronRight size="inline" />}<span>{entry.label}</span></button> : <label id={`${id}-label`} htmlFor={id}>{entry.label}</label>}
      {status ? <StatusText>{status}</StatusText> : null}
      {state.exists ? <IconButton aria-label={`${entry.label} 기본값으로 되돌리기`} disabled={state.saving} onClick={() => void reset()}><RotateCcw /></IconButton> : null}
    </div>
    {entry.description ? <div className="ks-settings-description" id={`${id}-description`}>{entry.description}</div> : null}
    {!state.loaded && !state.error ? <StatusText>불러오는 중</StatusText> : null}
    {state.loaded ? <div className="ks-settings-control">
      {entry.kind === "md" ? <div id={`${id}-document`} className="ks-settings-document" hidden={!expanded}><MarkdownEditorBlock block={{ type: "markdown_editor", document: { entry: entry.id } }} context={context} /></div>
        : <SettingControl id={id} entry={entry} index={index} value={state.value} session={session} invalid={state.error?.code === "invalid_request"} />}
    </div> : null}
    {state.conflict ? <Notice role="alert" actions={[
      <Button key="reload" onClick={() => void session.reload().then(restoreFocus)}>다시 불러오기</Button>,
      <Button key="overwrite" variant="emphasis" onClick={() => void session.overwrite().then(restoreFocus)}>덮어쓰기</Button>,
    ]}>다른 곳에서 바뀌었습니다</Notice> : null}
    {state.error ? <div id={`${id}-error`}><Notice role="alert" actions={state.error.code === "invalid_request" ? undefined : [<Button key="retry" onClick={() => void session.retry()}>다시 시도</Button>]}>{state.error.message}</Notice></div> : null}
  </div>;
}

function valueLabel(value: JsonValue): string {
  if (value === null) return "지정 안 함";
  if (typeof value === "boolean") return value ? "켬" : "끔";
  return String(value);
}

function includeCurrent(options: SelectOption[], value: JsonValue): SelectOption[] {
  return options.some((item) => equalOption(value, optionValue(item))) ? options : [{ value, label: valueLabel(value) }, ...options];
}

function SettingControl({ id, entry, index, value, session, invalid }: { id: string; entry: StorageEntryDecl; index: number; value: JsonValue; session: SettingsEntrySession; invalid: boolean }) {
  const schema = entry.schema!;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const kind = types.find((type) => type !== "null");
  const bound = useBinding(`/storage/entries/${index}/choices`, entry.choices ?? null);
  const options: SelectOption[] = entry.choices !== undefined && bound.status === "ready"
    ? (Array.isArray(bound.value) ? bound.value : bound.value == null ? [] : [bound.value]).flatMap((item): SelectOption[] => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object" && !Array.isArray(item) && typeof item.value === "string") return [{ value: item.value, label: typeof item.label === "string" ? item.label : item.value }];
      return [];
    }) : (schema.enum ?? []).map((item): SelectOption => ({ value: item, label: valueLabel(item) }));
  const hasOptions = entry.choices !== undefined || schema.enum !== undefined || (kind === "boolean" && nullable);
  const describedBy = [entry.description ? `${id}-description` : null, invalid ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const save = (next: JsonValue) => { session.edit(next); void session.save(); };
  if (entry.choices !== undefined && bound.status !== "ready") return <DataState value={bound} compact />;
  if (kind === "boolean" && !hasOptions) return <Toggle checked={Boolean(value)} labelledBy={`${id}-label`} invalid={invalid || undefined} describedBy={describedBy} onChange={save} />;
  if (kind === "array") return <StringList label={entry.label} value={Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []} options={hasOptions ? options : undefined} unique={Boolean(schema.uniqueItems)} session={session} invalid={invalid} describedBy={describedBy} onChange={save} />;
  if (hasOptions) {
    let items = kind === "boolean" && nullable && schema.enum === undefined ? [{ value: true, label: "켬" }, { value: false, label: "끔" }, { value: null, label: "지정 안 함" }] : options;
    if (entry.choices !== undefined && nullable && (schema.enum === undefined || schema.enum.includes(null))) items = [...items, { value: null, label: "지정 안 함" }];
    return <Select label={entry.label} items={includeCurrent(items, value)} value={value} invalid={invalid || undefined} describedBy={describedBy} onChange={save} />;
  }
  const convert = (text: string): JsonValue => nullable && !text ? null : kind === "number" || kind === "integer" ? Number(text) : text;
  return <TextInput id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} persistent value={value == null ? "" : String(value)}
    onFocus={() => session.beginEdit()} onEdit={(text) => { session.beginEdit(); if ((kind !== "number" && kind !== "integer") || (text.trim() !== "" && Number.isFinite(Number(text))) || (nullable && text === "")) session.edit(convert(text)); }}
    onCommit={(text) => { if ((kind === "number" || kind === "integer") && (text.trim() === "" && !nullable || !Number.isFinite(Number(text)))) return; session.edit(convert(text)); void session.finishEdit(); }} onCancel={() => session.cancel()} />;
}

function StringList({ label, value, options, unique, session, invalid, describedBy, onChange }: { label: string; value: string[]; options?: SelectOption[]; unique: boolean; session: SettingsEntrySession; invalid: boolean; describedBy?: string; onChange: (value: JsonValue) => void }) {
  const [addition, setAddition] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const focusAt = (index: number) => requestAnimationFrame(() => host.current?.querySelectorAll<HTMLElement>("[data-list-control]")[index]?.querySelector<HTMLElement>("button, input")?.focus());
  const available = options?.filter((option) => !unique || !value.includes(typeof option === "string" ? option : String(option.value)));
  const move = (index: number, delta: number) => { const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next); focusAt(index + delta); };
  return <div className="ks-settings-list" ref={host}>
    {value.map((item, index) => <div className="ks-settings-list-row" key={index}>
      <span className="ks-settings-index">{index + 1}</span><span className="ks-settings-list-input" data-list-control>
        {options ? <Select label={`${index + 1} ${item}`} invalid={invalid || undefined} describedBy={describedBy} items={includeCurrent(options.filter((option) => !unique || !value.some((old, i) => i !== index && old === optionValue(option))), item)} value={item} onChange={(next) => onChange(value.map((old, i) => i === index ? String(next) : old))} /> : <TextInput persistent aria-label={`${index + 1} ${item}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={item} onFocus={() => session.beginEdit()} onCommit={(next) => { onChange(value.map((old, i) => i === index ? next : old)); void session.finishEdit(); }} onCancel={() => session.cancel()} />}
      </span><IconButton aria-label={`${item} 위로`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton><IconButton aria-label={`${item} 아래로`} disabled={index === value.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton><IconButton aria-label={`${item} 삭제`} onClick={() => { onChange(value.filter((_, i) => i !== index)); focusAt(Math.min(index, value.length - 1)); }}><X /></IconButton>
    </div>)}
    <div className="ks-settings-list-add"><span className="ks-settings-list-input" data-list-control>{options ? <Select add label={`${label.replace(/ 순서$/, "")} 추가`} invalid={invalid || undefined} describedBy={describedBy} items={available ?? []} value={undefined} placeholder={`${label.replace(/ 순서$/, "")} 추가`} onChange={(next) => onChange([...value, String(next)])} /> : <TextInput persistent aria-label={`${label} 추가`} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={addition} onEdit={setAddition} onCommit={setAddition} onCancel={() => setAddition("")} />}</span>{!options ? <Button disabled={!addition || (unique && value.includes(addition))} onClick={() => { onChange([...value, addition]); setAddition(""); }}><Plus size="inline" /> {label} 추가</Button> : null}</div>
  </div>;
}
