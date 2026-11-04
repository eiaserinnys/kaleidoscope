/** 실제로 넘치는 가장 가까운 스크롤 영역만 찾는다. 창 프레임과 그 바깥은 움직이지 않는다. */
export function nearestScrollable(element: HTMLElement, horizontal: boolean): HTMLElement | null {
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    if (parent.classList.contains("ks-data-window")) break;
    const style = getComputedStyle(parent);
    const overflow = horizontal ? style.overflowX : style.overflowY;
    const size = horizontal ? parent.clientWidth : parent.clientHeight;
    const extent = horizontal ? parent.scrollWidth : parent.scrollHeight;
    if (/^(auto|scroll)$/.test(overflow) && size > 0 && extent > size) return parent;
  }
  return null;
}

/** 두 경계가 이미 보이면 움직이지 않고, 벗어난 쪽만 가장 짧게 이동한다. */
export function revealIn(element: HTMLElement, scroller: HTMLElement, horizontal: boolean): void {
  const target = element.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  const start = horizontal ? target.left : target.top;
  const end = horizontal ? target.right : target.bottom;
  const visibleStart = (horizontal ? frame.left + scroller.clientLeft : frame.top + scroller.clientTop);
  const visibleEnd = visibleStart + (horizontal ? scroller.clientWidth : scroller.clientHeight);
  const delta = end - start >= visibleEnd - visibleStart ? start - visibleStart
    : start < visibleStart ? start - visibleStart : end > visibleEnd ? end - visibleEnd : 0;
  if (horizontal) scroller.scrollLeft += delta;
  else scroller.scrollTop += delta;
}
