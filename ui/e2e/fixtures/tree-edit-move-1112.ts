import type { AppDefinition } from "../../src/contract/contract";

// 블록 세트 60의 데이터 트리 바로 입력, 끌어 옮기기와 구역 메뉴, 이름 바꾸기를 눈으로 확인하는 앱 정의.
// 화면은 앱 고유의 것을 담지 않는 시험용이며, 상태 갱신은 모두 단순 set_state로 둔다.
// 구역 넷(짧은 쪽, 칸보다 긴 쪽, 빈 쪽, 이름을 받아들이지 않는 쪽)을 두어 트리 사이 끌기, 트리 밖 끌기,
// 긴 목록 끝 바로 입력, 빈 구역으로 끌기, 거절된 구역 이름을 함께 다룬다.

const deepEdit = '( $f := function($i){ $merge([$i, {"editing": false, "title": $i.key = $item.key ? $event : $i.title}]) }; '
  + '$deep := function($i){ $exists($i.children) ? $merge([$f($i), {"children": $map($i.children, $f)}]) : $f($i) }; '
  + '$map($state.sections, function($s){ $merge([$s, {"rows": $map($s.rows, $deep)}]) }) )';
const deepCancel = '( $keep := function($i){ $not($i.title = "" and $substring($i.key, 0, 4) = "new-") }; '
  + '$f := function($i){ $merge([$i, {"editing": false}]) }; '
  + '$deep := function($i){ $exists($i.children) ? $merge([$f($i), {"children": $map($filter($i.children, $keep), $f)}]) : $f($i) }; '
  + '$map($state.sections, function($s){ $merge([$s, {"rows": $map($filter($s.rows, $keep), $deep)}]) }) )';
const deepRename = '( $f := function($i){ $merge([$i, {"editing": $i.key = $item.key}]) }; '
  + '$deep := function($i){ $exists($i.children) ? $merge([$f($i), {"children": $map($i.children, $f)}]) : $f($i) }; '
  + '$map($state.sections, function($s){ $merge([$s, {"rows": $map($s.rows, $deep)}]) }) )';
const deepCheck = '( $f := function($i){ $i.key = $item.key ? $merge([$i, {"checked": $event}]) : $i }; '
  + '$deep := function($i){ $exists($i.children) ? $merge([$f($i), {"children": $map($i.children, $f)}]) : $f($i) }; '
  + '$map($state.sections, function($s){ $merge([$s, {"rows": $map($s.rows, $deep)}]) }) )';
// 접힌 부모 안에 바로 입력 항목을 넣는 하위 항목 추가.
const deepAdd = '( $new := function($i){ [{"key": "new-" & $i.key, "title": "", "checked": false, "editing": true}] }; '
  + '$deep := function($i){ $exists($i.children) '
  + '? $merge([$i, {"children": $append($append([], $map($i.children, $deep)), $i.key = $item.key ? $new($i) : [])}]) '
  + ': ($i.key = $item.key ? $merge([$i, {"children": $new($i)}]) : $i) }; '
  + '$map($state.sections, function($s){ $merge([$s, {"rows": $append([], $map($s.rows, $deep))}]) }) )';

const longRows = Array.from({ length: 22 }, (_, index) => ({
  key: `n${index + 1}`, title: `다음 항목 ${index + 1}`, checked: false,
}));

