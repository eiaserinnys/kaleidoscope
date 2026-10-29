import type { AppDefinition } from "../src/contract/contract";

export const dataLayoutApp: AppDefinition = {
  id: "data-controls", name: "범용 블록", requires: { blocks: 4, modules: { connection: 1 } },
  permissions: [{ id: "sample", module: "connection", access: "read", connection: "sample", label: "예제" }],
  state: { query: "", choice: "하나", enabled: false, tab: 0, note: "" },
  sources: {
    sample: { kind: "request", permission: "sample", path: "/sample" },
    failed: { kind: "request", permission: "sample", path: "/failed" },
  },
  ui: { type: "stack", direction: "column", gap: "medium", children: [
    { type: "toolbar", start: [
      { type: "input", value: { state: "query" }, on_change: { set_state: "query" }, kind: "search", placeholder: "검색" },
      { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["하나", "둘"], style: "dropdown" },
    ], end: [{ type: "button", label: "실행", icon: "play", on_click: [{ call: { permission: "sample", method: "GET", path: "/" } }] }] },
    { type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [
      { label: "기본", child: { type: "stack", direction: "column", gap: "medium", children: [
        { type: "section", title: "입력", meta: "범용", collapsible: true, child: { type: "stack", direction: "column", gap: "small", children: [
          { type: "input", value: { state: "note" }, on_change: { set_state: "note" }, multiline: true, placeholder: "여러 줄 입력" },
          { type: "toggle", value: { state: "enabled" }, on_change: { set_state: "enabled" }, label: "사용" },
          { type: "select", value: { state: "choice" }, on_change: { set_state: "choice" }, options: ["하나", "둘"], style: "segmented" },
          { type: "button", label: "삭제", icon: "trash-2", variant: "danger", confirm: { title: "삭제할까요?", body: "이 동작을 진행합니다." }, on_click: [{ call: { permission: "sample", method: "GET", path: "/" } }] },
        ] } },
        { type: "section", title: { expr: "$data.failed.heading" }, collapsible: true, child: { type: "text", value: "구역 내용" } },
        { type: "section", title: "데이터", child: { type: "stack", direction: "column", gap: "medium", children: [
          { type: "text", value: { expr: "$data.sample.message" } },
          { type: "text", value: { expr: "$data.failed.message" } },
        ] } },
      ] } },
      { label: "다른 탭", child: { type: "text", value: "두 번째 탭" } },
    ] },
  ] },
};
