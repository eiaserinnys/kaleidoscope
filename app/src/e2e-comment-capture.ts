// Windows E2E 빌드에서만 불러오는 셸 내부 시험 경로.
import { captureWindowForComment, suspendWebSurfaces, type AppCommentRect, type ShellStore } from "@kaleidoscope/ui";

export function installCommentCaptureProbe(store: ShellStore): void {
  let release: (() => void) | undefined;
  Object.assign(window, {
    __ksCommentCapture: {
      capture(windowId: string, selector: string, rect: AppCommentRect) {
        const content = document.querySelector<HTMLElement>(selector);
        if (!content) return Promise.reject("창 본문을 찾지 못했습니다");
        return captureWindowForComment(store, windowId, content, rect);
      },
      async suspend(windowId: string) {
        release = await suspendWebSurfaces(windowId);
      },
      release() {
        release?.();
        release = undefined;
      },
    },
  });
}
