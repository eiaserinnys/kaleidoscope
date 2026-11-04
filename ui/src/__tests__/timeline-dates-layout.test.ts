import { describe, expect, it } from "vitest";
import { autoRange, dateToDay, dayToDate, layoutLanes, tickScale } from "../blocks/timeline-dates-layout";

describe("날짜 일정 배치", () => {
  it("UTC 날짜를 확인하고 끝날을 포함한다", () => {
    expect(dateToDay("2026-02-30")).toBeNull();
    const day = dateToDay("2026-11-14")!;
    expect(dayToDate(day + 6)).toBe("2026-11-20");
    expect(layoutLanes([{ id: "a", start: day, end: day }, { id: "b", start: day, end: day }], "pack")).toHaveLength(2);
  });
  it("겹치는 항목만 쌓거나 받은 순서대로 한 줄씩 놓는다", () => {
    const items = [{ id: "a", start: 10, end: 12 }, { id: "b", start: 12, end: 14 }, { id: "c", start: 13, end: 14 }, { id: "d", start: null, end: null }];
    expect(layoutLanes(items, "pack").map((lane) => lane.map((item) => item.id))).toEqual([["a", "c"], ["b"], ["d"]]);
    expect(layoutLanes(items, "each").map((lane) => lane[0].id)).toEqual(["a", "b", "c", "d"]);
    expect(layoutLanes(items, "single").map((lane) => lane.map((item) => item.id))).toEqual([["a", "b", "c"], ["d"]]);
    expect(layoutLanes([], "pack")).toEqual([[]]);
  });
  it("데이터가 없으면 오늘을 기준으로 범위를 잡는다", () => {
    const today = dateToDay("2026-11-18")!;
    const range = autoRange([], [], today, false);
    expect(dayToDate(range.start)).toBe("2026-11-02");
    expect(range.end).toBe(today + 42);
  });
  it("측정한 글자 간격으로 일, 주, 월을 전환한다", () => {
    expect(tickScale(20, 20, 30)).toBe("day");
    expect(tickScale(10, 20, 30)).toBe("week");
    expect(tickScale(4, 20, 30)).toBe("month");
  });
});
