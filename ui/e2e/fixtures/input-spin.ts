import type { AppDefinition } from "../../src/contract/contract";

export const inputSpinApp = {
  id: "input-spin-test", name: "숫자 입력", requires: { blocks: 31, modules: {} }, permissions: [],
  state: { amount: 2, saved: 0, blank: null, limit: 5, locked: 3, rows: [{ label: "수량", value: 12, step: 2 }] },
  ui: { type: "stack", direction: "column", gap: "medium", children: [
    { type: "input", kind: "number", label: "금액", value: { state: "amount" }, min: 0, max: 50, step: 1, on_change: { set_state: "amount" } },
    { type: "button", label: "적용", on_click: [{ set_state: "saved", value: { expr: "$state.amount" } }] },
    { type: "repeat", items: { state: "rows" }, key: "label", layout: "column", virtual: false, template: {
      type: "input", kind: "number", label: { item: "label" }, label_position: "top", columns: 6,
      step: { item: "step" }, value: { item: "value" }, on_change: { set_state: "amount" },
    } },
    { type: "input", kind: "number", spin: true, label: "조정", value: { state: "amount" }, min: 0, max: 50, step: 1, on_change: { set_state: "amount" } },
    { type: "input", kind: "number", spin: true, label: "빈 값", value: { state: "blank" }, on_change: { set_state: "blank" } },
    { type: "input", kind: "number", spin: true, columns: 6, label: "한도", value: { state: "limit" }, min: 0, max: 5, on_change: { set_state: "limit" } },
    { type: "input", kind: "number", spin: true, label: "읽기 전용", value: { state: "locked" }, read_only: true, on_change: { set_state: "locked" } },
  ] },
} as unknown as AppDefinition;
