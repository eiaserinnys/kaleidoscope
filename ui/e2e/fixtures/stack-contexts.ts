import sideForm from "./side-form.json";

const items = Array.from({ length: 30 }, (_, i) => ({ key: String(i), title: `항목 ${i}` }));
const contexts = ["section", "tab", "pane"] as const;
const fills = ["number", "list"] as const;

export default [
  {
    id: "root-section-list", name: "창 직속 구역", requires: { blocks: 37, modules: {} }, permissions: [], state: {},
    ui: { type: "section", title: "목록", child: { type: "stack", direction: "column", fill: [0], children: [{ type: "list", items }] } },
  },
  ...[false, true].map(tail => ({
    id: `stacked-grid-detail-${Number(tail)}`, name: "격자 상세", requires: { blocks: 37, modules: { files: 1 } }, permissions: [{ id: "media", module: "files", access: "read", label: "그림" }], state: {},
    ui: { type: "split", direction: "row", column_below: 1200, sizes: [60, 40], children: [
      { type: "list", items },
      { type: "stack", direction: "column", gap: "none", fill: [1], children: [
        { type: "toolbar", start: [{ type: "text", value: "상세", style: "title" }] },
        { type: "stack", direction: "column", gap: "medium", children: [
          { type: "notice", kind: "loading", message: "" },
          { type: "properties", fields: [{ label: "권한", value: [{ text: "아주 긴 외부 서비스 접속 권한을 표시하는 배지" }], format: "badge" }] },
          { type: "list", layout: "grid", items: items.slice(0, 4).map(item => ({ ...item, image: { permission: "media", path: "landscape.png" } })) },
          { type: "text", value: "상세 설명의 마지막 문장입니다.", style: "body" },
        ] },
        ...(tail ? [{ type: "toolbar", start: [], end: [{ type: "button", label: "설치", on_click: [] }] }] : []),
      ] },
    ] },
  })),
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

export const bottomPaddingCases = [
  {
    id: "bottom-horizontal-stack", name: "나란한 칸의 바닥", requires: { blocks: 37, modules: {} }, permissions: [], state: {},
    ui: { type: "stack", direction: "row", fill: 0, children: [
      { type: "split", direction: "row", children: [{ type: "section", title: "내용", child: { type: "list", items } }, { type: "list", items }] },
      { type: "text", value: "옆 칸" },
    ] },
  },
  ...["controls", "markdown", "editor", "folder"].map(kind => ({
    id: `bottom-tabs-${kind}`, name: "구역 안 탭", requires: { blocks: 37, modules: { files: 1 } }, permissions: [{ module: "files", id: "docs", access: "read", label: "문서" }], state: {},
    ui: { type: "split", direction: "row", children: [
      { type: "section", title: "쓰기", child: { type: "tabs", tabs: [{ label: "내용", child: kind === "controls"
        ? { type: "stack", direction: "column", fill: [0], children: [{ type: "list", items }, { type: "button", label: "저장", on_click: [] }] }
        : kind === "markdown" ? { type: "markdown", value: "본문" } : kind === "editor" ? { type: "markdown", read_only: false, document: { entry: "docs", doc: { state: "file" } } } : { type: "folder", root: { permission: "docs" } } }] } },
      { type: "list", items },
    ] },
  })),
  ...[false, true].map(middle => ({
    id: `bottom-split-${middle ? "middle" : "last"}`, name: "분할 바닥", requires: { blocks: 37, modules: {} }, permissions: [], state: {},
    ui: { type: "stack", direction: "column", fill: 1, children: [
      { type: "toolbar", start: [{ type: "text", value: "목록" }] },
      { type: "split", direction: "row", column_below: 640, children: [
        { type: "table", columns: [{ field: "title", label: "제목" }], rows: items },
        { type: "section", title: "상세", child: { type: "stack", direction: "column", fill: [0], children: [{ type: "list", items }] } },
      ] },
      ...(middle ? [{ type: "tabs", tabs: [{ label: "다음", child: { type: "text", value: "다음 내용" } }] }] : []),
    ] },
  })),
  {
    id: "bottom-body-scroll", name: "창 본문 스크롤", requires: { blocks: 37, modules: {} }, permissions: [], state: {},
    ui: { type: "stack", direction: "column", fill: 1, children: [
      { type: "toolbar", start: [{ type: "text", value: "자료" }] },
      { type: "stack", direction: "column", fill: 0, children: [
        { type: "stack", direction: "column", children: [...items.map(i => ({ type: "text", value: i.title })), { type: "text", value: "출처" }] },
      ] },
    ] },
  },
];
