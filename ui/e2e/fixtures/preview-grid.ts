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

export const previewGridFixtures = [
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
