import type { AppDefinition } from "../src/contract/contract";

const entries = Array.from({ length: 35 }, (_, index) => ({ key: String(index), name: "기록", body: `내용 ${index + 1}` }));
const items = Array.from({ length: 1000 }, (_, index) => ({ key: String(index), title: `항목 ${index + 1}` }));
const grid = Array.from({ length: 24 }, (_, index) => ({ key: String(index), title: `그림 ${index + 1}`, image: { permission: "media", path: index % 2 ? "shapes.png" : "landscape.png" } }));
const rows = Array.from({ length: 70 }, (_, index) => ({ key: String(index), name: `행 ${index + 1}`, status: "길게 표시되는 진행 상태 배지", a: index, b: index + 1, c: index + 2, d: index + 3, e: index + 4 }));

export const dataViewsApp: AppDefinition = {
  id: "data-views-test",
  name: "보기 시험",
  requires: { blocks: 4, modules: { files: 1 } },
  permissions: [{ id: "media", module: "files", access: "read", label: "그림" }],
  state: { tab: 0, choice: null, feed: entries },
  ui: { type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [
    { label: "긴 목록", child: { type: "list", items, selected: { state: "choice" }, on_select: { set_state: "choice" } } },
    { label: "격자 시험", child: { type: "list", layout: "grid", items: grid, selected: { state: "choice" }, on_select: { set_state: "choice" } } },
    { label: "표 시험", child: { type: "table", rows, columns: [
      { field: "name", label: "이름", width: "wide" },
      { field: "status", label: "상태", width: "narrow", format: "badge" },
      ...["a", "b", "c", "d", "e"].map((field) => ({ field, label: field.toUpperCase(), width: "medium" as const, format: "number" as const })),
    ] } },
    { label: "흐름 시험", child: { type: "stack", direction: "column", children: [
      { type: "toolbar", start: [{ type: "button", label: "추가", on_click: [{ set_state: "feed", value: { expr: "$append($state.feed, [{\"key\": $string($count($state.feed)), \"name\": \"기록\", \"body\": \"새 내용\"}])" } }] }] },
      { type: "feed", follow: true, entries: { state: "feed" } },
    ] } },
  ] },
};
