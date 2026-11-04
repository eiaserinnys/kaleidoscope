import type { AppDefinition } from "../../src/contract/contract";

export const inputDateTimeApp = {
  id: "input-date-time-fixture", name: "날짜와 시간", requires: { blocks: 33, modules: {} }, permissions: [],
  locale: { state: "locale" },
  state: { locale: "ko-KR", date: "2026-11-20", empty: null, time: "15:30", saved: "", bottom: "2026-11-20" },
  ui: { type: "stack", direction: "column", gap: "medium", children: [
    { type: "input", kind: "date", label: "날짜", value: { state: "date" }, on_change: { set_state: "date" }, min: "2026-11-19", max: "2026-11-25" },
    { type: "input", kind: "date", label: "빈 날짜", value: { state: "empty" }, on_change: { set_state: "empty" } },
    { type: "input", kind: "time", label: "시간", value: { state: "time" }, on_change: { set_state: "time" }, step: 30 },
    { type: "button", label: "저장", on_click: { set_state: "saved", value: { expr: "$state.date" } } },
    { type: "text", value: { state: "saved" } },
    { type: "input", kind: "date", label: "마감일", value: { state: "bottom" }, on_change: { set_state: "bottom" } },
  ] },
} as unknown as AppDefinition;
