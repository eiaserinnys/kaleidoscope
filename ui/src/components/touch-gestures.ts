// 터치 기기의 손가락 조작을 PC 마우스 조작에 맞춘다(카드 #1739).
// 길게 누르기 하나로 오른쪽 클릭(contextmenu)을, 짧은 두 번 누르기 하나로 더블클릭(dblclick)을 보낸다.
// 문서 전체에 한 번만 걸고 ContextMenuHost가 설치한다. 마우스, 펜, 키보드 사건은 건드리지 않는다.

const LONG_PRESS_MS = 500;
const MOVE_LIMIT_PX = 10;
const TAP_MAX_MS = 300;
const DOUBLE_TAP_MS = 300;
const CLICK_SUPPRESS_MS = 700;
const NATIVE_DOUBLE_TAP_SUPPRESS_MS = 600;
const EDITABLE = "input, textarea, [contenteditable], .cm-editor";

const longPressEvents = new WeakSet<Event>();
const openedMenus = new WeakSet<Event>();
const syntheticDoubleClicks = new WeakSet<Event>();

/** 이 contextmenu 사건이 손가락 길게 누르기로 합성된 것인가. */
export const isTouchLongPress = (event: Event): boolean => longPressEvents.has(event);

/** 앱 처리기가 이 사건으로 메뉴를 열었음을 알린다. 메뉴를 열지 않았으면 click을 막지 않는다. */
export function markContextMenuOpened(event: Event): void {
  if (longPressEvents.has(event)) openedMenus.add(event);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(EDITABLE));
}

/** selection.css 정책에서 user-select: text로 연 자리인가. 여기서는 기기의 글자 선택을 둔다. */
export function isTextSelectable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const style = getComputedStyle(target) as CSSStyleDeclaration & { webkitUserSelect?: string };
  return style.userSelect === "text" || style.webkitUserSelect === "text";
}

function clearSelectionOutsideEditable(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  if (element && element.closest(EDITABLE)) return;
  selection.removeAllRanges();
}

type PressState = {
  pointerId: number;
  x: number;
  y: number;
  startedAt: number;
  target: Element;
  timer: number | null;
  fired: boolean;
  opened: boolean;
  editable: boolean;
};

let installCount = 0;
let dispose: (() => void) | null = null;

/**
 * 손가락 조작 처리를 문서에 건다. 여러 ContextMenuHost가 동시에 살아 있어도 한 번만 걸린다.
 * 돌려받은 함수를 부르면 그 호스트의 설치가 풀린다.
 */
export function installTouchGestures(closeMenu: () => void): () => void {
  installCount += 1;
  if (installCount === 1) dispose = start(closeMenu);
  return () => {
    installCount = Math.max(0, installCount - 1);
    if (installCount !== 0) return;
    dispose?.();
    dispose = null;
  };
}

function start(closeMenu: () => void): () => void {
  let press: PressState | null = null;
  let lastTap: { x: number; y: number; at: number } | null = null;
  let suppressClick: { until: number } | null = null;
  let suppressDoubleUntil = 0;
  const now = () => performance.now();

  const clearPress = () => {
    if (press?.timer != null) window.clearTimeout(press.timer);
    press = null;
  };

  const fireLongPress = () => {
    const current = press;
    if (!current || current.fired) return;
    current.fired = true;
    current.timer = null;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: current.x,
      clientY: current.y,
      button: 2,
      buttons: 2,
    });
    longPressEvents.add(event);
    current.target.dispatchEvent(event);
    current.opened = openedMenus.has(event);
    if (current.opened) {
      clearSelectionOutsideEditable();
      suppressClick = { until: now() + CLICK_SUPPRESS_MS };
    }
    lastTap = null;
  };

  const fireDoubleClick = (target: Element, x: number, y: number) => {
    // 기기가 이 두 번 누르기에 dblclick을 따로 보내도 처리기는 한 번만 돈다.
    suppressDoubleUntil = now() + NATIVE_DOUBLE_TAP_SUPPRESS_MS;
    window.setTimeout(() => {
      const event = new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        detail: 2,
      });
      syntheticDoubleClicks.add(event);
      target.dispatchEvent(event);
    }, 0);
  };

  const onPointerDown = (event: PointerEvent) => {
    // 새로 누르는 것은 새 조작의 시작이다. 앞선 길게 누르기의 click 억제를 여기서 끝낸다. 메뉴 안을 눌러도 같다.
    // 손가락뿐 아니라 마우스와 펜으로 눌러도 같은 규칙을 따른다. 이 모듈은 손가락 조작만 맞추고 마우스 조작은 건드리지 않는다.
    suppressClick = null;
    if (event.pointerType !== "touch") return;
    if (!event.isPrimary || event.button !== 0) {
      clearPress();
      lastTap = null;
      return;
    }
    if (press) {
      // 손가락이 둘 이상이면 두 번 누르기와 길게 누르기를 모두 그만둔다.
      clearPress();
      lastTap = null;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[role="menu"]')) return;
    const editable = isEditableTarget(target);
    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: now(),
      target,
      timer: editable ? null : window.setTimeout(fireLongPress, LONG_PRESS_MS),
      fired: false,
      opened: false,
      editable,
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId || press.fired) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_LIMIT_PX) clearPress();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const current = press;
    press = null;
    if (current.timer != null) window.clearTimeout(current.timer);
    if (current.fired) {
      if (current.opened) {
        clearSelectionOutsideEditable();
        // 메뉴를 연 손가락을 늦게 떼어도 그에 딸린 클릭이 메뉴를 닫지 않게 창을 다시 연다.
        // 이미 click 하나를 막았거나 새 손가락 누름이 억제를 풀었으면 다시 걸지 않는다.
        if (suppressClick) suppressClick = { until: now() + CLICK_SUPPRESS_MS };
      }
      lastTap = null;
      return;
    }
    const duration = now() - current.startedAt;
    if (current.editable || duration > TAP_MAX_MS) {
      lastTap = null;
      return;
    }
    const tap = { x: current.x, y: current.y, at: now() };
    const paired = lastTap
      && current.startedAt - lastTap.at <= DOUBLE_TAP_MS
      && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) <= MOVE_LIMIT_PX;
    if (paired) {
      lastTap = null;
      fireDoubleClick(current.target, current.x, current.y);
      return;
    }
    lastTap = tap;
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    clearPress();
    lastTap = null;
  };

  const onScroll = () => {
    if (press && !press.fired) clearPress();
    lastTap = null;
  };

  const onDragStart = () => {
    clearPress();
    lastTap = null;
    suppressClick = null;
    closeMenu();
  };

  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    if (now() > suppressClick.until) {
      suppressClick = null;
      return;
    }
    // 기기가 손가락을 뗀 자리를 주변의 누를 수 있는 요소로 보정해도, 메뉴를 연 길게 누르기 뒤의
    // 첫 click 하나는 대상과 관계없이 막는다. 그 click이 메뉴 항목을 실행하면 첫 항목이 눌린다.
    suppressClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (syntheticDoubleClicks.has(event)) return;
    if (now() > suppressDoubleUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("scroll", onScroll, true);
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);

  return () => {
    clearPress();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDoubleClick, true);
  };
}
