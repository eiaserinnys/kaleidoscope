import { useEffect, useState } from "react";
import type { App, AppDefinition, Block, FileEntry } from "../contract/contract";
import { Menu, type MenuEntry } from "../components/menu";
import { FileCode, FileImage, FileText, File as FileIcon } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { BlockContext } from "./block-context";
import { FileBrowserTree } from "./file-browser-tree";

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

function fileIcon(entry: FileEntry) {
  const extension = fileExtension(entry.path);
  if (["md", "txt"].includes(extension)) return <FileText size="inline" />;
  if (["json", "yaml", "yml", "toml", "js", "ts", "tsx", "rs", "py", "html", "css"].includes(extension)) {
    return <FileCode size="inline" />;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return <FileImage size="inline" />;
  return <FileIcon size="inline" />;
}

export function ExplorerBlock({ block, context }: { block: ExplorerBlockData; context: BlockContext }) {
  const permission = block.root.permission;
  const permissionLabel = context.definition.permissions.find(
    (item) => item.module === "files" && item.id === permission,
  )?.label ?? permission;
  const rootPath = context.snapshot.device.grants.find(
    (grant) => grant.window_id === context.window.id && grant.permission === permission,
  )?.root_path ?? null;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; entries: MenuEntry[] } | null>(null);

  useEffect(() => {
    setSelectedPath(null);
    setActionError(null);
    setMenu(null);
  }, [rootPath]);

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

  const handleContextMenu = (anchor: HTMLElement, path: string) => openMenu(anchor, path);

  return (
    <>
      <FileBrowserTree
        actionError={actionError}
        canCreate={false}
        context={context}
        extensions={[]}
        fileIcon={fileIcon}
        onActionError={setActionError}
        onFileContextMenu={handleContextMenu}
        onFileDoubleClick={activateFile}
        onFileEnter={activateFile}
        onSelect={setSelectedPath}
        permission={permission}
        permissionLabel={permissionLabel}
        selectedPath={selectedPath}
      />
      {menu ? <Menu anchor={menu.anchor} items={menu.entries} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
