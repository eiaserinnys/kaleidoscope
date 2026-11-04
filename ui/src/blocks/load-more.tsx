import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BindingMore } from "../contract/contract";
import { DataState } from "../components/data-state";
import { Button } from "../components/primitives";
import type { WindowData } from "../data/window-data";

export function useLoadMore(more: BindingMore | undefined, rows: number, last: number, data: WindowData | undefined, visible: boolean, loading?: ReactNode, progress = rows) {
  const footer = useRef<HTMLDivElement>(null);
  const requested = useRef<number | null>(null);
  const pending = useRef(false);
  const loadingRows = useRef<number | null>(null);
  const previousState = useRef<BindingMore["state"] | undefined>(undefined);
  const [manual, setManual] = useState(false);
  const request = (fromButton = false) => {
    if (!data || !more || pending.current) return;
    if (fromButton) {
      const view = footer.current?.closest<HTMLElement>(".ks-data-view");
      const rows = Array.from(view?.querySelectorAll<HTMLElement>("[data-focus-index]") ?? [])
        .filter((row) => row.closest(".ks-data-view") === view);
      const repeatRows = Array.from(view?.querySelectorAll<HTMLElement>(".ks-repeat-item") ?? [])
        .filter((row) => row.closest(".ks-data-view") === view);
      const row = rows.find((item) => item.tabIndex === 0) ?? rows.at(-1) ?? repeatRows.at(-1);
      if (row) {
        if (!row.hasAttribute("tabindex")) row.tabIndex = -1;
        row.focus({ preventScroll: true });
      }
    }
    pending.current = true;
    const count = progress;
    requested.current = count;
    void data.more(more.source).then((started) => {
      pending.current = false;
      if (!started && requested.current === count) requested.current = null;
    });
  };
  useEffect(() => {
    let unchanged = false;
    if (!more) {
      requested.current = null;
      loadingRows.current = null;
      if (manual) setManual(false);
    } else if (more.state === "loading") {
      if (previousState.current !== "loading") loadingRows.current = progress;
    } else if (more.state === "ready" && previousState.current === "loading") {
      unchanged = loadingRows.current === progress;
      setManual(unchanged);
      if (!unchanged) requested.current = null;
      loadingRows.current = null;
    }
    previousState.current = more?.state;
    if (more?.state === "ready" && visible && !manual && !unchanged && last >= rows - 1 - 5 && requested.current !== progress) request();
  });
  if (!more) return null;
  const source = more.id === "DATA_SOURCE_MORE_LOGIN_REQUIRED" ? data?.definition.sources?.[more.source] : undefined;
  const isLogin = more.state === "failed" && more.id === "DATA_SOURCE_MORE_LOGIN_REQUIRED" && source?.kind === "request";
  const content = more.state === "loading" ? loading ?? <DataState compact value={{ status: "loading" }} />
    : isLogin ? <DataState compact layout="row" value={{ status: "login_required", permission: source.permission }} loginFailure={{ message: more.message ?? "", id: more.id }} onLogin={() => request(true)} />
    : more.state === "failed" ? <DataState compact layout="row" value={{ status: "failed", message: more.message ?? "", id: more.id, retry: [] }} onRetry={more.retry ? () => request(true) : undefined} />
    : manual ? <Button onClick={() => request(true)}>더 보기</Button> : null;
  return content ? <div ref={footer} className="ks-load-more">{content}</div> : null;
}
