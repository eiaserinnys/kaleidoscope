import type { ReactNode } from "react";
import { useOptionalWindowData } from "../data/window-data";
import { toCoreError } from "../core/core-transport";
import { openContextMenu, writeMenuClipboard } from "./context-menu";

function externalUrl(href: string | undefined): URL | null {
  if (!href) return null;
  try { const url = new URL(href); return url.protocol === "http:" || url.protocol === "https:" ? url : null; } catch { return null; }
}

/** 바깥 주소를 여는 링크. 마크다운 본문과 알림 글처럼 주소를 그대로 보여 주는 자리가 함께 쓴다. */
export function ExternalLink({ href, children }: { href?: string; children: ReactNode }) {
  const data = useOptionalWindowData();
  const openLink = (url: URL) => {
    if (data) void data.store.call({ op: "external.open", window_id: data.windowId, url: url.href }).catch((error: unknown) => data.setNotice(toCoreError(error)));
    else globalThis.window.open(url.href, "_blank", "noopener,noreferrer");
  };
  return <a href={href} onContextMenu={(event) => {
    const url = externalUrl(href);
    openContextMenu(event, [
      ...(url ? [{ id: "link-open", label: "링크 열기", onSelect: () => openLink(url) }] : []),
      ...(href ? [{ id: "link-copy", label: "링크 주소 복사", onSelect: () => { void writeMenuClipboard(href, "링크 주소 복사"); } }] : []),
    ]);
  }} onClick={(event) => {
    event.preventDefault();
    const url = externalUrl(href);
    if (url) openLink(url);
  }}>{children}</a>;
}

// 주소로 볼 수 있는 글자만 이어 붙인다. 공백과 한글에서 끊긴다.
const URL_IN_TEXT = /https?:\/\/[\x21-\x7E]+/g;
// 주소 뒤에 붙은 문장부호와 닫는 괄호는 링크 밖에 둔다.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** 글 속의 http(s) 주소만 골라 링크로 그리고 나머지 글자는 그대로 둔다. */
export function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const raw = match[0];
    const address = raw.replace(TRAILING_PUNCTUATION, "");
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    if (externalUrl(address)) {
      parts.push(<ExternalLink key={start} href={address}>{address}</ExternalLink>);
      if (address.length < raw.length) parts.push(raw.slice(address.length));
    } else parts.push(raw);
    last = start + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
