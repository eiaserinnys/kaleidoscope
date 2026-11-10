import type { AppDefinition } from "../../src/contract/contract";

// 블록 세트 60의 데이터 트리 바로 입력·끌어 옮기기와 구역 메뉴·이름 바꾸기를 눈으로 확인하는 앱 정의.
// 화면은 앱 고유의 것을 담지 않는 시험용이며, 상태 갱신은 모두 단순 set_state로 둔다.

const itemsWithEditingFirst = '[{"key":"a","title":"설계 정리","checked":false,"editing":true},{"key":"b","title":"시험 실행","checked":true,"children":[{"key":"b1","title":"단위 시험","checked":false}]},{"key":"c","title":"배포 준비","checked":false}]';
// 앱이 이름 바꾸기 결과를 반영할 때처럼 editing 표시를 거둔다. 다시 이름 바꾸기를 열 수 있는 상태가 된다.
const clearEditing = '$map($state.items, function($v) { $merge([$v, {"editing": false}]) })';

export const treeEditMoveApp: AppDefinition = {
  id: "tree-edit-move-1112", name: "작업 목록", requires: { blocks: 60, modules: {} }, permissions: [],
  state: {
    sectionTitle: "이번 주",
    sectionEditing: false,
    items: [
      { key: "a", title: "설계 정리", checked: false },
      { key: "b", title: "시험 실행", checked: true, children: [{ key: "b1", title: "단위 시험", checked: false }] },
      { key: "c", title: "배포 준비", checked: false },
    ],
    lastMove: "",
    lastEdit: "",
    lastCheck: "",
  },
  ui: { type: "stack", direction: "column", children: [
    { type: "section", collapsible: true, title: { state: "sectionTitle" }, editing: { state: "sectionEditing" },
      menu: [
        { label: "구역 이름 바꾸기", on_select: [{ set_state: "sectionEditing", value: true }] },
        { label: "할 일 이름 바꾸기", on_select: [{ set_state: "items", value: { expr: itemsWithEditingFirst } }] },
      ],
      on_edit: [{ set_state: "sectionTitle", value: { expr: "$event" } }, { set_state: "sectionEditing", value: false }],
      on_edit_cancel: [{ set_state: "sectionEditing", value: false }],
      actions: [{ type: "button", label: "+", on_click: [{ set_state: "lastCheck", value: { expr: "$state.lastCheck" } }] }],
      child: { type: "tree", items: { state: "items" }, default_expanded: true,
        item_menu: [{ label: "이름 바꾸기", on_select: [{ set_state: "items", value: { expr: itemsWithEditingFirst } }] }],
        on_check: [{ set_state: "lastCheck", value: { expr: '$item.title & ": " & ($event ? "확인" : "해제")' } }],
        on_edit: [{ set_state: "lastEdit", value: { expr: "$event" } }, { set_state: "items", value: { expr: clearEditing } }],
        on_edit_cancel: [{ set_state: "lastEdit", value: "취소" }, { set_state: "items", value: { expr: clearEditing } }],
        on_move: [{ set_state: "lastMove", value: { expr: '$event.key & " → " & ($event.target ? $event.target : "끝") & " (" & $event.position & ")"' } }],
      } },
    { type: "text", style: "meta", value: { expr: '"마지막 이동: " & ($state.lastMove ? $state.lastMove : "없음")' } },
    { type: "text", style: "meta", value: { expr: '"마지막 이름: " & ($state.lastEdit ? $state.lastEdit : "없음")' } },
  ] },
};
