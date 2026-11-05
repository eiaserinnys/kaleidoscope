import sideForm from "./side-form.json";

const items = Array.from({ length: 30 }, (_, i) => ({ key: String(i), title: `항목 ${i}` }));
const contexts = ["section", "tab", "pane"] as const;
const fills = ["number", "list"] as const;

export default [
  {
    id: "stacked-fill-detail", name: "쌓인 상세", requires: { blocks: 37, modules: {} }, permissions: [], state: {},
    ui: { type: "split", direction: "row", column_below: 1200, sizes: [60, 40], children: [
      { type: "text", value: "목록 칸" },
      { type: "stack", direction: "column", fill: [1, 2], children: [
        { type: "text", value: "상세 머리" },
        { type: "text", format: "markdown", value: "선택한 항목의 상세 내용" },
        { type: "text", value: "상태 안내" },
      ] },
    ] },
  },
  ...contexts.flatMap(context => (context === "section" ? ["list", "markdown"] : ["list"]).flatMap(kind => fills.flatMap(fill => [false, true].map(tail => {
    const children = [
      { type: "properties", fields: [{ label: "상태", value: "내용", format: "text" }] },
      kind === "list" ? { type: "list", items } : { type: "markdown", value: items.map(i => `${i.title} 문단입니다.`).join("\n\n") },
      ...(tail ? [{ type: "stack", direction: "row", children: [{ type: "button", label: "결정", on_click: [] }] }] : []),
    ];
    const stack = { type: "stack", direction: "column", gap: "small", fill: fill === "number" ? 1 : [1], children };
    const content = context === "section" ? { type: "section", title: "영역", child: stack }
      : context === "tab" ? { type: "tabs", header: false, tabs: [{ label: "목록", child: stack }] } : stack;
    return {
      id: `context-${context}-${fill}-${Number(tail)}-${kind}`, name: "쌓기 맥락",
      requires: { blocks: 37, modules: {} }, permissions: [], state: {},
      ui: { type: "split", direction: "row", sizes: [60, 40], children: [content, { type: "text", value: "옆 칸" }] },
    };
  })))),
  sideForm,
];
