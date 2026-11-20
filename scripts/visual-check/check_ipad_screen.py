#!/usr/bin/env python3
"""iPad 가로 화면에서 쉘의 가장자리와 창 배치를 WebKit으로 캡처하고 잰다.

장면: 바탕화면과 작업 표시줄, 설정 창, 앱 창 두 개, 최대화한 창, 입력칸에 초점이 간 모습.
iPad 가로 1024x768, 1194x834, 1366x1024를 찍는다. 장면마다 위 0, 아래 20px의 안전 영역을
흉내 낸 것과 0으로 둔 것을 모두 찍는다. 위 24px·아래 20px인 기기(상태 표시줄이 숨지 않은 경우)의
최대화한 창도 함께 찍어, 창이 자란 막대 아래 끝에서 12px만 비켜 시작하는지 잰다. 흉내는
:root 사용자 속성(--ks-safe-top/right/bottom/left)을 덮어 한다. CSS와 창 배치 계산이
이 속성을 같은 값으로 읽는지가 이 스크립트의 관심사다.

  python3 scripts/visual-check/check_ipad_screen.py [--output 산출폴더] [--port 5317] [--label after]

PC(Chromium 1440x900)는 같은 장면을 찍어 같은 폴더의 `pc-<장면>-before.png`와 화소를 견준다.
기준 캡처가 없으면 비교를 건너뛴다. PNG는 기본으로 .local/visual/ipad-screen/ 에 둔다.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
IPAD_SIZES = ((1024, 768), (1194, 834), (1366, 1024))
PC_SIZE = (1440, 900)
SAFE_VARIANTS = (("safe", 0, 20), ("zero", 0, 0))
SCENES = ("desktop", "settings", "two-windows", "maximized", "input-focus")
BAR_HEIGHT = 48
TASKBAR_HEIGHT = 40
EDGE_INSET = 12
# 유리 창 모서리의 안티에일리어싱은 합성 층이 조금만 달라져도 2/255까지 다르게 그려질 수 있다.
# 모양이 바뀌었는지는 이 문턱으로 가르고, 다른 화소 수와 최대 차이를 함께 남긴다.
PC_CHANNEL_TOLERANCE = 2

MEASURE = """() => {
  const rect = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  };
  const style = getComputedStyle(document.documentElement);
  const root = document.documentElement;
  const focus = document.activeElement;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    safe: {
      top: style.getPropertyValue('--ks-safe-top').trim(),
      right: style.getPropertyValue('--ks-safe-right').trim(),
      bottom: style.getPropertyValue('--ks-safe-bottom').trim(),
      left: style.getPropertyValue('--ks-safe-left').trim(),
    },
    bar: rect(document.querySelector('.ks-shell-bar')),
    taskbar: rect(document.querySelector('.ks-taskbar')),
    windows: [...document.querySelectorAll('.ks-window')].map(rect),
    document: {
      scroll_x: root.scrollLeft,
      scroll_y: root.scrollTop,
      scroll_width: root.scrollWidth,
      scroll_height: root.scrollHeight,
      body_scroll_y: document.body ? document.body.scrollTop : 0,
    },
    focus: focus instanceof HTMLElement ? { tag: focus.tagName, class: focus.className, rect: rect(focus) } : null,
  };
}"""


def safe_area_script(top: int, bottom: int) -> str:
    """:root의 안전 영역 속성을 iPad 값으로 덮는다. 페이지 스크립트보다 먼저 인라인 스타일로 넣는다."""
    return f"""(() => {{
  const apply = () => {{
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty('--ks-safe-top', '{top}px');
    root.style.setProperty('--ks-safe-right', '0px');
    root.style.setProperty('--ks-safe-bottom', '{bottom}px');
    root.style.setProperty('--ks-safe-left', '0px');
  }};
  apply();
  document.addEventListener('readystatechange', apply);
}})()"""


def wait_server(port, path, seconds=120):
    url = f"http://127.0.0.1:{port}{path}"
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - 아직 뜨지 않은 서버는 다시 본다
            pass
        time.sleep(0.1)
    raise RuntimeError(f"서버가 뜨지 않았습니다: {url}")


def ensure_port_free(port):
    """다른 체크아웃의 서버가 먼저 그 포트를 잡고 있으면 그 화면을 찍게 되므로 시작 전에 막는다."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise RuntimeError(f"포트 {port}를 이미 다른 서버가 쓰고 있습니다: {error}") from error


