import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  Notice,
  TextInput,
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
import {
  AppsIcon,
  ChevronDownIcon,
  ImportIcon,
  LinkedCloudIcon,
  OfflineCloudIcon,
  PairingCloudIcon,
  PlusIcon,
  UnlinkedCloudIcon,
} from "./icons";
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
    return <main className="app-root"><EmptyState icon={<AppsIcon />} text="코어에 연결할 수 없습니다" /></main>;
  }

  if (!activeWorkspace || !activeDesktop) {
    return <main className="app-root"><EmptyState icon={<AppsIcon />} text="코어에 연결할 수 없습니다" /></main>;
  }

  const workspaces = snapshot.shared.workspaces;
  const desktops = snapshot.shared.desktops
    .filter((desktop) => desktop.workspace_id === activeWorkspace.id)
    .sort((a, b) => a.position - b.position);

  const openAppMenu = (anchor: HTMLElement) => {
    const entries: MenuEntry[] = snapshot.shared.apps.length > 0
      ? snapshot.shared.apps.map((app) => ({
        id: `app-${app.id}`,
        label: app.name,
        onSelect: () => void runCommand({
          op: "window.open",
          desktop_id: activeDesktop.id,
          app_id: app.id,
          rect: newWindowRect(activeDesktop.id, snapshot),
        }),
      }))
      : [{ id: "no-apps", label: "앱 없음", disabled: true }];
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

  const linkMenuEntries = (anchor: HTMLElement): MenuEntry[] => {
    const status = snapshot.link;
    const command = (op: "link.start" | "link.cancel" | "link.unlink") => () => void runCommand({ op });
    return status.state === "unlinked"
      ? [{ id: "link-start", label: "서버에 연결", onSelect: () => void startLink(anchor) }]
      : status.state === "pairing"
        ? pairingMenuEntries(status.user_code)
        : status.state === "connected"
          ? [
            { id: "link-connected", label: `${new URL(status.server_url).host} 연결됨`, disabled: true },
            { id: "link-separator", type: "separator" },
            { id: "link-unlink", label: "연결 끊기", danger: true, onSelect: command("link.unlink") },
          ]
          : status.state === "offline"
            ? [
              { id: "link-offline", label: "다시 연결하는 중", disabled: true },
              { id: "link-separator", type: "separator" },
              { id: "link-unlink", label: "연결 끊기", danger: true, onSelect: command("link.unlink") },
            ]
            : [{ id: "link-restart", label: "다시 연결", onSelect: () => void startLink(anchor) }];
  };

  const pairingMenuEntries = (userCode: string): MenuEntry[] => [
    {
      id: "link-copy-code",
      label: `${userCode} 복사`,
      onSelect: () => {
        void navigator.clipboard.writeText(userCode).catch((reason: unknown) => setNotice(toCoreError(reason)));
      },
    },
    { id: "link-separator", type: "separator" },
    { id: "link-cancel", label: "연결 취소", onSelect: () => void runCommand({ op: "link.cancel" }) },
  ];

  const startLink = async (anchor: HTMLElement) => {
    const reply = await runCommand({ op: "link.start" });
    if (reply?.op === "link.start") setMenu({ kind: "link", anchor });
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

  const menuItems = menu?.kind === "link" ? linkMenuEntries(menu.anchor) : menu?.entries ?? [];
  // 연결 상태에 따라 메뉴 폭이 바뀌므로 기준 위치를 다시 계산한다.
  const linkMenuKey = menuItems.map((entry) => entry.type === "separator" ? entry.id : `${entry.id}:${entry.label}`).join("|");

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
              <ChevronDownIcon className="ks-shell-chevron" />
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
            <PlusIcon />
          </IconButton>
        </nav>

        <div className="ks-shell-actions">
          <IconButton aria-label="앱 열기" onClick={(event) => openAppMenu(event.currentTarget)} title="앱 열기">
            <AppsIcon />
          </IconButton>
          <IconButton aria-label="앱 정의 가져오기" onClick={() => fileInput.current?.click()} title="앱 정의 가져오기">
            <ImportIcon />
          </IconButton>
          {snapshot.link.state === "connected" ? (
            <IconButton
              aria-label="연결됨"
              onClick={(event) => openLinkMenu(event.currentTarget)}
              title={`연결됨 · ${snapshot.link.device_name}`}
            >
              <LinkedCloudIcon />
            </IconButton>
          ) : snapshot.link.state === "pairing" ? (
            <IconButton
              aria-label={`연결 코드 ${snapshot.link.user_code}`}
              onClick={(event) => openLinkMenu(event.currentTarget)}
              title={`연결 코드 ${snapshot.link.user_code}`}
            >
              <PairingCloudIcon className="ks-link-icon-accent" />
            </IconButton>
          ) : snapshot.link.state === "offline" ? (
            <IconButton
              aria-label="다시 연결하는 중"
              onClick={(event) => openLinkMenu(event.currentTarget)}
              title={`다시 연결하는 중 · ${snapshot.link.reason}`}
            >
              <OfflineCloudIcon />
            </IconButton>
          ) : snapshot.link.state === "revoked" ? (
            <IconButton
              aria-label="연결이 끊겼습니다"
              onClick={(event) => openLinkMenu(event.currentTarget)}
              title="연결이 끊겼습니다"
            >
              <UnlinkedCloudIcon />
            </IconButton>
          ) : (
            <IconButton aria-label="서버에 연결" onClick={(event) => openLinkMenu(event.currentTarget)} title="서버에 연결">
              <UnlinkedCloudIcon />
            </IconButton>
          )}
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
        activeDesktopId={activeDesktop.id}
        activeWorkspaceId={activeWorkspace.id}
        onAreaChange={reportArea}
        onCall={runCommand}
        onOpenApps={openAppMenu}
        snapshot={snapshot}
        store={store}
      />

      {menu ? (
        <Menu
          key={menu.kind === "link" ? linkMenuKey : "items"}
          anchor={menu.anchor}
          items={menuItems}
          onClose={closeMenu}
        />
      ) : null}
      {notice ? (
        <div className="ks-shell-notice-layer">
          <Notice
            actions={[
              <Button key="close" onClick={() => setNotice(null)}>닫기</Button>,
            ]}
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
