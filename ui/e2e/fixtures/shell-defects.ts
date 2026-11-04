import type { AppDefinition } from "../../src/contract/contract";

const base = { requires: { blocks: 20, modules: {} }, permissions: [] };
const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `항목 ${i}` }));
export const shellDefectFixtures = [
  { ...base, id: "follow-fixture", name: "따라가기 시험", state: { active: null, rows }, ui: { type: "stack", direction: "column", fill: 1, children: [
    { type: "button", label: "마지막 항목", on_click: [{ set_state: "active", value: "29" }] },
    { type: "repeat", key: "id", items: { state: "rows" }, follow_key: { state: "active" }, template: { type: "text", value: { item: "name" } } },
  ] } },
  { ...base, id: "timeline-fixture", name: "시간축 시험", state: { open: false }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "대화상자 열기", on_click: [{ set_state: "open", value: true }] },
    { type: "timeline", controls: true, duration: 14.02, position: 3, tracks: [{ id: "track", label: "트랙", items: [] }] },
    { type: "dialog", title: "확인", open: { state: "open" }, on_close: [{ set_state: "open", value: false }], child: { type: "text", value: "내용" } },
  ] } },
  { ...base, requires: { blocks: 21, modules: {} }, id: "segmented-fixture", name: "고르기 시험", state: { value: "one" }, ui: { type: "tabs", tabs: [
    { label: "설정", child: { type: "select", style: "segmented", label: "선택", label_position: "hidden", value: { state: "value" }, on_change: { set_state: "value" }, options: ["one", "two"] } },
  ] } },
  { ...base, id: "tour-fixture", name: "안내 시험", state: { open: false, step: "first" }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "안내 시작", on_click: [{ set_state: "open", value: true }] },
    { type: "anchor", id: "target", child: { type: "text", value: "목표" } },
    { type: "tour", open: { state: "open" }, step: { state: "step" }, steps: [{ key: "first", target: "target", title: "첫 단계", body: "설명" }], on_step: [{ set_state: "step" }], on_close: [{ set_state: "open", value: false }] },
  ] } },
] as unknown as AppDefinition[];