def start_server(command, cwd, port, path, log_path, env):
    ensure_port_free(port)
    log = open(log_path, "w", encoding="utf-8")
    server = subprocess.Popen(
        command,
        cwd=cwd,
        env={**os.environ, **env},
        stdin=subprocess.PIPE,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        wait_server(port, path)
        time.sleep(0.5)
        if server.poll() is not None:
            raise RuntimeError(
                f"띄운 서버가 곧바로 끝났습니다(종료 코드 {server.returncode}). 포트 {port}를 다른 서버가 쓰고 있는지 확인하십시오."
            )
    except BaseException:
        stop_server(server, log)
        raise
    return server, log


def stop_server(server, log):
    if server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
    if server.stdin is not None:
        server.stdin.close()
    log.close()


def settle(page):
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)


def open_scene(page, port, scene):
    base = f"http://127.0.0.1:{port}/harness.html"
    if scene == "desktop":
        page.goto(f"{base}?window=calculator", wait_until="load")
        page.locator(".ks-window").first.wait_for(timeout=20000)
    elif scene == "settings":
        page.goto(base, wait_until="load")
        page.locator(".ks-shell-bar").wait_for(timeout=20000)
        page.locator('.ks-shell-bar button[aria-label="설정"]').click()
        page.locator('[data-testid="system-window-settings"]').wait_for(timeout=20000)
    elif scene == "two-windows":
        page.goto(base, wait_until="load")
        page.locator(".ks-window").nth(1).wait_for(timeout=20000)
    elif scene == "maximized":
        page.goto(f"{base}?window=html-report", wait_until="load")
        page.locator(".ks-window").first.wait_for(timeout=20000)
        page.get_by_role("button", name="창 최대화").click()
        page.wait_for_timeout(200)
    elif scene == "input-focus":
        page.goto(base, wait_until="load")
        page.locator(".ks-shell-bar").wait_for(timeout=20000)
        page.locator('.ks-shell-bar button[aria-label="설정"]').click()
        field = page.locator('[data-testid="system-window-settings"] .ks-text-input:not([disabled])').first
        field.wait_for(timeout=20000)
        field.click()
    else:
        raise ValueError(scene)
    settle(page)


def capture(page, output, key):
    path = output / f"{key}.png"
    page.screenshot(path=str(path), animations="disabled")
    return path


def check_edges(key, facts, safe_top, safe_bottom, problems):
    viewport = facts["viewport"]
    bar, taskbar = facts["bar"], facts["taskbar"]
    if bar is None or taskbar is None:
        problems.append(f"{key}: 위 막대나 작업 표시줄이 없습니다")
        return
    if abs(bar["y"]) > 1:
        problems.append(f"{key}: 위 막대가 화면 맨 위에 있지 않습니다(y={bar['y']})")
    if abs(bar["width"] - viewport["width"]) > 1:
        problems.append(f"{key}: 위 막대가 화면 폭을 다 채우지 않습니다({bar['width']} != {viewport['width']})")
    if abs(bar["height"] - (BAR_HEIGHT + safe_top)) > 1:
        problems.append(f"{key}: 위 막대 높이가 {bar['height']}입니다(위 안전 영역 {safe_top}이면 {BAR_HEIGHT + safe_top})")
    bottom_gap = viewport["height"] - taskbar["bottom"]
    if abs(bottom_gap - max(EDGE_INSET, safe_bottom)) > 1:
        problems.append(f"{key}: 작업 표시줄 아래 여백이 {bottom_gap}px입니다(기대 {max(EDGE_INSET, safe_bottom)})")
    if abs(taskbar["x"] - EDGE_INSET) > 1:
        problems.append(f"{key}: 작업 표시줄 왼쪽 여백이 {taskbar['x']}px입니다(기대 {EDGE_INSET})")
    right_gap = viewport["width"] - taskbar["right"]
    if abs(right_gap - EDGE_INSET) > 1:
        problems.append(f"{key}: 작업 표시줄 오른쪽 여백이 {right_gap}px입니다(기대 {EDGE_INSET})")
    if abs(taskbar["height"] - TASKBAR_HEIGHT) > 1:
        problems.append(f"{key}: 작업 표시줄 높이가 {taskbar['height']}입니다(기대 {TASKBAR_HEIGHT})")
    document = facts["document"]
    if document["scroll_x"] != 0 or document["scroll_y"] != 0 or document["body_scroll_y"] != 0:
        problems.append(f"{key}: 문서가 스크롤되어 있습니다 {document}")
    if document["scroll_width"] > viewport["width"] + 1:
        problems.append(f"{key}: 문서가 가로로 넘칩니다({document['scroll_width']} > {viewport['width']})")


