import { useEffect, useId, useRef, useState } from "react";
import { Button, ErrorId, ErrorNotice, IconButton, Notice, TextInput, SettingsRow, SHELL_SERVER_PAIRING_CODE_COPY_FAILED, type CoreReply, type CoreRequest, type ShellSnapshot, type ShellStore, type TransferResult } from "@kaleidoscope/ui";
import { Check, Copy, LoaderCircle } from "../../../ui/src/components/icons";
import { serverLabel } from "./server-label";
import { AccountSettings } from "./account-settings";
import { WallpaperSettings } from "./wallpaper-settings";

type Entry = { kind: "gear" | "server" | "agent"; sequence: number };

function Progress() {
  return <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span>;
}

export function ShellSettings({ snapshot, entry, call, store }: {
  snapshot: ShellSnapshot; entry: Entry;
  call: (request: CoreRequest) => Promise<CoreReply | undefined>;
  store: ShellStore;
}) {
  const root = useRef<HTMLElement>(null);
  const serverEntry = useRef<HTMLElement>(null);
  const id = useId();
  const link = snapshot.link;
  const revokedUrl = link.state === "revoked" ? link.server_url : null;
  const [url, setUrl] = useState(revokedUrl ?? "");
  const [localTransfer, setTransfer] = useState<TransferResult | null>(null);
  const [busy, setBusy] = useState<CoreRequest["op"] | null>(null);
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCopyTimer = () => { if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = null; };
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const transfer = localTransfer ?? snapshot.last_transfer;
  useEffect(() => { if (revokedUrl !== null) setUrl(revokedUrl); }, [revokedUrl]);
  useEffect(() => {
    if (entry.kind === "server") {
      serverEntry.current?.scrollIntoView?.({ block: "nearest" });
      serverEntry.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
    } else if (entry.kind === "agent") {
      const agent = root.current?.querySelector<HTMLElement>("[data-settings-agent]");
      agent?.scrollIntoView?.({ block: "nearest" });
      agent?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    } else root.current?.closest<HTMLElement>(".ks-window-content")?.focus();
  }, [entry]);
  useEffect(() => {
    if (!busy && document.activeElement === document.body) {
      serverEntry.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
    }
  }, [link.state, busy]);

  const run = async (request: CoreRequest) => {
    setBusy(request.op); clearCopyTimer(); setCopyResult(null); setTransfer(null);
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

  return <section className="ks-shell-settings ks-app-settings-scroll" data-ks-share-skip aria-label="설정" ref={root}>
    <div className="ks-shell-settings-body">
      <section className="ks-settings-group" aria-labelledby={`${id}-pc`} ref={serverEntry}>
        <h3 className="ks-data-section-title" id={`${id}-pc`}>이 PC</h3>
        <SettingsRow label={<>
          <span aria-hidden="true" className={`shell-server-dot is-${link.state}`} /><span>{link.state === "pairing" ? <>페어링 코드 <span className="ks-pairing-code">{link.user_code}</span></> : status}</span>
          {link.state === "offline" && link.mode === "embedded" && !link.reason ? <LoaderCircle size="inline" className="ks-settings-apply-spinner" /> : null}
          {link.state === "pairing" ? <IconButton aria-label="코드 복사" title="코드 복사" disabled={busy !== null} onClick={async () => {
            try {
              await navigator.clipboard.writeText(link.user_code);
              clearCopyTimer(); setCopyResult("copied");
              copyTimer.current = setTimeout(() => { copyTimer.current = null; setCopyResult((current) => current === "copied" ? null : current); }, 1500);
            } catch { clearCopyTimer(); setCopyResult("failed"); }
          }}>{copyResult === "copied" ? <Check /> : <Copy />}</IconButton> : null}
          {link.state === "pairing" ? <span aria-live="polite" className="ks-accessible-hidden" role="status">{copyResult === "copied" ? "복사했습니다" : ""}</span> : null}
        </>} meta={<div className="shell-server-meta-group">
          {meta.map((item) => <span key={item} className="shell-server-meta">{item}</span>)}
          {link.state === "offline" && link.reason ? <span className="shell-server-meta">{link.reason.message} {link.reason.id ? <ErrorId id={link.reason.id} /> : null}</span> : null}
        </div>} control={showSwitch ? <Button aria-label={switchLabel} aria-busy={busy === switchOp || undefined} className={busy === switchOp ? "is-progress" : undefined} disabled={busy !== null} onClick={() => void run({ op: switchOp })}><span>{switchLabel}</span>{busy === switchOp ? <Progress /> : null}</Button> : null} />
        {copyResult === "failed" ? <ErrorNotice error={SHELL_SERVER_PAIRING_CODE_COPY_FAILED()} /> : null}
        {remote && snapshot.embedded_available ? <SettingsRow label="내 PC 앱과 데이터" control={<Button aria-label="가져오기" aria-busy={busy === "link.sync_local_to_remote" || undefined} className={busy === "link.sync_local_to_remote" ? "is-progress" : undefined} disabled={busy !== null || link.state !== "connected"} onClick={() => void run({ op: "link.sync_local_to_remote" })}><span>가져오기</span>{busy === "link.sync_local_to_remote" ? <Progress /> : null}</Button>} /> : null}
        {snapshot.transfer_error ? <Notice role="alert">{snapshot.transfer_error}</Notice> : null}
        {remote && transfer && !snapshot.transfer_error ? <Notice role="status">가져오기 완료 {transfer.imported}개{transfer.skipped.length > 0 ? <details className="shell-server-skipped"><summary>건너뜀 {transfer.skipped.length}개</summary><div className="shell-server-skipped-list">{transfer.skipped.map((item) => <div key={item}>{item}</div>)}</div></details> : null}</Notice> : null}
        {showAddress ? <div className="ks-settings-entry">
          <div className="ks-settings-label-row"><label htmlFor={`${id}-url`}>원격 서버 주소</label></div>
          <div className="ks-settings-control"><div className="ks-settings-inline">
            <TextInput id={`${id}-url`} type="url" placeholder="https://server.example" persistent commitOnBlur={false} value={url} onEdit={setUrl} onCommit={startRemote} onCancel={() => setUrl("")} disabled={busy !== null} />
            <Button aria-label="연결" aria-busy={busy === "link.start" || undefined} className={busy === "link.start" ? "is-progress" : undefined} disabled={busy !== null || !url.trim()} onClick={() => startRemote(url)}><span>연결</span>{busy === "link.start" ? <Progress /> : null}</Button>
          </div></div>
        </div> : null}
      </section>
      <WallpaperSettings snapshot={snapshot} store={store} />
      <AccountSettings store={store} />
    </div>
  </section>;
}
