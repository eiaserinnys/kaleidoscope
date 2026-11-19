import type { AppDefinition } from "../../src/contract/contract";

const source = `(() => {
  const bridge = window.kaleidoscope;
  let sections = [
    {key:'a', title:'업무', rows:[{key:'a1',title:'계획 세우기'},{key:'a2',title:'자료 확인'}]},
    {key:'b', title:'개인', rows:[{key:'b1',title:'책 읽기'}]},
    {key:'c', title:'나중에', rows:[]}
  ];
  const publish = () => bridge.publish({sections});
  bridge.handle('move_section', ({event}) => {
    const index = sections.findIndex(s => s.key === event.key);
    const [moving] = sections.splice(index, 1);
    const target = sections.findIndex(s => s.key === event.target);
    sections.splice(target + (event.position === 'after' ? 1 : 0), 0, moving);
    publish();
  });
  bridge.handle('move_row', ({event}) => { bridge.publish({sections, lastMove: event.key + ' → ' + event.target}); });
  bridge.handle('rename', ({item}) => { sections = sections.map(s => ({...s, editing:s.key === item.key})); publish(); });
  bridge.handle('edit', ({item,event}) => { sections = sections.map(s => s.key === item.key ? {...s,title:event,editing:false} : s); publish(); });
  bridge.handle('cancel', () => { sections = sections.map(s => ({...s,editing:false})); publish(); });
  bridge.handle('remove', ({item}) => { sections = sections.filter(s => s.key !== item.key); publish(); });
  bridge.handle('add', () => {});
  publish();
})();`;
export const sectionMoveMedia = { "section-move-1705-client": URL.createObjectURL(new Blob([source], { type: "text/javascript" })) };
export const sectionMoveApp: AppDefinition = {
  id: "section-move-1705", name: "작업 목록", requires: { blocks: 66, modules: { assets: 1, client: 1 } }, permissions: [],
  assets: [{ id: "section-move-1705-client", version: 1 }],
  client: { runtime: "javascript", entry: { id: "section-move-1705-client", version: 1 }, inputs: {}, outputs: { sections: { default: [] }, lastMove: { default: "" } }, actions: ["move_section", "move_row", "rename", "edit", "cancel", "remove", "add"], commands: {}, state_keys: [], storage_entries: [] },
  state: {}, ui: { type: "repeat", items: { client: "sections" }, key: "key", layout: "column", gap: "small", template: {
    type: "section", title: { item: "title" }, collapsible: true, editing: { item: "editing" },
    on_move: { client: "move_section" }, on_edit: { client: "edit" }, on_edit_cancel: { client: "cancel" },
    menu: [{ label: "이름 바꾸기", on_select: { client: "rename" } },
      { label: "지우기", danger: true, confirm: { title: "묶음을 지울까요?", ok: "지우기" }, on_select: { client: "remove" } }],
    actions: [{ type: "button", label: "추가", icon: "plus", icon_only: true, on_click: { client: "add" } }],
    child: { type: "tree", items: { item: "rows" }, by: "children", empty_text: "할 일 없음", on_move: { client: "move_row" } },
  } },
};
