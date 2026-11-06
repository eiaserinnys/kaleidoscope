/** A frame block can contain toolbars; only its actual surface is a point target. */
export function frameSurfaces(block: HTMLElement, type: string): HTMLElement[] {
  if (type === "canvas") return [block];
  const selector = type === "web_view" ? ".ks-web-surface" : type === "sandbox" || type === "html_view" ? "iframe" : "";
  return selector ? [...block.querySelectorAll<HTMLElement>(selector)] : [];
}
