import type { AppDefinition } from "../../src/contract/contract";
import stackFillRegressions from "./stack-fill-regressions.json";

const base = { requires: { blocks: 20, modules: {} }, permissions: [] };
const rows = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `항목 ${i}` }));
export const shellDefectFixtures = [
  ...stackFillRegressions,
  { ...base, id: "list-row-fit-940", name: "목록 줄 축소", state: {}, ui: { type: "list", grouped: true, items: [{ title: "묶음", items: Array.from({ length: 20 }, (_, i) => ({ key: String(i), title: `@작성자_${i}`, subtitle: "말줄임으로 표시할 아주 긴 부제입니다. ".repeat(8), color: "#804080", meta: "11/03", badges: ["고치는 중"] })) }] } },
  ...(["grid", "icons"] as const).map((layout) => ({ ...base, requires: { blocks: 30, modules: {} }, id: `layout-940-${layout}`, name: "그림 목록", state: {}, ui: { type: "tabs", tabs: [
    { label: "그림", child: { type: "stack", direction: "column", children: [
      { type: "input", label: "찾기", label_position: "top", value: "", on_change: [] },
      { type: "list", layout, items: Array.from({ length: 6 }, (_, i) => ({ key: String(i), title: `그림 ${i + 1}` })) },
    ] } },
  ] } })),
  { ...base, id: "layout-940", name: "목록 배치", state: { open: false, search: "", rows: [
    { key: "a", title: "목록의 긴 제목을 끝까지 볼 수 있어야 합니다", subtitle: "긴 부제도 볼 수 있어야 합니다", meta: "2026년 11월 5일 오후", badges: ["긴 배지 하나", "긴 배지 둘", "긴 배지 셋"] },
  ] }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "선택 열기", on_click: [{ set_state: "open", value: true }] },
    { type: "list", grouped: true, items: [{ title: "목록 묶음", items: [{ key: "a", title: "목록의 긴 제목을 끝까지 볼 수 있어야 합니다", subtitle: "긴 부제도 볼 수 있어야 합니다", meta: "2026년 11월 5일 오후", badges: ["긴 배지 하나", "긴 배지 둘", "긴 배지 셋"] }] }] },
    { type: "feed", grouped: true, entries: [{ title: "피드 묶음", items: [{ key: "f", name: "아주 길고 긴 작성자의 표시 이름입니다 표시 이름", meta: "@longusername", badges: ["운영자"], body: "본문" }] }] },
    { type: "dialog", title: "선택", open: { state: "open" }, on_close: [{ set_state: "open", value: false }], child: { type: "stack", direction: "column", children: [
      { type: "input", kind: "search", placeholder: "찾기", value: { state: "search" }, on_change: { set_state: "search" } },
      { type: "button", label: "결과 비우기", on_click: [{ set_state: "rows", value: [] }] },
      { type: "list", layout: "grid", items: { state: "rows" } },
    ] } },
  ] } },
  { ...base, id: "layout-940-table", name: "표 선택", state: { open: false }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "표 열기", on_click: [{ set_state: "open", value: true }] },
    { type: "dialog", title: "표 선택", open: { state: "open" }, on_close: [{ set_state: "open", value: false }], child: { type: "section", title: "항목", child: { type: "table", columns: [{ field: "title", label: "제목" }], rows: [{ key: "a", title: "하나" }] } } },
  ] } },
  { ...base, requires: { blocks: 37, modules: {} }, id: "stack-fill-list-fixture", name: "채움 시험", state: { first: "", second: "" }, ui: {
    type: "section", title: "답글", child: { type: "stack", direction: "column", gap: "small", fill: [0, 1], children: [
      { type: "input", label: "한국어", multiline: true, value: { state: "first" }, on_change: { set_state: "first" } },
      { type: "input", label: "영어", multiline: true, rows: 3, value: { state: "second" }, on_change: { set_state: "second" } },
      { type: "button", label: "올리기", on_click: [] },
    ] },
  } },
  { ...base, requires: { blocks: 21, modules: {} }, id: "input-autogrow-fixture", name: "여러 줄 입력", state: { text: "", fixed: "" }, ui: { type: "tabs", tabs: [
    { label: "입력", child: { type: "stack", direction: "column", gap: "small", children: [
      { type: "input", label: "한국어", multiline: true, value: { state: "text" }, on_change: { set_state: "text" } },
      { type: "input", label: "고정", multiline: true, rows: 3, value: { state: "fixed" }, on_change: { set_state: "fixed" } },
    ] } },
  ] } },
  { ...base, requires: { blocks: 21, modules: {} }, id: "input-inset-fixture", name: "입력 정렬", state: { first: "", second: "", nested: "", search: "", open: false }, ui: { type: "stack", direction: "column", children: [
    { type: "section", title: "기준 제목", child: { type: "stack", direction: "column", gap: "small", children: [
      { type: "input", placeholder: "첫 입력", value: { state: "first" }, on_change: { set_state: "first" } },
      { type: "input", placeholder: "둘째 입력", value: { state: "second" }, on_change: { set_state: "second" } },
      { type: "stack", direction: "column", children: [{ type: "input", placeholder: "중첩 입력", value: { state: "nested" }, on_change: { set_state: "nested" } }] },
    ] } },
    { type: "button", label: "찾기 열기", on_click: [{ set_state: "open", value: true }] },
    { type: "dialog", title: "찾기", open: { state: "open" }, on_close: [{ set_state: "open", value: false }], child: { type: "stack", direction: "column", children: [
      { type: "input", kind: "search", placeholder: "찾기 입력", value: { state: "search" }, on_change: { set_state: "search" } },
    ] } },
  ] } },
  { ...base, id: "stacked-list-fixture", name: "쌓인 목록", state: { first: "", second: "" }, ui: { type: "split", direction: "row", column_below: 700, children: [
    { type: "list", items: Array.from({ length: 100 }, (_, i) => ({ key: String(i), title: `첫 목록 ${i + 1}` })) },
    { type: "list", items: Array.from({ length: 100 }, (_, i) => ({ key: String(i), title: `둘째 목록 ${i + 1}` })) },
    { type: "stack", direction: "column", children: [
      { type: "input", placeholder: "첫 입력", value: { state: "first" }, on_change: { set_state: "first" } },
      { type: "input", placeholder: "둘째 입력", value: { state: "second" }, on_change: { set_state: "second" } },
      { type: "code", value: "작업 내용을 확인합니다.\n다음 줄입니다.", read_only: true },
    ] },
  ] } },
  { ...base, id: "long-tabs-fixture", name: "긴 탭 이름", state: {}, ui: { type: "tabs", tabs: [
    { label: "프로젝트의 아주 긴 이름과 여러 항목을 함께 살펴보는 상세 작업 화면과 변경 기록", child: { type: "text", value: "선택한 보기" } },
    { label: "상세 보기", child: { type: "text", value: "상세 내용" } },
    { label: "기록 보기", child: { type: "text", value: "기록 내용" } },
  ] } },
  { ...base, id: "notice-fixture", name: "알림 시험", state: { clicked: "대기" }, ui: { type: "stack", direction: "column", children: [
    { type: "toolbar", start: [
      { type: "button", label: "시작 단추", on_click: [{ set_state: "clicked", value: "시작 누름" }] },
    ], end: [
      { type: "button", label: "끝 단추 하나", on_click: [{ set_state: "clicked", value: "끝 누름" }] },
      { type: "button", label: "끝 단추 둘", on_click: [{ set_state: "clicked", value: "둘째 누름" }] },
    ] },
    { type: "text", value: { state: "clicked" } },
  ] } },
  ...[false, true].map((inTabs) => {
    const fields = { type: "stack", direction: "column", gap: "small", children: [
      { type: "input", label: "짧은 입력", label_position: "top", columns: 5, kind: "number", value: { state: "value" }, on_change: { set_state: "value" } },
      { type: "stack", direction: "row", align: "end", fill: 1, gap: "small", children: [
        { type: "input", label: "긴 입력", label_position: "top", columns: 12, value: { state: "value" }, on_change: { set_state: "value" } },
        { type: "button", label: "새 값", on_click: [] },
      ] },
      { type: "input", label: "기본", columns: 5, value: { state: "value" }, on_change: { set_state: "value" } },
    ] };
    return { ...base, requires: { blocks: 21, modules: {} }, id: inTabs ? "columns-tabs" : "columns-plain", name: "입력 폭 시험", state: { value: "12" }, ui: inTabs ? { type: "tabs", tabs: [{ label: "입력", child: fields }] } : fields };
  }),
  { ...base, id: "follow-fixture", name: "따라가기 시험", state: { active: null, rows }, ui: { type: "stack", direction: "column", fill: 1, children: [
    { type: "button", label: "마지막 항목", on_click: [{ set_state: "active", value: "29" }] },
    { type: "repeat", key: "id", items: { state: "rows" }, follow_key: { state: "active" }, template: { type: "text", value: { item: "name" } } },
  ] } },
  { ...base, id: "timeline-fixture", name: "시간축 시험", state: { open: false }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "대화상자 열기", on_click: [{ set_state: "open", value: true }] },
    { type: "timeline", controls: true, duration: 14.02, position: 3, tracks: [{ id: "track", label: "트랙", items: [] }] },
    { type: "dialog", title: "확인", open: { state: "open" }, on_close: [{ set_state: "open", value: false }], child: { type: "text", value: "내용" } },
  ] } },
  { ...base, requires: { blocks: 21, modules: {} }, id: "segmented-fixture", name: "고르기 시험", state: { value: "one" }, ui: { type: "tabs", tabs: [
    { label: "설정", child: { type: "select", style: "segmented", label: "선택", label_position: "hidden", value: { state: "value" }, on_change: { set_state: "value" }, options: ["one", "two"] } },
  ] } },
  { ...base, requires: { blocks: 21, modules: {} }, id: "row-fields-fixture", name: "가로 입력 시험", state: { value: "one", text: "내용", amount: 20 }, ui: { type: "stack", direction: "column", gap: "small", children: [
    { type: "stack", direction: "row", fill: 0, gap: "small", children: [
      { type: "slider", label: "크기", label_position: "hidden", show_value: false, min: 0, max: 100, value: { state: "amount" }, on_change: { set_state: "amount" } },
      { type: "button", label: "다음", on_click: [] },
    ] },
    { type: "stack", direction: "row", fill: 0, gap: "small", children: [
      { type: "select", label: "선택", label_position: "hidden", value: { state: "value" }, on_change: { set_state: "value" }, options: ["one", "two"] },
      { type: "button", label: "확인", on_click: [] },
    ] },
    { type: "stack", direction: "row", fill: 0, gap: "small", children: [
      { type: "input", label: "입력", label_position: "hidden", value: { state: "text" }, on_change: { set_state: "text" } },
      { type: "button", label: "저장", on_click: [] },
    ] },
    { type: "stack", direction: "row", fill: 1, gap: "small", children: [
      { type: "slider", label: "기본", min: 0, max: 100, value: { state: "amount" }, on_change: { set_state: "amount" } },
      { type: "button", label: "끝", on_click: [] },
    ] },
  ] } },
  { ...base, id: "tour-fixture", name: "안내 시험", state: { open: false, step: "first" }, ui: { type: "stack", direction: "column", children: [
    { type: "button", label: "안내 시작", on_click: [{ set_state: "open", value: true }] },
    { type: "anchor", id: "target", child: { type: "text", value: "목표" } },
    { type: "tour", open: { state: "open" }, step: { state: "step" }, steps: [{ key: "first", target: "target", title: "첫 단계", body: "설명" }], on_step: [{ set_state: "step" }], on_close: [{ set_state: "open", value: false }] },
  ] } },
] as unknown as AppDefinition[];
