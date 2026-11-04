import type { AppDefinition } from "../../src/contract/contract";

const options = Array.from({ length: 504 }, (_, index) => ({
  value: `entry-${index}`,
  label: index === 503 ? "Zombie 마지막" : `항목 ${index}`,
  description: index === 503 ? "긴 설명을 읽고 복사할 수 있도록 선택지 옆에 표시합니다. 창이 좁아지면 설명이 목록 아래로 이동하며 글이 잘리지 않아야 합니다. 실제 사용에서 필요한 내용을 여러 문장으로 설명합니다." : `항목 ${index}의 설명`,
}));

export const inputOptionsApp = {
  id: "input-options-fixture", name: "선택지 입력", requires: { blocks: 32, modules: {} }, permissions: [],
  state: { value: "entry-1", free: "", saved: "", selected: "a" },
  ui: { type: "stack", direction: "column", gap: "medium", children: [
    { type: "input", label: "목록 전용", value: { state: "value" }, on_change: { set_state: "value" }, options, options_only: true },
    { type: "input", label: "자유 입력", value: { state: "free" }, on_change: { set_state: "free" }, options },
    { type: "button", label: "저장", on_click: [{ set_state: "saved", value: { expr: "$state.value" } }] },
    { type: "text", value: { state: "saved" } },
    { type: "select", label: "표시", value: { state: "selected" }, on_change: { set_state: "selected" }, options: [{ value: "a", label: "첫째", description: "첫째 선택지 설명" }, { value: "b", label: "둘째", description: "둘째 선택지 설명" }] },
  ] },
} as unknown as AppDefinition;
