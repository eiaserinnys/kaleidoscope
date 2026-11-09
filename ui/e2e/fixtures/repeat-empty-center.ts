import type { AppDefinition } from "../../src/contract/contract";

export const repeatEmptyCenterApp: AppDefinition = {
  id: "repeat-empty-center", name: "빈 반복 가운데 시험", requires: { blocks: 22, modules: {} }, permissions: [], state: {},
  ui: { type: "stack", direction: "column", gap: "small", fill: 2, children: [
    { type: "toolbar", start: [{ type: "text", value: "받은 항목" }] },
    { type: "when", value: { expr: "$data.entries.count == 0" }, child: {
      type: "stack", direction: "column", place: "center", children: [
        { type: "text", value: "받은 항목 없음", style: "meta" },
      ],
    } },
    { type: "repeat", items: { expr: "$data.entries.items" }, key: "key", layout: "grid",
      grid: { columns: "auto", item_width: "large" }, gap: "large",
      template: { type: "section", title: { item: "name" }, child: { type: "text", value: "한 줄" } } },
  ] },
};
