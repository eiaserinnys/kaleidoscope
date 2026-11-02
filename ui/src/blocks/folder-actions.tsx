import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ShellStore } from "../core/shell-store";
import { toCoreError } from "../core/core-transport";
import type { TreeRowModel } from "../components/tree/tree-model";
import { Dialog } from "../components/dialog";
import { Menu, type MenuEntry } from "../components/menu";
import { Button, Notice } from "../components/primitives";
import { TextInput } from "../components/text-input";
import type { FolderBackend, FolderItem } from "./folder-backend";
import { editorRevision, flushEditors } from "./file-editor-session";

interface ShellClipboard {
  root: string;
  path: string;
  mode: "copy" | "cut";
}

const clipboardByStore = new WeakMap<ShellStore, ShellClipboard>();
const clipboardListeners = new WeakMap<ShellStore, Set<(clipboard: ShellClipboard | null) => void>>();

function getClipboard(store: ShellStore): ShellClipboard | null {
  return clipboardByStore.get(store) ?? null;
}

function setClipboard(store: ShellStore, clipboard: ShellClipboard | null) {
  if (clipboard) clipboardByStore.set(store, clipboard);
  else clipboardByStore.delete(store);
  for (const listener of clipboardListeners.get(store) ?? []) listener(clipboard);
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
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

function parentFor(row: TreeRowModel | null, item: FolderItem | null, collection = false): string {
  if (collection) return "";
  if (!item) {
    const data = row?.node.data as { directoryPath?: string } | undefined;
    return data?.directoryPath ?? "";
  }
  if (item.kind === "dir") return item.path;
  return row?.parentId ?? parentPath(item.path);
}

export interface FolderInlineEdit {
  kind: "file" | "directory" | "rename";
  path: string | null;
  directory: string;
  item?: FolderItem;
  document?: boolean;
  initialName: string;
  error: string | null;
  attempt: number;
}

export function FolderInlineRow({ edit, onCommit, onCancel }: {
  edit: FolderInlineEdit;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const label = edit.kind === "rename" ? "이름 바꾸기"
    : edit.kind === "directory" ? "새 폴더 이름"
      : edit.document ? "새 문서 이름" : "새 파일 이름";
  return <div className="ks-file-tree-entry">
    <div className="ks-row ks-file-tree-row ks-file-tree-create-row">
      <span aria-hidden="true" className="ks-file-tree-icon" />
      <TextInput
        key={`${edit.path ?? edit.directory}:${edit.attempt}`}
        aria-label={label}
        cancelOnBlur
        cancelOnEscape
        commitOnBlur={false}
        onCancel={onCancel}
        onCommit={onCommit}
        selectBeforeExtension={edit.kind === "rename"}
        value={edit.initialName}
      />
    </div>
    {edit.error ? <span className="ks-inline-error" role="alert">{edit.error}</span> : null}
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
}) {
  const [clipboard, setLocalClipboard] = useState<ShellClipboard | null>(() => getClipboard(store));
  const [inlineEdit, setInlineEdit] = useState<FolderInlineEdit | null>(null);
  const [menuState, setMenuState] = useState<{ anchor: HTMLElement; point: { x: number; y: number }; item: FolderItem | null; parent: string } | null>(null);
  const [dialog, setDialog] = useState<{ action: "trash" | "permanent" | "properties"; item: FolderItem } | null>(null);
  const [notice, setNotice] = useState<{ message: string; allowPermanent?: FolderItem } | null>(null);
  const operationRunning = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setLocalClipboard(getClipboard(store));
    const listeners = clipboardListeners.get(store) ?? new Set<(item: ShellClipboard | null) => void>();
    listeners.add(setLocalClipboard);
    clipboardListeners.set(store, listeners);
    return () => { listeners.delete(setLocalClipboard); };
  }, [enabled, store]);

  const isCutPath = useCallback((path: string) => clipboard?.root === backend.identity
    && clipboard.mode === "cut" && clipboard.path === path, [backend.identity, clipboard]);

  const openMenu = useCallback((row: TreeRowModel | null, anchor: HTMLElement, point: { x: number; y: number }) => {
    const item = itemFromRow(row);
    setNotice(null);
    setMenuState({ anchor, point, item, parent: parentFor(row, item, backend.kind === "collection") });
  }, [backend.kind]);

  const beginEdit = useCallback(async (kind: FolderInlineEdit["kind"], item: FolderItem | null, directory: string) => {
    await prepareDirectory(directory);
    setMenuState(null);
    setNotice(null);
    const name = kind === "directory" ? "새 폴더"
      : kind === "rename" ? item?.name ?? ""
        : backend.kind === "collection" ? "새 문서.md"
          : extensions.length ? `새 파일.${extensions[0]}` : "새 파일";
    const editDirectory = kind === "rename" && backend.kind === "collection" ? "" : directory;
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
  }, [backend.kind, extensions, prepareDirectory]);

  const operationFailed = useCallback((message: string, item?: FolderItem) => {
    setNotice({ message, ...(item ? { allowPermanent: item } : {}) });
  }, []);

  const reportResults = useCallback((results: Array<{ path: string; error?: { code: string; message: string } }>, item?: FolderItem) => {
    const failures = results.filter((result) => result.error);
    if (!failures.length) return;
    const trashUnavailable = failures.find((result) => result.error?.code === "trash_unavailable");
    if (trashUnavailable && item) {
      operationFailed(`${trashUnavailable.error?.message ?? "휴지통으로 보낼 수 없습니다."} 영구 삭제를 선택할 수 있습니다.`, item);
      return;
    }
    const message = failures.length === 1
      ? failures[0].error!.message
      : `${failures.length}개 실패: ${failures.map((failure) => failure.error!.message).join(" · ")}`;
    operationFailed(message);
  }, [operationFailed]);

  const flushBefore = useCallback(async (item: FolderItem) => {
    if (await flushEditors(backend.editorAddress(item.path))) return true;
    operationFailed("편집 중인 내용을 저장하지 못해 작업을 취소했습니다.");
    return false;
  }, [backend, operationFailed]);

  const runTrash = useCallback(async (item: FolderItem, permanent: boolean) => {
    if (operationRunning.current) return;
    const remove = permanent ? backend.actions.permanentDelete : backend.actions.trash;
    if (!remove) return;
    operationRunning.current = true;
    try {
      if (!(await flushBefore(item))) return;
      const results = await remove([item.path]);
      reportResults(results, permanent ? undefined : item);
    } catch (cause) {
      const error = toCoreError(cause);
      operationFailed(error.message, !permanent && error.code === "trash_unavailable" ? item : undefined);
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions.permanentDelete, backend.actions.trash, flushBefore, operationFailed, reportResults]);

  const confirmDialog = useCallback(() => {
    if (!dialog) return;
    const current = dialog;
    setDialog(null);
    if (current.action === "properties") return;
    void runTrash(current.item, current.action === "permanent");
  }, [dialog, runTrash]);

  const commitInline = useCallback(async (name: string) => {
    if (!inlineEdit || operationRunning.current) return;
    const current = inlineEdit;
    const action = current.kind === "rename" ? backend.actions.rename
      : current.kind === "directory" ? backend.actions.createDirectory
        : backend.actions.createFile;
    if (!action) return;
    const isFile = current.kind === "file" || (current.kind === "rename" && current.item?.kind === "file");
    if (isFile && extensions.length && !extensions.some((extension) => extension.toLowerCase() === extensionOf(name))) {
      setInlineEdit((currentEdit) => currentEdit ? {
        ...currentEdit,
        initialName: name,
        error: "이 폴더에서 표시되지 않는 확장자입니다.",
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
      setInlineEdit(null);
    } catch (cause) {
      const error = toCoreError(cause);
      setInlineEdit((currentEdit) => currentEdit ? {
        ...currentEdit,
        initialName: name,
        error: error.message,
        attempt: currentEdit.attempt + 1,
      } : null);
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions, extensions, flushBefore, inlineEdit]);

  const copyPath = useCallback(async (item: FolderItem, absolute: boolean) => {
    try {
      const value = absolute ? await backend.actions.absolutePath?.(item.path) : item.path;
      if (value === undefined) return;
      await navigator.clipboard.writeText(value);
      setNotice({ message: absolute ? "경로를 복사했습니다." : "상대 경로를 복사했습니다." });
    } catch (cause) {
      operationFailed(toCoreError(cause).message);
    }
  }, [backend.actions.absolutePath, operationFailed]);

  const executePaste = useCallback(async (destination: string) => {
    if (operationRunning.current || !clipboard || clipboard.root !== backend.identity) return;
    const action = clipboard.mode === "cut" ? backend.actions.move : backend.actions.copy;
    if (!action) return;
    const cached = clipboard;
    operationRunning.current = true;
    try {
      if (cached.mode === "cut" && !(await flushEditors(backend.editorAddress(cached.path)))) {
        operationFailed("편집 중인 내용을 저장하지 못해 이동을 취소했습니다.");
        return;
      }
      const results = await action([cached.path], destination);
      const succeeded = results.filter((result) => !result.error).map((result) => result.path);
      if (cached.mode === "cut" && succeeded.includes(cached.path)) setClipboard(store, null);
      reportResults(results);
    } catch (cause) {
      operationFailed(toCoreError(cause).message);
    } finally {
      operationRunning.current = false;
    }
  }, [backend, clipboard, operationFailed, reportResults, store]);

  const createDuplicate = useCallback(async (item: FolderItem, destination: string) => {
    if (operationRunning.current || !backend.actions.copy) return;
    operationRunning.current = true;
    try {
      reportResults(await backend.actions.copy([item.path], destination));
    } catch (cause) {
      operationFailed(toCoreError(cause).message);
    } finally {
      operationRunning.current = false;
    }
  }, [backend.actions.copy, operationFailed, reportResults]);

  const menuItems = useMemo((): MenuEntry[] => {
    if (!menuState) return [];
    const { item, parent } = menuState;
    const capabilities = backend.capabilities;
    const items: MenuEntry[] = [];
    if (item) items.push({
      id: "open",
      label: item.kind === "dir" && isExpanded(item.path) ? "접기" : item.kind === "dir" ? "펼치기" : "열기",
      onSelect: () => openItem(item),
    });
    if (capabilities.createFile) items.push({ id: "new-file", label: backend.kind === "collection" ? "새 문서" : "새 파일", onSelect: () => void beginEdit("file", null, parent) });
    if (capabilities.createDirectory) items.push({ id: "new-folder", label: "새 폴더", shortcut: "Ctrl+Shift+N", onSelect: () => void beginEdit("directory", null, parent) });
    if (item && (capabilities.rename || capabilities.trash || capabilities.permanentDelete || capabilities.copy || capabilities.move)) items.push({ id: "separator-top", type: "separator" });
    if (item && capabilities.rename) items.push({ id: "rename", label: "이름 바꾸기", shortcut: "F2", onSelect: () => void beginEdit("rename", item, parent) });
    if (item && capabilities.trash) items.push({ id: "trash", label: "휴지통으로 삭제", shortcut: "Delete", danger: true, onSelect: () => setDialog({ action: "trash", item }) });
    if (item && capabilities.permanentDelete) items.push({ id: "permanent", label: "영구 삭제", shortcut: "Shift+Delete", danger: true, onSelect: () => setDialog({ action: "permanent", item }) });
    if (item && (capabilities.move || capabilities.copy)) items.push({ id: "separator-clipboard", type: "separator" });
    if (item && capabilities.move) items.push({ id: "cut", label: "잘라내기", shortcut: "Ctrl+X", onSelect: () => setClipboard(store, { root: backend.identity, path: item.path, mode: "cut" }) });
    if (item && capabilities.copy) items.push({ id: "copy", label: "복사", shortcut: "Ctrl+C", onSelect: () => setClipboard(store, { root: backend.identity, path: item.path, mode: "copy" }) });
    if (clipboard?.root === backend.identity && (capabilities.move || capabilities.copy)) items.push({ id: "paste", label: "붙여넣기", shortcut: "Ctrl+V", onSelect: () => void executePaste(parent) });
    if (item && capabilities.duplicate) items.push({ id: "duplicate", label: "사본 만들기", onSelect: () => void createDuplicate(item, parent) });
    if (item && (capabilities.absolutePath || capabilities.reveal)) items.push({ id: "separator-path", type: "separator" });
    if (item && capabilities.absolutePath) items.push({ id: "absolute-path", label: "경로 복사", onSelect: () => void copyPath(item, true) });
    if (item && capabilities.absolutePath) items.push({ id: "relative-path", label: "상대 경로 복사", onSelect: () => void copyPath(item, false) });
    if (item && capabilities.reveal) items.push({ id: "reveal", label: "파일 관리자에서 보기", onSelect: () => void backend.actions.reveal?.(item.path).catch((cause) => operationFailed(toCoreError(cause).message)) });
    if (items.length) items.push({ id: "refresh-separator", type: "separator" });
    items.push({ id: "refresh", label: "새로 고침", shortcut: "F5", onSelect: () => refreshDirectory(parent) });
    if (item && capabilities.properties) items.push({ id: "properties", label: "속성", onSelect: () => setDialog({ action: "properties", item }) });
    return items;
  }, [backend.actions, backend.capabilities, backend.identity, backend.kind, beginEdit, clipboard, copyPath, createDuplicate, executePaste, isExpanded, menuState, openItem, operationFailed, refreshDirectory, store]);

  const commandKeyDown = useCallback((row: TreeRowModel | null, event: KeyboardEvent<HTMLElement>): boolean => {
    const target = itemFromRow(row);
    const parent = parentFor(row, target, backend.kind === "collection");
    const key = event.key;
    if (key === "F2" && target && backend.capabilities.rename) {
      void beginEdit("rename", target, parent);
      return true;
    }
    if (key === "Delete" && target && !event.shiftKey && backend.capabilities.trash) {
      setDialog({ action: "trash", item: target });
      return true;
    }
    if (key === "Delete" && target && event.shiftKey && backend.capabilities.permanentDelete) {
      setDialog({ action: "permanent", item: target });
      return true;
    }
    if (event.ctrlKey && event.shiftKey && key.toLowerCase() === "n" && backend.capabilities.createDirectory) {
      void beginEdit("directory", null, parent);
      return true;
    }
    if (key === "F5") {
      refreshDirectory(parent);
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "c" && target && backend.capabilities.copy) {
      setClipboard(store, { root: backend.identity, path: target.path, mode: "copy" });
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "x" && target && backend.capabilities.move) {
      setClipboard(store, { root: backend.identity, path: target.path, mode: "cut" });
      return true;
    }
    if (event.ctrlKey && key.toLowerCase() === "v" && clipboard?.root === backend.identity && (backend.capabilities.move || backend.capabilities.copy)) {
      void executePaste(parent);
      return true;
    }
    const opensMenu = (key === "F10" && event.shiftKey) || key === "ContextMenu";
    if (opensMenu) {
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(row, event.currentTarget, { x: rect.left, y: rect.bottom });
      return true;
    }
    return false;
  }, [backend.capabilities, backend.identity, backend.kind, beginEdit, clipboard, executePaste, openMenu, refreshDirectory, store]);

  const inlineRow = useCallback((directory: string, beforePath?: string) => {
    if (!inlineEdit || inlineEdit.directory !== directory) return null;
    if (inlineEdit.path ? inlineEdit.path !== beforePath : beforePath !== undefined) return null;
    return <FolderInlineRow edit={inlineEdit} onCancel={() => setInlineEdit(null)} onCommit={(name) => void commitInline(name)} />;
  }, [commitInline, inlineEdit]);

  const menuElement: ReactNode = menuState ? <Menu
    anchor={menuState.anchor}
    anchorPoint={menuState.point}
    items={menuItems}
    onClose={() => setMenuState(null)}
  /> : null;

  const dialogHost = host();
  const dialogProperties = dialog?.action === "properties" ? backend.actions.properties?.(dialog.item) ?? [] : [];
  const dialogElement: ReactNode = dialog && dialogHost ? <Dialog
    host={dialogHost}
    title={dialog.action === "properties" ? "속성" : dialog.action === "trash" ? "휴지통으로 이동" : "영구 삭제"}
    body={dialog.action === "properties"
      ? <dl className="ks-properties">{dialogProperties.map((property) => <Fragment key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></Fragment>)}</dl>
      : backend.kind === "collection"
        ? <span><strong>{dialog.item.name}</strong> 문서가 서버에서 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</span>
        : dialog.action === "trash"
          ? <span><strong>{dialog.item.name}</strong>을(를) 휴지통으로 이동할까요?</span>
          : <span><strong>{dialog.item.name}</strong>을(를) 영구 삭제하면 되돌릴 수 없습니다.</span>}
    ok={dialog.action === "properties" ? "닫기" : dialog.action === "trash" ? "휴지통으로 이동" : "영구 삭제"}
    danger={dialog.action !== "properties"}
    onCancel={() => setDialog(null)}
    onConfirm={confirmDialog}
  /> : null;

  const noticeNode = notice ? <Notice role="alert" actions={notice.allowPermanent ? [<Button key="permanent" onClick={() => {
    const item = notice.allowPermanent!;
    setNotice(null);
    setDialog({ action: "permanent", item });
  }}>영구 삭제</Button>] : undefined}>{notice.message}</Notice> : null;

  return {
    backend,
    clipboard,
    commandKeyDown,
    inlineEdit,
    inlineRow,
    menuElement,
    onContextMenu: openMenu,
    dialogElement,
    noticeNode,
    isCutPath,
  };
}
