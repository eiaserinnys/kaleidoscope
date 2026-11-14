// 이 파일은 crates/contract/src/data.rs의 ui_tables 시험이 만든다. 손으로 고치지 않는다.
//
// 블록 종류마다 화면 자리다. 코어의 own_slots와 child_blocks가 정본이다.

export interface BlockSlots {
  /** 블록 자신의 식 바인딩 자리. 블록 자리 기준 상대 경로다. */
  bindings: string[];
  /** 블록 자신의 동작 자리. 블록 자리 기준 상대 경로다. */
  actions: string[];
  /** 바로 아래 블록의 자리. 숫자로 바뀌는 마디는 `*`다. */
  children: string[];
}

export const BLOCK_SLOTS: Record<string, BlockSlots> = {
  repeat: { bindings: ["follow_key", "items"], actions: [], children: ["template"] },
  when: { bindings: ["value"], actions: [], children: ["child"] },
  dialog: { bindings: ["cancel_label", "close_label", "open", "title"], actions: ["on_close", "on_confirm"], children: ["child"] },
  tour: { bindings: ["labels/done", "labels/next", "labels/previous", "labels/skip", "open", "step", "steps/*/body", "steps/*/title"], actions: ["on_close", "on_step"], children: [] },
  anchor: { bindings: [], actions: [], children: ["child"] },
  progress: { bindings: ["label", "value"], actions: [], children: [] },
  canvas: { bindings: ["aspect_ratio", "description", "loading", "surface"], actions: ["on_pointer"], children: [] },
  timeline: { bindings: ["duration", "markers", "off_days", "position", "selection", "snap", "ticks", "tracks", "viewport"], actions: ["on_edit", "on_seek", "on_select", "on_viewport"], children: [] },
  sandbox: { bindings: ["value"], actions: [], children: [] },
  slider: { bindings: ["label", "value"], actions: ["on_change"], children: [] },
  color: { bindings: ["disabled", "label", "value"], actions: ["on_change"], children: [] },
  split: { bindings: [], actions: [], children: ["children/*"] },
  tree: { bindings: ["empty_text", "item_menu/*/confirm/body", "items"], actions: ["item_menu/*/on_select", "on_check", "on_edit", "on_edit_cancel", "on_move", "on_select"], children: [] },
  folder: { bindings: [], actions: ["on_select"], children: [] },
  markdown: { bindings: ["value"], actions: [], children: [] },
  html_view: { bindings: ["value"], actions: [], children: [] },
  chat: { bindings: ["loading"], actions: [], children: ["footer"] },
  web_view: { bindings: [], actions: [], children: [] },
  explorer: { bindings: [], actions: [], children: [] },
  stack: { bindings: ["scroll_reset"], actions: [], children: ["children/*"] },
  tabs: { bindings: ["tabs/*/label"], actions: [], children: ["tabs/*/child"] },
  toolbar: { bindings: [], actions: [], children: ["end/*", "start/*"] },
  section: { bindings: ["editing", "menu/*/confirm/body", "meta", "title"], actions: ["menu/*/on_select", "on_edit", "on_edit_cancel"], children: ["actions/*", "child"] },
  list: { bindings: ["current", "disabled", "item_menu/*/confirm/body", "items", "selected"], actions: ["group_actions/*/on_click", "item_menu/*/on_select", "on_activate", "on_remove", "on_select"], children: [] },
  table: { bindings: ["columns", "item_menu/*/confirm/body", "rows", "selected"], actions: ["item_menu/*/on_select", "on_select"], children: [] },
  properties: { bindings: ["fields/*/label", "fields/*/value"], actions: [], children: [] },
  feed: { bindings: ["entries", "item_menu/*/confirm/body"], actions: ["item_menu/*/on_select", "on_select"], children: [] },
  text: { bindings: ["value"], actions: ["on_click", "on_double_click"], children: [] },
  input: { bindings: ["disabled", "focus", "label", "max", "min", "options", "placeholder", "read_only", "step", "value"], actions: ["on_cancel", "on_change", "on_submit"], children: [] },
  select: { bindings: ["disabled", "label", "options", "placeholder", "value"], actions: ["on_change"], children: [] },
  toggle: { bindings: ["disabled", "label", "value"], actions: ["on_change"], children: [] },
  notice: { bindings: ["actions/*/label", "error_id", "message"], actions: ["actions/*/on_click"], children: [] },
  button: { bindings: ["confirm/body", "description", "disabled", "icon", "label", "prefix", "pressed", "variant"], actions: ["on_click"], children: ["preview"] },
  code: { bindings: ["value"], actions: [], children: [] },
  image: { bindings: ["src"], actions: [], children: [] },
  media: { bindings: ["src"], actions: [], children: [] },
  metrics: { bindings: ["items"], actions: [], children: [] },
  button_grid: { bindings: ["buttons"], actions: ["on_press"], children: [] },
  chart: { bindings: ["selected", "series"], actions: ["on_select"], children: [] },
  map: { bindings: ["points"], actions: ["on_select"], children: [] },
};
