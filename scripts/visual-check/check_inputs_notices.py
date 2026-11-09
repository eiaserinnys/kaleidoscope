#!/usr/bin/env python3
"""블록 입력과 알림 여섯 항목의 실화면 검수.

  1. 분할 고르기가 이름표의 대상을 빼앗지 않는지(이름표를 div로 둔다).
  2. (숫자 칸 글자 거르기는 단위 시험이 잰다. 여기서는 화면 배치를 보지 않는다.)
  3. 채움 칸의 줄 목록 대화상자가 창을 채우는지.
  4. 격자 칸이 화살표와 Tab으로 들어올 때만 점선 초점 테두리를 치고, 마우스로 다시 눌러도 남지 않는지.
  5. 알림 글이 단추 수와 상관없이 280px 바탕을 갖고, 좁은 창에서 단추가 다음 줄 오른쪽 끝으로 가는지.
  6. 알림 글 속 주소가 링크로 그려지고 뒤 문장부호가 링크 밖에 남는지.

  python3 scripts/visual-check/check_inputs_notices.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-views-test에 장면 정의를 주입하고 1180×720과 360×240에서 잰다.
실제 개인 앱 정의는 쓰지 않는다. 기본 산출 폴더는 target/visual-check/inputs-notices이고,
서버는 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
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
APP_ID = "data-views-test"
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
SIZES = ((1180, 720), (360, 240))
TOLERANCE = 1.0
# 알림 글의 flex 바탕. --ks-pane-min-size(160px) * 1.75.
MESSAGE_BASIS = 280.0

LONG_MESSAGE = "받지 못했습니다. 서버가 응답하지 않아 문서를 불러오지 못했습니다. 네트워크를 확인하고 잠시 뒤 다시 시도하세요."
retry = {"label": "다시 시도", "on_click": []}
notice_single = {"type": "notice", "kind": "error", "message": LONG_MESSAGE, "actions": [retry]}
notice_two = {"type": "notice", "kind": "error", "message": LONG_MESSAGE, "actions": [retry, {"label": "나중에", "on_click": []}]}
notice_url = {"type": "notice", "kind": "error", "message": "내려받지 못했습니다. https://example.com/app. 잠시 뒤 다시 시도하세요.", "actions": []}

list_items = [{"key": f"i{index}", "title": f"{index + 1}번째 항목"} for index in range(8)]
fill_dialog = {
    "type": "dialog", "open": True, "title": "항목 고르기", "on_close": [],
    "child": {"type": "stack", "direction": "column", "gap": "small", "fill": 1, "children": [
        {"type": "text", "value": "보낼 항목을 고르세요."},
        {"type": "list", "layout": "rows", "items": list_items},
    ]},
}
nofill_dialog = {
    "type": "dialog", "open": True, "title": "항목 고르기", "on_close": [],
    "child": {"type": "stack", "direction": "column", "gap": "small", "children": [
        {"type": "list", "layout": "rows", "items": list_items[:2]},
        {"type": "button", "label": "닫기", "on_click": []},
    ]},
}
segmented_select = {"type": "stack", "direction": "column", "gap": "medium", "children": [
    {"type": "select", "label": "형식", "label_position": "top", "style": "segmented", "value": {"state": "choice"}, "on_change": {"set_state": "choice"}, "options": ["하나", "둘"]},
    {"type": "text", "value": {"state": "choice"}},
]}
grid_rows = [{"key": f"r{index}", "a": f"{index + 1}-A", "b": f"{index + 1}-B"} for index in range(30)]
grid_table = {
    "type": "table",
    "rows": grid_rows,
    "columns": [{"field": "a", "label": "첫째"}, {"field": "b", "label": "둘째"}],
    "selection": "cell",
    "on_select": [],
}

# (이름, 정의, 판정 종류)
SCENES = [
    ("notice-center", {"type": "stack", "place": "center", "children": [notice_single]}, "notice"),
    ("notice-body", {"type": "stack", "direction": "column", "gap": "medium", "children": [{"type": "text", "value": "보낸 문서"}, notice_single]}, "notice"),
    ("notice-dialog", {"type": "dialog", "open": True, "title": "문서를 열지 못했습니다", "on_close": [], "child": {"type": "stack", "direction": "column", "gap": "medium", "children": [{"type": "text", "value": "서버가 응답하지 않았습니다."}, notice_single]}}, "notice"),
    ("notice-two-actions", {"type": "stack", "direction": "column", "gap": "medium", "children": [{"type": "text", "value": "보낸 문서"}, notice_two]}, "notice"),
    ("notice-url", {"type": "stack", "direction": "column", "gap": "medium", "children": [{"type": "text", "value": "보낸 문서"}, notice_url]}, "url"),
    ("dialog-fill-list", fill_dialog, "picker"),
    ("dialog-row-list", nofill_dialog, "no-picker"),
    ("select-segmented", segmented_select, "select"),
    ("grid", grid_table, "grid"),
]

NOTICE_JS = """(el) => {
  const notice = el.querySelector('.ks-notice');
  if (!notice) return { error: '알림을 찾지 못했습니다' };
  const message = notice.querySelector('.ks-notice-message');
  const actions = notice.querySelector('.ks-notice-actions');
  const cs = getComputedStyle(notice);
  const rect = (node) => node.getBoundingClientRect();
  return {
    noticeWidth: rect(notice).width,
    noticeInnerWidth: notice.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    contentRight: rect(notice).right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
    messageWidth: rect(message).width,
    messageBottom: rect(message).bottom,
    actionsTop: actions ? rect(actions).top : null,
    actionsRight: actions ? rect(actions).right : null,
    links: [...message.querySelectorAll('a')].map((link) => ({ text: link.textContent, href: link.getAttribute('href'), decoration: getComputedStyle(link).textDecorationLine })),
    text: message.textContent,
  };
}"""

DIALOG_JS = """() => {
  const overlay = document.querySelector('.ks-dialog-overlay');
  if (!overlay) return { error: '대화상자를 찾지 못했습니다' };
  const dialog = overlay.querySelector('.ks-dialog');
  if (!dialog) return { error: '대화상자 상자를 찾지 못했습니다' };
  return {
    isPicker: overlay.classList.contains('is-picker'),
    dialogHeight: dialog.getBoundingClientRect().height,
    dialogWidth: dialog.getBoundingClientRect().width,
    viewportHeight: window.innerHeight,
    rows: dialog.querySelectorAll('.ks-list-row, .ks-table-row').length,
    // 배치가 실제로 채움 칸으로 잡은 자식 수. is-picker 판정이 배치 규칙과 어긋나지 않는지 함께 본다.
    fillItems: dialog.querySelectorAll('.ks-data-stack-item.is-fill').length,
  };
}"""

SELECT_JS = """(el) => {
  const wrapper = el.querySelector('.ks-field.ks-select-field');
  const group = el.querySelector('[role="group"]');
  return {
    wrapperTag: wrapper ? wrapper.tagName : null,
    groupLabel: group ? group.getAttribute('aria-label') : null,
    buttons: [...el.querySelectorAll('button')].map((button) => button.textContent),
  };
}"""

GRID_INITIAL_JS = """() => {
  const first = document.querySelector('.ks-grid-cell[tabindex="0"]');
  if (!first) return { error: '격자 칸을 찾지 못했습니다' };
  const before = getComputedStyle(first, '::before');
  return { outlineStyle: before.outlineStyle, keyboardFocus: first.hasAttribute('data-keyboard-focus'), focusVisible: first.matches(':focus-visible') };
}"""

GRID_ACTIVE_JS = """() => {
  const cell = document.activeElement;
  if (!cell || !cell.classList || !cell.classList.contains('ks-grid-cell')) return { error: '격자 칸에 초점이 없습니다' };
  const before = getComputedStyle(cell, '::before');
  return {
    outlineStyle: before.outlineStyle,
    outlineWidth: before.outlineWidth,
    outlineColor: before.outlineColor,
    focusVisible: cell.matches(':focus-visible'),
    keyboardFocus: cell.hasAttribute('data-keyboard-focus'),
    label: cell.getAttribute('aria-label'),
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
        "() => window.__ksHarness && document.querySelector('[data-testid=app-window-data-views-test]')",
        timeout=120000,
    )
    page.evaluate(
        """async (layout) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === 'data-views-test');
          version.definition.state = { value: '', choice: '', selected: null, tab: 0 };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-views-test');
          win.app_version = version.version;
          win.state = { value: '', choice: '', selected: null, tab: 0 };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        ui,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def judge_notice(measurement, viewport_width):
    if measurement.get("error"):
        return {"measured": False}
    checks = {
        "message_min_basis": measurement["messageWidth"] + TOLERANCE >= min(measurement["noticeInnerWidth"], MESSAGE_BASIS),
    }
    if measurement["actionsTop"] is not None:
        checks["actions_right_aligned"] = abs(measurement["actionsRight"] - measurement["contentRight"]) <= TOLERANCE
        wrapped = measurement["actionsTop"] >= measurement["messageBottom"] - TOLERANCE
        # 좁은 창에서는 긴 글과 단추가 한 줄에 들어가지 않는다. 단추는 다음 줄 오른쪽 끝으로 간다.
        if viewport_width <= 360:
            checks["actions_wrapped"] = wrapped
            checks["message_full_when_wrapped"] = (not wrapped) or abs(measurement["messageWidth"] - measurement["noticeInnerWidth"]) <= TOLERANCE
    return checks


def judge_url(measurement):
    if measurement.get("error"):
        return {"measured": False}
    links = measurement["links"]
    return {
        "single_link": len(links) == 1,
        "link_address": len(links) == 1 and links[0]["href"] == "https://example.com/app",
        "link_underlined": len(links) == 1 and links[0]["decoration"] == "underline",
        "punctuation_outside": len(links) == 1 and not links[0]["text"].endswith("."),
        "message_keeps_text": measurement["text"] == "내려받지 못했습니다. https://example.com/app. 잠시 뒤 다시 시도하세요.",
    }


def run_grid(page, app, output, key_prefix):
    page.wait_for_timeout(200)
    initial = page.evaluate(GRID_INITIAL_JS)
    app.locator('.ks-grid-cell[tabindex="0"]').first.click()
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(150)
    after_arrow = page.evaluate(GRID_ACTIVE_JS)
    page.screenshot(path=str(output / f"{key_prefix}-after-arrow.png"), animations="disabled")
    active = page.evaluate("() => { const a = document.activeElement; return a && a.classList.contains('ks-grid-cell') ? a.getAttribute('aria-label') : null; }")
    if active is None:
        after_click = {"error": "화살표 이동이 칸에 초점을 두지 않았습니다"}
    else:
        app.locator(f'.ks-grid-cell[aria-label="{active}"]').click()
        page.wait_for_timeout(150)
        after_click = page.evaluate(GRID_ACTIVE_JS)
    page.screenshot(path=str(output / f"{key_prefix}-after-click-same.png"), animations="disabled")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.mouse.click(5, 5)
    for _ in range(3):
        page.keyboard.press("Tab")
        page.wait_for_timeout(100)
        probe = page.evaluate("() => document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('ks-grid-cell')")
        if probe:
            break
    after_tab = page.evaluate(GRID_ACTIVE_JS)
    page.screenshot(path=str(output / f"{key_prefix}-after-tab.png"), animations="disabled")
    return {
        "initial": initial,
        "after_arrow": after_arrow,
        "after_click_same": after_click,
        "after_tab": after_tab,
    }


def judge_grid(measurement):
    initial = measurement["initial"]
    arrow = measurement["after_arrow"]
    click = measurement["after_click_same"]
    tab = measurement["after_tab"]
    return {
        "initial_no_ring": initial.get("outlineStyle") == "none" and initial.get("keyboardFocus") is False,
        "arrow_ring": arrow.get("outlineStyle") == "dashed",
        "click_same_cell_no_ring": click.get("outlineStyle") != "dashed" and click.get("keyboardFocus") is False,
        "tab_entry_ring": tab.get("outlineStyle") == "dashed",
    }


def judge(kind, measurement, viewport_width):
    if kind == "notice":
        return judge_notice(measurement, viewport_width)
    if kind == "url":
        return judge_url(measurement)
    if kind == "picker":
        return {"picker": measurement.get("isPicker") is True and measurement.get("fillItems", 0) >= 1, "fills_height": measurement.get("dialogHeight", 0) >= measurement.get("viewportHeight", 0) * 0.5}
    if kind == "no-picker":
        return {"content_sized": measurement.get("isPicker") is False and measurement.get("fillItems", -1) == 0}
    if kind == "grid":
        return judge_grid(measurement)
    return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/inputs-notices")
    parser.add_argument("--port", type=int, default=5396)
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
            browser = playwright.chromium.launch()
            page = browser.new_page()
            for name, ui, kind in SCENES:
                for width, height in SIZES:
                    app = open_scene(page, args.port, ui, width, height)
                    key = f"{name}-{width}x{height}"
                    if kind in ("picker", "no-picker"):
                        page.wait_for_selector(".ks-dialog-overlay .ks-dialog", timeout=30000)
                        page.wait_for_timeout(200)
                    if kind == "grid":
                        app.locator(".ks-grid-cell").first.wait_for()
                        measurement = run_grid(page, app, output, key)
                    elif kind == "select":
                        measurement = app.evaluate(SELECT_JS)
                        measurement["role_button_label"] = app.get_by_role("button", name="형식", exact=True).count()
                        measurement["role_button_option"] = app.get_by_role("button", name="하나", exact=True).count()
                        measurement["role_group_named"] = app.get_by_role("group", name="형식").count()
                    else:
                        measurement = app.evaluate(DIALOG_JS) if kind in ("picker", "no-picker") else app.evaluate(NOTICE_JS)
                    if kind != "grid":
                        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
                    checks = judge(kind, measurement, width)
                    if kind == "select":
                        checks.update({
                            "wrapper_div": measurement.get("wrapperTag") == "DIV",
                            "group_named": measurement.get("role_group_named") == 1,
                            # 예전에는 이름표가 첫 단추를 붙들어 그 단추의 이름이 자기 글자가 아니었다.
                            "first_button_keeps_own_name": measurement.get("role_button_option") == 1,
                        })
                    scenes[key] = {"measurement": measurement, "checks": checks}
                    failed = [check for check, ok in checks.items() if not ok]
                    failures.extend(f"{key}.{check}" for check in failed)
                    print(key, "FAIL " + ",".join(failed) if failed else "ok")
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
