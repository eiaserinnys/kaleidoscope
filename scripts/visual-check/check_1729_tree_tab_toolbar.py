#!/usr/bin/env python3
"""셸 배치 검수 S1~S7의 장면을 찍고 잰다(카드 #1729, 단위 card1729-shell-2와 card1729-shell-3).

- tree-image-subtitle: 그림과 subtitle이 있는 트리(깊이 3까지). 같은 깊이 제목 x가 같고(±1px), 들여쓰기 한 단은
  그림 열 폭과 열 사이 간격의 합(--ks-control-height + --ks-space-2)이어서 자식 줄 그림의 왼쪽 x가 부모 줄 제목 x와
  같다(±1px). 그림 열은 목록 줄 그림과 같은 크기(--ks-control-height)다.
- tree-image-plain: 그림만 있는 트리. 제목 x가 같고 그림은 --ks-space-4(16px)이며 들여쓰기 한 단은 --ks-space-4다.
- tree-no-image: 그림 없는 트리. 제목 x와 행 높이를 기록하고 들여쓰기 한 단은 --ks-space-4다(고치기 전후 같아야 한다).
- tab-list: 탭 패널 안의 글 줄, list, tree. 탭 첫 단추 x, 글 x, list 행 내용 x, tree 행 내용 x가 같다(±1px).
  고른 행 배경은 패널 밖으로 나가지 않는다.
- pane-list: 칸에 바로 놓인 찾기 막대와 list. 찾기 칸 x와 list 행 내용 x를 기록한다(전후 같아야 한다).
- toolbar-form: 막대 다음 입력 묶음과, 같은 묶음을 탭 패널에 둔 비교 장면. 막대 아래 선에서 첫 이름표까지의 거리가
  탭 단추 아래에서 첫 이름표까지의 거리와 같다(±1px).
- toolbar-form-when: 같은 장면에 막대와 입력 묶음 사이에 그리지 않은 when 칸 둘을 끼운 것. 판정은 toolbar-form과 같다.
- toolbar-list: 막대 다음 list. 막대 아래 선에서 첫 줄까지의 거리를 기록한다(전후 같아야 한다).
- dialog-confirm-locked: confirm_disabled가 참인 대화상자. 확정 단추가 disabled다.
- dialog-select-focus: select 하나와 확정·취소 단추만 있는 대화상자를 「옮기기」 단추에서 Enter로 연 직후. 첫 초점이
  select 단추이고 키보드로 열었으니 초점 고리가 보인다. Enter는 목록을 열고, Esc는 열린 목록만 닫고(대화상자는 남고),
  다시 Esc는 대화상자를 닫는다.
- dialog-input-select-focus: 입력 칸 다음에 select가 있는 대화상자를 같은 방법으로 연 직후. 첫 초점은 입력 칸이고,
  그 입력 칸에서 Enter를 누르면 확정 단추를 누른 것과 같아 대화상자가 닫힌다(S8).

  python3 scripts/visual-check/check_1729_tree_tab_toolbar.py [--output 산출폴더] [--port 포트]

장면은 하네스 ?preview=data-controls의 앱 정의 ui를 바꿔 그린다(check_tab_panel_padding.py와 같은 꼴).
기본 산출 폴더는 target/visual-check/1729-tree-tab-toolbar이고, 그림과 measure.json을 남긴다.
판정이 하나라도 어긋나면 종료 코드 1로 끝난다.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SIZE = (1180, 720)
TOLERANCE = 1.0

PREVIEW_STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"

MEDIA_PERMISSION = {"id": "media", "module": "files", "access": "read", "label": "그림"}
LONG_TITLE = "서른 글자를 넘기는 아주 긴 제목으로 말줄임이 생기는지 보는 줄 항목"


def picture(index):
    return {"permission": "media", "path": "shapes.png" if index % 2 else "landscape.png"}


def tree_items(images, subtitles):
    def item(key, title, index, children=None):
        value = {"key": key, "title": title}
        if images:
            value["image"] = picture(index)
        if subtitles:
            value["subtitle"] = f"둘째 줄 {index}"
        if children:
            value["children"] = children
        return value
    return [
        item("root-a", "자식 있는 뿌리", 0, [item("child-a", "자식 줄", 1, [item("grandchild-a", "깊이 3 줄", 5)]), item("child-b", LONG_TITLE, 2)]),
        item("root-b", "자식 없는 뿌리", 3),
        item("root-c", LONG_TITLE, 4),
        {"key": "root-d", "title": "그림 없는 뿌리", **({"subtitle": "둘째 줄 5"} if subtitles else {})},
    ]


def tree_ui(images, subtitles):
    return {"type": "tree", "by": "children", "image_shape": "circle", "default_expanded": True, "items": tree_items(images, subtitles)}


LIST_ITEMS = [{"key": str(i), "title": f"목록 항목 {i}", "subtitle": f"둘째 줄 {i}", "image": picture(i)} for i in range(6)]
LIST = {"type": "list", "layout": "rows", "image_shape": "circle", "items": LIST_ITEMS}
PLAIN_LIST = {"type": "list", "layout": "rows", "items": [{"key": str(i), "title": f"항목 {i}"} for i in range(12)]}
FORM_FIELDS = [
    {"type": "input", "value": {"state": "title"}, "on_change": {"set_state": "title"}, "label": "제목", "kind": "text"},
    {"type": "input", "value": {"state": "body"}, "on_change": {"set_state": "body"}, "label": "요청", "kind": "text", "multiline": True},
    {"type": "select", "value": {"state": "node"}, "on_change": {"set_state": "node"}, "label": "노드", "placeholder": "노드 고르기",
     "options": [{"value": "a", "label": "노드 가"}, {"value": "b", "label": "노드 나"}]},
]
FORM = {"type": "stack", "direction": "column", "gap": "medium", "fill": 1, "children": [
    *FORM_FIELDS,
    {"type": "toolbar", "start": [], "end": [{"type": "button", "label": "취소", "on_click": []}, {"type": "button", "label": "만들기", "variant": "primary", "on_click": []}]},
]}
TITLE_TOOLBAR = {"type": "toolbar", "start": [{"type": "text", "value": "새 카드"}]}
HIDDEN = {"type": "when", "value": False, "child": {"type": "text", "value": "그리지 않는 칸"}}
SEARCH_TOOLBAR = {"type": "toolbar", "start": [
    {"type": "input", "value": {"state": "query"}, "on_change": {"set_state": "query"}, "kind": "search", "placeholder": "제목으로 찾기"},
], "end": [{"type": "button", "label": "새로", "icon": "plus", "icon_only": True, "on_click": []}]}


SELECT_FIELD = FORM_FIELDS[2]
NAME_FIELD = {"type": "input", "value": {"state": "title"}, "on_change": {"set_state": "title"}, "label": "이름", "kind": "text", "placeholder": "이름"}


OPEN_DIALOG_BUTTON = "옮기기"


def dialog_scene(child):
    return {"type": "stack", "direction": "column", "children": [
        {"type": "text", "value": "대화상자 뒤 본문"},
        {"type": "button", "label": OPEN_DIALOG_BUTTON, "on_click": [{"set_state": "dialog_open", "value": True}]},
        {"type": "dialog", "open": {"state": "dialog_open"}, "title": "옮길 곳", "close_label": "확정",
         "on_confirm": [{"set_state": "dialog_open", "value": False}], "on_close": [{"set_state": "dialog_open", "value": False}], "child": child},
    ]}


EDIT_KEY = "child-a"
EDIT_BUTTON = "이름 바꾸기"
EDIT_SCENES = ("tree-image-edit", "tree-no-image-edit")


def with_editing(items, key):
    """key 항목에 editing: true를 둔 사본."""
    return [{**item, **({"editing": True} if item["key"] == key else {}), **({"children": with_editing(item["children"], key)} if "children" in item else {})} for item in items]


def edit_scene(images, subtitles):
    """단추를 누르면 깊이 2 줄(child-a)이 바로 입력 줄로 바뀌는 트리. 누르기 전과 뒤를 같은 장면에서 잰다."""
    items = tree_items(images, subtitles)
    expr = f"$state.editing ? {json.dumps(with_editing(items, EDIT_KEY), ensure_ascii=False)} : {json.dumps(items, ensure_ascii=False)}"
    tree = {"type": "tree", "by": "children", "image_shape": "circle", "default_expanded": True, "items": {"expr": expr},
            "on_edit": [{"set_state": "editing", "value": False}], "on_edit_cancel": [{"set_state": "editing", "value": False}]}
    return col([{"type": "button", "label": EDIT_BUTTON, "on_click": [{"set_state": "editing", "value": True}]}, tree], fill=1)


def col(children, **extra):
    return {"type": "stack", "direction": "column", "gap": "none", **extra, "children": children}


def tabs(label, child):
    return {"type": "tabs", "tabs": [{"label": label, "child": child}, {"label": "다른 탭", "child": {"type": "text", "value": "비어 있음"}}]}


SCENES = {
    "tree-image-subtitle": tree_ui(True, True),
    "tree-image-plain": tree_ui(True, False),
    "tree-no-image": tree_ui(False, False),
    "tree-image-edit": edit_scene(True, True),
    "tree-no-image-edit": edit_scene(False, False),
    "tab-list": {"type": "split", "direction": "row", "children": [
        {"type": "text", "value": "왼쪽 칸"},
        tabs("목록", {"type": "stack", "direction": "column", "gap": "small", "fill": [1, 2], "children": [
            {"type": "text", "value": "패널 안 글 줄"}, LIST, tree_ui(True, True),
        ]}),
    ]},
    "pane-list": {"type": "split", "direction": "row", "children": [
        col([SEARCH_TOOLBAR, LIST], fill=1),
        {"type": "text", "value": "오른쪽 칸"},
    ]},
    "toolbar-form": {"type": "split", "direction": "row", "children": [
        col([TITLE_TOOLBAR, FORM], fill=1),
        tabs("설정", {"type": "stack", "direction": "column", "gap": "medium", "fill": 1, "children": [*FORM_FIELDS, {"type": "text", "value": "탭 패널 비교"}]}),
    ]},
    # 카드 앱의 오른쪽 칸처럼 막대와 입력 묶음 사이에 그리지 않은 when 칸이 끼어도 막대 다음으로 본다.
    "toolbar-form-when": {"type": "split", "direction": "row", "children": [
        col([TITLE_TOOLBAR, HIDDEN, HIDDEN, FORM], fill=3),
        tabs("설정", {"type": "stack", "direction": "column", "gap": "medium", "fill": 1, "children": [*FORM_FIELDS, {"type": "text", "value": "탭 패널 비교"}]}),
    ]},
    "toolbar-list": col([SEARCH_TOOLBAR, PLAIN_LIST], fill=1),
    "dialog-confirm-locked": {"type": "stack", "direction": "column", "children": [
        {"type": "text", "value": "대화상자 뒤 본문"},
        {"type": "dialog", "open": True, "title": "새 폴더", "close_label": "만들기", "confirm_disabled": {"expr": "$state.title = ''"},
         "on_confirm": [], "on_close": [],
         "child": {"type": "input", "value": {"state": "title"}, "on_change": {"set_state": "title"}, "label": "이름", "kind": "text", "placeholder": "폴더 이름"}},
    ]},
    "dialog-select-focus": dialog_scene(SELECT_FIELD),
    "dialog-input-select-focus": dialog_scene({"type": "stack", "direction": "column", "gap": "medium", "children": [NAME_FIELD, SELECT_FIELD]}),
}

STATE = {"title": "", "body": "", "node": None, "query": "", "picked": None, "dialog_open": False, "editing": False}

MEASURE_JS = """(root) => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const rows = [...root.querySelectorAll('[role="treeitem"]')].map((row) => {
    const name = row.querySelector('.ks-tree-name');
    const image = row.querySelector('.ks-tree-image');
    const columns = [...row.querySelectorAll(':scope > .ks-file-tree-icon')];
    const wrapper = row.closest('[data-tree-row]');
    return {
      key: row.getAttribute('data-tree-id'),
      title: name ? name.textContent : null,
      level: Number(row.getAttribute('aria-level')),
      wrapperTop: wrapper ? r(wrapper).top : null,
      wrapperHeight: wrapper ? r(wrapper).height : null,
      titleX: name ? r(name).left : null,
      imageX: image ? r(image).left : null,
      rowHeight: r(row).height,
      columns: columns.map((c) => ({ classes: c.className, width: r(c).width, empty: c.childElementCount === 0 })),
      imageWidth: image ? r(image).width : null,
      imageHeight: image ? r(image).height : null,
    };
  });
  const editRow = root.querySelector('.ks-file-tree-create-row');
  const editInput = editRow ? editRow.querySelector('.ks-text-input') : null;
  const editImage = editRow ? editRow.querySelector('.ks-tree-image') : null;
  const editWrapper = editRow ? editRow.closest('[data-tree-row]') : null;
  const tokens = getComputedStyle(root);
  const px = (name) => parseFloat(tokens.getPropertyValue(name));
  const tab = root.querySelector('[role="tab"]');
  const panel = root.querySelector('.ks-data-tab-panel:not([hidden])');
  const panelText = panel ? panel.querySelector('.ks-data-text') : null;
  const listRow = root.querySelector('.ks-list-row');
  const listContent = listRow ? listRow.firstElementChild : null;
  const treeRow = root.querySelector('[role="treeitem"]');
  const treeContent = treeRow ? treeRow.firstElementChild : null;
  const toolbar = root.querySelector('.ks-data-toolbar');
  const toolbarInput = toolbar ? toolbar.querySelector('.ks-data-input') : null;
  const labels = [...root.querySelectorAll('.ks-field-label')];
  const toolbarLabel = toolbar ? labels.find((l) => !panel || !panel.contains(l)) : null;
  const panelLabel = panel ? labels.find((l) => panel.contains(l)) : null;
  const dialog = root.querySelector('.ks-dialog');
  const confirm = dialog ? dialog.querySelector('.ks-dialog-confirm button') : null;
  const cancel = dialog ? [...dialog.querySelectorAll('.ks-dialog-actions button')].find((b) => !b.closest('.ks-dialog-confirm')) : null;
  const active = document.activeElement;
  return {
    documentHasFocus: document.hasFocus(),
    active: active && active !== document.body ? { tag: active.tagName.toLowerCase(), className: active.className, label: active.getAttribute('aria-label'), inDialogBody: Boolean(active.closest('.ks-dialog-body')), focused: active.matches(':focus'), focusVisible: active.matches(':focus-visible') } : null,
    dialogOpen: Boolean(dialog),
    menuOpen: Boolean(document.querySelector('[role="menu"]')),
    tokens: { space4: px('--ks-space-4'), space2: px('--ks-space-2'), controlHeight: px('--ks-control-height') },
    rows,
    editRow: editRow ? {
      key: editWrapper ? editWrapper.getAttribute('data-tree-row') : null,
      inputX: editInput ? r(editInput).left : null,
      inputHeight: editInput ? r(editInput).height : null,
      rowHeight: r(editRow).height,
      wrapperTop: editWrapper ? r(editWrapper).top : null,
      wrapperHeight: editWrapper ? r(editWrapper).height : null,
      imageX: editImage ? r(editImage).left : null,
      imageWidth: editImage ? r(editImage).width : null,
      largeImage: editRow.classList.contains('is-large-image'),
      columns: [...editRow.querySelectorAll(':scope > .ks-file-tree-icon')].map((c) => ({ classes: c.className, width: r(c).width, empty: c.childElementCount === 0 })),
    } : null,
    tabButtonX: tab ? r(tab).left : null,
    tabButtonBottom: tab ? r(tab).bottom : null,
    panelLeft: panel ? r(panel).left : null,
    panelTop: panel ? r(panel).top : null,
    panelTextX: panelText ? r(panelText).left : null,
    listRowLeft: listRow ? r(listRow).left : null,
    listRowTop: listRow ? r(listRow).top : null,
    listContentX: listContent ? r(listContent).left : null,
    treeRowLeft: treeRow ? r(treeRow).left : null,
    treeContentX: treeContent ? r(treeContent).left : null,
    toolbarLeft: toolbar ? r(toolbar).left : null,
    toolbarBottom: toolbar ? r(toolbar).bottom : null,
    toolbarInputX: toolbarInput ? r(toolbarInput).left : null,
    toolbarLabelTop: toolbarLabel ? r(toolbarLabel).top : null,
    panelLabelTop: panelLabel ? r(panelLabel).top : null,
    confirmDisabled: confirm ? confirm.disabled : null,
    confirmLabel: confirm ? confirm.textContent : null,
    cancelDisabled: cancel ? cancel.disabled : null,
  };
}"""


def close(left, right, tolerance=TOLERANCE):
    return left is not None and right is not None and abs(left - right) <= tolerance


def judge(name, m):
    checks = {}
    rows = m["rows"]
    by_level = {}
    for row in rows:
        by_level.setdefault(row["level"], []).append(row)
    if name in EDIT_SCENES:
        # 편집 전(rowsBefore)과 뒤(rows, editRow)를 비교한다. 입력 칸은 편집 전 그 줄의 제목 x에서 시작하고, 다른 줄은 움직이지 않는다.
        edited_id = f"item:{EDIT_KEY}"
        before = {row["key"]: row for row in m.get("rowsBefore", [])}
        after = {row["key"]: row for row in rows}
        edit = m.get("editRow")
        edited = before.get(edited_id)
        checks["edit_row_found"] = edit is not None and edited is not None and edit["key"] == edited_id
        if not checks["edit_row_found"]:
            return checks
        others = [key for key in before if key != edited_id]
        m["editInputX"] = edit["inputX"]
        m["editedTitleX"] = edited["titleX"]
        m["editRowHeight"] = edit["wrapperHeight"]
        m["editedRowHeight"] = edited["wrapperHeight"]
        m["otherRowsYShift"] = sorted({round(after[key]["wrapperTop"] - before[key]["wrapperTop"], 1) for key in others if key in after})
        checks["input_x_matches_title_x"] = close(edit["inputX"], edited["titleX"])
        checks["other_rows_keep_y"] = all(key in after and close(after[key]["wrapperTop"], before[key]["wrapperTop"]) for key in others)
        checks["edit_row_height_matches"] = close(edit["wrapperHeight"], edited["wrapperHeight"])
        checks["input_not_taller_than_row"] = edit["inputHeight"] is not None and edit["inputHeight"] <= edited["wrapperHeight"] + TOLERANCE
        if name == "tree-image-edit":
            checks["edit_columns_like_row"] = [c["classes"] for c in edit["columns"]] == [c["classes"] for c in edited["columns"]]
            checks["edit_shows_large_image"] = edit["imageX"] is not None and close(edit["imageWidth"], m["tokens"]["controlHeight"]) and close(edit["imageX"], edited["imageX"])
        else:
            checks["edit_one_column_no_image"] = len(edit["columns"]) == 1 and edit["imageX"] is None
        return checks
    if name.startswith("tree-"):
        # 부모 줄은 바로 앞에 나온 한 단계 얕은 줄이다.
        last_at_level = {}
        for row in rows:
            last_at_level[row["level"]] = row
            row["parentTitleX"] = last_at_level[row["level"] - 1]["titleX"] if row["level"] > 1 else None
        roots = by_level.get(1, [])
        children = by_level.get(2, [])
        nested = [row for row in rows if row["parentTitleX"] is not None]
        checks["has_rows"] = len(roots) >= 3 and len(children) >= 2 and len(by_level.get(3, [])) >= 1
        checks["same_depth_title_x"] = checks["has_rows"] and all(close(row["titleX"], level_rows[0]["titleX"]) for level_rows in by_level.values() for row in level_rows)
        # 들여쓰기 한 단: 큰 그림 트리(subtitle 있음)는 그림 열 폭 + 열 사이 간격, 그 밖은 --ks-space-4다.
        step = m["tokens"]["controlHeight"] + m["tokens"]["space2"] if name == "tree-image-subtitle" else m["tokens"]["space4"]
        m["indentStep"] = step
        m["indentMeasured"] = sorted({round(row["titleX"] - row["parentTitleX"], 1) for row in nested})
        checks["child_indent_one_step"] = checks["has_rows"] and all(close(row["titleX"] - row["parentTitleX"], step) for row in nested)
        if name == "tree-no-image":
            checks["one_column_rows"] = all(len(row["columns"]) == 1 for row in rows)
            checks["no_image"] = all(row["imageWidth"] is None for row in rows)
        else:
            if name == "tree-image-subtitle":
                m["childImageMinusParentTitle"] = sorted({round(row["imageX"] - row["parentTitleX"], 1) for row in nested if row["imageX"] is not None})
                checks["child_image_under_parent_title"] = checks["has_rows"] and all(close(row["imageX"], row["parentTitleX"]) for row in nested if row["imageX"] is not None)
            checks["two_columns_every_row"] = all(len(row["columns"]) == 2 for row in rows)
            widths = {round(row["imageWidth"]) for row in rows if row["imageWidth"] is not None}
            checks["one_image_size"] = len(widths) == 1
            expected = m["tokens"]["controlHeight"] if name == "tree-image-subtitle" else m["tokens"]["space4"]
            checks["image_size"] = all(close(row["imageWidth"], expected) and close(row["imageHeight"], expected) for row in rows if row["imageWidth"] is not None)
            checks["empty_image_column_same_width"] = all(len(row["columns"]) > 1 and close(row["columns"][1]["width"], expected) for row in rows)
    elif name == "tab-list":
        checks["text_matches_tab"] = close(m["panelTextX"], m["tabButtonX"])
        checks["list_matches_text"] = close(m["listContentX"], m["panelTextX"])
        checks["tree_matches_text"] = close(m["treeContentX"], m["panelTextX"])
        checks["list_row_inside_panel"] = m["listRowLeft"] is not None and m["listRowLeft"] >= m["panelLeft"] - TOLERANCE
        checks["tree_row_inside_panel"] = m["treeRowLeft"] is not None and m["treeRowLeft"] >= m["panelLeft"] - TOLERANCE
    elif name == "pane-list":
        checks["list_matches_search"] = close(m["listContentX"], m["toolbarInputX"])
    elif name.startswith("toolbar-form"):
        checks["labels_found"] = m["toolbarLabelTop"] is not None and m["panelLabelTop"] is not None
        gap_toolbar = m["toolbarLabelTop"] - m["toolbarBottom"] if checks["labels_found"] else None
        gap_tab = m["panelLabelTop"] - m["tabButtonBottom"] if checks["labels_found"] else None
        m["gapToolbarToLabel"] = gap_toolbar
        m["gapTabButtonToLabel"] = gap_tab
        m["gapPanelTopToLabel"] = m["panelLabelTop"] - m["panelTop"] if checks["labels_found"] else None
        checks["form_gap_matches_tab"] = close(gap_toolbar, gap_tab)
    elif name == "toolbar-list":
        m["gapToolbarToFirstRow"] = m["listRowTop"] - m["toolbarBottom"] if m["listRowTop"] is not None else None
        checks["list_found"] = m["gapToolbarToFirstRow"] is not None
    elif name == "dialog-confirm-locked":
        checks["confirm_disabled"] = m["confirmDisabled"] is True
        checks["cancel_enabled"] = m["cancelDisabled"] is False
    elif name == "dialog-select-focus":
        active = m["active"] or {}
        checks["first_focus_is_select"] = active.get("tag") == "button" and "ks-select-button" in (active.get("className") or "") and active.get("inDialogBody") is True
        checks["focus_ring_visible"] = active.get("focusVisible") is True
        checks["enter_opens_menu"] = m.get("menuAfterEnter") is True and m.get("dialogAfterEnter") is True
        checks["escape_closes_menu_only"] = m.get("menuAfterEscape") is False and m.get("dialogAfterEscape") is True
        checks["escape_closes_dialog"] = m.get("dialogAfterSecondEscape") is False
    elif name == "dialog-input-select-focus":
        active = m["active"] or {}
        checks["first_focus_is_input"] = active.get("tag") == "input" and active.get("inDialogBody") is True
        checks["enter_in_input_confirms"] = m.get("dialogAfterEnter") is False
    return checks


def open_dialog_by_keyboard(name, page, app):
    """select 첫 초점 장면은 실제 키보드 사용자처럼 단추에서 Enter로 대화상자를 연다."""
    if name not in ("dialog-select-focus", "dialog-input-select-focus"):
        return
    app.get_by_role("button", name=OPEN_DIALOG_BUTTON).focus()
    page.keyboard.press("Enter")
    app.locator(".ks-dialog").wait_for(state="attached", timeout=10000)
    page.wait_for_timeout(300)


def open_edit(name, page, app):
    """편집 장면: 편집 전 줄을 잰 뒤 단추로 깊이 2 줄의 바로 입력을 연다."""
    if name not in EDIT_SCENES:
        return {}
    before = app.evaluate(MEASURE_JS)
    app.get_by_role("button", name=EDIT_BUTTON).click()
    app.locator(".ks-file-tree-create-row").wait_for(state="attached", timeout=10000)
    page.wait_for_timeout(300)
    return {"rowsBefore": before["rows"]}


def interact(name, page, app):
    """그림을 찍은 뒤 키보드로 조작해 본 결과. 측정값에 합친다."""
    probe = "() => ({ menu: Boolean(document.querySelector('[role=\"menu\"]')), dialog: Boolean(document.querySelector('.ks-dialog')) })"
    result = {}
    if name == "dialog-input-select-focus":
        # 입력 칸에 초점이 있는 채로 Enter: 확정 단추를 누른 것과 같아 대화상자가 닫힌다.
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
        result["dialogAfterEnter"] = page.evaluate(probe)["dialog"]
        return result
    if name != "dialog-select-focus":
        return {}
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    state = page.evaluate(probe)
    result["menuAfterEnter"], result["dialogAfterEnter"] = state["menu"], state["dialog"]
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    state = page.evaluate(probe)
    result["menuAfterEscape"], result["dialogAfterEscape"] = state["menu"], state["dialog"]
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    result["dialogAfterSecondEscape"] = page.evaluate(probe)["dialog"]
    return result


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_scene(browser, port, ui):
    page = browser.new_page(viewport={"width": SIZE[0], "height": SIZE[1]})
    page.goto(f"http://127.0.0.1:{port}/?preview=data-controls")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)
    page.evaluate("""async ({ ui, state, permission }) => {
      const harness = window.__ksHarness;
      const { snapshot } = await harness.call({ op: "state.get" });
      const version = snapshot.shared.app_versions.find(v => v.app_id === "data-controls");
      version.definition.state = state;
      version.definition.ui = ui;
      version.definition.requires = { blocks: 67, modules: { files: 1 } };
      version.definition.permissions = [permission];
      version.definition.sources = {};
      version.version += 1;
      const win = snapshot.shared.windows.find(w => w.app_id === "data-controls");
      win.app_version = version.version;
      win.state = { ...state };
      harness.emit({ event: "state.changed", snapshot });
    }""", {"ui": ui, "state": STATE, "permission": MEDIA_PERMISSION})
    page.add_style_tag(content=PREVIEW_STYLE)
    app = page.get_by_test_id("app-window-data-controls")
    app.locator(".ks-data-window-body").first.wait_for(state="attached", timeout=120000)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    # 그림이 다 올 때까지 기다린다(없으면 바로 지나간다).
    page.wait_for_function("""() => [...document.querySelectorAll('.ks-media-thumbnail')].every(el => !el.classList.contains('is-loading'))""", timeout=30000)
    page.wait_for_timeout(500)
    return page, app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/1729-tree-tab-toolbar")
    parser.add_argument("--port", type=int, default=5417)
    parser.add_argument("--only", nargs="*", default=None, help="찍을 장면 이름")
    args = parser.parse_args()
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    output.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(
        ["node", "./harness/e2e-server.mjs"],
        cwd=ROOT / "ui",
        env={**os.environ, "KS_E2E_PORT": str(args.port)},
        stdin=subprocess.PIPE,
        stdout=open(output / "server.log", "w"),
        stderr=subprocess.STDOUT,
    )
    results = {}
    failures = []
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for name, ui in SCENES.items():
                if args.only and name not in args.only:
                    continue
                page, app = open_scene(browser, args.port, ui)
                try:
                    open_dialog_by_keyboard(name, page, app)
                    pre = open_edit(name, page, app)
                    measurement = app.evaluate(MEASURE_JS)
                    measurement.update(pre)
                    page.screenshot(path=str(output / f"{name}.png"), animations="disabled")
                    measurement.update(interact(name, page, app))
                    checks = judge(name, measurement)
                    results[name] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{name}.{check}" for check in failed)
                    summary = {k: v for k, v in measurement.items() if k not in ("rows", "rowsBefore")}
                    print(name, json.dumps(summary, ensure_ascii=False), "FAIL " + ",".join(failed) if failed else "ok", flush=True)
                    for row in measurement["rows"]:
                        print("  ", row["level"], round(row["titleX"] or -1, 1), round(row["imageX"] or -1, 1), round(row["rowHeight"], 1), row["imageWidth"], [c["width"] for c in row["columns"]], (row["title"] or "")[:12], flush=True)
                finally:
                    page.close()
            browser.close()
    finally:
        try:
            server.stdin.close()
        except Exception:
            pass
        server.terminate()
        try:
            server.wait(timeout=20)
        except Exception:
            server.kill()
    (output / "measure.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    if failures:
        print("FAILED:", ", ".join(failures), flush=True)
        return 1
    print("all ok", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
