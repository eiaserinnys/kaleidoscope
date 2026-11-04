import type { PointerEvent as ReactPointerEvent } from "react";

export function capturePointer(event: ReactPointerEvent<Element>): void {
  if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture?.(event.pointerId);
}
