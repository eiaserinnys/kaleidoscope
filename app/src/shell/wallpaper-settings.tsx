import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  ErrorNotice,
  SHELL_WALLPAPER_DECODE_FAILED,
  SHELL_WALLPAPER_FILE_TOO_LARGE,
  SHELL_WALLPAPER_FILE_TYPE_INVALID,
  SettingsRow,
  toCoreError,
  useShellSelector,
  type CoreError,
  type DesktopWallpaper,
  type ShellSnapshot,
  type ShellStore,
} from "@kaleidoscope/ui";
import { LoaderCircle } from "../../../ui/src/components/icons";
import { Select } from "../../../ui/src/components/select-toggle";
import { serverContext } from "../../../ui/src/components/app-icon";
import { selectDesktop, selectWorkspace } from "./shell-window-actions";
import { loadWallpaperUrl } from "./wallpaper-layer";

const WALLPAPER_MAX_BYTES = 20 * 1024 * 1024;
const FORMATS: Record<string, "png" | "jpeg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

function formatFor(file: File): "png" | "jpeg" | "webp" | null {
  const byMime = FORMATS[file.type];
  if (byMime) return byMime;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpeg";
  if (name.endsWith(".webp")) return "webp";
  return null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(SHELL_WALLPAPER_DECODE_FAILED());
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(SHELL_WALLPAPER_DECODE_FAILED());
    reader.readAsDataURL(file);
  });
}

function WallpaperPreview({ store, snapshot, wallpaper, activeDesktopId, desktopId }: {
  store: ShellStore;
  snapshot: ShellSnapshot;
  wallpaper?: DesktopWallpaper;
  activeDesktopId?: string;
  desktopId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<CoreError | null>(null);
  const context = serverContext(snapshot.link);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(null);
    if (!wallpaper) return;
    void loadWallpaperUrl(store, context, wallpaper).then((next) => {
      if (active) setUrl(next);
    }, (cause: unknown) => {
      // 활성 데스크톱의 읽기 실패는 배경 레이어가 쉘 알림으로 알린다.
      if (active && desktopId !== activeDesktopId) setError(toCoreError(cause));
    });
    return () => { active = false; };
  }, [store, context, wallpaper, desktopId, activeDesktopId]);
  return <>
    <div aria-busy={wallpaper && !url ? true : undefined} className="ks-wallpaper-preview" style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {wallpaper && !url ? <LoaderCircle className="ks-settings-apply-spinner" size="inline" /> : null}
    </div>
    {error ? <ErrorNotice error={error} /> : null}
  </>;
}

export function WallpaperSettings({ snapshot, store }: { snapshot: ShellSnapshot; store: ShellStore }) {
  const id = useId();
  const workspace = selectWorkspace(snapshot);
  const desktops = workspace
    ? snapshot.shared.desktops.filter((desktop) => desktop.workspace_id === workspace.id).sort((a, b) => a.position - b.position)
    : [];
  const activeDesktop = workspace ? selectDesktop(snapshot, workspace) : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wallpapers = useShellSelector(store, (value) => value?.shared.desktop_wallpapers);
  const selected = desktops.find((desktop) => desktop.id === selectedId) ?? activeDesktop ?? desktops[0];
  const wallpaper = selected ? wallpapers?.find((item) => item.desktop_id === selected.id) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CoreError | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!selected) return null;
  const connected = snapshot.link.state === "connected";

  const upload = async (file: File) => {
    const format = formatFor(file);
    if (!format) {
      setError(SHELL_WALLPAPER_FILE_TYPE_INVALID());
      return;
    }
    if (file.size > WALLPAPER_MAX_BYTES) {
      setError(SHELL_WALLPAPER_FILE_TOO_LARGE({ limit: "20MiB" }));
      return;
    }
    // 올리기 시작할 때 대상을 고정해 그 사이 데스크톱을 바꿔도 다른 곳에 적용되지 않게 한다.
    const desktopId = selected.id;
    setBusy(true);
    setError(null);
    try {
      const data_base64 = await readBase64(file);
      await store.call({ op: "desktop.wallpaper.upload", desktop_id: desktopId, format, data_base64 });
    } catch (cause) {
      setError(toCoreError(cause));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const desktopId = selected.id;
    setBusy(true);
    setError(null);
    try {
      await store.call({ op: "desktop.wallpaper.reset", desktop_id: desktopId });
    } catch (cause) {
      setError(toCoreError(cause));
    } finally {
      setBusy(false);
    }
  };

  return <section className="ks-settings-group" aria-labelledby={`${id}-wallpaper`}>
    <h3 className="ks-data-section-title" id={`${id}-wallpaper`}>바탕화면</h3>
    <SettingsRow label={<label>데스크톱</label>}
      control={<div className="ks-settings-row-select">
        <Select label="바탕화면 데스크톱" items={desktops.map((desktop) => ({ value: desktop.id, label: desktop.name }))}
          value={selected.id} disabled={busy} onChange={(value) => { if (typeof value === "string") setSelectedId(value); }} />
      </div>} />
    <div className="ks-wallpaper-picker" aria-busy={busy || undefined}>
      <WallpaperPreview activeDesktopId={activeDesktop?.id} desktopId={selected.id} snapshot={snapshot} store={store} wallpaper={wallpaper} />
      <div className="ks-wallpaper-actions">
        <Button aria-label="그림 고르기" aria-busy={busy || undefined} aria-disabled={busy || undefined} disabled={busy || !connected} onClick={() => input.current?.click()}>
          <span>그림 고르기</span>{busy ? <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span> : null}
        </Button>
        <Button aria-label="기본 배경" aria-disabled={busy || undefined} disabled={busy || !wallpaper} onClick={() => void reset()}>
          <span>기본 배경</span>
        </Button>
      </div>
      <input accept="image/png,image/jpeg,image/webp" aria-label="배경 그림 파일" className="ks-file-input" disabled={busy || !connected}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }} ref={input} type="file" />
    </div>
    {error ? <ErrorNotice error={error} /> : null}
  </section>;
}
