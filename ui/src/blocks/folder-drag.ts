import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { TreeRowModel } from "../components/tree/tree-model";
import type { FolderItem } from "./folder-backend";

const MIME = "application/x-kaleidoscope-folder";
type Payload = { root: string; paths: string[] };
let activeDrag: Payload | null = null;
let activeOwner: object | null = null;

function item(row: TreeRowModel | null): FolderItem | undefined {
  return (row?.node.data as { entry?: FolderItem } | undefined)?.entry;
}

export function useFolderDrag({ enabled, root, selection, setSelection, pathsFor, transfer, expand, focusDestination }: {
  enabled: boolean;
  root: string;
  selection: string[];
  setSelection: (ids: string[]) => void;
  pathsFor: (row: TreeRowModel | null) => string[];
  transfer: (paths: string[], destination: string, mode: "copy" | "cut") => Promise<void>;
  expand: (path: string, open: boolean) => void;
  focusDestination: (path: string) => void;
}) {
  const [target, setTarget] = useState<{ id: string; hoveredId: string | null; valid: boolean } | null>(null);
  const owner = useRef({});
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearHover = useCallback(() => {
    if (hover.current) clearTimeout(hover.current.timer);
    hover.current = null;
  }, []);
  const end = useCallback(() => { clearHover(); activeDrag = null; activeOwner = null; setTarget(null); }, [clearHover]);
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && activeDrag && activeOwner === owner.current) { setSelection([]); end(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); clearHover(); };
  }, [clearHover, end, setSelection]);
  const start = useCallback((row: TreeRowModel, event: DragEvent<HTMLElement>) => {
    if (!item(row)) { event.preventDefault(); return; }
    const paths = pathsFor(row);
    if (!selection.includes(row.id)) setSelection([row.id]);
    activeDrag = { root, paths };
    activeOwner = owner.current;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(MIME, JSON.stringify(activeDrag));
  }, [pathsFor, root, selection, setSelection]);
  const destination = (row: TreeRowModel | null) => {
    const entry = item(row);
    if (!entry) return (row?.node.data as { directoryPath?: string } | undefined)?.directoryPath ?? "";
    if (entry.kind === "dir") return entry.path;
    const slash = entry.path.lastIndexOf("/");
    return slash < 0 ? "" : entry.path.slice(0, slash);
  };
  const accepts = (payload: Payload, path: string, row: TreeRowModel | null) => payload.root === root
    && !payload.paths.some((source) => item(row)?.path === source || path === source || path.startsWith(`${source}/`));
  const movable = (paths: string[], path: string) => paths.filter((source) => {
    const slash = source.lastIndexOf("/");
    return (slash < 0 ? "" : source.slice(0, slash)) !== path;
  });
  const over = useCallback((row: TreeRowModel | null, event: DragEvent<HTMLElement>) => {
    if (!activeDrag) return;
    const path = destination(row);
    const valid = accepts(activeDrag, path, row);
    const noChange = valid && !event.ctrlKey && movable(activeDrag.paths, path).length === 0;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = valid && !noChange ? event.ctrlKey ? "copy" : "move" : "none";
    const id = valid ? path : row?.id ?? "";
    const hoveredId = row?.id ?? null;
    setTarget((current) => noChange ? null : current?.id === id && current.hoveredId === hoveredId && current.valid === valid ? current : { id, hoveredId, valid });
    const entry = item(row);
    if (valid && entry?.kind === "dir" && !row?.expanded) {
      if (hover.current?.id !== id) {
        clearHover();
        hover.current = { id, timer: setTimeout(() => { hover.current = null; expand(entry.path, true); }, 600) };
      }
    } else clearHover();
  }, [clearHover, expand, root]);
  const drop = useCallback((row: TreeRowModel | null, event: DragEvent<HTMLElement>) => {
    if (!activeDrag) return;
    event.preventDefault();
    event.stopPropagation();
    let payload: Payload;
    try { payload = JSON.parse(event.dataTransfer.getData(MIME)) as Payload; } catch { end(); return; }
    const path = destination(row);
    const paths = event.ctrlKey ? payload.paths : movable(payload.paths, path);
    if (accepts(payload, path, row) && paths.length) {
      void transfer(paths, path, event.ctrlKey ? "copy" : "cut").finally(() => focusDestination(path));
    }
    end();
  }, [end, focusDestination, root, transfer]);
  const leave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    clearHover();
    setTarget(null);
  }, [clearHover]);
  return { enabled, targetId: target?.id ?? null, hoveredId: target?.hoveredId ?? null, valid: target?.valid ?? false, onStart: start, onOver: over, onDrop: drop, onEnd: end, onLeave: leave };
}
