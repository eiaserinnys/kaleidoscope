import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Column, ExplorerView, FileEntry, SortSpec } from "../contract/contract";
import { EmptyState, IconButton, StatusText } from "../components/primitives";
import { ArrowUp, ChevronRight, Download, File, FileCode, FileImage, FileText, Folder, FolderOpen, HardDrive, Image, LayoutGrid, List, Monitor, Music, Video } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import { TableView, type Row } from "./data-table";
import { useRoving } from "./data-view-common";
import type { BlockContext } from "./block-context";

type ExplorerRow = Row & { kind: "dir" | "file" };
const columns: Column[] = [
  { field: "name", label: "이름", width: "fill" },
  { field: "modified", label: "수정한 날짜", format: "date", width: "medium" },
  { field: "type", label: "종류", width: "medium" },
  { field: "size", label: "크기", format: "number", width: "narrow" },
];

function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function fileIcon(entry: FileEntry, size: "inline" | "tile" = "inline") {
  const extension = extensionOf(entry.path);
  if (["md", "txt"].includes(extension)) return <FileText size={size} />;
  if (["json", "yaml", "yml", "toml", "js", "ts", "tsx", "rs", "py", "html", "css"].includes(extension)) return <FileCode size={size} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return <FileImage size={size} />;
  return <File size={size} />;
}

function typeLabel(entry: FileEntry) {
  if (entry.root_kind === "known") return "폴더";
  if (entry.root_kind === "volume") return "드라이브";
  if (entry.kind === "dir") return "폴더";
  const extension = extensionOf(entry.path);
  return extension ? `${extension.toUpperCase()} 파일` : "파일";
}

function directoryIcon(entry: FileEntry, size: "inline" | "tile" = "inline") {
  if (entry.root_kind === "volume") return <HardDrive size={size} />;
  if (entry.root_kind !== "known") return <Folder size={size} />;
  switch (entry.path) {
    case "desktop": return <Monitor size={size} />;
    case "documents": return <FileText size={size} />;
    case "downloads": return <Download size={size} />;
    case "pictures": return <Image size={size} />;
    case "music": return <Music size={size} />;
    case "videos": return <Video size={size} />;
    default: return <Folder size={size} />;
  }
}

