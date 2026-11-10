import type { AppDefinition } from "../../src/contract/contract";

// 블록 세트 60의 데이터 트리 바로 입력, 끌어 옮기기와 구역 메뉴, 이름 바꾸기를 눈으로 확인하는 앱 정의.
// 화면은 앱 고유의 것을 담지 않는 시험용이며, 상태 갱신은 모두 단순 set_state로 둔다.
// 구역 둘(짧은 쪽과 칸보다 긴 쪽)을 두어 트리 사이 끌기, 트리 밖 끌기, 긴 목록 끝 바로 입력을 함께 다룬다.

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

const longRows = Array.from({ length: 22 }, (_, index) => ({
  key: `n${index + 1}`, title: `다음 항목 ${index + 1}`, checked: false,
}));

export const treeEditMoveApp: AppDefinition = {
  id: "tree-edit-move-1112", name: "작업 목록", requires: { blocks: 60, modules: {} }, permissions: [],
  state: {
    sections: [
      { key: "g1", title: "이번 주", editing: false, rows: [
        { key: "a", title: "설계 정리", checked: false },
        { key: "b", title: "시험 실행", checked: true, children: [{ key: "b1", title: "단위 시험", checked: false }] },
        { key: "c", title: "배포 준비", checked: false },
      ] },
      { key: "g2", title: "다음 주", editing: false, rows: longRows },
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
        { set_state: "sections", value: { expr: '$map($state.sections, function($s){ $s.editing ? $merge([$s, {"title": $event, "editing": false}]) : $s })' } },
      ],
      on_edit_cancel: [{ set_state: "sections", value: { expr: '$map($state.sections, function($s){ $merge([$s, {"editing": false}]) })' } }],
      actions: [{ type: "button", label: "+", on_click: [
        { set_state: "sections", value: { expr: '$map($state.sections, function($s){ $s.key = $item.key ? $merge([$s, {"rows": $append($s.rows, [{"key": "new-" & $s.key, "title": "", "checked": false, "editing": true}])}]) : $s })' } },
      ] }],
      child: { type: "tree", items: { item: "rows" }, by: "children", default_expanded: true,
        item_menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "sections", value: { expr: deepRename } }] }],
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
    { type: "text", style: "meta", value: { expr: '"마지막 이동: " & ($state.lastMove ? $state.lastMove : "없음")' } },
    { type: "text", style: "meta", value: { expr: '"마지막 이름: " & ($state.lastEdit ? $state.lastEdit : "없음")' } },
  ] },
};
