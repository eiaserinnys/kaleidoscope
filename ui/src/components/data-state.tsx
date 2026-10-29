import { useState } from "react";
import type { BindingValue } from "../contract/contract";
import { useWindowData } from "../data/window-data";
import { DataIcon } from "./data-icons";
import { Button, EmptyState } from "./primitives";

export function DataState({ value, compact = false }: { value: Exclude<BindingValue, { status: "ready" }>; compact?: boolean }) {
  const data = useWindowData();
  const [error, setError] = useState<string | null>(null);
  if (value.status === "loading") return <div className="ks-data-skeleton" role="status" aria-label="불러오는 중"><i /><i /><i /></div>;
  const isLogin = value.status === "login_required";
  return <div className={compact ? "ks-data-state-compact" : "ks-data-state"}>
    <EmptyState icon={<DataIcon name={isLogin ? "log-in" : "triangle-alert"} size={compact ? "inline" : "empty"} />}
      text={error ?? (isLogin ? "로그인이 필요합니다" : value.message)}
      action={isLogin
        ? <Button onClick={() => { void data.store.call({ op: "connection.login", window_id: data.windowId, permission: value.permission }).catch((reason: unknown) => setError(typeof reason === "object" && reason !== null && "message" in reason ? String(reason.message) : String(reason))); }}>로그인</Button>
        : value.retry.length ? <Button onClick={() => { void data.refresh(value.retry); }}>다시 받기</Button> : undefined} />
  </div>;
}
