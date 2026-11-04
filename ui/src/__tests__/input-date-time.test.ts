import { describe, expect, it } from "vitest";
import { addMonths, addYears, createDateTimeFormat, parseISODate, timeOptions, weekStart } from "../blocks/input-date-time";

describe("날짜와 시간 입력", () => {
  it("실재하는 ISO 날짜와 윤일을 검사하고 월말과 연 이동을 맞춘다", () => {
    expect(parseISODate("2024-02-29")).toBe("2024-02-29");
    expect(parseISODate("2023-02-29")).toBeNull();
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(weekStart("en-US")).toBe(0);
    expect(weekStart("en-GB")).toBe(1);
  });
  it.each([
    ["ko-KR", "2026. 11. 20."], ["en-US", "11/20/2026"], ["en-GB", "20/11/2026"],
  ])("%s 날짜의 locale 표시와 입력을 ISO로 왕복한다", (locale, text) => {
    const f = createDateTimeFormat(locale);
    expect(f.formatDate("2026-11-20")).toBe(text);
    expect(f.parseDate(text)).toEqual({ valid: true, value: "2026-11-20" });
    expect(f.parseDate("2026-11-20")).toEqual({ valid: true, value: "2026-11-20" });
    expect(f.parseDate("2026-1").valid).toBe(false);
    expect(f.parseDate("11/20/26").valid).toBe(false);
    expect(f.parseDate(" ")).toEqual({ valid: true, value: null });
  });
  it("24시간과 locale 시각을 파싱하고 정오와 자정을 구분한다", () => {
    const ko = createDateTimeFormat("ko-KR");
    const en = createDateTimeFormat("en-US");
    expect(ko.parseTime("오후 3:30")).toEqual({ valid: true, value: "15:30" });
    expect(en.parseTime("3:30 PM")).toEqual({ valid: true, value: "15:30" });
    expect(en.parseTime("12:00 AM")).toEqual({ valid: true, value: "00:00" });
    expect(en.parseTime("12:00 PM")).toEqual({ valid: true, value: "12:00" });
    expect(en.parseTime("9:17")).toEqual({ valid: true, value: "09:17" });
    expect(en.parseTime("24:00").valid).toBe(false);
  });
  it("시간 선택지는 자정 기준 간격과 범위를 따른다", () => {
    expect(timeOptions(30, "09:10", "10:00")).toEqual(["09:30", "10:00"]);
    expect(timeOptions(15, "09:10", "09:45")).toEqual(["09:15", "09:30", "09:45"]);
  });
});
