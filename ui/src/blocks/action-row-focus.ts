import { isUnclaimedFocus } from "../components/focus-rescue";

/** 동작을 부른 목록, 표, 트리의 행. 동작이 그 행을 지우면 같은 자리 행이나 앞 행으로 초점을 옮긴다. */
export type ActionRow = { anchor: HTMLElement; container: HTMLElement | null; rowIndex: string | undefined; tree: boolean };

export function actionRow(anchor: HTMLElement): ActionRow {
  const container = anchor.closest<HTMLElement>('.ks-data-view, [role="tree"]');
  const tree = anchor.getAttribute("role") === "treeitem";
  return { anchor, container, rowIndex: tree ? anchor.dataset.index : anchor.dataset.focusIndex, tree };
}

function restoreAfterAction({ anchor, container, rowIndex, tree }: ActionRow) {
  // 동작을 기다리는 사이 사용자가 옮긴 초점은 그대로 둔다.
  if (!isUnclaimedFocus(document.activeElement) || !container?.isConnected) return;
  const row = (index: number) => container.querySelector<HTMLElement>(tree
    ? `[role="treeitem"][data-index="${index}"]`
    : `[data-focus-index="${index}"]`);
  const target = anchor.isConnected ? anchor : rowIndex === undefined ? null : row(Number(rowIndex)) ?? row(Number(rowIndex) - 1);
  target?.focus({ preventScroll: true });
}

/** 동작이 끝나면 행 초점을 되돌린다. 행이 아직 있으면 늦게 오는 상태 이벤트를 위해 실제 제거를 3초까지 한 번 기다린다. 기다림을 멈추는 함수를 돌려준다. */
export function restoreRowFocusAfter(row: ActionRow, done: Promise<unknown>): () => void {
  let stopped = false;
  let frame: number | undefined;
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    observer?.disconnect();
    clearTimeout(timer);
  };
  void done.then(() => {
    if (stopped) return;
    frame = requestAnimationFrame(() => {
      restoreAfterAction(row);
      if (!row.anchor.isConnected || !row.container?.isConnected) { stop(); return; }
      // 명령 응답보다 상태 이벤트가 늦으면 실제 행 제거를 한 번 기다린다.
      observer = new MutationObserver(() => {
        if (row.anchor.isConnected) return;
        stop();
        restoreAfterAction(row);
      });
      observer.observe(row.container, { childList: true, subtree: true });
      timer = setTimeout(stop, 3000);
    });
  });
  return stop;
}
