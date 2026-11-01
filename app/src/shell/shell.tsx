import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  BUILTIN_APP_IDS,
  ChevronDown,
  EmptyState,
  Import,
  IconButton,
  LayoutGrid,
  Menu,
  Notice,
  Plus,
  TextInput,
  UpdateReady,
  flushEditors,
  toCoreError,
  useShellSnapshot,
  type CoreError,
  type CoreReply,
  type CoreRequest,
  type Desktop,
  type MenuEntry,
  type ShellSnapshot,
  type ShellStore,
  type Workspace,
} from "@kaleidoscope/ui";
import { ServerPanel, serverLabel } from "./server-panel";
import { DesktopArea } from "./desktop-area";
import { importAppDefinition } from "./import-definition";
import { makeNewWindowRect } from "./window-geometry";

type OpenMenu =
  | { kind: "items"; anchor: HTMLElement; entries: MenuEntry[] }
  | { kind: "link"; anchor: HTMLElement };

export function Shell({ store }: { store: ShellStore }) {
  const snapshot = useShellSnapshot(store);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [notice, setNotice] = useState<CoreError | null>(null);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renamingDesktopId, setRenamingDesktopId] = useState<string | null>(null);
  const [restartingUpdate, setRestartingUpdate] = useState(false);
  const desktopAreaRef = useRef({ width: 0, height: 0 });
  const activeDesktopTabRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const reportArea = useCallback((area: { width: number; height: number }) => {
    desktopAreaRef.current = area;
  }, []);
  const newWindowRect = useCallback((desktopId: string, current: ShellSnapshot) => {
    const count = current.shared.windows.filter((window) => window.desktop_id === desktopId).length;
    return makeNewWindowRect(desktopAreaRef.current, count);
  }, []);

  const activeWorkspace = snapshot ? selectWorkspace(snapshot) : undefined;
  const activeDesktop = snapshot && activeWorkspace ? selectDesktop(snapshot, activeWorkspace) : undefined;
  useEffect(() => {
    activeDesktopTabRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeDesktop?.id]);

  const runCommand = useCallback(async (request: CoreRequest): Promise<CoreReply | undefined> => {
    try {
      const reply = await store.call(request as never) as CoreReply;
      return reply;
    } catch (reason) {
      setNotice(toCoreError(reason));
      return undefined;
    }
  }, [store]);

  useEffect(() => store.subscribeEvents((event) => {
    if (event.event !== "app.open_requested") return;
    const latest = store.getSnapshot();
    if (!latest?.shared.apps.some((app) => app.id === event.app_id)) return;
    const workspace = event.workspace_id
      ? latest.shared.workspaces.find((item) => item.id === event.workspace_id)
      : selectWorkspace(latest);
    const desktop = workspace ? selectDesktop(latest, workspace) : undefined;
    if (!desktop) return;

    const existing = latest.shared.windows
      .filter((window) => window.desktop_id === desktop.id && window.app_id === event.app_id)
      .reduce<typeof latest.shared.windows[number] | undefined>(
        (top, window) => !top || window.z > top.z ? window : top,
        undefined,
      );
    if (existing) {
      void runCommand({ op: "window.raise", window_id: existing.id });
    } else {
      void runCommand({
        op: "window.open",
        desktop_id: desktop.id,
        app_id: event.app_id,
        rect: newWindowRect(desktop.id, latest),
      });
    }
  }), [newWindowRect, runCommand, store]);

  if (!snapshot) {
    return <main className="app-root"><EmptyState icon={<LayoutGrid size="empty" />} text="코어에 연결할 수 없습니다" /></main>;
  }

  if (!activeWorkspace || !activeDesktop) {
    return <main className="app-root">
      <header className="ks-shell-bar"><Button onClick={(event) => openLinkMenu(event.currentTarget)}>{serverLabel(snapshot)}</Button></header>
      <EmptyState icon={<LayoutGrid size="empty" />} text={snapshot.link.state === "connected" ? "작업 없음" : "서버에 연결하는 중"} />
      {snapshot.link.state === "connected" && <Button onClick={() => void runCommand({ op: "workspace.create", name: "작업 1" })}>작업 만들기</Button>}
      {menu?.kind === "link" && <ServerPanel snapshot={snapshot} anchor={menu.anchor} onClose={closeMenu} call={runCommand} />}
    </main>;
  }

  const workspaces = snapshot.shared.workspaces;
  const desktops = snapshot.shared.desktops
    .filter((desktop) => desktop.workspace_id === activeWorkspace.id)
    .sort((a, b) => a.position - b.position);

  const openAppMenu = (anchor: HTMLElement) => {
    const builtins = new Set<string>(BUILTIN_APP_IDS);
    const sortApps = (apps: ShellSnapshot["shared"]["apps"]) => apps.slice().sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
    const builtinApps = sortApps(snapshot.shared.apps.filter((app) => builtins.has(app.id)));
    const customApps = sortApps(snapshot.shared.apps.filter((app) => !builtins.has(app.id)));
    const appEntries = (apps: typeof builtinApps) => apps.map((app) => ({
        id: `app-${app.id}`,
        label: app.name,
        onSelect: () => void runCommand({
          op: "window.open",
          desktop_id: activeDesktop.id,
          app_id: app.id,
          rect: newWindowRect(activeDesktop.id, snapshot),
        }),
      }));
    const entries: MenuEntry[] = [
      ...(builtinApps.length ? [{ id: "app-group-builtin", type: "heading" as const, label: "기본앱" }, ...appEntries(builtinApps)] : []),
      ...(customApps.length ? [
        ...(builtinApps.length ? [{ id: "app-group-separator", type: "separator" as const }] : []),
        { id: "app-group-custom", type: "heading" as const, label: "커스텀 앱" },
        ...appEntries(customApps),
      ] : []),
    ];
    if (!entries.length) entries.push({ id: "no-apps", label: "앱 없음", disabled: true });
    setMenu({ kind: "items", anchor, entries });
  };

  const openWorkspaceMenu = (anchor: HTMLElement) => {
    const entries: MenuEntry[] = [
      ...workspaces.map((workspace) => ({
        id: `workspace-${workspace.id}`,
        label: workspace.name,
        checked: workspace.id === activeWorkspace.id,
        onSelect: () => void runCommand({ op: "workspace.activate", workspace_id: workspace.id }),
      })),
      { id: "workspace-separator", type: "separator" },
      {
        id: "workspace-create",
        label: "새 워크스페이스",
        onSelect: async () => {
          const reply = await runCommand({ op: "workspace.create", name: nextName("작업", workspaces.map((item) => item.name)) });
          if (reply?.op === "workspace.create") setRenamingWorkspaceId(reply.workspace.id);
        },
      },
      {
        id: "workspace-rename",
        label: "이름 바꾸기",
        onSelect: () => setRenamingWorkspaceId(activeWorkspace.id),
      },
      {
        id: "workspace-delete",
        label: "지우기",
        disabled: workspaces.length <= 1,
        danger: true,
        onSelect: () => void runCommand({ op: "workspace.delete", workspace_id: activeWorkspace.id }),
      },
    ];
    setMenu({ kind: "items", anchor, entries });
  };

  const openDesktopMenu = (anchor: HTMLElement, desktop: Desktop) => {
    const count = desktops.length;
    setMenu({
      kind: "items",
      anchor,
      entries: [
        {
          id: `desktop-rename-${desktop.id}`,
          label: "이름 바꾸기",
          onSelect: () => setRenamingDesktopId(desktop.id),
        },
        { id: `desktop-separator-${desktop.id}`, type: "separator" },
        {
          id: `desktop-delete-${desktop.id}`,
          label: "지우기",
          disabled: count <= 1,
          danger: true,
          onSelect: () => void runCommand({ op: "desktop.delete", desktop_id: desktop.id }),
        },
      ],
    });
  };

  const openLinkMenu = (anchor: HTMLElement) => {
    setMenu({ kind: "link", anchor });
  };

  const restartUpdate = async () => {
    closeMenu();
    setRestartingUpdate(true);
    if (!await flushEditors()) {
      setNotice({ code: "io", message: "저장하지 못한 편집이 있어 다시 시작하지 않았습니다", details: [] });
      setRestartingUpdate(false);
      return;
    }
    const reply = await runCommand({ op: "update.restart" });
    if (reply?.op !== "update.restart") setRestartingUpdate(false);
  };

  const openUpdateMenu = (anchor: HTMLElement) => {
    const update = snapshot.update;
    if (update.state !== "ready") return;
    setMenu({
      kind: "items",
      anchor,
      entries: [
        { id: "update-version", label: `${update.current_version} → ${update.version}`, disabled: true },
        { id: "update-separator", type: "separator" },
        { id: "update-restart", label: "다시 시작해서 업데이트", onSelect: () => void restartUpdate() },
      ],
    });
  };

  const createDesktop = () => {
    const name = nextName("데스크톱", desktops.map((item) => item.name));
    void runCommand({ op: "desktop.create", workspace_id: activeWorkspace.id, name });
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const definition = await file.text();
      const latest = store.getSnapshot();
      const workspace = latest ? selectWorkspace(latest) : undefined;
      const desktop = latest && workspace ? selectDesktop(latest, workspace) : undefined;
      if (!desktop) return;
      await importAppDefinition(store, desktop.id, definition, newWindowRect(desktop.id, latest!));
    } catch (reason) {
      setNotice(toCoreError(reason));
    }
  };


  return (
    <main className="app-root">
      <header className="ks-shell-bar">
        <div className="ks-workspace-control">
          {renamingWorkspaceId === activeWorkspace.id ? (
            <TextInput
              aria-label="워크스페이스 이름"
              onCancel={() => setRenamingWorkspaceId(null)}
              onCommit={(name) => {
                setRenamingWorkspaceId(null);
                void runCommand({ op: "workspace.rename", workspace_id: activeWorkspace.id, name });
              }}
              value={activeWorkspace.name}
            />
          ) : (
            <Button onClick={(event) => openWorkspaceMenu(event.currentTarget)}>
              <span className="ks-workspace-name" title={activeWorkspace.name}>{activeWorkspace.name}</span>
              <ChevronDown className="ks-shell-chevron" size="inline" />
            </Button>
          )}
        </div>

        <nav aria-label="데스크톱" className="ks-desktop-tabs">
          <div className="ks-desktop-tab-scroll">
            {desktops.map((desktop) => (
              <div
                className="ks-desktop-tab-wrap"
                key={desktop.id}
                ref={desktop.id === activeDesktop.id ? activeDesktopTabRef : undefined}
              >
                {renamingDesktopId === desktop.id ? (
                  <TextInput
                    aria-label="데스크톱 이름"
                    onCancel={() => setRenamingDesktopId(null)}
                    onCommit={(name) => {
                      setRenamingDesktopId(null);
                      void runCommand({ op: "desktop.rename", desktop_id: desktop.id, name });
                    }}
                    value={desktop.name}
                  />
                ) : (
                  <button
                    aria-pressed={desktop.id === activeDesktop.id}
                    className={`ks-desktop-tab${desktop.id === activeDesktop.id ? " ks-desktop-tab-active" : ""}`}
                    onClick={() => void runCommand({ op: "desktop.activate", desktop_id: desktop.id })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openDesktopMenu(event.currentTarget, desktop);
                    }}
                    onDoubleClick={() => setRenamingDesktopId(desktop.id)}
                    title={desktop.name}
                    type="button"
                  >
                    <span className="ks-desktop-tab-name">{desktop.name}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          <IconButton aria-label="데스크톱 추가" onClick={createDesktop} title="데스크톱 추가">
            <Plus />
          </IconButton>
        </nav>

        <div className="ks-shell-actions">
          <IconButton aria-label="앱 열기" onClick={(event) => openAppMenu(event.currentTarget)} title="앱 열기">
            <LayoutGrid />
          </IconButton>
          <IconButton aria-label="앱 정의 가져오기" onClick={() => fileInput.current?.click()} title="앱 정의 가져오기">
            <Import />
          </IconButton>
          {snapshot.update.state === "ready" ? (
            <IconButton
              aria-label={restartingUpdate ? "다시 시작하는 중" : `새 판 ${snapshot.update.version} 받음`}
              disabled={restartingUpdate}
              onClick={(event) => openUpdateMenu(event.currentTarget)}
              title={restartingUpdate ? "다시 시작하는 중" : `새 판 ${snapshot.update.version} 받음`}
            >
              <UpdateReady className="ks-link-icon-accent" />
            </IconButton>
          ) : null}
          <Button className="shell-link-button" onClick={(event) => openLinkMenu(event.currentTarget)} aria-label={serverLabel(snapshot)}>
            <span aria-hidden="true" className={`shell-server-dot is-${snapshot.link.state}`} />
            <span className="ks-truncate">{serverLabel(snapshot)}</span>
          </Button>
          <input
            accept=".json,application/json"
            aria-label="앱 정의 파일"
            className="ks-file-input"
            onChange={handleImport}
            ref={fileInput}
            type="file"
          />
        </div>
      </header>

      <DesktopArea
        key={snapshot.link.state === "connected" || snapshot.link.state === "offline" ? snapshot.link.server_url : snapshot.link.state}
        activeDesktopId={activeDesktop.id}
        activeWorkspaceId={activeWorkspace.id}
        onAreaChange={reportArea}
        onCall={runCommand}
        onOpenApps={openAppMenu}
        getNewWindowRect={newWindowRect}
        snapshot={snapshot}
        store={store}
      />

      {menu?.kind === "link" ? <ServerPanel snapshot={snapshot} anchor={menu.anchor} onClose={closeMenu} call={runCommand} /> : menu ? (
        <Menu anchor={menu.anchor} items={menu.entries} onClose={closeMenu} />
      ) : null}
      {notice ? (
        <div className="ks-shell-notice-layer">
          <Notice
            actions={[
              <Button key="close" onClick={() => setNotice(null)}>닫기</Button>,
            ]}
          data-ks-overlay
            role="alert"
          >
            {notice.message}
            {notice.details.length > 0 ? (
              <span className="ks-notice-details">
                {notice.details.map((detail) => <span key={detail}>{detail}</span>)}
              </span>
            ) : null}
          </Notice>
        </div>
      ) : null}
    </main>
  );
}

function selectWorkspace(snapshot: ShellSnapshot): Workspace | undefined {
  return snapshot.shared.workspaces.find((workspace) => workspace.id === snapshot.device.active_workspace_id)
    ?? snapshot.shared.workspaces[0];
}

function selectDesktop(snapshot: ShellSnapshot, workspace: Workspace): Desktop | undefined {
  const desktops = snapshot.shared.desktops
    .filter((desktop) => desktop.workspace_id === workspace.id)
    .sort((a, b) => a.position - b.position);
  const activeId = snapshot.device.active_desktop_ids[workspace.id];
  return desktops.find((desktop) => desktop.id === activeId) ?? desktops[0];
}

function nextName(prefix: string, existing: string[]): string {
  const names = new Set(existing);
  let index = 1;
  while (names.has(`${prefix} ${index}`)) index += 1;
  return `${prefix} ${index}`;
}
