import * as errors from "../contract/shell-errors";

export function checkAppLink(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw errors.SHELL_APP_LINK_INVALID(); }
  if (parsed.protocol !== "https:") throw errors.SHELL_APP_LINK_NOT_HTTPS();
  const host = parsed.hostname.toLowerCase();
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  const ipv6 = host.startsWith("[") ? host.slice(1, -1) : "";
  if (host === "localhost" || host.endsWith(".localhost") || (ipv4 && (
    ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 ||
    (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
    (ipv4[0] === 169 && ipv4[1] === 254) ||
    (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
    (ipv4[0] === 192 && ipv4[1] === 168)
  )) || ipv6 === "::1" || /^(fc|fd|fe[89ab])/.test(ipv6)) throw errors.SHELL_APP_LINK_PRIVATE_HOST();
  return parsed.href;
}
