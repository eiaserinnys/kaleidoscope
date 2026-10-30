import { useEffect, useRef, useState } from "react";
import type { App, AppDefinition, Block, ExplorerView } from "../contract/contract";
import { Menu, type MenuEntry } from "../components/menu";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { FileBrowserTree } from "./file-browser-tree";
import { SplitPanes } from "./split";
import { ExplorerContent } from "./explorer-content";

type ExplorerBlockData = Extract<Block, { type: "explorer" }>;

interface OpenableApp {
  id: string;
  name: string;
}

export function findAppsForExtension(snapshot: BlockContext["snapshot"], extension: string): OpenableApp[] {
  const normalized = extension.toLowerCase();
  return snapshot.shared.apps
    .flatMap((app: App) => {
      const definition = currentDefinition(snapshot.shared.app_versions, app);
      return definition?.opens?.extensions.some((candidate) => candidate.toLowerCase() === normalized)
        ? [{ id: app.id, name: definition.name }]
        : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko") || left.id.localeCompare(right.id));
}

function currentDefinition(versions: BlockContext["snapshot"]["shared"]["app_versions"], app: App): AppDefinition | undefined {
  return versions.find((version) => version.app_id === app.id && version.version === app.current_version)?.definition;
}

function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function validFolderPath(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (
    !value.startsWith("/") && !value.endsWith("/") && !value.includes("\\") && !value.includes(":") && !value.includes("\0")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  ));
}

export function ExplorerBlock({ block, context }: { block: ExplorerBlockData; context: BlockContext }) {
  const permission = block.root.permission;
  const permissionLabel = context.definition.permissions.find(
    (item) => item.module === "files" && item.id === permission,
  )?.label ?? permission;
  const grant = context.snapshot.device.grants.find(
    (item) => item.window_id === context.window.id && item.permission === permission,
  ) ?? null;
  const rootPath = grant?.root_path ?? null;
  const [localFolder, setLocalFolder] = useState("");
  const [localView, setLocalView] = useState<ExplorerView>("icons");
  const [actionError, setActionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; entries: MenuEntry[] } | null>(null);
  const previousRoot = useRef(rootPath);
  const folderValue = block.folder ? context.window.state[block.folder.state] : undefined;
  const folder = block.folder && block.on_folder
    ? validFolderPath(folderValue) ? folderValue : ""
    : localFolder;
  const viewValue = block.view ? context.window.state[block.view.state] : undefined;
  const view: ExplorerView = block.view && block.on_view
    ? viewValue === "details" ? "details" : "icons"
    : localView;

  const navigate = async (path: string) => {
    setActionError(null);
    setLocalFolder(path);
    setMenu(null);
    if (!block.on_folder) return;
    try {
      await context.store.call({
        op: "window.set_state",
        window_id: context.window.id,
        state: { ...context.window.state, [block.on_folder.set_state]: path },
      });
    } catch (error) {
      setActionError(toCoreError(error).message);
    }
  };

  const changeView = async (next: ExplorerView) => {
    setLocalView(next);
    if (!block.on_view) return;
    try {
      await context.store.call({
        op: "window.set_state",
        window_id: context.window.id,
        state: { ...context.window.state, [block.on_view.set_state]: next },
      });
    } catch (error) {
      setActionError(toCoreError(error).message);
    }
  };

  useEffect(() => {
    const previous = previousRoot.current;
    previousRoot.current = rootPath;
    setActionError(null);
    setMenu(null);
    if (previous !== null && rootPath !== null && previous !== rootPath) void navigate("");
  }, [rootPath]);

  useEffect(() => {
    if (block.folder && block.on_folder && folderValue !== undefined && folderValue !== folder) void navigate("");
  }, [block.folder, block.on_folder, folder, folderValue]);

  const appsFor = (path: string) => findAppsForExtension(context.snapshot, fileExtension(path));
  const openWith = async (path: string, app: OpenableApp) => {
    setActionError(null);
    try {
      await context.store.call({
        op: "files.open",
        window_id: context.window.id,
        permission,
        path,
        app_id: app.id,
        rect: context.newWindowRect?.(),
      });
    } catch (error) {
      setActionError(toCoreError(error).message);
    }
  };
  const openMenu = (anchor: HTMLElement, path: string, apps = appsFor(path)) => {
    const entries = apps.length > 0
      ? apps.map((app) => ({ id: `open-${app.id}`, label: app.name, onSelect: () => void openWith(path, app) }))
      : [{ id: "open-none", label: "열 수 있는 앱이 없습니다", disabled: true }];
    setMenu({ anchor, entries });
  };
  const activateFile = (anchor: HTMLElement, path: string) => {
    const apps = appsFor(path);
    if (apps.length === 1) void openWith(path, apps[0]);
    else openMenu(anchor, path, apps);
  };
  const contextFile = (anchor: HTMLElement, path: string) => openMenu(anchor, path);

  const fileTree = <FileBrowserTree
    actionError={actionError}
    canCreate={false}
    context={context}
    extensions={[]}
    mode={rootPath === null ? "files" : "folders"}
    onActionError={setActionError}
    onSelect={navigate}
    permission={permission}
    permissionLabel={permissionLabel}
    selectedPath={rootPath === null ? null : folder}
  />;

  if (rootPath === null) return fileTree;

  return <>
    <div className="ks-explorer">
      <SplitPanes direction="row" sizes={[28, 72]}>
        {[
          fileTree,
          <ExplorerContent
            context={context}
            folder={folder}
            onActivateFile={activateFile}
            onContextFile={contextFile}
            onNavigate={navigate}
            onViewChange={changeView}
            permission={permission}
            rootName={grant?.root_name ?? ""}
            view={view}
          />,
        ]}
      </SplitPanes>
      {actionError ? <span className="ks-inline-error" role="alert">{actionError}</span> : null}
    </div>
    {menu ? <Menu anchor={menu.anchor} items={menu.entries} onClose={() => setMenu(null)} /> : null}
  </>;
}
