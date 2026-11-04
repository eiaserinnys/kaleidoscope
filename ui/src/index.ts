export { AppWindowContent } from "./render/app-window-content";
export { Button, EmptyState, ErrorId, ErrorNotice, IconButton, Notice, StatusText } from "./components/primitives";
export { Dialog } from "./components/dialog";
export {
  ArrowUp,
  ArrowDown,
  Settings,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  UpdateReady,
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
export { BUILTIN_APP_IDS } from "./contract/limits";
export { TextInput, type TextInputProps } from "./components/text-input";
export { createHttpTransport } from "./core/http-transport";
export {
  createFakeTransport,
  type FakeTransport,
  type FakeTransportSeed,
  type FakeWebViewSnapshot,
} from "./core/fake-transport";
export { createShellStore, useShellSelector, type ShellStore } from "./core/shell-store";
export { isWindowTop } from "./data/window-state";
export { flushEditors } from "./blocks/file-editor-session";
export { flushSandboxes } from "./blocks/sandbox-flush";
export { toCoreError } from "./core/core-transport";
export type { CoreTransport, ReplyFor, RequestFor } from "./core/core-transport";
export type {
  AppDefinition,
  AppWindow,
  Block,
  CoreError,
  CoreEvent,
  CoreReply,
  CoreRequest,
  Desktop,
  Rect,
  ShellSnapshot,
  ServerMode,
  TransferResult,
  Workspace,
} from "./contract/contract";
export { prepareShareForSend, useShareView } from "./share/share-view";
export { describeNumbered, resolveNumbered, forgetNumbered } from "./share/numbered";
export type { ResolveResult } from "./share/numbered";
export { installShellDragGuard } from "./shell-drag-guard";
export * from "./contract/shell-errors";
