import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ShellStore } from "../core/shell-store";
import { useShareView } from "../share/share-view";
import * as visible from "../share/visible";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("계속 바뀌는 샌드박스 화면도 정기적으로 코어에 전달한다", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let text = "처음";
  vi.spyOn(visible, "describeVisible").mockImplementation(() => ({ text, visual: true }));
  const rect = { left: 0, top: 0, right: 100, bottom: 100, x: 0, y: 0, width: 100, height: 100, toJSON() {} };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  const call = vi.fn().mockResolvedValue({ op: "share.view" });
  const store = { call } as unknown as ShellStore;
  function Probe() { const root = useRef<HTMLDivElement>(null); useShareView({ windowId: "window", root, enabled: true, store }); return <div ref={root} />; }
  const { container } = render(<Probe />);
  await act(async () => {});
  for (let i = 1; i <= 4; i++) {
    text = `화면 ${i}`;
    await act(async () => { container.firstElementChild!.setAttribute("data-share-seq", String(i)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  }
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: "share.view", view: expect.objectContaining({ text: expect.stringContaining("화면") }) }));
});
