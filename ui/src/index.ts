export { AppWindowContent } from "./render/app-window-content";
export { hasVisibleShortcutOverlay } from "./runtime/shortcuts";
export { Button, EmptyState, ErrorId, ErrorNotice, IconButton, Notice, StatusText } from "./components/primitives";
export { TooltipProvider } from "./components/tooltip";
export { Dialog } from "./components/dialog";
export {
  ArrowUp,
  ArrowDown,
  Settings,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UpdateReady,
  TriangleAlert,
  Cloud,
  CloudOff,
  FilePlus,
  File,
  FileCode,
  FileImage,
  FileText,
  FolderOpen,
  Globe,
  ICON_SIZE,
  Import,
  LayoutGrid,
  MessageSquare,
  Maximize2,
  Minus,
  Minimize2,
  OfflineCloud,
  PairingCloud,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCw,
  ScreenShare,
  X,
} from "./components/icons";
export { Menu, type MenuEntry, type MenuHeading, type MenuItem, type MenuProps, type MenuSeparator } from "./components/menu";
export { ContextMenuHost, openContextMenu, writeMenuClipboard } from "./components/context-menu";
export { APP_COMMENT_ANCHOR_SCHEMA_VERSION, BUILTIN_APP_IDS } from "./contract/limits";
export { buildDefinitionIndex, resolveDefinition, type DefinitionEntry, type DefinitionIndex, type DefinitionResult } from "./comments/definition";
export { describeTarget, type TargetDescription } from "./comments/target";
export { resolveScreen, type ScreenContext, type ScreenResult } from "./comments/screen";
export { encodeCommentKey, decodeCommentKey } from "./comments/key";
export { TextInput, type TextInputProps } from "./components/text-input";
export { createHttpTransport } from "./core/http-transport";
export {
  createFakeTransport,
  type FakeTransport,
  type FakeTransportSeed,
  type FakeWebViewSnapshot,
} from "./core/fake-transport";
export { createShellStore, useShellSelector, type ShellStore } from "./core/shell-store";
export { messageReceiver, messageApps, defaultMessageApp, useDefaultMessageApp, type MessageReceiver, type MessageApp } from "./shell/message-target";
export { sendToDefaultAgent } from "./shell/send-message";
export { isWindowTop } from "./data/window-state";
export { flushEditors, flushWindowEditors } from "./blocks/file-editor-session";
export { flushSandboxes } from "./blocks/sandbox-flush";
export { toCoreError } from "./core/core-transport";
export type { CoreTransport, ReplyFor, RequestFor } from "./core/core-transport";
export type {
  AppCommentAnchor,
  AppCommentImage,
  AppCommentPoint,
  AppCommentQuote,
  AppCommentRect,
  AppDefinition,
  AppWindow,
  Block,
  CoreError,
  CoreEvent,
  CoreReply,
  CoreRequest,
  PickFilesSpec,
  Desktop,
  Rect,
  ShellSnapshot,
  ServerMode,
  TransferResult,
  UpdateStatus,
  Workspace,
  WindowSize,
} from "./contract/contract";
export { captureWindowForComment, prepareShareForSend, useShareView } from "./share/share-view";
export { suspendWebSurfaces } from "./blocks/web-surface-layer";
export { useWindowControlHost } from "./share/window-control";
export { describeNumbered, resolveNumbered, forgetNumbered } from "./share/numbered";
export { windowActionActive } from "./share/action-context";
export { readWindowView, executeWindowAction, setWindowViewGeometry } from "./share/window-control";
export type { ResolveResult } from "./share/numbered";
export { installShellDragGuard, registerFileDropTarget } from "./shell-drag-guard";
export { clientFileDropReady, deliverClientFiles } from "./runtime/client-runtime";
export * from "./contract/shell-errors";
export { AppIcon } from "./components/app-icon";

export { IconTile, useIconGridColumns } from "./components/icon-tile";
export { CountBadge } from "./components/badge";
export { useAnchoredOverlay } from "./components/anchored-overlay";
export { GroupHeading } from "./blocks/data-view-common";
export { focusRescued } from "./components/focus-rescue";
export { SettingsRow } from "./components/settings-row";
