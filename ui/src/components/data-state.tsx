import { useState } from "react";
import type { BindingValue } from "../contract/contract";
import { toCoreError } from "../core/core-transport";
import { useWindowData } from "../data/window-data";
import { useWindowGrants } from "../data/window-state";
import { DataIcon } from "./data-icons";
import { FileGrant } from "../blocks/file-grant";
import { Button, EmptyState, ErrorId, Notice } from "./primitives";

export function useFolderPick() {
  const data = useWindowData();
  const [error, setError] = useState<ReturnType<typeof toCoreError> | null>(null);
  const pick = (permission: string, onPicked: () => void) => {
    setError(null);
    void data.store.call({ op: "files.pick_folder", window_id: data.windowId, permission })
      .then((reply) => { if (reply.grant) onPicked(); })
      .catch((reason: unknown) => setError(toCoreError(reason)));
  };
  return { error, pick, clear: () => setError(null) };
}

const messageBindingErrorIds = new Set([
  "SHELL_MESSAGE_ITEM_KEY_MISSING",
  "SHELL_MESSAGE_ITEM_KEY_NOT_STRING",
  "SHELL_MESSAGE_KEY_NOT_FOUND",
]);

export function isMessageBindingFailure(value: BindingValue): value is Extract<BindingValue, { status: "failed" }> & { id: string } {
  return value.status === "failed" && value.id !== undefined && messageBindingErrorIds.has(value.id);
}

export function BindingFailureNotice({ value, rootProps }: { value: BindingValue; rootProps?: import("../comments/block-root").BlockRootProps }) {
  if (!isMessageBindingFailure(value)) return null;
  return <Notice rootProps={rootProps} role="alert" errorId={value.id}>{value.message}</Notice>;
}

export function DataState({ value, compact = false, layout, loginFailure, onRetry, onLogin, rootProps }: { value: Exclude<BindingValue, { status: "ready" }>; compact?: boolean; layout?: "row"; loginFailure?: { message: string; id?: string }; onRetry?: () => void; onLogin?: () => void; rootProps?: import("../comments/block-root").BlockRootProps }) {
  const data = useWindowData();
  const context = { store: data.store, window: { id: data.windowId } };
  const [loginError, setLoginError] = useState<ReturnType<typeof toCoreError> | null>(null);
  const grants = useWindowGrants(context);
  const possiblePermissions = value.status === "failed"
    ? value.retry.map((name) => data.definition.sources?.[name])
      .flatMap((source) => source && (source.kind === "file" || source.kind === "folder") ? [source.permission] : [])
    : [];
  const ungranted = possiblePermissions.find((permission) => !grants.some((grant) => grant.permission === permission));
  if (value.status === "loading") return <div {...rootProps} className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div>;
  const isLogin = value.status === "login_required";
  // 기기 폴더 원천(file, folder)이 아직 폴더를 고르지 않아 실패했으면 다시 받기 대신 폴더 고르기를 보인다.
  // 폴더 원천만 쓰는 블록에는 파일 트리처럼 폴더를 고를 다른 자리가 없다.
  if (ungranted !== undefined && value.status === "failed" && value.id === "FILE_ACCESS_FOLDER_NOT_CHOSEN") {
    const retry = value.retry;
    return <div {...rootProps} className={compact ? "ks-data-state-compact" : "ks-data-state"} data-layout={layout}>
      <FileGrant context={{ ...context, definition: data.definition }} permission={ungranted} compact={compact} contentsOnly onGranted={() => void data.refresh(retry)} />
    </div>;
  }
  const failureText = loginError ? <>{loginError.message}{loginError.id ? <> <ErrorId id={loginError.id} /></> : null}</> : value.status === "failed" ? <>{value.message}{value.id ? <> <ErrorId id={value.id} /></> : null}</> : loginFailure ? <>{loginFailure.message}{loginFailure.id ? <> <ErrorId id={loginFailure.id} /></> : null}</> : "로그인이 필요합니다";
  return <div {...rootProps} className={compact ? "ks-data-state-compact" : "ks-data-state"} data-layout={layout}>
    <EmptyState icon={<DataIcon name={isLogin ? "log-in" : "triangle-alert"} size={compact ? "inline" : "empty"} />}
      text={failureText}
      action={isLogin
        ? <Button data-ks-user-consent onClick={(event) => { if (!event.nativeEvent.isTrusted) return; setLoginError(null); void data.store.call({ op: "connection.login", window_id: data.windowId, permission: value.permission }).then(() => onLogin?.()).catch((reason: unknown) => setLoginError(toCoreError(reason))); }}>로그인</Button>
        : onRetry ? <Button onClick={onRetry}>다시 받기</Button> : value.retry.length ? <Button onClick={() => { void data.refresh(value.retry); }}>다시 받기</Button> : undefined} />
  </div>;
}