export const treeEditMoveApp: AppDefinition = {
  id: "tree-edit-move-1112", name: "작업 목록", requires: { blocks: 61, modules: {} }, permissions: [],
  state: {
    sections: [
      { key: "g1", title: "이번 주", editing: false, rows: [
        { key: "a", title: "설계 정리", checked: false },
        { key: "b", title: "시험 실행", checked: true, children: [{ key: "b1", title: "단위 시험", checked: false }] },
        { key: "c", title: "배포 준비", checked: false },
      ] },
      { key: "g2", title: "다음 주", editing: false, rows: longRows },
      { key: "g3", title: "빈 구역", editing: false, rows: [] },
      { key: "g4", title: "고정 구역", editing: false, rejectName: true, rows: [{ key: "d", title: "고정 항목", checked: false }] },
    ],
    // empty_text를 쓰는 트리 셋. 확인 상자가 없는 같은 트리 모양의 뿌리 행을 기준선으로 두고,
    // 글 없는 한 줄과 짧은 글 한 줄을 나란히 둔다.
    plainSections: [
      { key: "p1", title: "기준 구역", rows: [{ key: "r1", title: "기준 항목" }] },
      { key: "p2", title: "글 없는 빈 구역", rows: [], emptyText: "" },
      { key: "p3", title: "안내 글 빈 구역", rows: [], emptyText: "아직 항목이 없습니다" },
    ],
    lastMove: "",
    lastEdit: "",
  },
  ui: { type: "stack", direction: "column", children: [
    { type: "repeat", items: { state: "sections" }, key: "key", layout: "column", gap: "small", template: {
      type: "section", collapsible: true, title: { item: "title" }, editing: { item: "editing" },
      menu: [
        { label: "구역 이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"editing": $s.key = $item.key}]) })' } }] },
        { label: "첫 항목 이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"rows": $map($s.rows, function($r, $i){ $merge([$r, {"editing": $s.key = $item.key and $i = 0}]) }) }]) })' } }] },
      ],
      on_edit: [
        // rejectName 구역은 이름을 받아들이지 않는다. 값을 그대로 두고 editing만 끈다.
        { set_state: "sections", value: { expr: '$map($state.sections, function($s){ $s.editing ? ($s.rejectName = true ? $merge([$s, {"editing": false}]) : $merge([$s, {"title": $event, "editing": false}])) : $s })' } },
      ],
      on_edit_cancel: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"editing": false}]) })' } }],
      actions: [{ type: "button", label: "+", on_click: [
        { set_state: "sections", value: { expr: '$map($state.sections, function($s){ $s.key = $item.key ? $merge([$s, {"rows": $append($s.rows, [{"key": "new-" & $s.key, "title": "", "checked": false, "editing": true}])}]) : $s })' } },
      ] }],
      child: { type: "tree", items: { item: "rows" }, by: "children", default_expanded: true,
        item_menu: [
          { label: "이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: deepRename } }] },
          { label: "하위 항목 추가", on_select: [{ set_state: "sections", value: { expr: deepAdd } }] },
        ],
        on_check: [{ set_state: "sections", value: { expr: deepCheck } }],
        on_edit: [
          { set_state: "lastEdit", value: { expr: '$item.key & ": " & $event' } },
          { set_state: "sections", value: { expr: deepEdit } },
        ],
        on_edit_cancel: [
          { set_state: "lastEdit", value: { expr: '$item.key & ": 취소"' } },
          { set_state: "sections", value: { expr: deepCancel } },
        ],
        on_move: [{ set_state: "lastMove", value: { expr: '$event.key & " → " & ($event.target ? $event.target : "끝") & " (" & $event.position & ")"' } }],
      } },
    },
    { type: "repeat", items: { state: "plainSections" }, key: "key", layout: "column", gap: "small", template: {
      type: "section", collapsible: true, title: { item: "title" },
      child: { type: "tree", items: { item: "rows" }, by: "children", default_expanded: true,
        empty_text: { item: "emptyText" },
        on_move: [{ set_state: "lastMove", value: { expr: '$event.key & " → " & ($event.target ? $event.target : "끝") & " (" & $event.position & ")"' } }],
      },
    } },
    { type: "text", style: "meta", value: { expr: '"마지막 이동: " & ($state.lastMove ? $state.lastMove : "없음")' } },
    { type: "text", style: "meta", value: { expr: '"마지막 이름: " & ($state.lastEdit ? $state.lastEdit : "없음")' } },
  ] },
};

// 구역 반복 key가 구역 이름인 앱. 이름을 확정하면 그 구역이 새 key로 다시 만들어져 초점을 쥔 머리가 사라진다.
// 쉘의 같은 자리 초점 규칙이 새 구역의 접기 단추로 초점을 옮기는지 브라우저에서 확인한다.
export const treeNameKeyApp: AppDefinition = {
  id: "tree-name-key-1112", name: "이름이 key인 구역", requires: { blocks: 60, modules: {} }, permissions: [],
  state: {
    sections: [
      { title: "이번 주", editing: false, rows: [{ key: "a", title: "첫 항목" }] },
      { title: "다음 주", editing: false, rows: [{ key: "b", title: "둘째 항목" }] },
    ],
  },
  ui: { type: "stack", direction: "column", children: [
    { type: "repeat", items: { state: "sections" }, key: "title", layout: "column", gap: "small", template: {
      type: "section", collapsible: true, title: { item: "title" }, editing: { item: "editing" },
      menu: [
        { label: "구역 이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"editing": $s.title = $item.title}]) })' } }] },
      ],
      on_edit: [
        { set_state: "sections", value: { expr: '$map($state.sections, function($s){ $s.editing ? $merge([$s, {"title": $event, "editing": false}]) : $s })' } },
      ],
      on_edit_cancel: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"editing": false}]) })' } }],
      child: { type: "tree", items: { item: "rows" }, by: "children" },
    } },
  ] },
};
