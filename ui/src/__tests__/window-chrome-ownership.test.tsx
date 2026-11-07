import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WindowChrome } from "../../../app/src/shell/window-chrome";
import { WindowFrame } from "../../../app/src/shell/window-frame";
import type { ShellStore } from "../core/shell-store";
import { makeTestSnapshot } from "./fixtures";

afterEach(cleanup);

const chrome = {
  area: { width: 1200, height: 800 },
  rect: { x: 0, y: 0, width: 800, height: 600 },
  maximized: false, minimized: false, zIndex: 1, isTop: true, title: "앱",
  icon: <span />, menuEntries: [], onRaise: () => undefined, onMinimize: () => undefined,
  onMaximize: () => undefined, onRestore: () => undefined, onClose: () => undefined,
  onRectCommit: async () => true, testId: "app-window-test",
};

it("앱 창의 창 틀은 창 임자를 표시한다", () => {
  const view = render(<WindowChrome {...chrome} windowId="window-a">내용</WindowChrome>);
  expect(view.container.querySelector(".ks-window")?.getAttribute("data-window-id")).toBe("window-a");
});

it("임자를 넘기지 않는 창 틀은 창 임자를 표시하지 않는다", () => {
  const view = render(<WindowChrome {...chrome}>내용</WindowChrome>);
  expect(view.container.querySelector(".ks-window")?.hasAttribute("data-window-id")).toBe(false);
});

it("앱 창 틀은 앱 창의 번호를 그대로 표시한다", () => {
  const snapshot = makeTestSnapshot();
  const window = snapshot.shared.windows.find((item) => item.id === "editor-window")!;
  const store = {
    getSnapshot: () => snapshot, getError: () => null,
    subscribe: () => () => undefined, subscribeEvents: () => () => undefined,
    getInstallConsent: () => undefined, subscribeInstallConsent: () => () => undefined,
    call: vi.fn(async () => undefined), ready: Promise.resolve(), dispose: () => undefined,
  } as unknown as ShellStore;
  const view = render(
    <WindowFrame area={{ width: 960, height: 552 }} appName="A" isTop sharing={false} shareable={false} store={store}
      onCall={async () => undefined} onMinimize={() => undefined} onMaximize={() => undefined} onRestore={() => undefined} window={window}>
      <input aria-label="입력" />
    </WindowFrame>,
  );
  expect(view.container.querySelector(`.ks-window[data-window-id="${window.id}"]`)).not.toBeNull();
});
