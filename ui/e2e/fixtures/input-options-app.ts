import type { AppDefinition } from "../../src/contract/contract";

const options = Array.from({ length: 504 }, (_, index) => ({
  value: `entry-${index}`,
  label: index === 503 ? "Zombie 마지막" : `항목 ${index}`,
  ...(index === 0 ? {} : { description: index === 503 ? "긴 설명을 읽고 복사할 수 있도록 선택지 옆에 표시합니다. 창이 좁아지면 설명이 목록 아래로 이동하며 글이 잘리지 않아야 합니다. 실제 사용에서 필요한 내용을 여러 문장으로 설명합니다." : `항목 ${index}의 설명` }),
}));

export const inputOptionsApp = {
  id: "input-options-fixture", name: "선택지 입력", requires: { blocks: 33, modules: { connection: 1 } },
  permissions: [{ id: "api", module: "connection", access: "read", connection: "sample", label: "예제" }],
  sources: { slow_options: { kind: "request", permission: "api", path: "/choices" } },
  state: { value: "entry-1", free: "", saved: "", selected: "a", slow: "", invalid: "", locked: false, letters: "Alpha beta gamma", digits: "123456", search: "entry-1", invalid_options: ["정상", { value: 12, label: "잘못된 자료" }] },
  ui: { type: "stack", direction: "column", gap: "medium", children: [
    { type: "input", label: "목록 전용", value: { state: "value" }, on_change: { set_state: "value" }, options, options_only: true },
    { type: "input", label: "자유 입력", value: { state: "free" }, on_change: { set_state: "free" }, options },
    { type: "button", label: "저장", on_click: [{ set_state: "saved", value: { expr: "$state.value" } }] },
    { type: "text", value: { state: "saved" } },
    { type: "select", label: "표시", value: { state: "selected" }, on_change: { set_state: "selected" }, options: [{ value: "a", label: "첫째", description: "첫째 선택지 설명" }, { value: "b", label: "둘째", description: "둘째 선택지 설명" }] },
    { type: "input", label: "연결 선택지", value: { state: "slow" }, on_change: { set_state: "slow" }, options: { expr: "$data.slow_options" } },
    { type: "input", label: "잘못된 선택지", value: { state: "invalid" }, on_change: { set_state: "invalid" }, options: { state: "invalid_options" } },
    { type: "input", label: "글자 선택", value: { state: "letters" }, on_change: { set_state: "letters" }, options: ["Alpha beta gamma", "포도", "배"], options_only: true },
    { type: "input", label: "검색 전용", kind: "search", value: { state: "search" }, on_change: { set_state: "search" }, options, options_only: true },
    { type: "input", label: "여섯 글자", columns: 6, value: { state: "digits" }, on_change: { set_state: "digits" }, options: ["123456"], options_only: true, disabled: { state: "locked" } },
    { type: "button", label: "잠금 전환", on_click: [{ set_state: "locked", value: { expr: "$not($state.locked)" } }] },
  ] },
} as unknown as AppDefinition;
