#!/usr/bin/env python3
"""카드 #1137의 쌓기 배치와 여백 결함 다섯 가지와 마크다운 표 넘침을 실측한다.

- 창 본문에 바로 놓인 진행 필드와 세로 쌓기 칸 안의 진행 필드가 좌우 12px 안쪽 여백을 갖는다.
- 창 몸통 세로 쌓기에 바로 둔 알림도 위 글과 같은 시작선과 대칭 여백을 쓴다. 가운데 쌓기,
  구역, 대화상자 안 알림은 그 컨테이너가 여백을 소유하므로 위치가 바뀌지 않는다.
- 탭 안 결정 줄 단추가 창 본문 결정 줄 단추와 같은 폭과 시작선을 쓴다. 결정 줄이 아닌 탭 단추는 폭을 채운다.
- 단추와 상태 글이 한 줄인 가로 줄을 결정 줄로 나누고, 글 칸이 단추와 세로 가운데를 맞춘다.
- 스스로 스크롤하는 반복 목록이 위아래로 더 볼 내용이 있으면 가장자리에 선을 그린다.
- 마크다운 편집기 3열 표가 최소 창에서 편집기 내용 폭을 넘지 않는다. 한 칸에 공백 없는
  긴 주소를 넣어 줄바꿈이 표 폭을 늘리지 않는지 본다. 스크롤바는 숨기지 않는다.
- 6열 표의 최소 창 넘침(알려진 한계 약 8px)은 판정하지 않고 기록값으로 남긴다.

  python3 scripts/visual-check/check_1137_stack_layout.py [--output 산출폴더] [--port 포트]

?preview=data-controls에 장면 정의를 주입하고 1180×720과 360×240에서 잰다. 표 장면은
?preview=md-editor의 내 폴더 파일 Kaleidoscope.md와 Create-plugins-preview.md, 그리고
긴 주소가 든 wide-table.md(실행 중에 만든다)를 쓴다.
기본 산출 폴더는 target/visual-check/stack-layout-1137이고, 서버는 이 체크아웃의
ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다. 실패가 하나라도 있으면 result.json과
캡처를 남긴 뒤 종료 코드 1로 끝난다.
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
APP_ID = "data-controls"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))
TOLERANCE = 1.0

rows = [{"key": str(i), "name": f"항목 {i + 1}"} for i in range(20)]
repeat_list = {
    "type": "repeat", "items": rows, "key": "key", "layout": "column", "gap": "small",
    "template": {"type": "section", "title": {"item": "name"}, "child": {"type": "text", "value": "한 줄"}},
}
toolbar = {"type": "toolbar", "start": [{"type": "text", "value": "받은 항목"}]}
input_ = {"type": "input", "value": {"state": "value"}, "on_change": [], "placeholder": "메모"}
button = {"type": "button", "label": "보내기", "on_click": []}
progress = {"type": "progress", "value": 40, "max": 100}
progress_stack = {"type": "stack", "direction": "column", "children": [progress]}
action_small = {"type": "stack", "direction": "column", "gap": "small", "fill": 1, "children": [toolbar, repeat_list, input_, button]}
tabbed_action = {"type": "tabs", "tabs": [{"label": "탭", "child": action_small}]}
tabbed_plain = {"type": "tabs", "tabs": [{"label": "탭", "child": {"type": "stack", "direction": "column", "children": [input_, button]}}]}
row_text = {
    "type": "stack", "direction": "row", "gap": "small",
    "children": [button, {"type": "text", "value": "3개 고름"}],
}
row_text_scene = {"type": "stack", "direction": "column", "gap": "small", "fill": 1, "children": [toolbar, repeat_list, row_text]}
# 채워진 목록(index 1) 뒤에 맨 끝 글이 붙은 장면. 목록이 스스로 스크롤한다.
edges_scene = {
    "type": "stack", "direction": "column", "fill": 1,
    "children": [toolbar, repeat_list, {"type": "text", "value": "맨 끝 글"}],
}

# 창 몸통 세로 쌓기에 바로 둔 알림. 위 글과 같은 시작선을 쓰는지 잰다.
notice = {"type": "notice", "kind": "info", "message": "서버 저장소 연결이 끊겨 변경을 저장하지 못했습니다.", "actions": []}
notice_text = {"type": "text", "value": "바로 위 글의 시작선"}
notice_gutter_scene = {"type": "stack", "direction": "column", "gap": "small", "children": [notice_text, notice]}
notice_center_scene = {"type": "stack", "direction": "column", "place": "center", "children": [notice]}
notice_section_scene = {"type": "section", "title": "알림", "child": {"type": "stack", "direction": "column", "gap": "small", "children": [notice_text, notice]}}
notice_dialog_scene = {"type": "stack", "direction": "column", "gap": "small", "children": [
    {"type": "button", "label": "대화상자 열기", "on_click": [{"set_state": "dialogOpen", "value": True}]},
    {"type": "dialog", "title": "알림", "open": {"state": "dialogOpen"}, "on_close": [{"set_state": "dialogOpen", "value": False}],
     "child": {"type": "stack", "direction": "column", "gap": "small", "children": [notice_text, notice]}},
]}
NOTICE_SCENES = [
    ("notice-gutter", notice_gutter_scene, "notice-gutter"),
    ("notice-center", notice_center_scene, "notice-center"),
    ("notice-section", notice_section_scene, "notice-in-container"),
    ("notice-dialog", notice_dialog_scene, "notice-in-container"),
]

# 한 칸에 공백 없는 긴 주소를 둔 3열 표. 줄바꿈하지 않으면 최소 폭이 창 내용 폭을 넘는다.
WIDE_URL = "https://example.org/very/long/path/segments/that/keeps/going/and/going/abcdefghijklmnopqrstuvwxyz"
WIDE_TABLE_DOCUMENT = f"""# 긴 주소가 든 표

