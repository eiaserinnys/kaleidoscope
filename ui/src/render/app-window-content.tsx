import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { AppSettings } from "../settings/app-settings";
import { WindowDataProvider, useWindowData, useDormant, useBinding, type WindowData } from "../data/window-data";
import { ClientShareSignal, WindowNotice } from "../data/window-notice";
import type { BlockContext, WindowIdentity } from "../blocks/block-context";
import { ErrorNotice, StatusText } from "../components/primitives";
import type { ShellStore } from "../core/shell-store";
import type { CoreError, Rect } from "../contract/contract";
import { useShellSelector } from "../core/shell-store";
import { registerAppShortcuts } from "../runtime/shortcuts";
import { focusRescued, writableControlSelector } from "../components/focus-rescue";
import { revealStackControl } from "./focus-scroll";
import { renderBlock } from "./render-block";
import * as shellErrors from "../contract/shell-errors";

export const AppWindowContent = memo(function AppWindowContent({
  store,
  windowId,
  newWindowRect,
  settingsOpen = false,
  settingsVisited = false,
  onSettingsClose = () => undefined,
  onSettingsProblem,
  onWindowHeader,
  onSettingsAvailable,
  onWindowData,
}: {
  store: ShellStore;
  windowId: string;
  newWindowRect?: () => Rect | undefined;
  settingsOpen?: boolean;
  settingsVisited?: boolean;
  onSettingsClose?: () => void;
  onSettingsProblem?: (problem: CoreError | string | null) => void;
  onWindowHeader?: (title: string, meta: string | null) => void;
  onSettingsAvailable?: (available: boolean) => void;
  onWindowData?: (data: WindowData | null) => void;
}) {
  const window = useShellSelector(store, (snapshot) => {
    const item = snapshot?.shared.windows.find((candidate) => candidate.id === windowId);
    return item ? { id: item.id, app_id: item.app_id, app_version: item.app_version, desktop_id: item.desktop_id } : null;
  }, sameWindowIdentity);
  const version = useShellSelector(store, (snapshot) => window
    ? snapshot?.shared.app_versions.find((item) => item.app_id === window.app_id && item.version === window.app_version)
    : undefined);
  const context = useMemo<BlockContext | null>(() => window && version ? {
    store, window, definition: version.definition, newWindowRect,
  } : null, [store, window, version, newWindowRect]);

  if (!store.getSnapshot()) {
    const error = store.getError();
    return error
      ? <div className="ks-app-content-error"><ErrorNotice error={error} /></div>
      : <div className="ks-app-content-loading"><StatusText>불러오는 중</StatusText></div>;
  }
  if (!window) return <div className="ks-app-content-error"><ErrorNotice error={shellErrors.SHELL_APP_WINDOW_NOT_FOUND()} /></div>;
  if (!version || !context) return <div className="ks-app-content-error"><ErrorNotice error={shellErrors.SHELL_APP_VERSION_NOT_FOUND()} /></div>;

  const hasSettings = Boolean(version.definition.settings)
    || (version.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false);
  if (version.definition.requires.blocks < 4 && !hasSettings && !version.definition.agent) return <div className="ks-app-window-content" data-ks-app-id={window.app_id}>{renderBlock(version.definition.ui, context)}</div>;
  return <WindowDataProvider store={store} windowId={window.id} definition={version.definition}>
    <WindowBody context={context} settingsOpen={settingsOpen} settingsVisited={settingsVisited} onSettingsClose={onSettingsClose} onSettingsProblem={onSettingsProblem} onWindowHeader={onWindowHeader} onSettingsAvailable={onSettingsAvailable} onWindowData={onWindowData} />
  </WindowDataProvider>;
});

function sameWindowIdentity(left: WindowIdentity | null, right: WindowIdentity | null) {
  return left === right || Boolean(left && right && left.id === right.id && left.app_id === right.app_id && left.app_version === right.app_version && left.desktop_id === right.desktop_id);
}

function AppShortcuts({ context, active }: { context: BlockContext; active: boolean }) {
  const data = useWindowData();
  useEffect(() => {
    const shortcuts = context.definition.shortcuts;
    if (!active || !shortcuts?.length) return;
    return registerAppShortcuts(context, shortcuts, (index, modifiers) => { void data.act(`/shortcuts/${index}/action`, null, undefined, modifiers); });
  }, [active, context, data]);
  return null;
}

