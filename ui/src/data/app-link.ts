import * as errors from "../contract/shell-errors";

function isPrivateIpv4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function isPrivateIpv6(address: string): boolean {
  // URL이 정규화한 16진 주소를 16비트 묶음 여덟 개로 편다.
  const [head, tail] = address.split("::");
  const left = head ? head.split(":").map((word) => parseInt(word, 16)) : [];
  const right = tail ? tail.split(":").map((word) => parseInt(word, 16)) : [];
  const words = tail === undefined ? left : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isPrivateIpv4([words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff]);
  }
  return words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80;
}

export function checkAppLink(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw errors.SHELL_APP_LINK_INVALID(); }
  if (parsed.protocol !== "https:") throw errors.SHELL_APP_LINK_NOT_HTTPS();
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  if (host === "localhost" || host.endsWith(".localhost") ||
    (ipv4 && isPrivateIpv4(ipv4)) ||
    (host.startsWith("[") && isPrivateIpv6(host.slice(1, -1)))) throw errors.SHELL_APP_LINK_PRIVATE_HOST();
  return parsed.href;
}
