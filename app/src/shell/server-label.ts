import type { ShellSnapshot } from "@kaleidoscope/ui";

export function serverLabel(snapshot: ShellSnapshot): string {
  const link = snapshot.link;
  if (link.state === "connected") return link.mode === "embedded" ? "내 PC 서버" : `원격 서버 (${new URL(link.server_url).host})`;
  if (link.state === "pairing") return `페어링 코드 ${link.user_code}`;
  if (link.state === "offline") return link.mode === "embedded" ? "내 PC 서버 연결 중" : "원격 오프라인";
  if (link.state === "revoked") return "원격 연결 거부됨";
  return "연결 해제됨";
}
