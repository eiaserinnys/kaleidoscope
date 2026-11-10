#!/usr/bin/env python3
"""카드 #1137 대화상자 스크롤 칸의 제목 밑 간격과 좌우 여백을 실측한다.

판정:
- 제목 아래와 스크롤 칸 위 사이 간격이 0보다 크고, 본문을 중간까지 내려도 값이 같다.
- 스크롤 전 첫 줄 위치가 제목 아래에서 --ks-space-2(8px)만큼 떨어져 있다(수정 전과 같음).
- 본문 내용의 좌우 여백이 스크롤바 유무와 관계없이 같고(양쪽 0), 스크롤바가 생겨도 본문 폭이 그대로다.
- 맨 위 상호작용 글과 단추의 초점 고리가 스크롤 칸 안에 들어온다.
- 선택기(is-picker) 대화상자에서 본문이 스크롤 칸 내용 상자를 채운다.
- 알림 자리가 채워지면 스크롤 칸 아래 초점 고리 자리가 본문 안쪽으로 옮겨진다.

장면:
- 확인 대화상자(짧은 본문), 긴 본문(맨 위 상호작용 글 + 단추 + 40줄), 긴 본문 중간 스크롤
- 선택기(채움 목록, 표), 알림 자리(?preview=notice-fixture + noticeFixture.alert)
- 설치 동의 하네스의 일반 설치와 바꾸기 갈래(modified-to-store), 창 동의 오버레이(showProcess)

크기와 테마: 넓은 창 1180×720(밝음), 최소 창 360×240(밝음·어두움). 설치 동의 장면은 쉘
최소 창이 그려지는 384×317을 쓴다(check_store_replace_consent.py와 같은 값). 설치 동의 장면은
그 스크립트와 같은 하네스 호출을 쓴다.

  python3 scripts/visual-check/check_dialog_scroll_edges.py --output <산출폴더> [--port 5402]

실패가 하나라도 있으면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
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
NOTICE_APP_ID = "notice-fixture"
STYLE = (
    "body { padding: 0; } .ks-harness { display: block; height: 100vh; } "
    ".ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"
)
DATA_SIZES = ((1180, 720), (360, 240))
CONSENT_SIZES = ((1180, 720), (384, 317))
TOLERANCE = 1.0

LONG_TEXT = "\n".join(f"{index + 1}번째 줄: 받은 문서를 확인하고 저장할 곳을 고릅니다." for index in range(40))
SLOT_MESSAGE = "내려받지 못했습니다. https://example.com/app. 잠시 뒤 다시 시도하세요."
list_items = [{"key": f"i{index}", "title": f"{index + 1}번째 항목"} for index in range(24)]
grid_rows = [{"key": f"r{index}", "a": f"{index + 1}-A", "b": f"{index + 1}-B"} for index in range(24)]

# 첫 줄에 초점 고리를 바깥으로 그리는 상호작용 글(ks-data-text.is-interactive)을 두어 위쪽 고리 자리를 잰다.
INTERACTIVE_TEXT = {"type": "text", "value": "문서 열기", "on_click": []}
TOP_BUTTON = {"type": "button", "label": "맨 위 단추", "on_click": []}

CONFIRM_UI = {
    "type": "dialog", "open": True, "title": "저장할까요?", "on_close": [], "on_confirm": [],
    "child": {"type": "text", "value": "되돌릴 수 없습니다."},
}
LONG_BODY_UI = {
    "type": "dialog", "open": True, "title": "문서 받기", "on_close": [], "on_confirm": [],
    "child": {"type": "stack", "direction": "column", "gap": "small", "children": [
        INTERACTIVE_TEXT,
        TOP_BUTTON,
        # 본문 전체 폭을 쓰는 띠라 스크롤바가 생길 때 좌우 여백 차이가 캡처에 드러난다.
        {"type": "notice", "kind": "info", "message": "본문 전체 폭을 쓰는 알림 띠입니다.", "actions": []},
        {"type": "text", "value": LONG_TEXT},
    ]},
}
PICKER_LIST_UI = {
    "type": "dialog", "open": True, "title": "항목 고르기", "on_close": [],
    "child": {"type": "stack", "direction": "column", "gap": "small", "fill": 1, "children": [
        {"type": "text", "value": "보낼 항목을 고르세요."},
        {"type": "list", "layout": "rows", "items": list_items},
    ]},
}
PICKER_TABLE_UI = {
    "type": "dialog", "open": True, "title": "항목 고르기", "on_close": [],
    "child": {
        "type": "table",
        "rows": grid_rows,
        "columns": [{"field": "a", "label": "첫째"}, {"field": "b", "label": "둘째"}],
        "selection": "cell",
        "on_select": [],
    },
}
SLOT_UI = {
    "type": "stack", "direction": "column", "children": [
        {"type": "text", "value": "본문"},
        {"type": "dialog", "open": True, "title": "문서 받기", "on_close": [], "on_confirm": [],
         "child": {"type": "text", "value": LONG_TEXT}},
    ],
}
CONSENT_SCENES = (
    ("consent-install", "async () => { window.installationHarness.show('light'); }"),
    (
        "consent-modified-to-store",
        "async () => { window.installationHarness.show('light', {}, 2, "
        "{ replacing: true, modified: true, store_url: 'https://apps.example.org/store', "
        "from_origin: { store_url: 'https://apps.example.org/store', store_app_id: 'clock', release: 2, digest: 'old-digest' } }); }",
    ),
)

MEASURE_JS = """() => {
  const round = (value) => Math.round(value * 100) / 100;
  const dialog = document.querySelector('.ks-dialog');
  if (!dialog) return { error: '대화상자를 찾지 못했습니다' };
  const title = dialog.querySelector(':scope > .ks-dialog-title');
  const scroll = dialog.querySelector(':scope > .ks-dialog-scroll');
  const body = scroll ? scroll.querySelector(':scope > .ks-dialog-body') : null;
  if (!title || !scroll || !body) return { error: '대화상자 구조를 찾지 못했습니다' };
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { left: round(box.left), top: round(box.top), right: round(box.right), bottom: round(box.bottom), width: round(box.width), height: round(box.height) };
  };
  const px = (value) => parseFloat(value) || 0;
  const dialogStyle = getComputedStyle(dialog);
  const scrollStyle = getComputedStyle(scroll);
  const bodyStyle = getComputedStyle(body);
  const dialogRect = rect(dialog);
  const contentLeft = dialogRect.left + px(dialogStyle.borderLeftWidth) + px(dialogStyle.paddingLeft);
  const contentRight = dialogRect.right - px(dialogStyle.borderRightWidth) - px(dialogStyle.paddingRight);
  const titleRect = rect(title);
  const scrollRect = rect(scroll);
  const bodyRect = rect(body);
  const slot = dialog.querySelector(':scope > .ks-dialog-notice-slot');
  const notice = slot ? slot.querySelector('.ks-notice') : null;
  const bodyLeft = bodyRect.left + px(bodyStyle.borderLeftWidth);
  const bodyRight = bodyRect.right - px(bodyStyle.borderRightWidth);
  return {
    titleBottom: titleRect.bottom,
    gap: round(scrollRect.top - titleRect.bottom),
    firstLine: round(bodyRect.top - titleRect.bottom),
    bodyLeftInset: round(bodyLeft - contentLeft),
    bodyRightInset: round(contentRight - bodyRight),
    bodyWidth: bodyRect.width,
    bodyHeight: bodyRect.height,
    bodyMarginTop: px(bodyStyle.marginTop),
    scrollClipTop: scrollRect.top,
    scrollClientWidth: scroll.clientWidth,
    scrollOffsetWidth: scroll.offsetWidth,
    scrollbarGutter: scrollStyle.scrollbarGutter,
    scrollPadTop: px(scrollStyle.paddingTop),
    scrollPadRight: px(scrollStyle.paddingRight),
    scrollPadBottom: px(scrollStyle.paddingBottom),
    scrollPadLeft: px(scrollStyle.paddingLeft),
    bodyPadTop: px(bodyStyle.paddingTop),
    bodyPadBottom: px(bodyStyle.paddingBottom),
    scrollTop: round(scroll.scrollTop),
    scrollHeight: scroll.scrollHeight,
    clientHeight: scroll.clientHeight,
    overflowY: scroll.scrollHeight > scroll.clientHeight + 1,
    scrollContentHeight: round(scroll.clientHeight - px(scrollStyle.paddingTop) - px(scrollStyle.paddingBottom)),
    notice: notice ? { left: round(rect(notice).left - contentLeft), right: round(contentRight - rect(notice).right), height: rect(notice).height } : null,
    space2: px(dialogStyle.getPropertyValue('--ks-space-2')),
    // --ks-dialog-ring은 calc() 토큰 그대로 돌아오므로 그 구성 값에서 센다.
    ring: px(dialogStyle.getPropertyValue('--ks-focus-width')) + px(dialogStyle.getPropertyValue('--ks-focus-offset')),
  };
}"""

RING_FOCUS_JS = """() => {
  const scroll = document.querySelector('.ks-dialog .ks-dialog-scroll');
  const body = scroll ? scroll.querySelector('.ks-dialog-body') : null;
  const target = body ? body.querySelector('.ks-data-text.is-interactive, button, .ks-text-input') : null;
  if (!target) return false;
  target.focus();
  scroll.scrollTop = 0;
  return true;
}"""

RING_MEASURE_JS = """() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.ks-dialog .ks-dialog-scroll');
  const active = document.activeElement;
  if (!scroll || !active || !scroll.contains(active)) {
    return { error: '스크롤 칸 안에 초점이 없습니다', active: active ? active.tagName : null };
  }
  const style = getComputedStyle(active);
  const box = active.getBoundingClientRect();
  const clip = scroll.getBoundingClientRect();
  const offset = parseFloat(style.outlineOffset) || 0;
  const width = parseFloat(style.outlineWidth) || 0;
  // 바깥 고리는 요소 상자에서 offset + width만큼 더 나간다. 안쪽 고리는 상자 안에 그려진다.
  const outwardBy = offset < 0 ? 0 : offset + width;
  return {
    tag: active.tagName,
    className: typeof active.className === 'string' ? active.className : '',
    focusVisible: active.matches(':focus-visible'),
    outlineStyle: style.outlineStyle,
    outlineWidth: width,
    outlineOffset: offset,
    outward: offset > 0,
    elementTop: round(box.top),
    clipTop: round(clip.top),
    ringTop: round(box.top - outwardBy),
    inside: box.top - outwardBy >= clip.top - 0.5,
    scrollTop: round(scroll.scrollTop),
  };
}"""


def wait_server(port):
    deadline = time.time() + 240
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/?preview={APP_ID}", timeout=5) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - 아직 뜨지 않은 서버는 다시 본다
            time.sleep(2)
    raise SystemExit("하네스 서버가 뜨지 않았습니다")


def settle(page):
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)


def capture(page, output, key):
    path = output / f"{key}.png"
    page.screenshot(path=str(path), animations="disabled")
    return str(path)


def open_data_scene(page, port, ui, app_id, app_state, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/?preview={app_id}")
    page.wait_for_function(
        "(id) => window.__ksHarness && document.querySelector(`[data-testid=app-window-${id}]`)",
        arg=app_id,
        timeout=120000,
    )
    page.evaluate(
        """async ([appId, layout, appState]) => {
          const harness = window.__ksHarness;
          const { snapshot } = await harness.call({ op: 'state.get' });
          const version = snapshot.shared.app_versions.find((v) => v.app_id === appId);
          version.definition.state = appState;
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === appId);
          win.app_version = version.version;
          win.state = appState;
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        [app_id, ui, app_state],
    )
    page.add_style_tag(content=STYLE)
    settle(page)
    page.wait_for_selector(".ks-dialog-overlay .ks-dialog", timeout=30000)
    return page.get_by_test_id(f"app-window-{app_id}")


