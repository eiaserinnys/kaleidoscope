import type { AppDefinition } from "../src/contract/contract";
import type { FakeSourceSeed } from "../src/core/fake-data";

const items = (start: number) => Array.from({ length: 30 }, (_, offset) => ({ key: String(start + offset), title: `항목 ${start + offset}`, name: `행 ${start + offset}`, body: `내용 ${start + offset}` }));
const stories = (start: number) => Array.from({ length: 30 }, (_, offset) => ({ objectID: String(start + offset), title: `시험 이야기 ${start + offset}`, author: "작성자", points: start + offset, num_comments: 2 }));

export const pagingApp: AppDefinition = {
  id: "paging-test", name: "쪽 넘김 시험", requires: { blocks: 28, modules: { connection: 1 } },
  permissions: [{ module: "connection", id: "api", connection: "example", label: "API", access: "read" }, { module: "connection", id: "alternate", connection: "example", label: "다른 연결", access: "read" }],
  state: { tab: 0 },
  sources: {
    list_items: { kind: "request", permission: "api", path: "/items", page: { param: "cursor", next: "next", items: "items" } },
    table_rows: { kind: "request", permission: "alternate", path: "/rows", page: { param: "cursor", next: "next", items: "items" } },
    horizontal_rows: { kind: "request", permission: "api", path: "/horizontal", page: { param: "cursor", next: "next", items: "items" } },
    grid_items: { kind: "request", permission: "api", path: "/grid", page: { param: "cursor", next: "next", items: "items" } },
    icon_items: { kind: "request", permission: "api", path: "/icons", page: { param: "cursor", next: "next", items: "items" } },
  },
  ui: { type: "tabs", selected: { state: "tab" }, on_change: { set_state: "tab" }, tabs: [
    { label: "목록", child: { type: "stack", direction: "column", children: [
      { type: "toolbar", start: [{ type: "button", label: "새로 받기", on_click: [{ refresh: ["list_items"] }] }] },
      { type: "list", items: { expr: "$data.list_items.items" } },
    ] } },
    { label: "표", child: { type: "stack", direction: "column", children: [
      { type: "toolbar", start: [{ type: "button", label: "새로 받기", on_click: [{ refresh: ["table_rows"] }] }] },
      { type: "table", rows: { expr: "$data.table_rows.items" }, columns: [{ field: "name", label: "이름" }] },
    ] } },
    { label: "가로 반복", child: { type: "repeat", layout: "row", virtual: true, key: "key", items: { expr: "$data.horizontal_rows.items" }, template: { type: "text", value: { item: "title" } } } },
    { label: "가로 폭 시험", child: { type: "table", rows: { expr: "$data.table_rows.items" }, columns: [{ field: "name", label: "이름", width: "wide" }, { field: "title", label: "제목", width: "wide" }] } },
    { label: "피드 시험", child: { type: "feed", entries: { expr: "$data.list_items.items" } } },
    { label: "격자 반복", child: { type: "repeat", layout: "grid", virtual: true, key: "key", items: { expr: "$data.list_items.items" }, template: { type: "text", value: { item: "title" } } } },
    { label: "격자 목록", child: { type: "list", layout: "grid", items: { expr: "$data.grid_items.items" } } },
    { label: "아이콘 목록", child: { type: "list", layout: "icons", items: { expr: "$data.icon_items.items" } } },
  ] },
};

export const pagingComparisonApp: AppDefinition = {
  id: "paging-comparison", name: "기존 오류 화면", requires: { blocks: 22, modules: { connection: 1 } },
  permissions: [{ module: "connection", id: "api", connection: "example", label: "API", access: "read" }],
  state: { locale: "ko" }, locale: { state: "locale" }, messages: { ko: {} },
  sources: { failed: { kind: "request", permission: "api", path: "/failed" } },
  ui: { type: "stack", direction: "column", children: [
    { type: "properties", fields: [{ label: "속성", value: { expr: "$data.failed.value" } }] },
    { type: "button", label: { message: "missing" }, on_click: [] },
    { type: "list", items: { expr: "$data.failed.items" } },
  ] },
};

export const pagingSplitApp: AppDefinition = {
  ...pagingApp, id: "paging-split-test", name: "분할 칸 쪽 넘김", state: {},
  ui: { type: "split", direction: "row", sizes: [50, 50], children: [
    { type: "table", rows: { expr: "$data.table_rows.items" }, columns: [{ field: "name", label: "이름" }] },
    { type: "list", items: { expr: "$data.list_items.items" } },
  ] },
};

export const pagingSeeds: Record<string, FakeSourceSeed> = {
  ...Object.fromEntries(["grid_items", "icon_items"].map((source) => [source, { delayMs: source === "icon_items" ? 1200 : 0, pages: [
    { value: { items: [{ key: "1", title: "첫 칸" }], next: "2" } },
    { value: { items: [{ key: "2", title: "둘째 칸" }], next: "3" }, delayMs: 1200 },
    { value: { items: [{ key: "3", title: "셋째 칸" }], next: null }, delayMs: 500 },
  ] }])),
  stories: { pages: [
    { value: { hits: stories(1), page: 0, nbPages: 2 } },
    { value: { hits: stories(31), page: 1, nbPages: 2 }, delayMs: 600 },
  ] },
  list_items: { pages: [
    { value: { items: items(1), next: "2" } },
    { error: "다음 쪽을 받지 못했습니다", id: "DATA_TEST_PAGE_FAILED", delayMs: 1200 },
    { value: { items: items(31), next: null }, delayMs: 600 },
  ] },
  table_rows: { pages: [
    { value: { items: items(1), next: "2" } },
    { value: { items: items(31), next: null }, delayMs: 1200 },
  ] },
  horizontal_rows: { pages: [
    { value: { items: items(1), next: "2" } },
    { value: { items: items(31), next: null } },
  ] },
};
