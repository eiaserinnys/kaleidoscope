import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  ContextMenuHost,
  SHELL_DESKTOP_DELETE_UNSAVED,
  SHELL_WINDOW_CLOSE_UNSAVED,
  SHELL_WORKSPACE_DELETE_UNSAVED,
  SHELL_UPDATE_RESTART_UNSAVED,
  ChevronDown,
  EmptyState,
  Import,
  IconButton,
  LayoutGrid,
  Menu,
  Notice,
  Plus,
  Settings,
  TextInput,
  UpdateReady,
  flushEditors,
  flushSandboxes,
  flushWindowEditors,
  toCoreError,
  useShellSelector,
  useWindowControlHost,
  type CoreError,
  type CoreReply,
  type CoreRequest,
  type Desktop,
  type MenuEntry,
  type ShellSnapshot,
  type ShellStore,
  type Workspace,
  type Rect,
} from "@kaleidoscope/ui";
import { AppLauncher, type LauncherSpacing } from "./app-launcher";
import { serverLabel } from "./server-label";
import { ShellSettings } from "./shell-settings";
import { MessageAppPrompt } from "./message-app-prompt";
import { BrandMark } from "./brand-mark";
import { DesktopArea } from "./desktop-area";
import { SystemWindow, type SystemWindowState } from "./system-window";
import { importAppDefinition } from "./import-definition";
import { makeNewWindowRect } from "./window-geometry";

type OpenMenu = { kind: "items"; anchor: HTMLElement; entries: MenuEntry[] };

