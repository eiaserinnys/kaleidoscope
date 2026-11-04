import { expect, it, vi } from "vitest";
import { flushPending, registerPendingFlush } from "../share/pending-flush";

it("입력에 등록된 지연 전송의 완료를 기다리고 한 번만 실행한다", async () => {
  const input = document.createElement("input");
  let finish!: () => void;
  const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  registerPendingFlush(input, send);
  let done = false;
  const task = flushPending(input).then(() => { done = true; });
  expect(send).toHaveBeenCalledTimes(1);
  expect(done).toBe(false);
  finish(); await task;
  await flushPending(input);
  expect(send).toHaveBeenCalledTimes(1);
});
