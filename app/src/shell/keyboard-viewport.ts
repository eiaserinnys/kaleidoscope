/**
 * iOS 가상 키보드가 닫힌 뒤 문서 스크롤을 0으로 되돌린다.
 *
 * 키보드가 뜨면 WebKit이 입력칸을 화면 안으로 밀면서 문서를 옮겨 두는데, 키보드가 닫혀도
 * 그 위치가 남아 위 막대가 화면 맨 위에서 떨어질 수 있다. html, body의 overflow: hidden은
 * 그대로 두고, 키보드가 닫힌 순간에만 스크롤을 제자리로 돌린다.
 */

/** 문서와 몸통의 스크롤을 0으로 되돌린다. 이미 0이면 아무것도 하지 않는다. */
export function restoreDocumentScroll(view: Window = window): void {
  for (const element of [view.document.scrollingElement, view.document.documentElement, view.document.body]) {
    if (element && (element.scrollTop !== 0 || element.scrollLeft !== 0)) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  }
  if (view.scrollX !== 0 || view.scrollY !== 0) view.scrollTo(0, 0);
}

/**
 * 키보드가 닫힐 때 문서 스크롤을 되돌리는 감시를 건다. 돌려준 함수로 해제한다.
 * focusout 뒤 초점이 다른 입력칸으로 옮겨 간 경우는 키보드가 닫힌 것이 아니므로 건너뛴다.
 */
export function installKeyboardScrollRestore(view: Window = window): () => void {
  let frame = 0;

  const stayingFocused = () => {
    const active = view.document.activeElement;
    return Boolean(active && active !== view.document.body && active !== view.document.documentElement);
  };

  const schedule = () => {
    if (frame) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!stayingFocused()) restoreDocumentScroll(view);
    });
  };

  const viewport = view.visualViewport;
  const onViewportResize = () => {
    // 키보드가 닫히면 보이는 높이가 레이아웃 높이로 돌아온다.
    if (viewport && viewport.height >= view.innerHeight - 1) restoreDocumentScroll(view);
  };

  view.document.addEventListener("focusout", schedule);
  viewport?.addEventListener("resize", onViewportResize);
  return () => {
    view.document.removeEventListener("focusout", schedule);
    viewport?.removeEventListener("resize", onViewportResize);
    if (frame) view.cancelAnimationFrame(frame);
  };
}
