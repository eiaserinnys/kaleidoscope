import type { AppDefinition } from "../src/contract/contract";

const entries = Array.from({ length: 35 }, (_, index) => ({ key: String(index), name: "기록", body: `내용 ${index + 1}` }));
const items = Array.from({ length: 1000 }, (_, index) => ({ key: String(index), title: `항목 ${index + 1}` }));
const grid = Array.from({ length: 24 }, (_, index) => ({ key: String(index), title: `그림 ${index + 1}`, image: { permission: "media", path: index % 2 ? "shapes.png" : "landscape.png" } }));
const rows = Array.from({ length: 70 }, (_, index) => ({ key: String(index), name: `행 ${index + 1}`, status: "길게 표시되는 진행 상태 배지", a: index, b: index + 1, c: index + 2, d: index + 3, e: index + 4 }));

export const dataViewsApp: AppDefinition = {
  id: "data-views-test",
  name: "보기 시험",
  requires: { blocks: 7, modules: { files: 1 } },
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
    { label: "선택 흐름 시험", child: { type: "feed", grouped: true, entries: [
      { title: "첫 묶음", items: [{ key: "one", name: "기록", body: "첫 번째 내용" }] },
      { title: "다음 묶음", items: [{ key: "two", name: "기록", body: "두 번째 내용" }] },
    ], selected: { state: "choice" }, on_select: { set_state: "choice" } } },
    { label: "병기 시험", child: { type: "feed", grouped: true, columns: true, copy: true, entries: [
      { title: "첫 묶음", items: [
        { key: "dialogue-1", name: "화자 하나", color: "#6d4c9a", meta: "id-001", body: ["문을 열어라.\n지금 바로.", "Open the door.\nRight now."] },
        { key: "dialogue-2", name: "화자 둘", color: "#327b72", meta: "id-002", body: ["기다리고 있었어요.", "I have been waiting."] },
      ] },
      { title: "다음 묶음", items: [
        { key: "dialogue-3", name: "화자 하나", color: "#6d4c9a", meta: "id-003", body: ["그 열쇠를 찾았어.", "I found the key."] },
        { key: "dialogue-4", name: "화자 셋", color: "#a05245", meta: "id-004", body: ["짧은 글", "한쪽 칸에서만 여러 줄로 이어지는 긴 시험 문장입니다. 좁은 화면에서는 이 문단이 길어져도 반대쪽 문단의 내용이 깨지거나 옆으로 밀리지 않고 위아래로 쌓여야 합니다."] },
      ] },
    ] } },
  ] },
};
