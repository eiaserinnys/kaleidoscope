/// <reference path="../iife.d.ts" />
import bridgeSource from "./html-bridge/main.ts?iife";
import { sourceHash } from "./html-bridge/identity";

const tokenNames = ["--ks-color-accent", "--ks-color-accent-contrast", "--ks-color-selection", "--ks-color-text", "--ks-color-focus", "--ks-color-scroll-thumb", "--ks-color-warning", "--ks-type-meta", "--ks-line-body", "--ks-font-family", "--ks-space-1", "--ks-space-2", "--ks-space-4", "--ks-space-5", "--ks-line-width", "--ks-focus-width", "--ks-focus-offset", "--ks-radius-small", "--ks-radius-large"];

export function htmlViewTokens(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(tokenNames.map((name) => [name, styles.getPropertyValue(name)]));
}

export function sanitizeHtml(root: Document | DocumentFragment): void {
  root.querySelectorAll("script, iframe, frame, object, embed, base, meta[http-equiv]").forEach((element) => element.remove());
  root.querySelectorAll("*").forEach((element) => {
    const srcHash = sourceHash(element.getAttribute("src"));
    const href = element.getAttribute("href");
    if (srcHash) element.setAttribute("data-ks-src-hash", srcHash);
    if (href) element.setAttribute("data-ks-href", href);
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
      if (name.startsWith("on") || (["href", "src", "action", "formaction", "xlink:href"].includes(name) && /^(?:javascript:|https?:|\/\/)/.test(value))) element.removeAttribute(attr.name);
    }
    if (element instanceof HTMLTemplateElement) sanitizeHtml(element.content);
  });
}

export function sanitizeFragment(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeHtml(template.content);
  return template.innerHTML;
}

export function htmlViewSource(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeHtml(doc);
  const nonce = crypto.randomUUID();
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.content = `default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'nonce-${nonce}'; connect-src 'none'; form-action 'none';`;
  csp.dataset.ksInjected = "";
  const style = doc.createElement("style");
  style.dataset.ksInjected = "";
  const tokens = htmlViewTokens();
  style.textContent = `:root{${Object.entries(tokens).map(([name, value]) => `${name}:${value};`).join("")}}` +
    "*::-webkit-scrollbar{width:var(--ks-space-2);height:var(--ks-space-2)}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:var(--ks-color-scroll-thumb);border-radius:var(--ks-radius-large);border:calc(var(--ks-line-width) * 2) solid transparent;background-clip:padding-box}*::-webkit-scrollbar-button{display:none}*:focus-visible{outline:var(--ks-focus-width) solid var(--ks-color-focus);outline-offset:var(--ks-focus-offset)}" +
    "::highlight(ks-comment){background-color:color-mix(in srgb,color-mix(in srgb,var(--ks-color-accent),var(--ks-color-accent-contrast)) 40%,transparent);text-decoration:underline solid var(--ks-color-accent) var(--ks-focus-width)}" +
    "::highlight(ks-comment-active),::highlight(ks-pending){background-color:color-mix(in srgb,color-mix(in srgb,var(--ks-color-accent),var(--ks-color-accent-contrast)) 72%,transparent);text-decoration:underline solid var(--ks-color-accent) var(--ks-focus-width)}";
  const script = doc.createElement("script");
  script.dataset.ksInjected = "";
  script.setAttribute("nonce", nonce);
  const bytes = new TextEncoder().encode(bridgeSource);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  script.src = `data:text/javascript;base64,${btoa(binary)}`;
  doc.head.prepend(csp, style, script);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