def open_consent_scene(page, port, show, width, height, overlay=None):
    page.set_viewport_size({"width": width, "height": height})
    selector = f"{overlay or '.ks-dialog-overlay'} .ks-dialog"
    # 첫 장면에서 Vite가 의존성을 다시 최적화하며 문서를 갱신하면 하네스가 잠깐 사라진다. 그때는 다시 연다.
    for attempt in range(3):
        try:
            page.goto(f"http://127.0.0.1:{port}/installation-consent.html", wait_until="load")
            page.wait_for_function("() => Boolean(window.installationHarness)", timeout=60000)
            page.evaluate("async () => { await window.installationHarness.ready; }")
            page.evaluate(show)
            page.wait_for_selector(selector, timeout=30000)
            break
        except Exception:  # noqa: BLE001 - 문서가 다시 그려지는 동안의 실패는 한 번 더 시도한다
            if attempt == 2:
                raise
            page.wait_for_timeout(1000)
    settle(page)


def measure(page, reset=True):
    if reset:
        page.evaluate("() => { const scroll = document.querySelector('.ks-dialog .ks-dialog-scroll'); if (scroll) scroll.scrollTop = 0; }")
    page.wait_for_timeout(100)
    return page.evaluate(MEASURE_JS)


def scroll_middle(page):
    page.evaluate(
        "() => { const scroll = document.querySelector('.ks-dialog .ks-dialog-scroll');"
        " if (scroll) scroll.scrollTop = Math.round((scroll.scrollHeight - scroll.clientHeight) / 2); }"
    )
    page.wait_for_timeout(200)


