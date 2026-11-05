import { memo, useEffect, useState } from "react";
import { useShellSelector, type ShellStore } from "../core/shell-store";
import { ICON_SIZE, LayoutGrid, type IconSize } from "./icons";

type IconImageData = { url: string; mask: boolean };

// SVG는 분류에만 파싱한다. 화면에는 원문을 삽입하지 않는다.
export function svgUsesCurrentColor(svg: string): boolean {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror, style, linearGradient, radialGradient, pattern, image")) return false;
  let current = false;
  let fixed = false;
  const shapes = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "use"]);
  const walk = (element: Element, inherited: { fill: string; stroke: string }) => {
    const values = { ...inherited };
    for (const property of ["fill", "stroke"] as const) {
      const attribute = element.getAttribute(property);
      if (attribute && attribute.trim().toLowerCase() !== "inherit") values[property] = attribute.trim().toLowerCase();
    }
    for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
      const [name, value] = declaration.split(":").map((part) => part.trim().toLowerCase());
      if ((name === "fill" || name === "stroke") && value && value !== "inherit") values[name] = value;
    }
    if (shapes.has(element.localName)) {
      const paints = element.localName === "line" ? [values.stroke] : [values.fill, values.stroke];
      for (const paint of paints) {
        if (paint === "currentcolor") current = true;
        else if (paint !== "none") fixed = true;
      }
    }
    for (const child of element.children) walk(child, values);
  };
  walk(root, { fill: "black", stroke: "none" });
  return current && !fixed;
}

export function iconImageFromData(mime: string, base64: string): IconImageData {
  const url = `data:${mime};base64,${base64}`;
  if (mime !== "image/svg+xml") return { url, mask: false };
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return { url, mask: svgUsesCurrentColor(new TextDecoder().decode(bytes)) };
}

export const IconImage = memo(function IconImage({ image, size }: { image: IconImageData; size: IconSize }) {
  const dimensions = { width: ICON_SIZE[size], height: ICON_SIZE[size], flexShrink: 0 };
  if (image.mask) return <span aria-hidden="true" className="ks-app-icon" style={{ ...dimensions, display: "inline-block", backgroundColor: "currentColor", mask: `url("${image.url}") center / contain no-repeat` }} />;
  return <img alt="" aria-hidden="true" className="ks-app-icon" src={image.url} style={{ ...dimensions, objectFit: "contain" }} />;
});

function serverContext(link: NonNullable<ReturnType<ShellStore["getSnapshot"]>>["link"]): string {
  if (link.state === "unlinked") return "unlinked";
  return `${link.state === "connected" || link.state === "offline" ? "server" : link.state}:${link.server_url}`;
}

export const AppIcon = memo(function AppIcon({ store, appId, appVersion, size, placeholder = "default" }: {
  store: ShellStore; appId: string; appVersion: number; size: IconSize; placeholder?: "default" | "skeleton";
}) {
  const icon = useShellSelector(store, (snapshot) => snapshot?.shared.app_versions.find((item) => item.app_id === appId && item.version === appVersion)?.definition.icon);
  const context = useShellSelector(store, (snapshot) => snapshot ? serverContext(snapshot.link) : "");
  const key = icon ? JSON.stringify([context, icon.asset, icon.version]) : "";
  const [result, setResult] = useState<{ key: string; image: IconImageData | null }>({ key: "", image: null });
  useEffect(() => {
    if (!icon) return;
    let active = true;
    let request = store.iconCache.get(key);
    if (!request) {
      request = store.call({ op: "app.icon", app_id: appId, app_version: appVersion })
        .then((reply) => reply.media ? iconImageFromData(reply.media.mime, reply.media.data_base64) : null);
      store.iconCache.set(key, request);
      const cached = request;
      void request.catch(() => { if (store.iconCache.get(key) === cached) store.iconCache.delete(key); });
    }
    void request.then((image) => { if (active) setResult({ key, image }); }, () => { if (active) setResult({ key, image: null }); });
    return () => { active = false; };
  }, [store, key, appId, appVersion, icon]);
  if (placeholder === "skeleton" && icon && result.key !== key) return <i aria-hidden="true" className={`ks-icon-skeleton-icon${size === "chrome" ? " ks-icon-skeleton-chrome" : ""}`} style={{ width: ICON_SIZE[size], height: ICON_SIZE[size] }} />;
  return result.key === key && result.image ? <IconImage image={result.image} size={size} /> : <LayoutGrid className="ks-app-icon" size={size} />;
});