| 항목 | 주소 | 상태 |
|---|---|---|
| 공지 | {WIDE_URL} | 열림 |
| 문서 | https://example.org/short | 닫힘 |
"""

SCENES = [
    ("progress-direct", progress, "progress-direct"),
    ("progress-stack", progress_stack, "progress-stack"),
    ("tab-row", tabbed_action, "button"),
    ("body-row", action_small, "button"),
    ("tab-plain", tabbed_plain, "button-fill"),
    ("row-text", row_text_scene, "row-text"),
]

PROGRESS_JS = """(el) => {
  const body = el.querySelector('.ks-data-window-body');
  const field = body.querySelector('.ks-data-progress-field');
  if (!field) return { error: '진행 필드를 찾지 못했습니다' };
  const item = field.closest('.ks-data-stack-item');
  const style = getComputedStyle(field);
  const itemStyle = item ? getComputedStyle(item) : null;
  return {
    fieldPaddingLeft: parseFloat(style.paddingLeft),
    fieldPaddingRight: parseFloat(style.paddingRight),
    itemPaddingLeft: itemStyle ? parseFloat(itemStyle.paddingLeft) : null,
    itemPaddingRight: itemStyle ? parseFloat(itemStyle.paddingRight) : null,
    space: parseFloat(getComputedStyle(body).getPropertyValue('--ks-space-3')),
  };
}"""

BUTTON_JS = """(el) => {
  const body = el.querySelector('.ks-data-window-body');
  const buttons = [...body.querySelectorAll('button')].filter((node) => node.getBoundingClientRect().height > 0);
  const button = buttons[buttons.length - 1];
  if (!button) return { error: '단추를 찾지 못했습니다' };
  const appRect = el.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  const panel = body.querySelector('.ks-data-tab-panel');
  const panelStyle = panel ? getComputedStyle(panel) : null;
  return {
    width: Math.round(rect.width * 100) / 100,
    left: Math.round((rect.left - appRect.left) * 100) / 100,
    right: Math.round((rect.right - appRect.left) * 100) / 100,
    panelInnerWidth: panel ? Math.round((panel.clientWidth - parseFloat(panelStyle.paddingLeft) - parseFloat(panelStyle.paddingRight)) * 100) / 100 : null,
  };
}"""

NOTICE_JS = """(el) => {
  const round = (value) => Math.round(value * 100) / 100;
  // 대화상자는 body로 포털되므로 대화상자 상자 안에서 잰다.
  const dialog = document.querySelector('.ks-dialog');
  const scope = dialog ?? el.querySelector('.ks-data-window');
  const container = dialog ?? el.querySelector('.ks-data-window-body');
  const notice = container.querySelector('.ks-notice');
  if (!notice) return { error: '알림을 찾지 못했습니다' };
  const scopeRect = scope.getBoundingClientRect();
  const rect = notice.getBoundingClientRect();
  const item = notice.closest('.ks-data-stack-item');
  const previous = item ? item.previousElementSibling : null;
  const text = previous ? previous.querySelector('.ks-data-text') : null;
  const textRect = text ? text.getBoundingClientRect() : null;
  return {
    left: round(rect.left - scopeRect.left),
    right: round(scopeRect.right - rect.right),
    width: round(rect.width),
    textLeft: textRect ? round(textRect.left - scopeRect.left) : null,
    textRight: textRect ? round(scopeRect.right - textRect.right) : null,
    centerDelta: round(rect.left - scopeRect.left - (scopeRect.right - rect.right)),
  };
}"""

ROW_TEXT_JS = """(el) => {
  const body = el.querySelector('.ks-data-window-body');
  const root = body.firstElementChild;
  const tail = [...root.children].filter((item) => getComputedStyle(item).display !== 'none').at(-1);
  const row = tail ? tail.querySelector('.ks-data-stack.is-row') : null;
  if (!row) return { hasActionTail: root.classList.contains('has-action-tail'), error: '결정 줄을 찾지 못했습니다' };
  const textItem = row.querySelector('.ks-data-stack-item:has(> .ks-data-text)');
  const text = row.querySelector('.ks-data-text');
  const button = row.querySelector('button');
  const center = (node) => { const box = node.getBoundingClientRect(); return (box.top + box.bottom) / 2; };
  return {
    hasActionTail: root.classList.contains('has-action-tail'),
    tailOutsideScroll: !tail.classList.contains('ks-stack-scroll'),
    textItemDisplay: textItem ? getComputedStyle(textItem).display : null,
    textPaddingTop: text ? parseFloat(getComputedStyle(text).paddingTop) : null,
    textPaddingBottom: text ? parseFloat(getComputedStyle(text).paddingBottom) : null,
    centerDelta: text && button ? Math.round(Math.abs(center(button) - center(text)) * 100) / 100 : null,
  };
}"""

EDGE_JS = """async (position) => {
  const view = document.querySelector('[data-testid=app-window-data-controls] .ks-data-window-body .ks-repeat');
  if (!view) return { error: '반복 목록을 찾지 못했습니다' };
  const max = view.scrollHeight - view.clientHeight;
  view.scrollTop = position === 'top' ? 0 : position === 'middle' ? Math.floor(max / 2) : view.scrollHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pseudo = (name) => {
    const style = getComputedStyle(view, name);
    return { content: style.content, height: style.height, background: style.backgroundColor, position: style.position };
  };
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.background = 'var(--ks-color-border)';
  document.body.append(probe);
  const borderColor = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return {
    position,
    scrollTop: view.scrollTop,
    max,
    clientHeight: view.clientHeight,
    scrollHeight: view.scrollHeight,
    before: pseudo('::before'),
    after: pseudo('::after'),
    lineWidth: getComputedStyle(view).getPropertyValue('--ks-line-width'),
    borderColor,
  };
}"""

MD_JS = """() => {
  const app = document.querySelector('[data-testid=app-window-md-editor]');
  const scroller = app.querySelector('.cm-scroller');
  const content = app.querySelector('.cm-content');
  const round = (value) => Math.round(value * 100) / 100;
  if (!scroller || !content) return { hasTable: false, tables: [], maxOverflow: 0 };
  const right = scroller.getBoundingClientRect().left + scroller.clientWidth;
  const tables = [...app.querySelectorAll('.ks-live-table')].map((table) => {
    const rect = table.getBoundingClientRect();
    return {
      width: round(rect.width),
      overflow: round(rect.right - right),
      cols: table.querySelectorAll('th').length,
    };
  });
  const contentRect = content.getBoundingClientRect();
  const style = getComputedStyle(content);
  const narrow = tables.filter((row) => row.cols < 4);
  const wide = tables.filter((row) => row.cols >= 4);
  return {
    hasTable: tables.length > 0,
    tables,
    maxOverflow: tables.length ? Math.max(...tables.map((row) => row.overflow)) : 0,
    maxNarrowOverflow: narrow.length ? Math.max(...narrow.map((row) => row.overflow)) : null,
    maxWideOverflow: wide.length ? Math.max(...wide.map((row) => row.overflow)) : null,
    wideTables: wide.length,
    tableWidth: narrow.length ? Math.max(...narrow.map((row) => row.width)) : tables.length ? Math.max(...tables.map((row) => row.width)) : null,
    contentClientWidth: content.clientWidth,
    contentInnerWidth: round(contentRect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
    scrollerClientWidth: scroller.clientWidth,
    scrollerOffsetWidth: scroller.offsetWidth,
    scrollerScrollWidth: scroller.scrollWidth,
  };
}"""


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}", timeout=5)
            return
        except Exception:
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def open_scene(page, port, ui, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={APP_ID}")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-controls]')",
        timeout=120000,
    )
    page.evaluate(
        """async (layout) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === 'data-controls');
          version.definition.state = { value: '', on: true, dialogOpen: false };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = { value: '', on: true, dialogOpen: false };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        ui,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def open_document(page, port, name, width, height, text=None):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview=md-editor")
    page.wait_for_function(
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-md-editor]')",
        timeout=120000,
    )
    page.evaluate(
        """async ({ file, text }) => {
          const harness = window.__ksHarness;
          await harness.call({ op: 'files.pick_folder', window_id: 'editor-window', permission: 'docs' });
          if (text !== null) await harness.call({ op: 'files.write', window_id: 'editor-window', permission: 'docs', path: file, text });
          const { snapshot } = await harness.call({ op: 'state.get' });
          const win = snapshot.shared.windows.find((w) => w.app_id === 'md-editor');
          win.state = { ...win.state, source: 1, current_file: file };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        {"file": name, "text": text},
    )
    page.wait_for_function("() => document.querySelector('[data-testid=app-window-md-editor] .cm-content')", timeout=120000)
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(400)


def scan_tables(page):
    """편집기를 끝까지 내리며 만난 표를 모아 최대 넘침을 돌려준다.

    편집기는 보이는 줄만 그리므로 한 화면에서 잰 표는 문서의 일부다. 160px씩 내리며
    매 화면의 표를 재고 넓은 표(6열)와 좁은 표(3열)의 최대 넘침을 따로 남긴다.
    화면 배율은 그대로 둔다.
    """
    page.evaluate("() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller'); if (scroller) scroller.scrollTop = 0; }")
    page.wait_for_timeout(200)
    seen = []
    for _ in range(120):
        measurement = page.evaluate(MD_JS)
        if measurement.get("hasTable"):
            seen.append(measurement)
        at_end = page.evaluate(
            "() => { const scroller = document.querySelector('[data-testid=app-window-md-editor] .cm-scroller');"
            " if (!scroller) return true; const before = scroller.scrollTop; scroller.scrollTop = before + 160;"
            " return scroller.scrollTop === before; }"
        )
        if at_end:
            break
        page.wait_for_timeout(120)
    final = page.evaluate(MD_JS)
    if final.get("hasTable"):
        seen.append(final)
    if not seen:
        return final

    def maximum(key):
        values = [item.get(key) for item in seen if item.get(key) is not None]
        return max(values) if values else None

    merged = dict(seen[-1])
    merged.update({
        "maxOverflow": maximum("maxOverflow"),
        "maxNarrowOverflow": maximum("maxNarrowOverflow"),
        "maxWideOverflow": maximum("maxWideOverflow"),
        "wideTables": maximum("wideTables"),
        "tableWidth": maximum("tableWidth"),
        "tables": [row for item in seen for row in item.get("tables", [])],
    })
    return merged


def judge_notice(measurement, kind):
    if measurement.get("error"):
        return {"notice_present": False}
    if kind == "notice-gutter":
        return {
            "notice_present": True,
            "left_matches_text": measurement.get("textLeft") is not None and abs(measurement.get("left", 0) - measurement["textLeft"]) <= TOLERANCE,
            "right_matches_text": measurement.get("textRight") is not None and abs(measurement.get("right", 0) - measurement["textRight"]) <= TOLERANCE,
            "inset_positive": measurement.get("left", 0) > TOLERANCE,
        }
    if kind == "notice-center":
        return {
            "notice_present": True,
            "centered": measurement.get("centerDelta") is not None and abs(measurement["centerDelta"]) <= TOLERANCE,
        }
    return {
        "notice_present": True,
        "left_matches_text": measurement.get("textLeft") is not None and abs(measurement.get("left", 0) - measurement["textLeft"]) <= TOLERANCE,
        "right_matches_text": measurement.get("textRight") is not None and abs(measurement.get("right", 0) - measurement["textRight"]) <= TOLERANCE,
    }


def judge_progress(measurement, direct):
    checks = {}
    if direct:
        checks["field_padding_left"] = abs(measurement.get("fieldPaddingLeft", 0) - measurement.get("space", 0)) <= TOLERANCE
        checks["field_padding_right"] = abs(measurement.get("fieldPaddingRight", 0) - measurement.get("space", 0)) <= TOLERANCE
    else:
        checks["item_padding_left"] = abs(measurement.get("itemPaddingLeft", 0) - measurement.get("space", 0)) <= TOLERANCE
        checks["item_padding_right"] = abs(measurement.get("itemPaddingRight", 0) - measurement.get("space", 0)) <= TOLERANCE
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/stack-layout-1137")
    parser.add_argument("--port", type=int, default=5394)
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
    scenes = {}
    failures = []
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            page = browser.new_page()
            for name, ui, kind in SCENES:
                for width, height in SIZES:
                    app = open_scene(page, args.port, ui, width, height)
                    key = f"{name}-{width}x{height}"
                    if kind in ("progress-direct", "progress-stack"):
                        measurement = app.evaluate(PROGRESS_JS)
                        checks = judge_progress(measurement, kind == "progress-direct")
                    elif kind == "button-fill":
                        measurement = app.evaluate(BUTTON_JS)
                        inner = measurement.get("panelInnerWidth") or 0
                        checks = {"fills_panel": measurement.get("width", 0) >= inner - TOLERANCE}
                    else:
                        measurement = app.evaluate(BUTTON_JS)
                        checks = {}
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    scenes[key] = {"measurement": measurement, "checks": checks}
            # 탭 결정 줄과 창 본문 결정 줄의 폭·시작선을 같은 뷰포트에서 맞춘다.
            for width, height in SIZES:
                tab = scenes[f"tab-row-{width}x{height}"]["measurement"]
                body = scenes[f"body-row-{width}x{height}"]["measurement"]
                checks = {
                    "same_width": abs(tab.get("width", 0) - body.get("width", 0)) <= TOLERANCE,
                    "same_left": abs(tab.get("left", 0) - body.get("left", 0)) <= TOLERANCE,
                    "same_right": abs(tab.get("right", 0) - body.get("right", 0)) <= TOLERANCE,
                }
                scenes[f"tab-row-{width}x{height}"]["checks"] = checks
            for name, ui, kind in SCENES:
                if kind in ("progress-direct", "progress-stack", "button"):
                    for width, height in SIZES:
                        key = f"{name}-{width}x{height}"
                        scene = scenes[key]
                        failed = [check for check, ok in scene["checks"].items() if not ok]
                        failures.extend(f"{key}.{check}" for check in failed)
                        print(key, scene["measurement"], "FAIL " + ",".join(failed) if failed else "ok")
            for width, height in SIZES:
                key = f"tab-plain-{width}x{height}"
                failed = [check for check, ok in scenes[key]["checks"].items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, scenes[key]["measurement"], "FAIL " + ",".join(failed) if failed else "ok")

            # 단추와 글이 한 줄인 결정 줄
            for width, height in SIZES:
                app = open_scene(page, args.port, row_text_scene, width, height)
                key = f"row-text-{width}x{height}"
                measurement = app.evaluate(ROW_TEXT_JS)
                checks = {
                    "has_action_tail": measurement.get("hasActionTail") is True,
                    "tail_outside_scroll": measurement.get("tailOutsideScroll") is True,
                    "text_item_flex": measurement.get("textItemDisplay") == "flex",
                    "text_padding_zero": measurement.get("textPaddingTop") == 0 and measurement.get("textPaddingBottom") == 0,
                    "center_matches": measurement.get("centerDelta") is not None and measurement.get("centerDelta") <= TOLERANCE,
                }
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                scenes[key] = {"measurement": measurement, "checks": checks}
                failed = [check for check, ok in checks.items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 창 몸통에 바로 둔 알림의 좌우 여백
            for name, ui, kind in NOTICE_SCENES:
                for width, height in SIZES:
                    app = open_scene(page, args.port, ui, width, height)
                    if name == "notice-dialog":
                        app.get_by_role("button", name="대화상자 열기").click()
                        page.wait_for_timeout(200)
                    key = f"{name}-{width}x{height}"
                    measurement = app.evaluate(NOTICE_JS)
                    checks = judge_notice(measurement, kind)
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 스크롤 가장자리 선
            for width, height in SIZES:
                open_scene(page, args.port, edges_scene, width, height)
                for position in ("top", "middle", "end"):
                    measurement = page.evaluate(EDGE_JS, position)
                    key = f"repeat-edges-{width}x{height}-{position}"
                    generated = lambda pseudo: pseudo.get("content") not in ("none", "normal")
                    checks = {
                        "after_only_when_more_below": generated(measurement["after"]) == (position != "end"),
                        "before_only_when_more_above": generated(measurement["before"]) == (position != "top"),
                        "line_height": measurement["after"]["height"] == measurement["lineWidth"] if generated(measurement["after"]) else True,
                        "line_color": measurement["after"]["background"] == measurement["borderColor"] if generated(measurement["after"]) else True,
                    }
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 마크다운 표 넘침. 6열 표의 최소 창 넘침은 알려진 한계라 판정하지 않고 기록한다.
            for width, height in SIZES:
                for name in ("Kaleidoscope.md", "Create-plugins-preview.md"):
                    open_document(page, args.port, name, width, height)
                    page.wait_for_timeout(300)
                    measurement = scan_tables(page)
                    key = f"md-table-{name.replace('.md', '')}-{width}x{height}"
                    # scrollerScrollWidth와 maxWideOverflow는 증거로만 남긴다.
                    checks = {
                        "table_present": measurement.get("hasTable") is True,
                        "narrow_tables_fit": measurement.get("maxNarrowOverflow") is not None and measurement.get("maxNarrowOverflow") <= TOLERANCE,
                    }
                    page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 한 칸에 공백 없는 긴 주소를 둔 3열 표. 줄바꿈이 표 폭을 내용 폭 안에 둔다.
            for width, height in SIZES:
                open_document(page, args.port, "wide-table.md", width, height, WIDE_TABLE_DOCUMENT)
                page.wait_for_timeout(300)
                measurement = scan_tables(page)
                key = f"md-table-wide-url-{width}x{height}"
                checks = {
                    "table_present": measurement.get("hasTable") is True,
                    "no_horizontal_overflow": measurement.get("maxNarrowOverflow") is not None and measurement.get("maxNarrowOverflow") <= TOLERANCE,
                }
                page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                scenes[key] = {"measurement": measurement, "checks": checks}
                failed = [check for check, ok in checks.items() if not ok]
                failures.extend(f"{key}.{check}" for check in failed)
                print(key, measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 기본 앱 불변 캡처
            for width, height in SIZES:
                page.set_viewport_size({"width": width, "height": height})
                page.goto(f"http://127.0.0.1:{args.port}/?preview=md-editor")
                page.wait_for_function("() => window.__ksHarness && document.querySelector('[data-testid=app-window-md-editor] .ks-data-window-body')", timeout=120000)
                page.add_style_tag(content=STYLE)
                page.evaluate("() => document.fonts.ready.then(() => undefined)")
                page.wait_for_timeout(300)
                page.screenshot(path=str(output / f"invariant-md-editor-{width}x{height}.png"), animations="disabled")
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    result = {"ok": not failures, "failures": failures, "scenes": scenes}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print("RESULT", "ok" if not failures else f"{len(failures)} failures", output / "result.json")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
