/* 표가 감싼 폭보다 넓으면 is-tight를 붙여 모든 칸을 아무 곳에서나 끊게 한다. */
export function fitTable(wrap: HTMLElement, table: HTMLElement): void {
  // 먼저 떼고 재야 한다. is-tight가 붙은 채로 재면 좁아진 최소 폭이 재져 넓힌 뒤에도 맞는 것으로 잘못 판정한다.
  wrap.classList.remove("is-tight");
  if (table.offsetWidth > wrap.clientWidth) wrap.classList.add("is-tight");
}

/**
 * 감싼 폭이 바뀔 때마다 표 맞춤을 다시 한다. wrap 대신 표 다음의 빈 probe를 관찰한다.
 * is-tight가 표 높이를 바꿔도 probe 크기는 그대로라 ResizeObserver가 되부르는 경고가 나지 않고,
 * 첫 알림으로 첫 맞춤을 그리기 전에 끝낸다.
 */
export function watchTableFit(wrap: HTMLElement, probe: HTMLElement, table: HTMLElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let lastWidth: number | undefined;
  const observer = new ResizeObserver((entries) => {
    const width = entries[entries.length - 1]?.contentRect.width;
    if (width === undefined || width === lastWidth) return;
    lastWidth = width;
    fitTable(wrap, table);
  });
  observer.observe(probe);
  return () => observer.disconnect();
}
