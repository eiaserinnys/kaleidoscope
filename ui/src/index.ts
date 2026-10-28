export { AppWindowContent } from "./render/app-window-content";
export { Button, EmptyState, IconButton, Notice, StatusText } from "./components/primitives";
export { Menu, type MenuEntry, type MenuItem, type MenuProps, type MenuSeparator } from "./components/menu";
export { TextInput, type TextInputProps } from "./components/text-input";
export { createHttpTransport } from "./core/http-transport";
export { createFakeTransport, type FakeTransport, type FakeTransportSeed } from "./core/fake-transport";
export { createShellStore, useShellSnapshot, type ShellStore } from "./core/shell-store";
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
  Workspace,
} from "./contract/contract";
