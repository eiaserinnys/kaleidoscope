import type { AppDefinition } from "../../src/contract/contract";

const grid = {
  type: "repeat", items: { state: "marks" }, key: "id", layout: "grid", grid: { columns: "auto" },
  template: { type: "button", label: { item: "label" }, preview: { type: "image", src: { item: "image" } }, on_click: [{ set_state: "selection", value: { item: "id" } }] },
};
const common = {
  requires: { blocks: 19, modules: { assets: 1 } }, permissions: [],
  assets: [{ id: "builtin-weather-clear", version: 1 }],
  state: { selection: "", tab: 0, query: "", marks: Array.from({ length: 16 }, (_, id) => ({ id: String(id), label: `견본 ${id + 1}`, image: { asset: "builtin-weather-clear" } })) },
};

const longText = Array.from({ length: 80 }, (_, index) => `내용 ${index + 1}`).join("\n");
const nestedColumn = (explicit: boolean, split: boolean) => ({
  type: "stack", direction: "column", fill: 1, children: [
    { type: "text", value: "바깥 머리" },
    { type: "stack", direction: "column", ...(explicit ? { fill: 1 } : {}), children: [
      { type: "text", value: "안쪽 머리" },
      split ? { type: "split", direction: "row", sizes: [50, 50], children: [
        { type: "section", title: "첫 칸", child: { type: "text", value: longText } },
        { type: "section", title: "둘째 칸", child: { type: "text", value: longText } },
      ] } : { type: "text", value: longText },
    ] },
  ],
});

export const previewGridFixtures = [
  { ...common, id: "slider-fill", name: "채움 슬라이더", requires: { blocks: 21, modules: {} }, ui: {
    type: "stack", direction: "row", fill: 1, children: [
      { type: "button", label: "고정 도구 단추", on_click: [] },
      { type: "slider", label_position: "hidden", show_value: false, value: { state: "selection" }, min: 0, max: 100, on_change: { set_state: "selection" } },
      { type: "button", label: "오른쪽에 놓인 긴 고정 도구 단추", on_click: [] },
    ],
  } },
  { ...common, id: "nested-controls", name: "중첩 조작 끝", ui: {
    type: "stack", direction: "column", fill: 1, children: [
      { type: "text", value: "고정 머리" },
      { type: "stack", direction: "column", children: [
        { type: "text", value: longText }, { type: "button", label: "끝 조작", on_click: [] },
      ] },
    ],
  } },
  ...[
    ["nested-fill", true, false],
    ["nested-fill-split", true, true],
    ["nested-natural", false, false],
  ].map(([id, explicit, split]) => ({ ...common, id, name: "중첩 채움 시험", ui: nestedColumn(Boolean(explicit), Boolean(split)) })),
  { ...common, id: "preview-grid-tabs", name: "격자 탭 시험", ui: {
    type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [
      { label: "격자", child: grid },
      { label: "줄", child: { type: "button", label: "단추", on_click: [{ set_state: "selection", value: "" }] } },
      { label: "찾기", child: { type: "stack", direction: "column", gap: "small", fill: 1, children: [
        { type: "input", label: "찾기", value: { state: "query" }, on_change: { set_state: "query" } }, grid,
      ] } },
      { label: "구역", child: { type: "section", title: "구역 제목", child: grid } },
    ],
  } },
  { ...common, id: "preview-grid-outside", name: "탭 밖 격자 시험", ui: {
    type: "section", title: "표식", child: { type: "stack", direction: "column", fill: 0, children: [grid] },
  } },
  { ...common, id: "preview-markdown-surface", name: "본문 글 시험", ui: {
    type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [
      { label: "구역", child: { type: "section", title: "구역 제목", child: { type: "markdown", read_only: true, value: "구역 본문 글입니다." } } },
      { label: "문서", child: { type: "markdown", read_only: true, value: "칸을 채우는 문서입니다." } },
    ],
  } },
] as unknown as AppDefinition[];
