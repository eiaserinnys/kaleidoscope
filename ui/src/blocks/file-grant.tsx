import { useCallback, useState, useSyncExternalStore } from "react";
import type { AppDefinition, CoreError } from "../contract/contract";
import { Button, EmptyState, ErrorId } from "../components/primitives";
import { FolderOpen } from "../components/icons";
import { toCoreError } from "../core/core-transport";
import type { ShellStore } from "../core/shell-store";
import { useOptionalWindowData } from "../data/window-data";
import { knownFolderNames } from "../data/default-folder";

export function FileGrant({ context, permission, rootProps, compact = false, onGranted, pickerLabel, contentsOnly = false }: { context: { store: ShellStore; window: { id: string }; definition: AppDefinition }; permission: string; rootProps?: import("../comments/block-root").BlockRootProps; compact?: boolean; onGranted?: () => void; pickerLabel?: string; contentsOnly?: boolean }) {
  const [error, setError] = useState<CoreError | null>(null);
  const data = useOptionalWindowData();
  const subscribe = useCallback((listener: () => void) => data?.defaultFolders.subscribe(permission, listener) ?? (() => {}), [data, permission]);
  const get = useCallback(() => data?.defaultFolders.get(permission), [data, permission]);
  const state = useSyncExternalStore(subscribe, get, get);
  const declaration = context.definition.permissions.find((item) => item.module === "files" && item.id === permission);
  const hasDefault = declaration?.module === "files" && Boolean(declaration.default_folder);
  if (hasDefault && !state) return <div {...rootProps} className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div>;
  const consent = state?.status === "consent_required" ? state : null;
  const name = consent ? knownFolderNames[consent.folder] : "";
  const text = error ? <>{error.message}{error.id ? <> <ErrorId id={error.id} /></> : null}</> : consent ? undefined : "폴더를 선택해 주세요";
  const pick = () => {
    setError(null);
    void context.store.call({ op: "files.pick_folder", window_id: context.window.id, permission })
      .then((reply) => { if (reply.grant) onGranted?.(); })
      .catch((reason: unknown) => setError(toCoreError(reason)));
  };
  const allow = () => {
    setError(null);
    void context.store.call({ op: "files.allow_default_folder", window_id: context.window.id, permission })
      .then((reply) => { data?.defaultFolders.set(permission, reply.result); if (reply.result.status === "ready") onGranted?.(); })
      .catch((reason: unknown) => setError(toCoreError(reason)));
  };
  const pickButton = <Button data-ks-user-consent onClick={(event) => { if (event.nativeEvent.isTrusted) pick(); }}>{consent ? "다른 폴더 선택" : pickerLabel ?? "폴더 선택"}</Button>;
  if (!consent && pickerLabel) return <div {...rootProps} className="ks-file-tree-ungranted">{pickButton}{error ? <span className="ks-inline-error" role="alert">{text}</span> : null}</div>;
  const content = <EmptyState icon={<FolderOpen size={compact ? "inline" : "empty"} />} text={text} action={consent ? <span className="ks-notice-actions"><Button data-ks-user-consent onClick={(event) => { if (event.nativeEvent.isTrusted) allow(); }}>{name} 폴더 {consent.access === "read" ? "읽기" : "읽고 고치기"} 허용</Button>{pickButton}</span> : pickButton} />;
  return contentsOnly ? content : <div {...rootProps} className="ks-file-tree-ungranted">{content}</div>;
}