def measure_ring(page):
    if page.evaluate(RING_FOCUS_JS) is not True:
        return {"error": "초점 대상이 없습니다"}
    check = page.evaluate(RING_MEASURE_JS)
    if check.get("focusVisible") is not True and not check.get("error"):
        # 누른 적 없는 초기 초점은 :focus-visible이 아닐 수 있다. 키보드로 오가게 해 고리를 그리게 한다.
        page.keyboard.press("Tab")
        page.keyboard.press("Shift+Tab")
        page.evaluate("() => { const scroll = document.querySelector('.ks-dialog .ks-dialog-scroll'); if (scroll) scroll.scrollTop = 0; }")
        check = page.evaluate(RING_MEASURE_JS)
        check["retried"] = True
    return check


def judge(kind, top, scrolled, require_overflow):
    if top.get("error"):
        return {"dialog_present": False}
    checks = {
        "dialog_present": True,
        "gap_positive": top.get("gap", 0) > TOLERANCE,
        "first_line_space_2": abs(top.get("firstLine", 0) - top.get("space2", 0)) <= TOLERANCE,
        "insets_symmetric_top": abs(top.get("bodyLeftInset", 0)) <= TOLERANCE and abs(top.get("bodyRightInset", 0)) <= TOLERANCE,
    }
    if require_overflow:
        checks["scrolls"] = top.get("overflowY") is True
    if scrolled is not None:
        checks["scrolled_is_scrolled"] = scrolled.get("scrollTop", 0) > 0
        checks["gap_stable"] = abs(scrolled.get("gap", 0) - top.get("gap", 0)) <= TOLERANCE
        checks["insets_symmetric_scrolled"] = abs(scrolled.get("bodyLeftInset", 0)) <= TOLERANCE and abs(scrolled.get("bodyRightInset", 0)) <= TOLERANCE
        checks["body_width_stable"] = abs(scrolled.get("bodyWidth", 0) - top.get("bodyWidth", 0)) <= TOLERANCE
        checks["body_left_stable"] = abs(scrolled.get("bodyLeftInset", 0) - top.get("bodyLeftInset", 0)) <= TOLERANCE
    if kind == "picker":
        checks["picker_fill"] = abs(top.get("bodyMarginTop", 0) + top.get("bodyHeight", 0) - top.get("scrollContentHeight", 0)) <= TOLERANCE
    if kind == "notice":
        checks["notice_present"] = top.get("notice") is not None
        checks["notice_bottom_rule"] = top.get("scrollPadBottom") == 0 and abs(top.get("bodyPadBottom", -1) - top.get("ring", 0)) <= TOLERANCE
    return checks


