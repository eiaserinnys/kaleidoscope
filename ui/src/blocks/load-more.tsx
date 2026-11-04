import { useEffect, useRef, useState } from "react";
import type { BindingMore } from "../contract/contract";
import { DataState } from "../components/data-state";
import { Button } from "../components/primitives";
import type { WindowData } from "../data/window-data";

export function useLoadMore(more: BindingMore | undefined, rows: number, last: number, data: WindowData | undefined, visible: boolean) {
  const requested = useRef<number | null>(null);
  const pending = useRef(false);
  const loadingRows = useRef<number | null>(null);
  const previousState = useRef<BindingMore["state"] | undefined>(undefined);
  const [manual, setManual] = useState(false);
  const request = () => {
    if (!data || !more || pending.current) return;
    pending.current = true;
    const count = rows;
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
      if (previousState.current !== "loading") loadingRows.current = rows;
    } else if (more.state === "ready" && previousState.current === "loading") {
      unchanged = loadingRows.current === rows;
      setManual(unchanged);
      if (!unchanged) requested.current = null;
      loadingRows.current = null;
    }
    previousState.current = more?.state;
    if (more?.state === "ready" && visible && !manual && !unchanged && last >= rows - 1 - 5 && requested.current !== rows) request();
  });
  if (!more) return null;
  if (more.state === "loading") return <DataState compact value={{ status: "loading" }} />;
  if (more.state === "failed") return <DataState compact value={{ status: "failed", message: more.message ?? "", id: more.id, retry: [] }} onRetry={more.retry ? request : undefined} />;
  return manual ? <Button onClick={request}>더 보기</Button> : null;
}
