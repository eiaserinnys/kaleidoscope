import { useState } from "react";
import type { BindingValue } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { useWindowData } from "../data/window-data";
import { useWindowGrants } from "../data/window-state";
import { DataIcon } from "./data-icons";
import { FolderOpen } from "./icons";
import { Button, EmptyState } from "./primitives";

export function DataState({ value, compact = false, onRetry, onLogin }: { value: Exclude<BindingValue, { status: "ready" }>; compact?: boolean; onRetry?: () => void; onLogin?: () => void }) {
  const data = useWindowData();
  const context = { store: data.store, window: { id: data.windowId } };
  const [error, setError] = useState<string | null>(null);
  const grants = useWindowGrants(context);
  const possiblePermissions = value.status === "failed"
    ? value.retry.map((name) => data.definition.sources?.[name])
      .flatMap((source) => source && (source.kind === "file" || source.kind === "folder") ? [source.permission] : [])
    : [];
  const ungranted = possiblePermissions.find((permission) => !grants.some((grant) => grant.permission === permission));
  if (value.status === "loading") return <div className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div>;
  const isLogin = value.status === "login_required";
  // 기기 폴더 원천(file, folder)이 아직 폴더를 고르지 않아 실패했으면 다시 받기 대신 폴더 고르기를 보인다.
  // 폴더 원천만 쓰는 블록에는 파일 트리처럼 폴더를 고를 다른 자리가 없다.
  if (ungranted !== undefined && value.status === "failed") {
    const retry = value.retry;
    const pick = () => {
      setError(null);
      void data.store.call({ op: "files.pick_folder", window_id: data.windowId, permission: ungranted })
        .then((reply) => { if (reply.grant) void data.refresh(retry); })
        .catch((reason: unknown) => setError(toCoreError(reason).message));
    };
    return <div className={compact ? "ks-data-state-compact" : "ks-data-state"}>
      <EmptyState icon={<FolderOpen size={compact ? "inline" : "empty"} />} text={error ?? "폴더를 선택해 주세요"} action={<Button onClick={pick}>폴더 선택</Button>} />
    </div>;
  }
  return <div className={compact ? "ks-data-state-compact" : "ks-data-state"}>
    <EmptyState icon={<DataIcon name={isLogin ? "log-in" : "triangle-alert"} size={compact ? "inline" : "empty"} />}
      text={error ?? (isLogin ? "로그인이 필요합니다" : value.message)}
      action={isLogin
        ? <Button onClick={() => { setError(null); void data.store.call({ op: "connection.login", window_id: data.windowId, permission: value.permission }).then(() => onLogin?.()).catch((reason: unknown) => setError(toCoreError(reason).message)); }}>로그인</Button>
        : onRetry ? <Button onClick={onRetry}>다시 받기</Button> : value.retry.length ? <Button onClick={() => { void data.refresh(value.retry); }}>다시 받기</Button> : undefined} />
  </div>;
}
