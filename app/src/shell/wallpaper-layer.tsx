import { useEffect, useRef, useState } from "react";
import {
  SHELL_WALLPAPER_DECODE_FAILED,
  toCoreError,
  useShellSelector,
  type CoreError,
  type DesktopWallpaper,
  type ShellSnapshot,
  type ShellStore,
} from "@kaleidoscope/ui";
import { serverContext } from "../../../ui/src/components/app-icon";

// 배경 그림은 서버 context와 자산 참조로 한 번만 받아 Blob URL로 나눠 쓴다.
// 서버가 바뀌면 이전 context의 URL을 모두 해제해 다른 서버 그림이 남지 않게 한다.
let cacheContext = "";
const pending = new Map<string, Promise<string | null>>();
const urls = new Map<string, string>();

function releaseCache() {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  pending.clear();
  cacheContext = "";
}

export function releaseWallpaperCache() {
  releaseCache();
}

function ensureContext(context: string) {
  if (cacheContext !== context) releaseCache();
  cacheContext = context;
}

async function fetchWallpaper(store: ShellStore, wallpaper: DesktopWallpaper): Promise<string | null> {
  const reply = await store.call({ op: "desktop.wallpaper.media", desktop_id: wallpaper.desktop_id });
  if (reply.op !== "desktop.wallpaper.media" || !reply.media) return null;
  const bytes = Uint8Array.from(atob(reply.media.data_base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: reply.media.mime }));
  try {
    if (typeof Image !== "undefined") {
      const image = new Image();
      image.src = url;
      if (typeof image.decode === "function") await image.decode();
    }
    return url;
  } catch {
    URL.revokeObjectURL(url);
    throw SHELL_WALLPAPER_DECODE_FAILED();
  }
}

type LinkState = ShellSnapshot["link"]["state"] | undefined;

/// 링크는 있으나 아직 connected가 아닌 상태다. 이때의 배경 읽기 실패는 연결이 끝나면 다시 읽으므로 알리지 않는다.
/// 링크가 아예 없거나(unlinked) 연결된(connected) 뒤의 실패는 그대로 알린다.
function awaitingLink(state: LinkState): boolean {
  return state !== undefined && state !== "connected" && state !== "unlinked";
}

/// 연결 전 미디어 읽기 실패인지 가른다. 코어는 MEDIA_LOAD_SERVER_NOT_CONNECTED를 DESK_WALLPAPER_MEDIA_READ_FAILED로
/// 감싸고 원인 문구만 details에 남기므로, 원인 코드 대신 감싼 코드와 그때의 링크 상태로 판정한다.
export function isAwaitingLinkReadFailure(error: CoreError, state: LinkState): boolean {
  return awaitingLink(state)
    && (error.id === "DESK_WALLPAPER_MEDIA_READ_FAILED" || error.id === "MEDIA_LOAD_SERVER_NOT_CONNECTED");
}

/// 고른 배경의 Blob URL을 돌려준다. 배경 레코드가 없으면 null이다.
export function loadWallpaperUrl(store: ShellStore, context: string, wallpaper: DesktopWallpaper): Promise<string | null> {
  ensureContext(context);
  const key = `${wallpaper.asset.id}\0${wallpaper.asset.version}`;
  let request = pending.get(key);
  if (!request) {
    request = fetchWallpaper(store, wallpaper).then((url) => {
      if (url && cacheContext === context) urls.set(key, url);
      else if (url) URL.revokeObjectURL(url);
      return url;
    });
    pending.set(key, request);
    const started = request;
    void request.catch(() => { if (pending.get(key) === started) pending.delete(key); });
  }
  return request;
}

export function WallpaperLayer({ store, activeDesktopId, onError }: {
  store: ShellStore;
  activeDesktopId?: string;
  onError: (error: CoreError) => void;
}) {
  const wallpaper = useShellSelector(store, (snapshot) =>
    activeDesktopId ? snapshot?.shared.desktop_wallpapers?.find((item) => item.desktop_id === activeDesktopId) : undefined);
  const context = useShellSelector(store, (snapshot) => snapshot ? serverContext(snapshot.link) : "");
  // serverContext는 연결 전(offline)과 연결 뒤(connected)가 같다. 연결이 끝나면 다시 읽도록 상태를 따로 구독한다.
  const linkState = useShellSelector(store, (snapshot) => snapshot?.link.state);
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const generation = useRef(0);

  useEffect(() => () => releaseWallpaperCache(), []);

  useEffect(() => {
    const current = ++generation.current;
    // 다른 데스크톱으로 옮기면 이전 그림을 즉시 걷고 캐시나 기본 그림으로 바뀐다.
    if (!wallpaper || !context) {
      setShown(null);
      return;
    }
    const key = `${context}|${wallpaper.asset.id}|${wallpaper.asset.version}`;
    setShown((previous) => previous?.key === key ? previous : null);
    void loadWallpaperUrl(store, context, wallpaper).then((url) => {
      if (current !== generation.current) return;
      setShown(url ? { key, url } : null);
    }, (cause: unknown) => {
      if (current !== generation.current) return;
      setShown(null);
      const error = toCoreError(cause);
      // 연결 전 실패는 기본 배경을 두고 연결되면 이 effect가 다시 읽는다. 알리지 않는다.
      if (isAwaitingLinkReadFailure(error, linkState)) return;
      onError(error);
    });
    return () => { generation.current += 1; };
  }, [store, context, wallpaper, onError, linkState]);

  if (!shown) return null;
  return <div aria-hidden="true" className="ks-wallpaper-layer" style={{ backgroundImage: `url("${shown.url}")` }} />;
}
