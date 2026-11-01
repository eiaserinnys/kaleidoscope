import { useEffect, useRef, useState } from "react";
import { Button, Notice, TextInput, type CoreReply, type CoreRequest, type ShellSnapshot, type TransferResult } from "@kaleidoscope/ui";

export function serverLabel(snapshot: ShellSnapshot): string {
  const link = snapshot.link;
  if (link.state === "connected") return link.mode === "embedded" ? "내 PC 서버" : `원격 서버 (${new URL(link.server_url).host})`;
  if (link.state === "pairing") return `페어링 코드 ${link.user_code}`;
  if (link.state === "offline") return link.mode === "embedded" ? "내 PC 서버 연결 중" : "원격 오프라인";
  return "연결 해제됨";
}

export function ServerPanel({ snapshot, anchor, onClose, call }: {
  snapshot: ShellSnapshot; anchor: HTMLElement; onClose: () => void;
  call: (request: CoreRequest) => Promise<CoreReply | undefined>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const link = snapshot.link;
  const revokedUrl = link.state === "revoked" ? link.server_url : null;
  const [url, setUrl] = useState(revokedUrl ?? "");
  useEffect(() => { if (revokedUrl !== null) setUrl(revokedUrl); }, [revokedUrl]);
  const [localTransfer, setTransfer] = useState<TransferResult | null>(null);
  const transfer = localTransfer ?? snapshot.last_transfer;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const outside = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); anchor.focus(); };
  }, [anchor, onClose]);
  const run = async (request: CoreRequest) => {
    setBusy(true); setResult(null); setTransfer(null);
    try {
      const reply = await call(request);
      if (reply?.op === "link.sync_local_to_remote") {
        setTransfer(reply.result);
      }
    } finally { setBusy(false); }
  };
  const remote = (link.state === "connected" || link.state === "offline") && link.mode === "remote";
  const title = link.state === "pairing" ? "페어링 코드"
    : link.state === "revoked" ? "원격 연결 거부됨"
    : link.state === "unlinked" ? "서버 연결"
    : remote ? "원격 서버" : "내 PC 내장 서버";
  const trimmedUrl = url.trim();
  const startRemote = (next: string) => {
    setUrl(next);
    const target = next.trim();
    if (!target) return;
    void run({ op: "link.start", server_url: target });
  };
  return <div ref={panel} className="shell-link-panel ks-menu" role="dialog" aria-label="서버 연결" data-ks-overlay>
    <div className="shell-server-heading">{title}</div>
    {link.state === "pairing" ? <>
      <Button disabled={busy} onClick={() => void navigator.clipboard.writeText(link.user_code).then(() => setResult("코드 복사됨"), () => setResult("코드 복사 실패"))}>{link.user_code} 복사</Button>
      <div className="shell-server-meta-group"><span className="shell-server-meta">{link.server_url}</span></div>
    </> : remote ? <>
      <div className="shell-server-meta-group">
        <span className="shell-server-meta">{link.server_url}</span>
        <span className="shell-server-meta">{link.device_name}</span>
        {link.state === "offline" && <span className="shell-server-meta">{link.reason}</span>}
      </div>
      {snapshot.embedded_available && <Button disabled={busy || link.state !== "connected"} onClick={() => void run({ op: "link.sync_local_to_remote" })}>내 PC 앱과 데이터 가져오기</Button>}
    </> : <>
      {link.state === "offline" && <div className="shell-server-meta-group"><span className="shell-server-meta">{link.reason}</span></div>}
      <TextInput aria-label="원격 서버 URL" type="url" placeholder="https://server.example" persistent commitOnBlur={false} value={url} onEdit={setUrl} onCommit={startRemote} onCancel={() => setUrl("")} disabled={busy} />
      <Button disabled={busy || !trimmedUrl} onClick={() => startRemote(url)}>원격 서버 연결</Button>
    </>}
    {(remote || link.state === "revoked" || link.state === "pairing") && <Button disabled={busy} onClick={() => void run({ op: snapshot.embedded_available ? "link.use_local" : link.state === "pairing" ? "link.cancel" : "link.unlink" })}>{snapshot.embedded_available ? link.state === "pairing" ? "내 PC 서버로 돌아가기" : "내 PC 서버로 전환" : link.state === "pairing" ? "연결 취소" : "연결 끊기"}</Button>}
    {snapshot.transfer_error && <Notice role="alert">{snapshot.transfer_error}</Notice>}
    {remote && transfer && <Notice role="status">가져오기 완료 {transfer.imported}개{transfer.skipped.length > 0 && <details className="shell-server-skipped"><summary>건너뜀 {transfer.skipped.length}개</summary><div className="shell-server-skipped-list">{transfer.skipped.map((item) => <div key={item}>{item}</div>)}</div></details>}</Notice>}
    {busy && <span role="status" className="shell-server-meta">처리 중</span>}
    {result && <Notice role="status">{result}</Notice>}
  </div>;
}