function formatSize(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

function toRow(entry: FileEntry): ExplorerRow {
  return {
    key: entry.path,
    name: entry.name,
    modified: entry.modified,
    type: typeLabel(entry),
    size: entry.size,
    kind: entry.kind,
  };
}

function compareRows(a: Row, b: Row, sort: SortSpec) {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  const left = a[sort.field];
  const right = b[sort.field];
  const compare = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
  return sort.desc ? -compare : compare;
}

export function ExplorerContent({
  context,
  permission,
  permissionLabel,
  rootName,
  rootPath,
  scope,
  folder,
  view,
  actionError,
  onNavigate,
  onViewChange,
  onActivateFile,
  onContextFile,
}: {
  context: BlockContext;
  permission: string;
  permissionLabel: string;
  rootName: string;
  rootPath: string;
  scope: "folder" | "pc";
  folder: string;
  view: ExplorerView;
  actionError: string | null;
  onNavigate: (folder: string) => void;
  onViewChange: (view: ExplorerView) => void;
  onActivateFile: (anchor: HTMLElement, path: string) => void;
  onContextFile: (anchor: HTMLElement, path: string) => void;
}) {
  const { store, window } = context;
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [pcRoots, setPcRoots] = useState<FileEntry[]>([]);
  const [pcRootsError, setPcRootsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const requestId = useRef(0);
  const pcRootsLoaded = useRef(false);
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const rows = useMemo(() => (entries ?? []).map(toRow), [entries]);
  const grid = useRef<HTMLDivElement>(null);
  const breadcrumbRef = useRef<HTMLElement>(null);
  const ellipsisRef = useRef<HTMLSpanElement>(null);
  const [gridColumns, setGridColumns] = useState(1);
  const roving = useRoving(rows, selected, grid);

  const readFolder = async (directory: string, showLoading = false) => {
    const request = ++requestId.current;
    const requestedRoot = rootPath;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const reply = await store.call({ op: "files.list", window_id: window.id, permission, dir: directory });
      if (reply.op === "files.list" && request === requestId.current && folderRef.current === directory && rootPathRef.current === requestedRoot) {
        setEntries(reply.entries);
        if (scope === "pc" && directory === "") {
          pcRootsLoaded.current = true;
          setPcRoots(reply.entries);
          setPcRootsError(null);
        }
      }
    } catch (cause) {
      if (request !== requestId.current || folderRef.current !== directory || rootPathRef.current !== requestedRoot) return;
      const coreError = toCoreError(cause);
      if ((coreError.code === "not_found" || coreError.code === "invalid_request") && directory !== "") {
        onNavigateRef.current("");
      } else {
        setError(coreError.message);
      }
    } finally {
      if (request === requestId.current && folderRef.current === directory && rootPathRef.current === requestedRoot) setLoading(false);
    }
  };
  const readFolderRef = useRef(readFolder);
  readFolderRef.current = readFolder;

  useEffect(() => {
    if (scope !== "pc" || !folderRef.current || pcRootsLoaded.current) return;
    const requestedRoot = rootPath;
    void store.call({ op: "files.list", window_id: window.id, permission, dir: "" }).then((reply) => {
      if (reply.op === "files.list" && rootPathRef.current === requestedRoot) {
        pcRootsLoaded.current = true;
        setPcRoots(reply.entries);
        setPcRootsError(null);
      }
    }).catch((cause) => {
      if (rootPathRef.current === requestedRoot) setPcRootsError(toCoreError(cause).message);
    });
  }, [folder, permission, rootPath, scope, store, window.id]);

  useEffect(() => {
    setSelected(null);
    setEntries(null);
    setError(null);
    void readFolder(folder, true);
  }, [folder, permission, rootPath, store, window.id]);

  useEffect(() => {
    const refresh = () => void readFolderRef.current(folderRef.current);
    globalThis.window.addEventListener("focus", refresh);
    return () => globalThis.window.removeEventListener("focus", refresh);
  }, [permission, store, window.id]);

  useEffect(() => {
    const element = grid.current;
    if (view !== "icons" || !element) return;
    const resize = () => {
      const style = getComputedStyle(element);
      const unit = Number.parseFloat(style.getPropertyValue("--ks-space-6")) || 32;
      const gap = Number.parseFloat(style.getPropertyValue("--ks-space-2")) || 8;
      const minimum = unit * 3;
      const contentWidth = element.clientWidth
        - (Number.parseFloat(style.paddingInlineStart) || 0)
        - (Number.parseFloat(style.paddingInlineEnd) || 0);
      setGridColumns(Math.max(1, Math.floor((contentWidth + gap) / (minimum + gap))));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, entries]);

  const segments = folder ? folder.split("/") : [];
  const breadcrumb = [{ name: scope === "pc" ? permissionLabel : rootName, path: "" }, ...segments.map((name, index) => ({
    name: scope === "pc" && index === 0 ? pcRoots.find((entry) => entry.path === name)?.name ?? name : name,
    path: segments.slice(0, index + 1).join("/"),
  }))];
  useLayoutEffect(() => {
    const nav = breadcrumbRef.current;
    const ellipsis = ellipsisRef.current;
    if (!nav || !ellipsis) return;
    const crumbs = Array.from(nav.querySelectorAll<HTMLElement>(".ks-explorer-crumb"));
    const update = () => {
      for (const crumb of crumbs) {
        const button = crumb.querySelector<HTMLButtonElement>("button")!;
        const style = getComputedStyle(button);
        ellipsis.style.font = style.font;
        const textWidth = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const enough = button.scrollWidth <= button.clientWidth
          ? textWidth > 0
          : textWidth >= ellipsis.getBoundingClientRect().width;
        crumb.style.visibility = enough ? "" : "hidden";
      }
    };
    update();
    const observer = new ResizeObserver(update);
    crumbs.forEach((crumb) => {
      observer.observe(crumb);
      observer.observe(crumb.querySelector("button")!);
    });
    return () => observer.disconnect();
  }, [folder, permissionLabel, rootName, scope]);
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
  const sortedEntries = entries ?? [];
  const onChoose = (entry: FileEntry) => setSelected(entry.path);
  const activate = (anchor: HTMLElement, entry: FileEntry) => {
    setSelected(entry.path);
    if (entry.kind === "dir") onNavigate(entry.path);
    else onActivateFile(anchor, entry.path);
  };
  const visible = entries !== null;
  return <div className="ks-explorer-content">
    <div className="ks-file-tree-header ks-explorer-toolbar">
      <IconButton aria-label="위 폴더" disabled={!folder} onClick={() => onNavigate(parent)}><ArrowUp /></IconButton>
      <nav aria-label="경로" className="ks-explorer-breadcrumb" ref={breadcrumbRef}>
        {breadcrumb.slice(0, -1).reduce<ReactNode>((ancestors, crumb) =>
          <span className="ks-explorer-ancestors" key={crumb.path}>
            {ancestors}
            <span className="ks-explorer-crumb">
              <button className="ks-explorer-crumb-button" onClick={() => onNavigate(crumb.path)} title={crumb.name} type="button">{crumb.name}</button>
              <ChevronRight className="ks-explorer-chevron" size="inline" />
            </span>
          </span>, null)}
        <span aria-current="page" className="ks-explorer-crumb-current" title={breadcrumb.at(-1)!.name}>{breadcrumb.at(-1)!.name}</span>
        <span aria-hidden="true" className="ks-explorer-crumb-measure" ref={ellipsisRef}>…</span>
      </nav>
      <div aria-label="보기" className="ks-explorer-view-buttons" role="group">
        <IconButton aria-label="아이콘 보기" pressed={view === "icons"} onClick={() => onViewChange("icons")}><LayoutGrid /></IconButton>
        <IconButton aria-label="자세히 보기" pressed={view === "details"} onClick={() => onViewChange("details")}><List /></IconButton>
      </div>
    </div>
    {actionError ? <div className="ks-inline-error" role="alert">{actionError}</div> : null}
    {pcRootsError ? <div className="ks-inline-error" role="alert">{pcRootsError}</div> : null}
    {error ? <div className="ks-inline-error" role="alert">{error}</div>
      : !visible && loading ? <StatusText>불러오는 중</StatusText>
      : visible && sortedEntries.length === 0 ? <div className="ks-explorer-empty"><EmptyState icon={<FolderOpen size="empty" />} text="빈 폴더" /></div>
          : view === "icons" ? <div aria-label="폴더 내용" className="ks-data-view ks-explorer-icons" ref={grid} role="listbox">
            {sortedEntries.map((entry, index) => {
              const active = selected === entry.path;
              return <button aria-label={entry.name} aria-posinset={index + 1} aria-selected={active} aria-setsize={sortedEntries.length} className={`ks-explorer-icon${active ? " is-selected" : ""}`} data-file-path={entry.kind === "file" ? entry.path : undefined} data-folder-path={entry.kind === "dir" ? entry.path : undefined} data-focus-index={index} key={entry.path} onClick={() => onChoose(entry)} onContextMenu={(event) => {
                if (entry.kind === "file") { event.preventDefault(); setSelected(entry.path); onContextFile(event.currentTarget, entry.path); }
              }} onDoubleClick={(event) => activate(event.currentTarget, entry)} onFocus={() => roving.setFocus(index)} onKeyDown={(event) => roving.keyDown(event, index, () => activate(event.currentTarget, entry), gridColumns)} role="option" tabIndex={roving.focus === index ? 0 : -1} title={entry.name} type="button">
                {entry.kind === "dir" ? directoryIcon(entry, "tile") : fileIcon(entry, "tile")}
                <span className="ks-explorer-icon-name">{entry.name}</span>
              </button>;
            })}
          </div>
          : <TableView ariaLabel="폴더 내용" columns={columns} compareRows={compareRows} onActivate={(row, anchor) => {
            const entry = sortedEntries.find((item) => item.path === row.key);
            if (entry) activate(anchor, entry);
          }} onChoose={(row) => {
            const entry = sortedEntries.find((item) => item.path === row.key);
            if (entry) onChoose(entry);
          }} onContextMenu={(row, anchor) => {
            const entry = sortedEntries.find((item) => item.path === row.key);
            if (entry?.kind === "file") { setSelected(entry.path); onContextFile(anchor, entry.path); }
          }} renderCell={(row, column) => {
            const entry = sortedEntries.find((item) => item.path === row.key);
            if (!entry) return undefined;
            if (column.field === "name") return <span className="ks-explorer-detail-name">{entry.kind === "dir" ? directoryIcon(entry) : fileIcon(entry)}<span>{entry.name}</span></span>;
            if (column.field === "size") return entry.kind === "dir" ? "" : formatSize(entry.size);
            return undefined;
          }} rowProps={(row): Record<string, string> => row.kind === "dir" ? { "data-folder-path": row.key } : { "data-file-path": row.key }} rows={rows} selected={selected} />}
  </div>;
}
