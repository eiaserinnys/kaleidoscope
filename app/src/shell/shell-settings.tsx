import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Button, ErrorId, ErrorNotice, IconButton, Notice, StatusText, TextInput, SHELL_SERVER_PAIRING_CODE_COPY_FAILED, type CoreReply, type CoreRequest, type ShellSnapshot, type TransferResult } from "@kaleidoscope/ui";
import { Copy, LoaderCircle } from "../../../ui/src/components/icons";
import { serverLabel } from "./server-label";

type Entry = { kind: "gear" | "server"; sequence: number };

function Progress() {
  return <span className="ks-settings-apply-progress" role="status" aria-label="처리 중"><LoaderCircle size="inline" className="ks-settings-apply-spinner" /></span>;
}

export function ShellSettings({ snapshot, entry, onClose, call }: {
  snapshot: ShellSnapshot; entry: Entry; onClose: () => void;
  call: (request: CoreRequest) => Promise<CoreReply | undefined>;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const serverEntry = useRef<HTMLElement>(null);
  const id = useId();
  const link = snapshot.link;
  const revokedUrl = link.state === "revoked" ? link.server_url : null;
  const [url, setUrl] = useState(revokedUrl ?? "");
  const [localTransfer, setTransfer] = useState<TransferResult | null>(null);
  const [busy, setBusy] = useState<CoreRequest["op"] | null>(null);
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const transfer = localTransfer ?? snapshot.last_transfer;
  useEffect(() => { if (revokedUrl !== null) setUrl(revokedUrl); }, [revokedUrl]);
  useEffect(() => {
    if (entry.kind === "server") {
      serverEntry.current?.scrollIntoView?.({ block: "nearest" });
      serverEntry.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
    } else title.current?.focus();
  }, [entry]);
  useEffect(() => {
    if (!busy && document.activeElement === document.body) {
      serverEntry.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
    }
  }, [link.state, busy]);

  const run = async (request: CoreRequest) => {
    setBusy(request.op); setCopyResult(null); setTransfer(null);
    try {
      const reply = await call(request);
      if (reply?.op === "link.sync_local_to_remote") setTransfer(reply.result);
    } finally { setBusy(null); }
  };
  const startRemote = (next: string) => {
    setUrl(next);
    const target = next.trim();
    if (target) void run({ op: "link.start", server_url: target });
  };
  const remote = (link.state === "connected" || link.state === "offline") && link.mode === "remote";
  const meta = link.state === "connected" || link.state === "offline" ? [link.server_url, link.device_name] : link.state === "pairing" || link.state === "revoked" ? [link.server_url] : [];
  const showAddress = !remote && link.state !== "pairing";
  const showSwitch = remote || link.state === "revoked" || link.state === "pairing";
  const switchOp = snapshot.embedded_available ? "link.use_local" : link.state === "pairing" ? "link.cancel" : "link.unlink";
  const switchLabel = snapshot.embedded_available ? link.state === "pairing" ? "내 PC 서버로 돌아가기" : "내 PC 서버로 전환" : link.state === "pairing" ? "연결 취소" : "연결 끊기";
  const status = remote && link.state === "connected" ? "원격 서버" : serverLabel(snapshot);

  return <section className="ks-app-settings ks-shell-settings" data-ks-share-skip aria-labelledby={`${id}-title`} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="ks-data-toolbar"><IconButton aria-label="작업 화면으로 돌아가기" onClick={onClose}><ArrowLeft /></IconButton><h2 ref={title} id={`${id}-title`} tabIndex={-1}>설정</h2></header>
    <div className="ks-app-settings-scroll"><div className="ks-shell-settings-body">
      <section className="ks-settings-group" aria-labelledby={`${id}-pc`} ref={serverEntry}>
        <h3 className="ks-data-section-title" id={`${id}-pc`}>이 PC</h3>
        <div className="ks-settings-entry">
          <div className="ks-settings-label-row"><span>서버 연결</span>{copyResult === "copied" ? <StatusText>코드 복사됨</StatusText> : null}</div>
          <div className="ks-settings-control ks-settings-stack">
            <div className="shell-server-meta-group">
              <div className="ks-settings-value">
                <span aria-hidden="true" className={`shell-server-dot is-${link.state}`} /><span>{link.state === "pairing" ? <>페어링 코드 <span className="ks-pairing-code">{link.user_code}</span></> : status}</span>
                {link.state === "offline" && link.mode === "embedded" && !link.reason ? <LoaderCircle size="inline" className="ks-settings-apply-spinner" /> : null}
                {link.state === "pairing" ? <IconButton aria-label="코드 복사" title="코드 복사" disabled={busy !== null} onClick={async () => {
                  try { await navigator.clipboard.writeText(link.user_code); setCopyResult("copied"); }
                  catch { setCopyResult("failed"); }
                }}><Copy /></IconButton> : null}
              </div>
              {meta.map((item) => <span key={item} className="shell-server-meta">{item}</span>)}
              {link.state === "offline" && link.reason ? <span className="shell-server-meta">{link.reason.message} {link.reason.id ? <ErrorId id={link.reason.id} /> : null}</span> : null}
            </div>
            {(remote && snapshot.embedded_available) || showSwitch ? <div className="ks-settings-actions">
              {remote && snapshot.embedded_available ? <Button disabled={busy !== null || link.state !== "connected"} onClick={() => void run({ op: "link.sync_local_to_remote" })}>{busy === "link.sync_local_to_remote" ? <Progress /> : null}내 PC 앱과 데이터 가져오기</Button> : null}
              {showSwitch ? <Button disabled={busy !== null} onClick={() => void run({ op: switchOp })}>{busy === switchOp ? <Progress /> : null}{switchLabel}</Button> : null}
            </div> : null}
          </div>
          {copyResult === "failed" ? <ErrorNotice error={SHELL_SERVER_PAIRING_CODE_COPY_FAILED()} /> : null}
          {snapshot.transfer_error ? <Notice role="alert">{snapshot.transfer_error}</Notice> : null}
          {remote && transfer ? <Notice role="status">가져오기 완료 {transfer.imported}개{transfer.skipped.length > 0 ? <details className="shell-server-skipped"><summary>건너뜀 {transfer.skipped.length}개</summary><div className="shell-server-skipped-list">{transfer.skipped.map((item) => <div key={item}>{item}</div>)}</div></details> : null}</Notice> : null}
        </div>
        {showAddress ? <div className="ks-settings-entry">
          <div className="ks-settings-label-row"><label htmlFor={`${id}-url`}>원격 서버 주소</label></div>
          <div className="ks-settings-control"><div className="ks-settings-inline">
            <TextInput id={`${id}-url`} type="url" placeholder="https://server.example" persistent commitOnBlur={false} value={url} onEdit={setUrl} onCommit={startRemote} onCancel={() => setUrl("")} disabled={busy !== null} />
            <Button disabled={busy !== null || !url.trim()} onClick={() => startRemote(url)}>{busy === "link.start" ? <Progress /> : null}연결</Button>
          </div></div>
        </div> : null}
      </section>
      <section className="ks-settings-group" aria-labelledby={`${id}-account`}>
        <h3 className="ks-data-section-title" id={`${id}-account`}>계정</h3>
        <div className="ks-settings-entry"><div className="ks-settings-label-row"><span>기본 에이전트</span></div></div>
      </section>
    </div></div>
  </section>;
}