def check_windows(key, scene, facts, problems):
    taskbar, windows = facts["taskbar"], facts["windows"]
    if not windows:
        problems.append(f"{key}: 창이 하나도 그려지지 않았습니다")
        return
    for index, window in enumerate(windows):
        if window["x"] < EDGE_INSET - 1 or window["y"] < EDGE_INSET - 1:
            problems.append(f"{key}: 창 {index}이 가장자리 여백 안으로 들어갔습니다 {window}")
        if window["right"] > facts["viewport"]["width"] - EDGE_INSET + 1:
            problems.append(f"{key}: 창 {index}이 오른쪽 여백을 넘었습니다 {window}")
    if taskbar is None:
        return
    for index, window in enumerate(windows):
        if window["bottom"] > taskbar["y"] + 1:
            problems.append(f"{key}: 창 {index}이 작업 표시줄과 겹칩니다(window {window}, taskbar {taskbar})")
    if scene == "maximized":
        window = windows[0]
        usable_width = facts["viewport"]["width"] - 2 * EDGE_INSET
        if abs(window["width"] - usable_width) > 1:
            problems.append(f"{key}: 최대화한 창이 쓸 수 있는 폭을 다 쓰지 않습니다({window['width']} != {usable_width})")
        if window["bottom"] >= taskbar["y"]:
            problems.append(f"{key}: 최대화한 창 아래 끝이 작업 표시줄에 닿습니다 {window}")
        # 위 안전 영역은 막대가 이미 안고 있으므로 창은 막대 아래 끝에서 12px만 비켜 시작한다.
        # (막대 아래로 또 안전 영역만큼 밀면 막대 아래 여백이 두 번 들어간다.)
        if facts["bar"] is not None:
            expected_y = facts["bar"]["bottom"] + EDGE_INSET
            if abs(window["y"] - expected_y) > 1:
                problems.append(f"{key}: 최대화한 창이 위 막대 아래 {EDGE_INSET}px에서 시작하지 않습니다(y={window['y']}, 기대 {expected_y})")


def check_focus(key, scene, facts, problems):
    if scene != "input-focus":
        return
    focus = facts["focus"]
    if not focus or focus["rect"] is None:
        problems.append(f"{key}: 초점을 받은 입력칸이 없습니다")
        return
    if "ks-text-input" not in (focus["class"] or ""):
        problems.append(f"{key}: 초점이 입력칸이 아닌 곳에 있습니다 {focus}")
    box, viewport = focus["rect"], facts["viewport"]
    if box["x"] < 0 or box["y"] < 0 or box["right"] > viewport["width"] or box["bottom"] > viewport["height"]:
        problems.append(f"{key}: 초점을 받은 입력칸이 화면 밖에 있습니다 {box}")


def check_safe_variables(key, facts, safe_top, safe_bottom, problems):
    safe = facts["safe"]
    expected = {"top": f"{safe_top}px", "right": "0px", "bottom": f"{safe_bottom}px", "left": "0px"}
    for name, value in expected.items():
        if safe[name] != value:
            problems.append(f"{key}: --ks-safe-{name}이 {safe[name]!r}입니다(기대 {value!r})")


def ipad_run(playwright, port, output, result):
    browser = playwright.webkit.launch()
    problems = []
    try:
        for variant, safe_top, safe_bottom in SAFE_VARIANTS:
            context = browser.new_context(
                locale="ko-KR",
                has_touch=True,
                is_mobile=True,
                device_scale_factor=2,
                viewport={"width": IPAD_SIZES[0][0], "height": IPAD_SIZES[0][1]},
                color_scheme="light",
            )
            if safe_bottom:
                context.add_init_script(safe_area_script(safe_top, safe_bottom))
            page = context.new_page()
            for width, height in IPAD_SIZES:
                page.set_viewport_size({"width": width, "height": height})
                for scene in SCENES:
                    key = f"ipad-{variant}-{width}x{height}-{scene}"
                    open_scene(page, port, scene)
                    facts = page.evaluate(MEASURE)
                    facts["capture"] = str(capture(page, output, key))
                    result[key] = facts
                    check_safe_variables(key, facts, safe_top, safe_bottom, problems)
                    check_edges(key, facts, safe_top, safe_bottom, problems)
                    check_windows(key, scene, facts, problems)
                    check_focus(key, scene, facts, problems)
                    taskbar = facts["taskbar"] or {}
                    print(f"{key} bar={facts['bar']['height'] if facts['bar'] else None} "
                          f"taskbar_bottom={round(facts['viewport']['height'] - taskbar.get('bottom', 0), 1)}", flush=True)
            context.close()
    finally:
        browser.close()
    return problems