export function Shell({ store }: { store: ShellStore }) {
  useWindowControlHost(store);
  const snapshot = useShellSelector(store, (value) => value, sameShellChrome);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [launcher, setLauncher] = useState<{ anchor: HTMLElement; spacing: LauncherSpacing } | null>(null);
  const closeLauncher = useCallback(() => setLauncher(null), []);
  const [settings, setSettings] = useState<{ anchor: HTMLElement; origin: "gear" | "server"; entry: { kind: "gear" | "server"; sequence: number }; minimized: boolean; maximized: boolean; z: number } | null>(null);
  const settingsRect = useRef<Rect | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
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
  const maxWindowZ = useShellSelector(store, (value) => Math.max(0, ...(value?.shared.windows.filter((item) => item.desktop_id === activeDesktop?.id).map((item) => item.z) ?? [])));
  const maxZNow = useCallback(() => {
    const current = store.getSnapshot();
    const workspace = current ? selectWorkspace(current) : undefined;
    const desktop = current && workspace ? selectDesktop(current, workspace) : undefined;
    return Math.max(0, ...(current?.shared.windows.filter((item) => item.desktop_id === desktop?.id).map((item) => item.z) ?? []));
  }, [store]);
  useEffect(() => {
    setSettings((current) => current ? { ...current, z: maxZNow() + 1 } : null);
  }, [activeDesktop?.id, maxZNow]);

  const runCommand = useCallback(async (request: CoreRequest): Promise<CoreReply | undefined> => {
    try {
      let windowIds: string[] | null = null;
      let unsaved: CoreError | null = null;
      if (request.op === "window.close") {
        windowIds = [request.window_id];
        unsaved = SHELL_WINDOW_CLOSE_UNSAVED();
      } else if (request.op === "desktop.delete" || request.op === "workspace.delete") {
        const current = store.getSnapshot();
        const desktops = request.op === "desktop.delete"
          ? [request.desktop_id]
          : (current?.shared.desktops ?? []).filter((desktop) => desktop.workspace_id === request.workspace_id).map((desktop) => desktop.id);
        windowIds = (current?.shared.windows ?? []).filter((window) => desktops.includes(window.desktop_id)).map((window) => window.id);
        unsaved = request.op === "desktop.delete" ? SHELL_DESKTOP_DELETE_UNSAVED() : SHELL_WORKSPACE_DELETE_UNSAVED();
      }
      if (windowIds && unsaved) {
        const [editorsSaved, ...sandboxesSaved] = await Promise.all([flushWindowEditors(windowIds), ...windowIds.map((id) => flushSandboxes(id))]);
        if (!editorsSaved || !sandboxesSaved.every(Boolean)) {
          setNotice(unsaved);
          return undefined;
        }
      }
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

  const openSettings = (anchor: HTMLElement, kind: "gear" | "server") => {
    closeMenu(); closeLauncher();
    const z = maxZNow() + 1;
    setSettings((current) => current
      ? { ...current, minimized: false, z, entry: { kind, sequence: current.entry.sequence + 1 } }
      : { anchor, origin: kind, entry: { kind, sequence: 0 }, minimized: false, maximized: false, z });
  };
  const closeSettings = () => {
    if (settings) {
      const target = settings.anchor.isConnected ? settings.anchor : document.querySelector<HTMLElement>(settings.origin === "server" ? ".ks-shell-bar .shell-link-button" : '.ks-shell-bar button[aria-label="설정"]');
      target?.focus();
    }
    setSettings(null);
  };
  const raiseSettings = () => setSettings((current) => current ? { ...current, minimized: false, z: maxZNow() + 1 } : null);
  const systemState: SystemWindowState | undefined = settings ? {
    minimized: settings.minimized, maximized: settings.maximized, z: settings.z,
    isTop: !settings.minimized && settings.z > maxWindowZ,
    raise: raiseSettings,
    minimize: () => setSettings((current) => current ? { ...current, minimized: true } : null),
    maximize: () => setSettings((current) => current ? { ...current, maximized: true } : null),
    restore: () => setSettings((current) => current ? { ...current, maximized: false } : null),
    close: closeSettings,
  } : undefined;

  const serverButton = snapshot ? (
    <Button className="ks-button-quiet shell-link-button" onClick={(event) => openSettings(event.currentTarget, "server")} aria-label={serverLabel(snapshot)}>
      <span aria-hidden="true" className={`shell-server-dot is-${snapshot.link.state}`} />
      <span className="ks-truncate">{serverLabel(snapshot)}</span>
    </Button>
  ) : null;
  const settingsButton = <IconButton aria-label="설정" title="설정" onClick={(event) => openSettings(event.currentTarget, "gear")}><Settings /></IconButton>;
  const canvasKey = snapshot ? (snapshot.link.state === "connected" || snapshot.link.state === "offline" ? snapshot.link.server_url : snapshot.link.state) : "";
  const systemWindow = snapshot && settings && systemState ? {
    state: systemState,
    render: (area: { width: number; height: number }) => <SystemWindow area={area} state={systemState} title="설정" icon={<Settings className="ks-app-icon" size="chrome" />} lastRect={settingsRect} testId="system-window-settings">
      <ShellSettings snapshot={snapshot} entry={settings.entry} call={runCommand} store={store} />
    </SystemWindow>,
  } : undefined;

  if (!snapshot) {
    return <main className="app-root"><EmptyState icon={<LayoutGrid size="empty" />} text="코어에 연결할 수 없습니다" /></main>;
  }

  if (!activeWorkspace || !activeDesktop) {
    return <main className="app-root" ref={setHost}>
      <ContextMenuHost onError={setNotice} />
      <header className="ks-shell-bar"><BrandMark /><div className="ks-shell-actions">{serverButton}{settingsButton}</div></header>
      <DesktopArea canvasKey={canvasKey} systemWindow={systemWindow} launcherOpen={false} onAreaChange={reportArea} onCall={runCommand} onOpenApps={() => {}} store={store}
        emptyState={<EmptyState icon={<LayoutGrid size="empty" />} text={snapshot.link.state === "connected" ? "작업 없음" : "서버에 연결하는 중"}
          action={snapshot.link.state === "connected" ? <Button onClick={() => void runCommand({ op: "workspace.create", name: "작업 1" })}>작업 만들기</Button> : undefined} />} />
      {host ? <MessageAppPrompt store={store} host={host} /> : null}
    </main>;
  }

  const workspaces = snapshot.shared.workspaces;
  const desktops = snapshot.shared.desktops
    .filter((desktop) => desktop.workspace_id === activeWorkspace.id)
    .sort((a, b) => a.position - b.position);

  const openAppMenu = (anchor: HTMLElement, spacing: LauncherSpacing) => {
    closeMenu();
    setLauncher((current) => current?.anchor === anchor ? null : { anchor, spacing });
  };
  const selectApp = (appId: string) => {
    const latest = store.getSnapshot();
    const workspace = latest ? selectWorkspace(latest) : undefined;
    const desktop = latest && workspace ? selectDesktop(latest, workspace) : undefined;
    if (!latest || !desktop) return;
    void runCommand({ op: "window.open", desktop_id: desktop.id, app_id: appId, rect: newWindowRect(desktop.id, latest) });
  };

  const openWorkspaceMenu = (anchor: HTMLElement) => {
    closeLauncher();
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
        label: "새 작업",
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
    closeLauncher();
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


  const restartUpdate = async () => {
    closeMenu();
    setRestartingUpdate(true);
    if (!await flushEditors() || !await flushSandboxes()) {
      setNotice(SHELL_UPDATE_RESTART_UNSAVED());
      setRestartingUpdate(false);
      return;
    }
    const reply = await runCommand({ op: "update.restart" });
    if (reply?.op !== "update.restart") setRestartingUpdate(false);
  };

  const openUpdateMenu = (anchor: HTMLElement) => {
    closeLauncher();
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
    <main className="app-root" ref={setHost}>
      <ContextMenuHost onError={setNotice} />
      <header className="ks-shell-bar">
        <BrandMark />
        <div className="ks-workspace-control">
          {renamingWorkspaceId === activeWorkspace.id ? (
            <TextInput
              aria-label="작업 이름"
              onCancel={() => setRenamingWorkspaceId(null)}
              onCommit={(name) => {
                setRenamingWorkspaceId(null);
                void runCommand({ op: "workspace.rename", workspace_id: activeWorkspace.id, name });
              }}
              value={activeWorkspace.name}
            />
          ) : (
            <Button className="ks-button-quiet" onClick={(event) => openWorkspaceMenu(event.currentTarget)}>
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
                    onClick={() => { void runCommand({ op: "desktop.activate", desktop_id: desktop.id }); }}
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
          <IconButton aria-label="앱 열기" aria-haspopup="dialog" aria-expanded={launcher !== null} onClick={(event) => openAppMenu(event.currentTarget, "none")} title="앱 열기">
            <LayoutGrid />
          </IconButton>
          <IconButton aria-label="앱 정의 가져오기" onClick={() => { fileInput.current?.click(); }} title="앱 정의 가져오기">
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
          {serverButton}
          {settingsButton}
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
        canvasKey={canvasKey}
        systemWindow={systemWindow}
        activeDesktopId={activeDesktop.id}
        activeWorkspaceId={activeWorkspace.id}
        launcherOpen={launcher !== null}
        onAreaChange={reportArea}
        onCall={runCommand}
        onOpenApps={(anchor) => openAppMenu(anchor, "gap")}
        getNewWindowRect={newWindowRect}
        store={store}
      />

      {host ? <MessageAppPrompt store={store} host={host} /> : null}
      {launcher ? <AppLauncher store={store} anchor={launcher.anchor} spacing={launcher.spacing} onClose={closeLauncher} onSelect={selectApp} /> : null}
      {menu ? (
        <Menu anchor={menu.anchor} items={menu.entries} onClose={closeMenu} />
      ) : null}
      {notice ? (
        <div className="ks-shell-notice-layer">
          <Notice
            actions={[
              <Button key="close" onClick={() => setNotice(null)}>닫기</Button>,
            ]}
            errorId={notice.id}
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

function sameShellChrome(left: ShellSnapshot | null, right: ShellSnapshot | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.link === right.link
    && left.update === right.update
    && left.shared.workspaces === right.shared.workspaces
    && left.shared.desktops === right.shared.desktops
    && left.shared.apps === right.shared.apps
    && left.shared.app_versions === right.shared.app_versions
    && left.device.active_workspace_id === right.device.active_workspace_id
    && left.device.active_desktop_ids === right.device.active_desktop_ids
    && left.embedded_available === right.embedded_available
    && left.last_transfer === right.last_transfer
    && left.transfer_error === right.transfer_error;
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
