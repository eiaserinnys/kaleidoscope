import type {
  App,
  AppDefinition,
  AppVersion,
  AppWindow,
  Grant,
  ShellSnapshot,
} from "../contract/contract";
import mdEditorJson from "../../../apps/md-editor.json";

export const mdEditorDefinition = mdEditorJson as AppDefinition;
export const mdViewerDefinition: AppDefinition = {
  id: "md-viewer", name: "마크다운 보기", requires: { blocks: 1, modules: { files: 1 } },
  permissions: [{ module: "files", id: "docs", access: "read", label: "읽을 폴더" }],
  state: { current_file: null },
  ui: { type: "split", direction: "row", sizes: [24, 76], children: [
    { type: "file_tree", root: { permission: "docs" }, extensions: ["md"], selected: { state: "current_file" }, on_select: { set_state: "current_file" } },
    { type: "markdown_view", file: { permission: "docs", path: { state: "current_file" } } },
  ] },
};

export interface TestSeed {
  snapshot: ShellSnapshot;
  folder: { root_path: string; root_name: string };
  files: Record<string, string>;
}

export function makeTestSnapshot(options: {
  editorPath?: string | null;
  viewerPath?: string | null;
  grants?: Grant[];
  definitions?: AppDefinition[];
} = {}): ShellSnapshot {
  const definitions = options.definitions ?? [mdEditorDefinition, mdViewerDefinition];
  const apps: App[] = definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    current_version: 1,
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-28T00:00:00Z",
  }));
  const appVersions: AppVersion[] = definitions.map((definition) => ({
    app_id: definition.id,
    version: 1,
    definition,
    created_at: "2026-10-28T00:00:00Z",
  }));
  const windows: AppWindow[] = definitions.map((definition) => ({
    id: definition.id === "md-editor" ? "editor-window" : "viewer-window",
    desktop_id: "desktop-1",
    app_id: definition.id,
    app_version: 1,
    rect: { x: 0, y: 0, width: 640, height: 480 },
    z: definition.id === "md-editor" ? 1 : 2,
    state: {
      ...(definition.id === "md-editor" ? { current_file: options.editorPath ?? null } : {}),
      ...(definition.id === "md-viewer" ? { current_file: options.viewerPath ?? null } : {}),
    },
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-28T00:00:00Z",
  }));

  return {
    shared: {
      apps,
      app_versions: appVersions,
      workspaces: [{
        id: "workspace-1",
        name: "Workspace",
        created_at: "2026-10-28T00:00:00Z",
        updated_at: "2026-10-28T00:00:00Z",
      }],
      desktops: [{
        id: "desktop-1",
        workspace_id: "workspace-1",
        name: "Desktop",
        position: 0,
        created_at: "2026-10-28T00:00:00Z",
        updated_at: "2026-10-28T00:00:00Z",
      }],
      windows,
    },
    device: {
      active_workspace_id: "workspace-1",
      active_desktop_ids: { "workspace-1": "desktop-1" },
      grants: options.grants ?? [],
      pc_access: [],
      local_agent_access: [],
    },
    supported: { blocks: 1, modules: { files: 1 } },
    embedded_available: false,
    link: { state: "unlinked" },
    sharing: [],
    update: { state: "unavailable" },
  };
}

export function makeTestSeed(options: {
  editorPath?: string | null;
  viewerPath?: string | null;
  grants?: Grant[];
  definitions?: AppDefinition[];
  files?: Record<string, string>;
} = {}): TestSeed {
  return {
    snapshot: makeTestSnapshot(options),
    folder: { root_path: "/fake/docs", root_name: "docs" },
    files: options.files ?? { "README.md": "# Hello\n" },
  };
}

export function grantFor(windowId: string, permission: string, rootName = "docs"): Grant {
  return {
    window_id: windowId,
    permission,
    root_path: "/fake/docs",
    root_name: rootName,
    granted_at: "2026-10-28T00:00:00Z",
  };
}
