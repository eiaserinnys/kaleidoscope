#!/usr/bin/env python3
"""카드 #1739 U2a 터치 조작의 화면을 WebKit iPad 흉내와 마우스 Chromium에서 잰다.

WebKit iPad 가로(1194x834, 1024x768, hasTouch)에서 다음을 캡처하고 잰다.
1. data-views 「긴 목록」의 행을 길게 누르면 누른 자리에 메뉴가 뜬다.
2. hover가 없는 기기에서 피드 복사 단추가 보인다(opacity 1).
3. 미디어 재생기의 손잡이가 보인다(hover: none 규칙이 걸려 있다).
4. 앱 창 제목줄을 두 번 누르면 창이 최대화되고, 손가락 기기의 창 크기 조절 손잡이가
   창 밖으로 넓어진다(16px/24px). html/body의 touch-action은 manipulation이다.

마우스 Chromium(1440x900)에서는 같은 네 장면을 마우스 조작으로 캡처한다. `--compare-before`에
이전 코드로 찍은 폴더를 주면 같은 이름의 PNG와 픽셀 단위로 비교한다. 이전 코드 캡처는 기준
파일로 되돌린 뒤 `--mouse-only --output <이전폴더>`로 먼저 찍어 만든다.

  python3 -P scripts/visual-check/check_1739_ipad_touch.py \
    [--root 저장소뿌리] [--compare-before 이전캡처폴더] [--output 산출폴더] [--port 47600] \
    [--ipad-only | --mouse-only]

기본 산출 폴더는 .local/visual/ipad-touch다. 판정이 하나라도 실패하면 1로 끝난다.
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
IPAD_SIZES = ((1194, 834), (1024, 768))
MOUSE_SIZE = (1440, 900)

POINTER_JS = """([type, x, y]) => {
  const target = type === "pointerdown" ? document.elementFromPoint(x, y) || document : document;
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true,
    button: 0, buttons: type === "pointerup" ? 0 : 1,
  }));
}"""

DOUBLE_TAP_JS = """([x, y]) => {
  const target = document.elementFromPoint(x, y) || document;
  for (const type of ["pointerdown", "pointerup"]) {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 9, pointerType: "touch", isPrimary: true,
      button: 0, buttons: type === "pointerdown" ? 1 : 0,
    }));
  }
}"""

MEDIA_QUERY_JS = """() => ({
  hoverNone: matchMedia("(hover: none)").matches,
  pointerCoarse: matchMedia("(pointer: coarse)").matches,
})"""

SLIDER_RULE_JS = """() => {
  const found = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
        if (rule.conditionText.includes("hover: none")) found.push(rule.cssText);
      } else if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* 다른 출처의 시트는 읽지 않는다 */ }
  }
  return found;
}"""

HANDLES_JS = """(root) => {
  const windowBox = root.getBoundingClientRect();
  const read = (selector) => {
    const node = root.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10,
      cssWidth: style.width, cssHeight: style.height,
      outsideX: box.right <= windowBox.left + 0.5 || box.left >= windowBox.right - 0.5,
      outsideY: box.bottom <= windowBox.top + 0.5 || box.top >= windowBox.bottom - 0.5,
    };
  };
  return {
    east: read(".ks-window-resize-east"), west: read(".ks-window-resize-west"),
    north: read(".ks-window-resize-north"), south: read(".ks-window-resize-south"),
    northWest: read(".ks-window-resize-north-west"), southEast: read(".ks-window-resize-south-east"),
    touchAction: getComputedStyle(root.querySelector(".ks-window-titlebar")).touchAction,
    bodyTouchAction: getComputedStyle(document.body).touchAction,
  };
}"""

COMPARE_JS = """async ([a, b]) => {
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 읽지 못했습니다"));
    image.src = src;
  });
  const [left, right] = await Promise.all([load(a), load(b)]);
  if (left.width !== right.width || left.height !== right.height) {
    return { same: false, reason: `크기 ${left.width}x${left.height} != ${right.width}x${right.height}` };
  }
  const pixels = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const first = pixels(left), second = pixels(right);
  let diff = 0;
  for (let index = 0; index < first.length; index += 4) {
    if (first[index] !== second[index] || first[index + 1] !== second[index + 1]
        || first[index + 2] !== second[index + 2] || first[index + 3] !== second[index + 3]) diff += 1;
  }
  return { same: diff === 0, diff };
}"""


def wait_server(port, path, seconds=120):
    url = f"http://127.0.0.1:{port}{path}"
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=3):
                return
        except Exception:
            time.sleep(0.3)
    raise RuntimeError(f"서버가 뜨지 않았습니다: {url}")


def start_server(command, cwd, port, path, log_path, env):
    log = open(log_path, "w")
    process = subprocess.Popen(command, cwd=cwd, env={**os.environ, **env}, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
    try:
        wait_server(port, path)
    except Exception:
        process.terminate()
        log.close()
        raise
    return process, log


def stop_server(process, log):
    if process is None:
        return
    try:
        if process.stdin:
            process.stdin.close()
    except Exception:
        pass
    process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=20)
    log.close()


def settle(page):
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(350)


def select_tab(scope, name):
    pattern = re.compile(f"^{re.escape(name)}$")
    tab = scope.locator('[role="tab"]').filter(has_text=pattern).first
    tab.wait_for(state="attached", timeout=120000)
    if tab.is_visible():
        tab.click()
    else:
        scope.locator('[role="tab"]').first.locator("..").get_by_role("button", name="탭 더 보기").click()
        scope.page.get_by_role("menu").get_by_role("menuitem", name=name, exact=True).click()
    tab.wait_for(state="visible", timeout=120000)


def judge(result, key, checks):
    result["judged"][key] = checks
    for check, ok in checks.items():
        if ok is False:
            result["failures"].append(f"{key}.{check}")


def open_ui_scene(page, port, preview):
    page.goto(f"http://127.0.0.1:{port}/?preview={preview}", wait_until="load")
    page.wait_for_function("() => window.__ksHarness !== undefined", timeout=120000)


def ipad_row_long_press(context, port, size, output, result):
    page = context.new_page()
    try:
        open_ui_scene(page, port, "data-views-test")
        app = page.get_by_test_id("app-window-data-views-test")
        row = app.get_by_role("option", name="항목 1", exact=True)
        row.wait_for(timeout=120000)
        settle(page)
        box = row.bounding_box()
        x = box["x"] + min(48, box["width"] / 3)
        y = box["y"] + box["height"] / 2
        page.evaluate(POINTER_JS, ["pointerdown", x, y])
        page.wait_for_timeout(650)
        item = page.get_by_role("menuitem", name="주소 복사")
        visible = item.count() == 1 and item.first.is_visible()
        page.evaluate(POINTER_JS, ["pointerup", x, y])
        menu_box = page.get_by_role("menu").bounding_box() if page.get_by_role("menu").count() else None
        key = f"ipad-long-press-{size}"
        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
        measured = {
            "menuVisible": visible,
            "press": [round(x, 1), round(y, 1)],
            "menuBox": menu_box,
            "dx": round(menu_box["x"] - x, 1) if menu_box else None,
            "dy": round(menu_box["y"] - y, 1) if menu_box else None,
        }
        result["scenes"][key] = measured
        print(key, json.dumps(measured, ensure_ascii=False), flush=True)
        judge(result, key, {
            "menu_visible": visible,
            "menu_at_press": menu_box is not None and abs(menu_box["x"] - x) <= 4 and abs(menu_box["y"] - y) <= 4,
        })
    finally:
        page.close()


def ipad_feed_copy(context, port, size, output, result):
    page = context.new_page()
    try:
        open_ui_scene(page, port, "data-views-test")
        app = page.get_by_test_id("app-window-data-views-test")
        select_tab(app, "병기 시험")
        copy = app.locator(".ks-feed-copy-control").first
        copy.wait_for(state="attached", timeout=120000)
        settle(page)
        key = f"ipad-feed-copy-{size}"
        measured = page.evaluate(MEDIA_QUERY_JS)
        measured["opacity"] = copy.evaluate("(element) => getComputedStyle(element).opacity")
        measured["visible"] = copy.is_visible()
        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
        result["scenes"][key] = measured
        print(key, json.dumps(measured, ensure_ascii=False), flush=True)
        judge(result, key, {
            "hover_none": measured["hoverNone"] is True,
            "copy_visible": measured["opacity"] == "1" and measured["visible"] is True,
        })
    finally:
        page.close()


def open_media_page(page, port):
    open_ui_scene(page, port, "block-gallery")
    app = page.get_by_test_id("app-window-block-gallery")
    select_tab(app, "미디어")
    page.get_by_role("tab", name="소리").click()
    page.get_by_text("tone.wav").click()
    seek = page.get_by_role("slider", name="재생 위치")
    seek.wait_for(state="visible", timeout=120000)
    # 재생 시각이 흐르면 위치 막대와 시각 글자가 캡처마다 달라진다. 처음 자리에 멈춰 둔다.
    page.evaluate("() => { const audio = document.querySelector('audio'); if (audio) { audio.pause(); audio.currentTime = 0; } }")
    page.wait_for_timeout(250)
    settle(page)
    return seek


def ipad_media_slider(context, port, size, output, result):
    page = context.new_page()
    try:
        seek = open_media_page(page, port)
        key = f"ipad-media-slider-{size}"
        measured = page.evaluate(MEDIA_QUERY_JS)
        rules = page.evaluate(SLIDER_RULE_JS)
        measured["ruleVisible"] = any("ks-media-range::-webkit-slider-thumb" in rule and "opacity: 1" in rule for rule in rules)
        measured["sliderBox"] = seek.bounding_box()
        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
        result["scenes"][key] = measured
        print(key, json.dumps(measured, ensure_ascii=False), flush=True)
        judge(result, key, {
            "hover_none": measured["hoverNone"] is True,
            "thumb_rule": measured["ruleVisible"] is True,
            "slider_visible": measured["sliderBox"] is not None,
        })
    finally:
        page.close()


def titlebar_point(page):
    box = page.get_by_test_id("app-window-calculator").locator(".ks-window-titlebar").bounding_box()
    return box["x"] + 120, box["y"] + box["height"] / 2


def ipad_titlebar(context, port, size, output, result):
    page = context.new_page()
    try:
        page.goto(f"http://127.0.0.1:{port}/harness.html?window=calculator", wait_until="load")
        window = page.get_by_test_id("app-window-calculator")
        window.wait_for(timeout=120000)
        settle(page)
        handles = window.evaluate(HANDLES_JS)
        x, y = titlebar_point(page)
        for _ in range(2):
            page.evaluate(DOUBLE_TAP_JS, [x, y])
            page.wait_for_timeout(80)
        page.wait_for_function("() => document.querySelector('[data-testid=\"app-window-calculator\"]')?.getAttribute('data-maximized') === 'true'", timeout=5000)
        settle(page)
        key = f"ipad-titlebar-maximized-{size}"
        measured = {"maximized": window.get_attribute("data-maximized"), "handles": handles}
        page.screenshot(path=str(output / f"{key}.png"), animations="disabled")
        result["scenes"][key] = measured
        print(key, json.dumps(measured, ensure_ascii=False), flush=True)
        side_edges = [handles[name] for name in ("east", "west")]
        level_edges = [handles[name] for name in ("north", "south")]
        corners = [handles[name] for name in ("northWest", "southEast")]
        judge(result, key, {
            "maximized": measured["maximized"] == "true",
            "side_edge_width": all(edge and edge["cssWidth"] == "16px" for edge in side_edges),
            "side_edge_outside": all(edge and edge["outsideX"] for edge in side_edges),
            "level_edge_width": all(edge and edge["cssHeight"] == "16px" for edge in level_edges),
            "level_edge_outside": all(edge and edge["outsideY"] for edge in level_edges),
            "corner_size": all(corner and corner["cssWidth"] == "24px" and corner["cssHeight"] == "24px" for corner in corners),
            "corner_outside": all(corner and corner["outsideX"] and corner["outsideY"] for corner in corners),
            "body_touch_action": handles["bodyTouchAction"] == "manipulation",
            "titlebar_touch_action": handles["touchAction"] == "none",
        })
    finally:
        page.close()


def mouse_row_menu(page, port, output, name):
    open_ui_scene(page, port, "data-views-test")
    app = page.get_by_test_id("app-window-data-views-test")
    row = app.get_by_role("option", name="항목 1", exact=True)
    row.wait_for(timeout=120000)
    settle(page)
    row.click(button="right", position={"x": 48, "y": row.bounding_box()["height"] / 2})
    page.get_by_role("menu").wait_for(state="visible", timeout=10000)
    settle(page)
    page.screenshot(path=str(output / f"{name}.png"), animations="disabled")


def mouse_feed_copy(page, port, output, name):
    open_ui_scene(page, port, "data-views-test")
    app = page.get_by_test_id("app-window-data-views-test")
    select_tab(app, "병기 시험")
    copy = app.locator(".ks-feed-copy-control").first
    copy.wait_for(state="attached", timeout=120000)
    settle(page)
    entry = copy.locator("xpath=ancestor::*[contains(@class, 'ks-feed-entry')][1]")
    (entry if entry.count() else copy).hover()
    page.wait_for_timeout(400)
    page.screenshot(path=str(output / f"{name}.png"), animations="disabled")


def mouse_media_slider(page, port, output, name):
    seek = open_media_page(page, port)
    seek.hover()
    page.wait_for_timeout(400)
    page.screenshot(path=str(output / f"{name}.png"), animations="disabled")


def mouse_titlebar(page, port, output, name):
    page.goto(f"http://127.0.0.1:{port}/harness.html?window=calculator", wait_until="load")
    window = page.get_by_test_id("app-window-calculator")
    window.wait_for(timeout=120000)
    settle(page)
    x, y = titlebar_point(page)
    page.mouse.dblclick(x, y)
    page.wait_for_function("() => document.querySelector('[data-testid=\"app-window-calculator\"]')?.getAttribute('data-maximized') === 'true'", timeout=5000)
    settle(page)
    page.screenshot(path=str(output / f"{name}.png"), animations="disabled")


MOUSE_SCENES = (
    ("mouse-row-menu", mouse_row_menu),
    ("mouse-feed-copy", mouse_feed_copy),
    ("mouse-media-slider", mouse_media_slider),
    ("mouse-titlebar-maximized", mouse_titlebar),
)


def capture_mouse(browser, root, port, output):
    context = browser.new_context(viewport={"width": MOUSE_SIZE[0], "height": MOUSE_SIZE[1]})
    try:
        ui_server = ui_log = app_server = app_log = None
        try:
            ui_server, ui_log = start_server(
                ["node", "./harness/e2e-server.mjs"], root / "ui", port, "/?preview=data-views-test",
                output / "ui-server.log", {"KS_E2E_PORT": str(port)},
            )
            page = context.new_page()
            try:
                for name, scene in MOUSE_SCENES:
                    if name.startswith("mouse-titlebar"):
                        continue
                    scene(page, port, output, name)
            finally:
                page.close()
            stop_server(ui_server, ui_log)
            ui_server = ui_log = None
            app_server, app_log = start_server(
                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
                root / "app", port, "/harness.html", output / "app-server.log", {},
            )
            page = context.new_page()
            try:
                mouse_titlebar(page, port, output, "mouse-titlebar-maximized")
            finally:
                page.close()
        finally:
            stop_server(ui_server, ui_log)
            stop_server(app_server, app_log)
    finally:
        context.close()


def compare_images(browser, before_path, after_path):
    page = browser.new_page()
    try:
        page.goto("about:blank")
        prefix = "data:image/png;base64,"
        return page.evaluate(COMPARE_JS, [
            prefix + base64.b64encode(before_path.read_bytes()).decode("ascii"),
            prefix + base64.b64encode(after_path.read_bytes()).decode("ascii"),
        ])
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--compare-before", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/visual/ipad-touch")
    parser.add_argument("--port", type=int, default=47600)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--ipad-only", action="store_true")
    group.add_argument("--mouse-only", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    before = args.compare_before.resolve() if args.compare_before else None
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "root": str(root), "compareBefore": str(before) if before else None,
        "ipadSizes": [f"{w}x{h}" for w, h in IPAD_SIZES], "mouseSize": f"{MOUSE_SIZE[0]}x{MOUSE_SIZE[1]}",
        "scenes": {}, "judged": {}, "failures": [], "comparisons": {},
    }

    with sync_playwright() as playwright:
        if not args.mouse_only:
            browser = playwright.webkit.launch()
            try:
                for width, height in IPAD_SIZES:
                    size = f"{width}x{height}"
                    context = browser.new_context(viewport={"width": width, "height": height}, has_touch=True, is_mobile=True, device_scale_factor=2)
                    try:
                        ui_server = ui_log = None
                        try:
                            ui_server, ui_log = start_server(
                                ["node", "./harness/e2e-server.mjs"], root / "ui", args.port, "/?preview=data-views-test",
                                output / f"ui-server-{size}.log", {"KS_E2E_PORT": str(args.port)},
                            )
                            ipad_row_long_press(context, args.port, size, output, result)
                            ipad_feed_copy(context, args.port, size, output, result)
                            ipad_media_slider(context, args.port, size, output, result)
                        finally:
                            stop_server(ui_server, ui_log)
                        app_server = app_log = None
                        try:
                            app_server, app_log = start_server(
                                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                                root / "app", args.port, "/harness.html", output / f"app-server-{size}.log", {},
                            )
                            ipad_titlebar(context, args.port, size, output, result)
                        finally:
                            stop_server(app_server, app_log)
                    finally:
                        context.close()
            finally:
                browser.close()

        if not args.ipad_only:
            browser = playwright.chromium.launch()
            try:
                capture_mouse(browser, root, args.port, output)
                if before is not None:
                    for name, _ in MOUSE_SCENES:
                        compared = compare_images(browser, before / f"{name}.png", output / f"{name}.png")
                        result["comparisons"][name] = compared
                        print("compare", name, json.dumps(compared, ensure_ascii=False), flush=True)
                        if compared.get("same") is not True:
                            result["failures"].append(f"mouse-unchanged.{name}")
            finally:
                browser.close()

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json", flush=True)
    if result["failures"]:
        print("FAIL", ",".join(result["failures"]), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
