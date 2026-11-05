/** textarea의 커서 노출 스크롤 뒤, 결정 줄 위 본문에는 입력의 테두리도 남긴다. */
export function revealStackControl(target: HTMLElement) {
  const scroller = target.closest<HTMLElement>(".ks-stack-scroll");
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const top = bounds.top + scroller.clientTop;
  const bottom = top + scroller.clientHeight;
  const rect = target.getBoundingClientRect();
  if (rect.top < top) scroller.scrollTop -= top - rect.top;
  else if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
}
