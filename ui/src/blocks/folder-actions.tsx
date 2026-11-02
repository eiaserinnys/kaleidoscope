// 메뉴·인라인 편집·알림이 같은 동작 상태를 공유한다. 지정된 알림 보완 범위를 지키기 위해 500줄 분리는 이 변경에서 보류한다.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ShellStore } from "../core/shell-store";
import type { CoreError } from "../contract/contract";
import { SHELL_FILE_EDITOR_SAVE_FAILED, SHELL_FILE_EXTENSION_NOT_ALLOWED } from "../contract/shell-errors";
import { toCoreError } from "../core/core-transport";
import type { TreeRowModel } from "../components/tree/tree-model";
import type { TreeFocusController } from "../components/tree/tree-view";
import { dateText } from "./data-view-common";
import { FileText, FolderOpen } from "../components/icons";
import { Dialog } from "../components/dialog";
import { Menu, type MenuEntry } from "../components/menu";
import { Button, ErrorId, Notice } from "../components/primitives";
import { TextInput, type TextInputCancelReason } from "../components/text-input";
import type { FolderBackend, FolderItem } from "./folder-backend";
import { editorRevision, flushEditors } from "./file-editor-session";
import { clipboardListeners, getClipboard, setClipboard, type ShellClipboard } from "./folder-clipboard";

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function failureMessage(path: string, message: string): string {
  return message.includes(path) ? message : `${path}: ${message}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function itemFromRow(row: TreeRowModel | null): FolderItem | null {
  if (!row) return null;
  const value = row.node.data as FolderItem | { entry?: FolderItem } | undefined;
  if (!value) return null;
  if ("entry" in value) return value.entry ?? null;
  return "path" in value && "kind" in value ? value as FolderItem : null;
}

function destinationFor(row: TreeRowModel | null, item: FolderItem | null, collection = false): string {
  if (collection) return "";
  if (!item) {
    const data = row?.node.data as { directoryPath?: string } | undefined;
    return data?.directoryPath ?? "";
  }
  if (item.kind === "dir") return item.path;
  return row?.parentId ?? parentPath(item.path);
}

function parentOfItem(item: FolderItem): string {
  return parentPath(item.path);
}

function rowId(path: string, collection: boolean): string {
  return collection ? `doc:${path}` : path;
}

function allowedExtensionMessage(name: string, extensions: string[]): CoreError {
  const endings = extensions.map((extension) => `.${extension}`).join(", ");
  return SHELL_FILE_EXTENSION_NOT_ALLOWED({ name, extensions: endings });
}

export interface FolderInlineEdit {
  kind: "file" | "directory" | "rename";
  path: string | null;
  directory: string;
  item?: FolderItem;
  document?: boolean;
  initialName: string;
  error: CoreError | null;
  attempt: number;
}

export function FolderInlineRow({ edit, onCommit, onCancel }: {
  edit: FolderInlineEdit;
  onCommit: (name: string) => void;
  onCancel: (reason?: TextInputCancelReason) => void;
}) {
  const label = edit.kind === "rename" ? "이름 바꾸기"
    : edit.kind === "directory" ? "새 폴더 이름"
      : edit.document ? "새 문서 이름" : "새 파일 이름";
  const directory = edit.kind === "directory" || (edit.kind === "rename" && edit.item?.kind === "dir");
  return <div className="ks-file-tree-entry">
    <div className="ks-row ks-file-tree-row ks-file-tree-create-row">
      <span aria-hidden="true" className="ks-file-tree-icon">{directory ? <FolderOpen size="inline" /> : <FileText size="inline" />}</span>
      <TextInput
        key={`${edit.path ?? edit.directory}:${edit.attempt}`}
        aria-label={label}
        cancelOnBlur
        cancelOnEscape
        commitOnBlur={false}
        onCancel={onCancel}
        onCommit={onCommit}
        selectBeforeExtension={edit.kind === "rename" || edit.kind === "file"}
        value={edit.initialName}
      />
    </div>
    {edit.error ? <span className="ks-inline-error" role="alert">{edit.error.message}{edit.error.id ? <> <ErrorId id={edit.error.id} /></> : null}</span> : null}
  </div>;
}

export function useFolderActions({
  enabled,
  store,
  backend,
  extensions,
  host,
  refreshDirectory,
  prepareDirectory,
  openItem,
  isExpanded,
  getFocusController,
  createCancelFocusId,
}: {
  enabled: boolean;
  store: ShellStore;
  backend: FolderBackend;
  extensions: string[];
  host: () => HTMLElement | null;
  refreshDirectory: (directory: string) => void;
  prepareDirectory: (directory: string) => Promise<void>;
  openItem: (item: FolderItem) => void;
  isExpanded: (path: string) => boolean;
  getFocusController: () => TreeFocusController | null;
  createCancelFocusId: string | null;
}) {
  const [clipboard, setLocalClipboard] = useState<ShellClipboard | null>(() => getClipboard(store));
  const [selection, setSelection] = useState<string[]>([]);
  const [inlineEdit, setInlineEdit] = useState<FolderInlineEdit | null>(null);
  const [menuState, setMenuState] = useState<{ anchor: HTMLElement; point: { x: number; y: number }; item: FolderItem | null; row: TreeRowModel | null; parent: string; focus: TreeFocusController; targetId: string | null } | null>(null);
  const [dialog, setDialog] = useState<{ action: "trash" | "permanent" | "properties"; item: FolderItem; paths: string[]; row: TreeRowModel; focus: TreeFocusController; focusTargets: Array<string | null> } | null>(null);
  const [notice, setNotice] = useState<{ message: string; errorId?: string; failures?: Array<{ path: string; message: string; errorId?: string }>; allowPermanent?: FolderItem; row?: TreeRowModel; focus?: TreeFocusController; focusTargets?: Array<string | null> } | null>(null);
  const [noticeExpanded, setNoticeExpanded] = useState(false);
  const operationRunning = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setLocalClipboard(getClipboard(store));
    const listeners = clipboardListeners.get(store) ?? new Set<(item: ShellClipboard | null) => void>();
    listeners.add(setLocalClipboard);
    clipboardListeners.set(store, listeners);
    return () => { listeners.delete(setLocalClipboard); };
  }, [enabled, store]);

  useEffect(() => { setSelection([]); }, [backend.identity]);
  const pathsFor = useCallback((row: TreeRowModel | null) => {
    if (!row || !itemFromRow(row)) return [];
    const ids = selection.includes(row.id) ? selection : [row.id];
    return ids.map((id) => backend.kind === "collection" ? id.slice(4) : id);
  }, [backend.kind, selection]);
  const isCutPath = useCallback((path: string) => clipboard?.root === backend.identity
    && clipboard.mode === "cut" && clipboard.paths.includes(path), [backend.identity, clipboard]);

  const openMenu = useCallback((row: TreeRowModel | null, anchor: HTMLElement, point: { x: number; y: number }, focus: TreeFocusController) => {
    const item = itemFromRow(row);
    if (item && row && !selection.includes(row.id)) setSelection([row.id]);
    setNotice(null);
    setMenuState({ anchor, point, item, row, parent: destinationFor(row, item, backend.kind === "collection"), focus, targetId: row?.id ?? null });
  }, [backend.kind, selection]);

  const beginEdit = useCallback(async (kind: FolderInlineEdit["kind"], item: FolderItem | null, directory: string, focus: TreeFocusController, cancelFocusId?: string | HTMLElement | null) => {
    const editDirectory = backend.kind === "collection" ? "" : kind === "rename" && item ? parentOfItem(item) : directory;
    await prepareDirectory(editDirectory);
    setMenuState(null);
    setNotice(null);
    const name = kind === "directory" ? "새 폴더"
      : kind === "rename" ? item?.name ?? ""
        : backend.kind === "collection" ? "새 문서.md"
          : extensions.length ? `새 파일.${extensions[0]}` : "새 파일";
    setInlineEdit({
      kind,
      item: item ?? undefined,
      path: item?.path ?? null,
      directory: editDirectory,
      initialName: name,
      error: null,
      attempt: 0,
      document: kind === "file" && backend.kind === "collection",
    });
    setEditFocus({
      focus,
      cancelId: cancelFocusId ?? (item ? rowId(item.path, backend.kind === "collection") : editDirectory ? rowId(editDirectory, backend.kind === "collection") : null),
    });
  }, [backend.kind, extensions, prepareDirectory]);

  const [editFocus, setEditFocus] = useState<{ focus: TreeFocusController; cancelId: string | HTMLElement | null } | null>(null);

  const cancelInline = useCallback((reason?: TextInputCancelReason) => {
    const current = editFocus;
    setInlineEdit(null);
    setEditFocus(null);
    if (reason === "blur" || !current) return;
    if (current.cancelId instanceof HTMLElement) current.cancelId.focus();
    else current.focus.row(current.cancelId, current.cancelId !== null);
  }, [editFocus]);

  const operationFailed = useCallback((error: CoreError | string, item?: FolderItem, row?: TreeRowModel, focus?: TreeFocusController, focusTargets?: Array<string | null>, errorId?: string) => {
    setNoticeExpanded(false);
    const resolvedErrorId = typeof error === "string" ? errorId : error.id;
    setNotice({
      message: typeof error === "string" ? error : error.message,
      ...(resolvedErrorId ? { errorId: resolvedErrorId } : {}),
      ...(item ? { allowPermanent: item } : {}),
      ...(row ? { row } : {}),
      ...(focus ? { focus } : {}),
      ...(focusTargets ? { focusTargets } : {}),
    });
  }, []);

  const reportResults = useCallback((results: Array<{ path: string; error?: CoreError }>, item?: FolderItem, row?: TreeRowModel, focus?: TreeFocusController, focusTargets?: Array<string | null>) => {
    const failures = results.filter((result) => result.error);
    if (!failures.length) return true;
    const trashUnavailable = failures.find((result) => result.error?.code === "trash_unavailable");
    if (trashUnavailable && item) {
      operationFailed(trashUnavailable.error!, item, row, focus, focusTargets);
      return false;
    }
    const details = failures.map((failure) => {
      const id = failure.error!.id;
      return { path: failure.path, message: failure.error!.message, ...(id ? { errorId: id } : {}) };
    });
    const errorId = failures.every((failure) => failure.error?.id === failures[0].error?.id) ? failures[0].error?.id : undefined;
    if (results.length === 1) {
      operationFailed(failures[0].error!, undefined, undefined, undefined, undefined, errorId);
      return false;
    }
    if (details.length === 1) {
      operationFailed(`1개 실패: ${failureMessage(details[0].path, details[0].message)}`, undefined, undefined, undefined, undefined, errorId);
      return false;
    }
    const sameMessage = details.every((failure) => failure.message === details[0].message);
    setNoticeExpanded(false);
    setNotice({ message: `${details.length}개 실패${sameMessage ? `: ${details[0].message}` : ""}`, failures: details, ...(errorId ? { errorId } : {}) });
    return false;
  }, [operationFailed]);

  const flushPaths = useCallback(async (paths: string[]) => {
    const results = await Promise.all(paths.map((path) => flushEditors(backend.editorAddress(path))));
    if (results.every(Boolean)) return true;
    operationFailed(SHELL_FILE_EDITOR_SAVE_FAILED());
    return false;
  }, [backend, operationFailed]);
  const flushBefore = useCallback((item: FolderItem) => flushPaths([item.path]), [flushPaths]);

  const runTrash = useCallback(async (item: FolderItem, paths: string[], permanent: boolean, row: TreeRowModel, focus: TreeFocusController, focusTargets: Array<string | null>) => {
    if (operationRunning.current) return;
    const remove = permanent ? backend.actions.permanentDelete : backend.actions.trash;
    if (!remove) return;
    setNotice(null);
    operationRunning.current = true;
    try {
      if (!(await flushPaths(paths))) {
        focus.row(row.id);
        return;
      }
      const results = await remove(paths);
      const succeeded = reportResults(results, permanent || paths.length > 1 ? undefined : item, row, focus, focusTargets);
      if (succeeded) setSelection([]);
      if (succeeded) focus.afterDelete(focusTargets);
      else focus.row(row.id);
    } catch (cause) {
      const error = toCoreError(cause);
      operationFailed(error, !permanent && error.code === "trash_unavailable" ? item : undefined, row, focus, focusTargets);
      focus.row(row.id);
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions.permanentDelete, backend.actions.trash, flushPaths, operationFailed, reportResults]);

  const confirmDialog = useCallback(() => {
    if (!dialog) return;
    const current = dialog;
    setDialog(null);
    if (current.action === "properties") {
      current.focus.row(current.row.id);
      return;
    }
    void runTrash(current.item, current.paths, current.action === "permanent", current.row, current.focus, current.focusTargets);
  }, [dialog, runTrash]);

  const commitInline = useCallback(async (name: string) => {
    if (!inlineEdit || operationRunning.current) return;
    setNotice(null);
    const current = inlineEdit;
    const action = current.kind === "rename" ? backend.actions.rename
      : current.kind === "directory" ? backend.actions.createDirectory
        : backend.actions.createFile;
    if (!action) return;
    if (current.kind === "file" && extensions.length && !extensionOf(name)) name = `${name}.${extensions[0]}`;
    const isFile = current.kind === "file" || (current.kind === "rename" && current.item?.kind === "file");
    if (isFile && extensions.length && !extensions.some((extension) => extension.toLowerCase() === extensionOf(name))) {
      setInlineEdit((currentEdit) => currentEdit ? {
        ...currentEdit,
        initialName: name,
        error: allowedExtensionMessage(name, extensions),
        attempt: currentEdit.attempt + 1,
      } : null);
      return;
    }
    operationRunning.current = true;
    try {
      if (current.kind === "rename" && current.item && !(await flushBefore(current.item))) return;
      if (current.kind === "rename" && current.item) {
        const revision = editorRevision(backend.editorAddress(current.item.path));
        const item = revision === undefined ? current.item : { ...current.item, revision: revision ?? undefined };
        await backend.actions.rename!(item, name);
      }
      else await (action as (parent: string, name: string) => Promise<void>)(current.directory, name);
      const parent = current.kind === "rename" && current.item ? parentOfItem(current.item) : current.directory;
      const path = parent ? `${parent}/${name}` : name;
      setInlineEdit(null);
      setEditFocus(null);
      if (current.kind === "file") openItem({ name, path, kind: "file", ext: extensionOf(name), size: 0, modified: "" });
      editFocus?.focus.row(rowId(path, backend.kind === "collection"), true, current.kind === "rename");
    } catch (cause) {
      const error = toCoreError(cause);
      setInlineEdit((currentEdit) => currentEdit ? {
        ...currentEdit,
        initialName: name,
        error,
        attempt: currentEdit.attempt + 1,
      } : null);
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions, backend.kind, editFocus, extensions, flushBefore, inlineEdit, openItem]);

  const copyPath = useCallback(async (item: FolderItem, absolute: boolean) => {
    try {
      const value = absolute ? await backend.actions.absolutePath?.(item.path) : await backend.actions.relativePath?.(item.path);
      if (value === undefined) return;
      await navigator.clipboard.writeText(value);
    } catch (cause) {
      operationFailed(toCoreError(cause));
    }
  }, [backend.actions.absolutePath, backend.actions.relativePath, operationFailed]);

  const transferPaths = useCallback(async (paths: string[], destination: string, mode: "copy" | "cut") => {
    if (operationRunning.current) return;
    const action = mode === "cut" ? backend.actions.move : backend.actions.copy;
    if (!action) return;
    setNotice(null);
    operationRunning.current = true;
    try {
      if (!(await flushPaths(paths))) return;
      const results = await action(paths, destination);
      const succeeded = results.filter((result) => !result.error).map((result) => result.path);
      const currentClipboard = getClipboard(store);
      if (mode === "cut" && currentClipboard?.mode === "cut" && currentClipboard.root === backend.identity) {
        const remaining = currentClipboard.paths.filter((path) => !succeeded.some((success) => path === success || path.startsWith(`${success}/`)));
        setClipboard(store, remaining.length ? { ...currentClipboard, paths: remaining } : null);
      }
      reportResults(results);
    } catch (cause) {
      operationFailed(toCoreError(cause));
    } finally {
      operationRunning.current = false;
    }
  }, [backend, flushPaths, operationFailed, reportResults, store]);
  const executePaste = useCallback((destination: string) => {
    if (clipboard?.root === backend.identity) void transferPaths(clipboard.paths, destination, clipboard.mode);
  }, [backend.identity, clipboard, transferPaths]);

  const createDuplicate = useCallback(async (item: FolderItem, destination: string) => {
    if (operationRunning.current || !backend.actions.copy) return;
    setNotice(null);
    operationRunning.current = true;
    try {
      if (await flushBefore(item)) reportResults(await backend.actions.copy([item.path], destination));
    } catch (cause) {
      operationFailed(toCoreError(cause));
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions.copy, flushBefore, operationFailed, reportResults]);

  const beginCreateFile = useCallback((directory = "", focus?: TreeFocusController | null, cancelFocusId?: string | HTMLElement | null) => {
    const controller = focus ?? getFocusController();
    if (!controller) return;
    void beginEdit("file", null, directory, controller, cancelFocusId);
  }, [beginEdit, getFocusController]);

  const menuItems = useMemo((): MenuEntry[] => {
    if (!menuState) return [];
    const { item, parent, row, focus } = menuState;
    const paths = pathsFor(row);
    const single = paths.length === 1;
    const deletedIds = paths.map((path) => rowId(path, backend.kind === "collection"));
    const restoreId = row ? row.node.content === undefined ? menuState.targetId : row.parentId : createCancelFocusId;
    const capabilities = backend.capabilities;
    const items: MenuEntry[] = [];
    if (item && single) items.push({
      id: "open",
      label: item.kind === "dir" && isExpanded(item.path) ? "접기" : item.kind === "dir" ? "펼치기" : "열기",
      onSelect: () => openItem(item),
    });
    if (capabilities.createFile) items.push({ id: "new-file", label: backend.kind === "collection" ? "새 문서" : "새 파일", onSelect: () => void beginEdit("file", null, parent, focus, restoreId) });
    if (capabilities.createDirectory) items.push({ id: "new-folder", label: "새 폴더", shortcut: "Ctrl+Shift+N", onSelect: () => void beginEdit("directory", null, parent, focus, restoreId) });
    if (item && (capabilities.rename || capabilities.trash || capabilities.permanentDelete || capabilities.copy || capabilities.move)) items.push({ id: "separator-top", type: "separator" });
    if (item && single && capabilities.rename) items.push({ id: "rename", label: "이름 바꾸기", shortcut: "F2", onSelect: () => void beginEdit("rename", item, parentOfItem(item), focus, menuState.targetId) });
    if (item && capabilities.trash) items.push({ id: "trash", label: "휴지통으로 이동", shortcut: "Delete", danger: true, onSelect: () => setDialog({ action: "trash", item, paths, row: row!, focus, focusTargets: focus.deletionTargets(row!, deletedIds) }) });
    else if (item && capabilities.permanentDelete) items.push({ id: "permanent", label: "영구 삭제", shortcut: "Delete", danger: true, onSelect: () => setDialog({ action: "permanent", item, paths, row: row!, focus, focusTargets: focus.deletionTargets(row!, deletedIds) }) });
    if (item && capabilities.trash && capabilities.permanentDelete) items.push({ id: "permanent", label: "영구 삭제", shortcut: "Shift+Delete", danger: true, onSelect: () => setDialog({ action: "permanent", item, paths, row: row!, focus, focusTargets: focus.deletionTargets(row!, deletedIds) }) });
    if (item && (capabilities.move || capabilities.copy)) items.push({ id: "separator-clipboard", type: "separator" });
    if (item && capabilities.move) items.push({ id: "cut", label: "잘라내기", shortcut: "Ctrl+X", onSelect: () => setClipboard(store, { root: backend.identity, paths, mode: "cut" }) });
    if (item && capabilities.copy) items.push({ id: "copy", label: "복사", shortcut: "Ctrl+C", onSelect: () => setClipboard(store, { root: backend.identity, paths, mode: "copy" }) });
    if (clipboard?.root === backend.identity && (capabilities.move || capabilities.copy)) items.push({ id: "paste", label: "붙여넣기", shortcut: "Ctrl+V", onSelect: () => void executePaste(parent) });
    if (item && single && capabilities.duplicate) items.push({ id: "duplicate", label: "사본 만들기", onSelect: () => void createDuplicate(item, parentOfItem(item)) });
    if (item && single && (capabilities.absolutePath || capabilities.relativePath || capabilities.reveal)) items.push({ id: "separator-path", type: "separator" });
    if (item && single && capabilities.absolutePath) items.push({ id: "absolute-path", label: "경로 복사", onSelect: () => void copyPath(item, true) });
    if (item && single && capabilities.relativePath) items.push({ id: "relative-path", label: "상대 경로 복사", onSelect: () => void copyPath(item, false) });
    if (item && single && capabilities.reveal) items.push({ id: "reveal", label: "파일 관리자에서 보기", onSelect: () => void backend.actions.reveal?.(item.path).catch((cause) => operationFailed(toCoreError(cause))) });
    if (items.length) items.push({ id: "refresh-separator", type: "separator" });
    items.push({ id: "refresh", label: "새로 고침", shortcut: "F5", onSelect: () => refreshDirectory(parent) });
    if (item && single && capabilities.properties) items.push({ id: "properties", label: "속성", onSelect: () => setDialog({ action: "properties", item, paths, row: row!, focus, focusTargets: focus.deletionTargets(row!) }) });
    return items;
  }, [backend.actions, backend.capabilities, backend.identity, backend.kind, beginEdit, clipboard, copyPath, createCancelFocusId, createDuplicate, executePaste, isExpanded, menuState, openItem, operationFailed, pathsFor, refreshDirectory, store]);

  const commandKeyDown = useCallback((row: TreeRowModel | null, event: KeyboardEvent<HTMLElement>, focus: TreeFocusController): boolean => {
    const ids = selection.length ? selection : row ? [row.id] : [];
    const targetRows = focus.rows(ids);
    const targetRow = targetRows[0] ?? null;
    const target = itemFromRow(targetRow);
    const paths = targetRows.flatMap((entry) => itemFromRow(entry)?.path ?? []);
    const parent = destinationFor(row, itemFromRow(row), backend.kind === "collection");
    const key = event.key;
    if (key === "F2" && target && paths.length === 1 && backend.capabilities.rename) {
      void beginEdit("rename", target, parentOfItem(target), focus, targetRow?.id);
      return true;
    }
    if (key === "Delete" && target && !event.shiftKey && backend.capabilities.trash) {
      setDialog({ action: "trash", item: target, paths, row: targetRow!, focus, focusTargets: focus.deletionTargets(row ?? targetRow!, ids) });
      return true;
    }
    if (key === "Delete" && target && !event.shiftKey && backend.capabilities.permanentDelete) {
      setDialog({ action: "permanent", item: target, paths, row: targetRow!, focus, focusTargets: focus.deletionTargets(row ?? targetRow!, ids) });
      return true;
    }
    if (key === "Delete" && target && event.shiftKey && backend.capabilities.permanentDelete) {
      setDialog({ action: "permanent", item: target, paths, row: targetRow!, focus, focusTargets: focus.deletionTargets(row ?? targetRow!, ids) });
      return true;
    }
    if (key === "Escape" && notice) {
      setNotice(null);
      return true;
    }
    if (key === "Escape" && (selection.length || (clipboard?.root === backend.identity && clipboard.mode === "cut"))) {
      setSelection([]);
      if (clipboard?.root === backend.identity && clipboard.mode === "cut") setClipboard(store, null);
      return true;
    }
    if (event.ctrlKey && event.shiftKey && key.toLowerCase() === "n" && backend.capabilities.createDirectory) {
      void beginEdit("directory", null, parent, focus, row?.id ?? null);
      return true;
    }
    if (key === "F5") {
      refreshDirectory(parent);
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "c" && target && backend.capabilities.copy) {
      setClipboard(store, { root: backend.identity, paths, mode: "copy" });
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "x" && target && backend.capabilities.move) {
      setClipboard(store, { root: backend.identity, paths, mode: "cut" });
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "v" && clipboard?.root === backend.identity && (backend.capabilities.move || backend.capabilities.copy)) {
      void executePaste(parent);
      return true;
    }
    const opensMenu = (key === "F10" && event.shiftKey) || key === "ContextMenu";
    if (opensMenu) {
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(row, event.currentTarget, { x: rect.left, y: rect.bottom }, focus);
      return true;
    }
    return false;
  }, [backend.capabilities, backend.identity, backend.kind, beginEdit, clipboard, executePaste, openMenu, refreshDirectory, selection, store, notice]);

  const inlineRow = useCallback((directory: string, beforePath?: string) => {
    if (!inlineEdit || inlineEdit.directory !== directory) return null;
    if (inlineEdit.path ? inlineEdit.path !== beforePath : beforePath !== undefined) return null;
    return <FolderInlineRow edit={inlineEdit} onCancel={cancelInline} onCommit={(name) => void commitInline(name)} />;
  }, [cancelInline, commitInline, inlineEdit]);

  const menuElement: ReactNode = menuState ? <Menu
    anchor={menuState.anchor}
    anchorPoint={menuState.point}
    items={menuItems}
    onClose={() => setMenuState(null)}
  /> : null;

  const dialogHost = host();
  const dialogProperties = dialog?.action === "properties"
    ? (backend.actions.properties?.(dialog.item) ?? []).map((property) => property.label === "수정 시각"
      ? { ...property, value: dateText(property.value) || "—" }
      : property)
    : [];
  const dialogElement: ReactNode = dialog && dialogHost ? <Dialog
    host={dialogHost}
    title={dialog.action === "properties" ? "속성" : dialog.paths.length > 1 ? `${dialog.paths.length}개 항목` : dialog.item.name}
    body={dialog.action === "properties"
      ? <dl className="ks-properties">{dialogProperties.map((property) => <Fragment key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></Fragment>)}</dl>
      : dialog.action === "trash" ? undefined : <span>되돌릴 수 없습니다.</span>}
    ok={dialog.action === "properties" ? "닫기" : dialog.action === "trash" ? "휴지통으로 이동" : "영구 삭제"}
    danger={dialog.action !== "properties"}
    showCancel={dialog.action !== "properties"}
    onCancel={() => setDialog(null)}
    onConfirm={confirmDialog}
  /> : null;

  const dismissNotice = () => {
    setNotice(null);
    getFocusController()?.visibleRow(null);
  };
  const closeNotice = <Button key="close" onClick={dismissNotice}>닫기</Button>;
  const noticeNode = notice ? <Notice role="alert" onDismiss={dismissNotice} errorId={notice.errorId} details={noticeExpanded && notice.failures ? notice.failures.map((failure) => <div key={failure.path}>{failureMessage(failure.path, failure.message)}{failure.errorId ? <> <ErrorId id={failure.errorId} /></> : null}</div>) : undefined} actions={notice.failures ? [<Button key="details" onClick={() => setNoticeExpanded((current) => !current)}>{noticeExpanded ? "접기" : "펼치기"}</Button>, closeNotice] : notice.allowPermanent ? [<Button key="permanent" onClick={() => {
    const item = notice.allowPermanent!;
    const row = notice.row;
    const focus = notice.focus;
    const focusTargets = notice.focusTargets;
    setNotice(null);
    if (row && focus) setDialog({ action: "permanent", item, paths: [item.path], row, focus, focusTargets: focusTargets ?? focus.deletionTargets(row) });
  }}>영구 삭제</Button>, closeNotice] : [closeNotice]}>{notice.message}</Notice> : null;

  return {
    backend,
    clipboard,
    commandKeyDown,
    beginCreateFile,
    inlineEdit,
    inlineRow,
    menuElement,
    onContextMenu: openMenu,
    dialogElement,
    noticeNode,
    isCutPath,
    selection,
    setSelection,
    pathsFor,
    transferPaths,
    menuTargetId: menuState?.targetId ?? null,
  };
}
