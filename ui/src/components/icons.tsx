import {
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  Settings as SettingsIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  ChevronRight as ChevronRightIcon,
  CircleArrowUp as CircleArrowUpIcon,
  Cloud as CloudIcon,
  CloudOff as CloudOffIcon,
  File as FileIcon,
  FilePlus as FilePlusIcon,
  FileText as FileTextIcon,
  FileCode as FileCodeIcon,
  FileImage as FileImageIcon,
  HardDrive as HardDriveIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Globe as GlobeIcon,
  Image as ImageIcon,
  Import as ImportIcon,
  LayoutGrid as LayoutGridIcon,
  List as ListIcon,
  Maximize2 as Maximize2Icon,
  Minus as MinusIcon,
  Minimize2 as Minimize2Icon,
  LoaderCircle as LoaderCircleIcon,
  MessageSquare as MessageSquareIcon,
  Monitor as MonitorIcon,
  Music as MusicIcon,
  Download as DownloadIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PanelLeftOpen as PanelLeftOpenIcon,
  Paperclip as PaperclipIcon,
  Plus as PlusIcon,
  RotateCw as RotateCwIcon,
  RotateCcw as RotateCcwIcon,
  ScreenShare as ScreenShareIcon,
  X as XIcon,
  Video as VideoIcon,
  Undo2 as Undo2Icon,
  Redo2 as Redo2Icon,
  MousePointer2 as MousePointer2Icon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  Check as CheckIcon,
  Ellipsis as EllipsisIcon,
  Copy as CopyIcon,
  Trash2 as Trash2Icon,
  TriangleAlert as TriangleAlertIcon,
  Save as SaveIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  AlignLeft as AlignLeftIcon,
  AlignCenter as AlignCenterIcon,
  AlignRight as AlignRightIcon,
  AlignJustify as AlignJustifyIcon,
  AlignStartVertical as AlignStartVerticalIcon,
  AlignCenterVertical as AlignCenterVerticalIcon,
  AlignEndVertical as AlignEndVerticalIcon,
  AlignHorizontalSpaceBetween as AlignHorizontalSpaceBetweenIcon,
  AlignVerticalSpaceBetween as AlignVerticalSpaceBetweenIcon,
  AlignStartHorizontal as AlignStartHorizontalIcon,
  AlignCenterHorizontal as AlignCenterHorizontalIcon,
  AlignEndHorizontal as AlignEndHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export const ICON_SIZE = { control: 17, inline: 15, chrome: 14, empty: 32, tile: 32 } as const;
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
export const ChevronUp = (props: IconProps) => renderIcon(ChevronUpIcon, props);
export const PanelLeftOpen = (props: IconProps) => renderIcon(PanelLeftOpenIcon, props);
export const PanelLeftClose = (props: IconProps) => renderIcon(PanelLeftCloseIcon, props);
export const FileText = (props: IconProps) => renderIcon(FileTextIcon, props);
export const File = (props: IconProps) => renderIcon(FileIcon, props);
export const Paperclip = (props: IconProps) => renderIcon(PaperclipIcon, props);
export const FileCode = (props: IconProps) => renderIcon(FileCodeIcon, props);
export const FileImage = (props: IconProps) => renderIcon(FileImageIcon, props);
export const HardDrive = (props: IconProps) => renderIcon(HardDriveIcon, props);
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
export const Image = (props: IconProps) => renderIcon(ImageIcon, props);
export const Monitor = (props: IconProps) => renderIcon(MonitorIcon, props);
export const Music = (props: IconProps) => renderIcon(MusicIcon, props);
export const Download = (props: IconProps) => renderIcon(DownloadIcon, props);
export const Video = (props: IconProps) => renderIcon(VideoIcon, props);
export const Plus = (props: IconProps) => renderIcon(PlusIcon, props);
export const LayoutGrid = (props: IconProps) => renderIcon(LayoutGridIcon, props);
export const List = (props: IconProps) => renderIcon(ListIcon, props);
export const Maximize2 = (props: IconProps) => renderIcon(Maximize2Icon, props);
export const Minus = (props: IconProps) => renderIcon(MinusIcon, props);
export const Minimize2 = (props: IconProps) => renderIcon(Minimize2Icon, props);
export const LoaderCircle = (props: IconProps) => renderIcon(LoaderCircleIcon, props);
export const Import = (props: IconProps) => renderIcon(ImportIcon, props);
export const ScreenShare = (props: IconProps) => renderIcon(ScreenShareIcon, props);
export const X = (props: IconProps) => renderIcon(XIcon, props);
export const Cloud = (props: IconProps) => renderIcon(CloudIcon, props);
export const CloudOff = (props: IconProps) => renderIcon(CloudOffIcon, props);
export const Undo2 = (props: IconProps) => renderIcon(Undo2Icon, props);
export const Redo2 = (props: IconProps) => renderIcon(Redo2Icon, props);
export const MousePointer2 = (props: IconProps) => renderIcon(MousePointer2Icon, props);
export const Eye = (props: IconProps) => renderIcon(EyeIcon, props);
export const EyeOff = (props: IconProps) => renderIcon(EyeOffIcon, props);
export const Check = (props: IconProps) => renderIcon(CheckIcon, props);
export const Ellipsis = (props: IconProps) => renderIcon(EllipsisIcon, props);
export const Copy = (props: IconProps) => renderIcon(CopyIcon, props);
export const TriangleAlert = (props: IconProps) => renderIcon(TriangleAlertIcon, props);
export const Trash2 = (props: IconProps) => renderIcon(Trash2Icon, props);
export const Save = (props: IconProps) => renderIcon(SaveIcon, props);
export const SlidersHorizontal = (props: IconProps) => renderIcon(SlidersHorizontalIcon, props);
export const AlignLeft = (props: IconProps) => renderIcon(AlignLeftIcon, props);
export const AlignCenter = (props: IconProps) => renderIcon(AlignCenterIcon, props);
export const AlignRight = (props: IconProps) => renderIcon(AlignRightIcon, props);
export const AlignJustify = (props: IconProps) => renderIcon(AlignJustifyIcon, props);
export const AlignStartVertical = (props: IconProps) => renderIcon(AlignStartVerticalIcon, props);
export const AlignCenterVertical = (props: IconProps) => renderIcon(AlignCenterVerticalIcon, props);
export const AlignEndVertical = (props: IconProps) => renderIcon(AlignEndVerticalIcon, props);
export const AlignHorizontalSpaceBetween = (props: IconProps) => renderIcon(AlignHorizontalSpaceBetweenIcon, props);
export const AlignVerticalSpaceBetween = (props: IconProps) => renderIcon(AlignVerticalSpaceBetweenIcon, props);
export const AlignStartHorizontal = (props: IconProps) => renderIcon(AlignStartHorizontalIcon, props);
export const AlignCenterHorizontal = (props: IconProps) => renderIcon(AlignCenterHorizontalIcon, props);
export const AlignEndHorizontal = (props: IconProps) => renderIcon(AlignEndHorizontalIcon, props);
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
