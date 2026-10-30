import {
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  Settings as SettingsIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  CircleArrowUp as CircleArrowUpIcon,
  Cloud as CloudIcon,
  CloudOff as CloudOffIcon,
  File as FileIcon,
  FilePlus as FilePlusIcon,
  FileText as FileTextIcon,
  FileCode as FileCodeIcon,
  FileImage as FileImageIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Globe as GlobeIcon,
  Import as ImportIcon,
  LayoutGrid as LayoutGridIcon,
  List as ListIcon,
  MessageSquare as MessageSquareIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PanelLeftOpen as PanelLeftOpenIcon,
  Paperclip as PaperclipIcon,
  Plus as PlusIcon,
  RotateCw as RotateCwIcon,
  RotateCcw as RotateCcwIcon,
  ScreenShare as ScreenShareIcon,
  X as XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export const ICON_SIZE = { control: 18, inline: 16, empty: 32, tile: 32 } as const;
export type IconSize = keyof typeof ICON_SIZE;

interface IconProps {
  size?: IconSize;
  className?: string;
}

function renderIcon(
  Icon: LucideIcon,
  { size = "control", className }: IconProps,
  children?: ReactNode,
  strokeDasharray?: string,
) {
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      className={className}
      size={ICON_SIZE[size]}
      strokeDasharray={strokeDasharray}
      strokeWidth={1.5}
    >
      {children}
    </Icon>
  );
}

export const ChevronRight = (props: IconProps) => renderIcon(ChevronRightIcon, props);
export const UpdateReady = (props: IconProps) => renderIcon(CircleArrowUpIcon, props);
export const ChevronDown = (props: IconProps) => renderIcon(ChevronDownIcon, props);
export const PanelLeftOpen = (props: IconProps) => renderIcon(PanelLeftOpenIcon, props);
export const PanelLeftClose = (props: IconProps) => renderIcon(PanelLeftCloseIcon, props);
export const FileText = (props: IconProps) => renderIcon(FileTextIcon, props);
export const File = (props: IconProps) => renderIcon(FileIcon, props);
export const Paperclip = (props: IconProps) => renderIcon(PaperclipIcon, props);
export const FileCode = (props: IconProps) => renderIcon(FileCodeIcon, props);
export const FileImage = (props: IconProps) => renderIcon(FileImageIcon, props);
export const FilePlus = (props: IconProps) => renderIcon(FilePlusIcon, props);
export const FolderOpen = (props: IconProps) => renderIcon(FolderOpenIcon, props);
export const Folder = (props: IconProps) => renderIcon(FolderIcon, props);
export const MessageSquare = (props: IconProps) => renderIcon(MessageSquareIcon, props);
export const Settings = (props: IconProps) => renderIcon(SettingsIcon, props);
export const ArrowDown = (props: IconProps) => renderIcon(ArrowDownIcon, props);
export const ArrowUp = (props: IconProps) => renderIcon(ArrowUpIcon, props);
export const ArrowLeft = (props: IconProps) => renderIcon(ArrowLeftIcon, props);
export const ArrowRight = (props: IconProps) => renderIcon(ArrowRightIcon, props);
export const RotateCw = (props: IconProps) => renderIcon(RotateCwIcon, props);
export const RotateCcw = (props: IconProps) => renderIcon(RotateCcwIcon, props);
export const Globe = (props: IconProps) => renderIcon(GlobeIcon, props);
export const Plus = (props: IconProps) => renderIcon(PlusIcon, props);
export const LayoutGrid = (props: IconProps) => renderIcon(LayoutGridIcon, props);
export const List = (props: IconProps) => renderIcon(ListIcon, props);
export const Import = (props: IconProps) => renderIcon(ImportIcon, props);
export const ScreenShare = (props: IconProps) => renderIcon(ScreenShareIcon, props);
export const X = (props: IconProps) => renderIcon(XIcon, props);
export const Cloud = (props: IconProps) => renderIcon(CloudIcon, props);
export const CloudOff = (props: IconProps) => renderIcon(CloudOffIcon, props);
export const PairingCloud = (props: IconProps) => renderIcon(
  CloudIcon,
  props,
  <>
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
  </>,
);
export const OfflineCloud = (props: IconProps) => renderIcon(CloudIcon, props, undefined, "3 2");