def run_scene(page, output, key, kind, opener, require_overflow, ring=False):
    opener()
    top = measure(page)
    captures = [capture(page, output, key)]
    scrolled = None
    if top.get("overflowY"):
        scroll_middle(page)
        scrolled = measure(page, reset=False)
        captures.append(capture(page, output, f"{key}-scrolled"))
    ring_measure = None
    if ring:
        ring_measure = measure_ring(page)
    checks = judge(kind, top, scrolled, require_overflow)
    if ring:
        checks["ring_visible"] = ring_measure.get("focusVisible") is True
        checks["ring_inside"] = ring_measure.get("inside") is True
    failed = [name for name, ok in checks.items() if not ok]
    print(key, json.dumps({"top": summary(top), "scrolled": summary(scrolled) if scrolled else None, "ring": ring_measure}, ensure_ascii=False),
          "FAIL " + ",".join(failed) if failed else "ok")
    return {
        "kind": kind,
        "top": top,
        "scrolled": scrolled,
        "ring": ring_measure,
        "checks": checks,
        "captures": captures,
    }


def summary(measurement):
    if not measurement or measurement.get("error"):
        return measurement
    return {
        "gap": measurement.get("gap"),
        "firstLine": measurement.get("firstLine"),
        "left": measurement.get("bodyLeftInset"),
        "right": measurement.get("bodyRightInset"),
        "width": measurement.get("bodyWidth"),
        "overflow": measurement.get("overflowY"),
        "scrollbar": (measurement.get("scrollOffsetWidth") or 0) - (measurement.get("scrollClientWidth") or 0),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/dialog-scroll-edges-1137")
    parser.add_argument("--port", type=int, default=5402)
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
    console = []
    scenes = {}
    try:
        wait_server(args.port)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            page = browser.new_page()
            page.on("console", lambda message: console.append({"type": message.type, "text": message.text}))

            def data_run(name, kind, ui, scheme, width, height, app_id=APP_ID, app_state=None, ring=False):
                page.emulate_media(color_scheme=scheme)
                key = f"{name}-{scheme}-{width}x{height}"
                return run_scene(
                    page, output, key, kind,
                    lambda: open_data_scene(page, args.port, ui, app_id, app_state if app_state is not None else {"value": "", "choice": "", "selected": None, "tab": 0}, width, height),
                    kind in ("long",), ring=ring,
                )

            def slot_run(name, scheme, width, height):
                page.emulate_media(color_scheme=scheme)
                key = f"{name}-{scheme}-{width}x{height}"

                def opener():
                    open_data_scene(page, args.port, SLOT_UI, NOTICE_APP_ID, {}, width, height)
                    page.evaluate("(message) => window.noticeFixture.alert(message)", SLOT_MESSAGE)
                    page.wait_for_selector(".ks-dialog-notice-slot .ks-notice-message", timeout=30000)
                    page.wait_for_timeout(200)

                return run_scene(page, output, key, "notice", opener, False)

            for scheme in ("light", "dark"):
                sizes = DATA_SIZES if scheme == "light" else (DATA_SIZES[1],)
                for width, height in sizes:
                    scenes[f"confirm-{scheme}-{width}x{height}"] = data_run("confirm", "short", CONFIRM_UI, scheme, width, height)
                    scenes[f"long-body-{scheme}-{width}x{height}"] = data_run("long-body", "long", LONG_BODY_UI, scheme, width, height, ring=True)
                    scenes[f"picker-list-{scheme}-{width}x{height}"] = data_run("picker-list", "picker", PICKER_LIST_UI, scheme, width, height)
                    scenes[f"picker-table-{scheme}-{width}x{height}"] = data_run("picker-table", "picker", PICKER_TABLE_UI, scheme, width, height)
                    scenes[f"notice-slot-{scheme}-{width}x{height}"] = slot_run("notice-slot", scheme, width, height)

            for name, show in CONSENT_SCENES:
                for scheme in ("light", "dark"):
                    sizes = CONSENT_SIZES if scheme == "light" else (CONSENT_SIZES[1],)
                    for width, height in sizes:
                        page.emulate_media(color_scheme=scheme)
                        key = f"{name}-{scheme}-{width}x{height}"
                        scenes[key] = run_scene(
                            page, output, key, "consent",
                            lambda show=show, width=width, height=height: open_consent_scene(page, args.port, show, width, height),
                            False,
                        )

            page.emulate_media(color_scheme="light")
            for scheme in ("light", "dark"):
                sizes = CONSENT_SIZES if scheme == "light" else (CONSENT_SIZES[1],)
                for width, height in sizes:
                    page.emulate_media(color_scheme=scheme)
                    key = f"consent-process-command-{scheme}-{width}x{height}"
                    scenes[key] = run_scene(
                        page, output, key, "consent",
                        lambda width=width, height=height: open_consent_scene(
                            page, args.port, "() => { window.installationHarness.showProcess('command'); }", width, height,
                            overlay=".ks-window-consent-overlay",
                        ),
                        False,
                    )
            browser.close()
    finally:
        server.stdin.close()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    failures = [f"{key}.{check}" for key, scene in scenes.items() for check, ok in scene["checks"].items() if not ok]
    font_rejections = sum(1 for item in console if "outside of Vite serving allow list" in item["text"])
    result = {"ok": not failures, "failures": failures, "font_rejections": font_rejections, "console": console, "scenes": scenes}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print("font-rejections", font_rejections, "console-errors", sum(1 for item in console if item["type"] == "error"))
    print("RESULT", "ok" if not failures else f"{len(failures)} failures", output / "result.json")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
