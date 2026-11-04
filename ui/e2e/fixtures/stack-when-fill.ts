import type { AppDefinition, Block } from "../../src/contract/contract";

const rows = Array.from({ length: 30 }, (_, index) => ({
  key: `row-${index}`, label: `작업 ${index + 1}`,
  first: { title: `검토 ${index + 1}`, color: "#d6eaff" },
  second: { title: `진행 ${index + 1}`, color: "#d9ead3" },
}));
const table: Block = { type: "table", rows, columns: [
  { field: "label", label: "항목" },
  { field: "first", label: "첫째 날", format: "content" },
  { field: "second", label: "둘째 날", format: "content" },
] };
const detail: Block = { type: "text", value: "선택한 항목의 상세 내용" };

export const stackWhenFillApp: AppDefinition = {
  id: "stack-when-fill", name: "조건 배치 시험", requires: { blocks: 19, modules: {} }, permissions: [], state: {},
  ui: { type: "stack", direction: "column", fill: 1, children: [
    { type: "toolbar", start: [{ type: "text", value: "작업 일정" }] },
    { type: "stack", direction: "column", gap: "none", fill: 0, children: [
      { type: "when", min_width: 1200, child: { type: "split", direction: "row", sizes: [65, 35], children: [table, detail] } },
      { type: "when", max_width: 1199, child: { type: "split", direction: "column", sizes: [50, 50], children: [table, detail] } },
    ] },
  ] },
};