def ipad_safe_top_run(playwright, port, output, result):
    """위 안전 영역이 있는 기기(상태 표시줄이 숨지 않은 경우)에서 최대화한 창의 자리를 잰다.

    쉘 막대가 위 안전 영역만큼 자라므로 창은 막대 아래 끝에서 12px만 비켜 시작해야 한다.
    """
    browser = playwright.webkit.launch()
    problems = []
    safe_top, safe_bottom = 24, 20
    try:
        context = browser.new_context(
            locale="ko-KR",
            has_touch=True,
            is_mobile=True,
            device_scale_factor=2,
            viewport={"width": IPAD_SIZES[0][0], "height": IPAD_SIZES[0][1]},
            color_scheme="light",
        )
        context.add_init_script(safe_area_script(safe_top, safe_bottom))
        page = context.new_page()
        for width, height in IPAD_SIZES:
            page.set_viewport_size({"width": width, "height": height})
            scene = "maximized"
            key = f"ipad-safe-top-{width}x{height}-{scene}"
            open_scene(page, port, scene)
            facts = page.evaluate(MEASURE)
            facts["capture"] = str(capture(page, output, key))
            bar_bottom = facts["bar"]["bottom"] if facts["bar"] else None
            facts["expected_maximized_y"] = None if bar_bottom is None else bar_bottom + EDGE_INSET
            result[key] = facts
            check_safe_variables(key, facts, safe_top, safe_bottom, problems)
            check_edges(key, facts, safe_top, safe_bottom, problems)
            check_windows(key, scene, facts, problems)
            print(f"{key} bar={facts['bar']['height'] if facts['bar'] else None} "
                  f"maximized_y={facts['windows'][0]['y'] if facts['windows'] else None} "
                  f"expected={facts['expected_maximized_y']}", flush=True)
        context.close()
    finally:
        browser.close()
    return problems


def pc_run(playwright, port, output, label, result):
    browser = playwright.chromium.launch()
    problems = []
    try:
        context = browser.new_context(locale="ko-KR", viewport={"width": PC_SIZE[0], "height": PC_SIZE[1]}, color_scheme="light")
        page = context.new_page()
        for scene in SCENES:
            open_scene(page, port, scene)
            key = f"pc-{scene}-{label}"
            result[key] = page.evaluate(MEASURE)
            result[key]["capture"] = str(capture(page, output, key))
        context.close()
    finally:
        browser.close()
    return problems


def compare_pc(output, label, result):
    if label == "before":
        result["pc_compare"] = "기준 캡처(before)라 비교하지 않음"
        return []
    problems = []
    result["pc_compare"] = {}
    for scene in SCENES:
        before = output / f"pc-{scene}-before.png"
        after = output / f"pc-{scene}-after.png"
        if not before.exists():
            result["pc_compare"][scene] = "기준 캡처 없음"
            continue
        with Image.open(before) as before_image, Image.open(after) as after_image:
            difference = ImageChops.difference(before_image.convert("RGB"), after_image.convert("RGB"))
        red, green, blue = difference.split()
        brightest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        histogram = brightest.histogram()
        different = sum(histogram[1:])
        max_delta = brightest.getextrema()[1]
        result["pc_compare"][scene] = {
            "different_pixels": different,
            "max_channel_delta": max_delta,
            "size": list(difference.size),
        }
        if max_delta > PC_CHANNEL_TOLERANCE:
            problems.append(f"pc-{scene}: 변경 전후 화소가 {different}개 다릅니다(최대 {max_delta}/255)")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/visual/ipad-screen")
    parser.add_argument("--port", type=int, default=5317)
    parser.add_argument("--label", default="after", choices=("before", "after"))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    result = {"label": args.label, "port": args.port, "console": []}
    problems = []
    app_server = app_log = None
    try:
        with sync_playwright() as playwright:
            app_server, app_log = start_server(
                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                ROOT / "app",
                args.port,
                "/harness.html",
                output / "app-server.log",
                {"NODE_ENV": "development"},
            )
            result["console"] = []
            problems += ipad_run(playwright, args.port, output, result)
            problems += ipad_safe_top_run(playwright, args.port, output, result)
            problems += pc_run(playwright, args.port, output, args.label, result)
    finally:
        if app_server is not None:
            stop_server(app_server, app_log)

    problems += compare_pc(output, args.label, result)
    result["problems"] = problems
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json")
    if problems:
        for problem in problems:
            print("문제:", problem)
        return 1
    print("모든 단언 통과", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