function WindowBody({ context, settingsOpen, settingsVisited, onSettingsClose, onSettingsProblem, onWindowHeader, onSettingsAvailable, onWindowData }: {
  context: BlockContext; settingsOpen: boolean; settingsVisited: boolean; onSettingsClose: () => void; onSettingsProblem?: (problem: CoreError | string | null) => void; onWindowHeader?: (title: string, meta: string | null) => void; onSettingsAvailable?: (available: boolean) => void; onWindowData?: (data: WindowData | null) => void;
}) {
  const data = useWindowData();
  const host = useRef<HTMLDivElement | null>(null);
  const setHost = useCallback((element: HTMLDivElement | null) => {
    host.current = element;
    data.setClientHost(element);
  }, [data]);
  useEffect(() => {
    const content = host.current;
    if (!content) return;
    const scope = content.closest<HTMLElement>(".ks-window-frame") ?? content;
    let focused: HTMLElement | null = null;
    let focusedItem: HTMLElement | null = null;
    let focusedRemove = false;
    let focusPath: Array<{ ancestor: HTMLElement; controlIndex: number }> = [];
    let inContent = false;
    let restore = false;
    let pointer = false;
    let focusFrame = 0;
    const visibleControls = (within: ParentNode) => Array.from(within.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.tabIndex >= 0 && !element.closest("[hidden], [inert], [aria-hidden='true']")
        && (typeof element.checkVisibility !== "function" || element.checkVisibility({ visibilityProperty: true })));
    const onPointer = () => { pointer = true; };
    const onKey = () => { pointer = false; };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.classList.contains("ks-window-content")) return;
      cancelAnimationFrame(focusFrame);
      // 브라우저의 커서 스크롤이 끝난 다음, 키보드로 옮긴 입력 상자를 온전히 보인다.
      if (!pointer && content.contains(target)) focusFrame = requestAnimationFrame(() => {
        if (document.activeElement === target) revealStackControl(target);
      });
      focused = target;
      focusedRemove = target.classList.contains("ks-list-remove");
      inContent = content.contains(target);
      focusedItem = null;
      for (let item: HTMLElement | null = target; item && content.contains(item); item = item.parentElement) {
        if (item.matches('[role="option"], [role="listitem"], [role="row"][data-focus-index]') || item.parentElement?.matches('.ks-repeat-content')) {
          focusedItem = item;
          break;
        }
      }
      focusPath = [];
      for (let ancestor = target.parentElement; ancestor && content.contains(ancestor); ancestor = ancestor.parentElement) {
        focusPath.push({ ancestor, controlIndex: visibleControls(ancestor).indexOf(target) });
      }
      restore = false;
    };
    const windowContentTarget = () => {
      const windowContent = content.closest<HTMLElement>(".ks-window-content") ?? content;
      if (!windowContent.hasAttribute("tabindex")) windowContent.tabIndex = -1;
      windowContent.classList.add("ks-focus-rescue-empty");
      windowContent.addEventListener("blur", () => windowContent.classList.remove("ks-focus-rescue-empty"), { once: true });
      return windowContent;
    };
    const nearTarget = () => {
      for (const { ancestor, controlIndex } of focusPath) {
        if (!content.contains(ancestor)) continue;
        const controls = visibleControls(ancestor);
        if (controls.length) return controls[Math.min(Math.max(controlIndex, 0), controls.length - 1)];
      }
      return undefined;
    };
    const collectionTarget = (changes: MutationRecord[]): HTMLElement | undefined => {
      const collection = inContent ? focusPath.find(({ ancestor }) => ancestor.matches('.ks-repeat-content, .ks-agent-attachment-list, [role="list"], [role="listbox"], [role="table"]')) : undefined;
      if (!collection || !focusedItem || focusedItem.isConnected) return;
      const group = collection.ancestor;
      const removableList = group.matches('.ks-list[role="list"]');
      const visible = visibleControls(content);
      let anchor: Node = group;
      if (content.contains(group)) {
        if (removableList) {
          const items = Array.from(group.querySelectorAll<HTMLElement>('[role="listitem"][data-list-index]'));
          const index = Number(focusedItem.dataset.listIndex);
          const item = items.find((item) => Number(item.dataset.listIndex) >= index) ?? items.at(-1);
          const target = item?.querySelector<HTMLElement>(focusedRemove ? ".ks-list-remove" : "button");
          if (target) return target;
        }
        const controls = visibleControls(group);
        if (controls.length) return controls[Math.max(0, collection.controlIndex)] ?? controls[controls.length - 1];
      } else {
        const parent = focusPath.find(({ ancestor }) => content.contains(ancestor))?.ancestor;
        if (!parent) return;
        const added = changes.filter((change) => change.target === parent).flatMap((change) => Array.from(change.addedNodes));
        anchor = added.find((node) => parent.contains(node)) ?? parent;
      }
      if (removableList) {
        const before = visible.filter((element) => Boolean(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        return before ?? visible.find((element) => Boolean(anchor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) && !anchor.contains(element)) ?? windowContentTarget();
      }
      const addedControl = changes.some((change) => content.contains(change.target)
        && Array.from(change.addedNodes).some((node) => visible.some((control) => node.contains(control))));
      if (addedControl) return;
      // 빈 모음에서는 뒤에 있는 강조 단추보다 입력칸과 앞 조작을 우선한다.
      const target = visible.find((element) => element.classList.contains("ks-agent-chat-input"))
        ?? visible.filter((element) => Boolean(element.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      if (target) return target;
      return windowContentTarget();
    };
    const observer = new MutationObserver((changes) => {
      const active = document.activeElement;
      const lost = active === document.body || (active instanceof HTMLElement && active.classList.contains("ks-window-content") && scope.contains(active));
      if (focused && !scope.contains(focused)) { focused = null; restore = lost; }
      if (!restore || !lost) return;
      let target = collectionTarget(changes);
      if (pointer) {
        target ??= nearTarget();
        if (!target || target.matches(writableControlSelector)) target = windowContentTarget();
      } else {
        const visible = visibleControls(content);
        target ??= visible.find((element) => element.classList.contains("ks-button-emphasis"))
          ?? visible.find((element) => element.classList.contains("ks-agent-chat-input")) ?? visible[0];
      }
      if (target) { restore = false; focusRescued(target, pointer ? { preventScroll: true } : undefined); }
    });
    scope.addEventListener("focusin", onFocus);
    scope.addEventListener("pointerdown", onPointer, true);
    scope.addEventListener("keydown", onKey, true);
    observer.observe(scope, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(focusFrame);
      scope.removeEventListener("focusin", onFocus);
      scope.removeEventListener("pointerdown", onPointer, true);
      scope.removeEventListener("keydown", onKey, true);
      observer.disconnect();
    };
  }, [data]);
  const hasSettings = Boolean(context.definition.settings)
    || (context.definition.storage?.entries.some((entry) => entry.presentation === "settings") ?? false);
  useEffect(() => {
    onWindowData?.(data);
    return () => onWindowData?.(null);
  }, [data, onWindowData]);
  useDormant("/ui", settingsOpen);
  useDormant("/settings/ui", Boolean(context.definition.settings) && !settingsOpen);
  useEffect(() => { data.setClientDormant(settingsOpen); }, [data, settingsOpen]);
  return <div ref={setHost} className="ks-app-window-content ks-data-window" data-ks-app-id={context.window.app_id} data-window-id={context.window.id}>
    <WindowFrameBindings context={context} onWindowHeader={onWindowHeader} onSettingsAvailable={onSettingsAvailable} />
    <ClientShareSignal />
    <AppShortcuts context={context} active={!settingsOpen} />
    <div className="ks-data-window-body" hidden={settingsOpen} inert={settingsOpen || undefined}>{renderBlock(context.definition.ui, context)}</div>
    {hasSettings && settingsVisited ? <AppSettings key={context.window.app_version} context={context} open={settingsOpen} onClose={onSettingsClose} onProblem={onSettingsProblem} /> : null}
    <div className="ks-data-window-notice"><WindowNotice /></div>
  </div>;
}

function WindowFrameBindings({ context, onWindowHeader, onSettingsAvailable }: {
  context: BlockContext;
  onWindowHeader?: (title: string, meta: string | null) => void;
  onSettingsAvailable?: (available: boolean) => void;
}) {
  const titleBinding = context.definition.window_title?.title ?? context.definition.name;
  const metaBinding = context.definition.window_title?.meta ?? "";
  const title = useBinding("/window_title/title", titleBinding);
  const meta = useBinding("/window_title/meta", metaBinding);
  const settings = context.definition.settings;
  const available = useBinding("/settings/available", settings?.available ?? true);
  const titleText = title.status === "ready" && typeof title.value === "string" ? title.value : context.definition.name;
  const metaText = meta.status === "ready" && typeof meta.value === "string" ? meta.value : null;
  const settingsIsAvailable = settings?.available === undefined
    || (available.status === "ready" && available.value === true);

  useEffect(() => { onWindowHeader?.(titleText, metaText); }, [onWindowHeader, titleText, metaText]);
  useEffect(() => { onSettingsAvailable?.(settingsIsAvailable); }, [onSettingsAvailable, settingsIsAvailable]);
  return null;
}
