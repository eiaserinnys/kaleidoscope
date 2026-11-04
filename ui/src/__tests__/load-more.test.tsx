import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BindingMore } from "../contract/contract";
import type { WindowData } from "../data/window-data";
import { useLoadMore } from "../blocks/load-more";

vi.mock("../components/data-state", () => ({ DataState: ({ value, onRetry }: { value: { status: string; message?: string }; onRetry?: () => void }) =>
  <div>{value.message ?? value.status}{onRetry && <button onClick={onRetry}>다시 받기</button>}</div> }));

function Harness({ more, count, visible, data }: { more?: BindingMore; count: number; visible: boolean; data: WindowData }) {
  return useLoadMore(more, count, count - 1, data, visible);
}
function IconHarness({ more, items, data }: { more?: BindingMore; items: number; data: WindowData }) {
  return useLoadMore(more, 1, 0, data, true, undefined, items);
}
const state = (status: BindingMore["state"], retry = false): BindingMore => ({ source: "items", state: status, retry });

describe("다음 쪽 바닥 줄", () => {
  it.each(["grid", "icons"])("%s의 같은 격자 행에 항목이 추가돼도 다음 쪽을 계속 받는다", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const data = { more: request } as unknown as WindowData;
    const { rerender } = render(<IconHarness more={state("ready")} items={1} data={data} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender(<IconHarness more={state("loading")} items={1} data={data} />);
    rerender(<IconHarness more={state("ready")} items={2} data={data} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });
  it("같은 행 수에서 자동 호출을 반복하지 않고 새 행이 없으면 더 보기를 제공한다", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const data = { more: request } as unknown as WindowData;
    const { rerender } = render(<Harness more={state("ready")} count={10} visible data={data} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => {});
    rerender(<Harness more={state("loading")} count={10} visible data={data} />);
    rerender(<Harness more={state("ready")} count={10} visible data={data} />);
    expect(await screen.findByRole("button", { name: "더 보기" })).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("시작하지 못한 호출은 다시 보일 때 재시도한다", async () => {
    const request = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const data = { more: request } as unknown as WindowData;
    const { rerender } = render(<Harness more={state("ready")} count={10} visible data={data} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => {});
    rerender(<Harness more={state("ready")} count={10} visible={false} data={data} />);
    rerender(<Harness more={state("ready")} count={10} visible data={data} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("선언 오류에는 다시 받기 단추가 없다", () => {
    const data = { more: vi.fn() } as unknown as WindowData;
    const failure = { ...state("failed"), message: "선언 오류" };
    render(<Harness more={failure} count={10} visible data={data} />);
    expect(screen.getByText("선언 오류")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 받기" })).toBeNull();
  });
});
