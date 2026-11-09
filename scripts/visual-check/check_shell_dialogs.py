#!/usr/bin/env python3
"""쉘 대화상자 네 자리의 화면을 고치기 전과 뒤에서 같은 장면으로 캡처한다.

장면: 설치 동의(새 설치와 업데이트), 실행 동의(프로그램 범위와 이름 범위),
설정의 가져오기 실패, 키보드로 연 앱 설정의 제목 초점 테두리.

  python3 scripts/visual-check/check_shell_dialogs.py [--output 산출폴더] [--port 5291] [--label after]

동의 장면은 이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄워
/installation-consent.html에서, 설정 장면은 app의 vite 개발 서버를 같은 포트에
순서대로 띄워 /harness.html?preview=...에서 그린다. 두 서버는 동시에 띄우지 않는다.
넓은 창 1180×720과 최소 창 360×240에서 찍는다.

이 스크립트는 판정하지 않고 화면 글자와 초점 상태를 result.json에 남긴다.
고치기 전과 뒤의 result.json을 같은 장면끼리 비교하는 것이 목적이다.
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
SIZES = ((1180, 720), (360, 240))
IMPORT_FAILURE = "가져오지 못했습니다. 다시 시도하세요."


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


def start_server(command, cwd, port, path, log_path, env):
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
    except Exception:
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


def reset_scroll(page):
    """최소 창에서는 쉘 막대가 넘쳐 숨은 스크롤 위치가 남는다. 장면마다 처음 자리에서 찍는다."""
    page.evaluate("() => { document.querySelectorAll('*').forEach((el) => { el.scrollLeft = 0; el.scrollTop = 0; }); }")
    page.wait_for_timeout(200)


def capture(page, output, key, clip=None):
    path = output / f"{key}.png"
    page.screenshot(path=str(path), animations="disabled", clip=clip)
    return str(path)


def consent_scene(page, port, width, height, key, output, show):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/installation-consent.html", wait_until="load")
    page.evaluate("async () => { await window.installationHarness.ready; }")
    page.evaluate(show)
    dialog = page.get_by_role("dialog")
    dialog.wait_for(timeout=20000)
    settle(page)
    facts = {
        "title": dialog.locator(".ks-dialog-title").inner_text(),
        "body": dialog.locator(".ks-dialog-body").inner_text(),
        "buttons": dialog.get_by_role("button").all_inner_texts(),
    }
    facts["capture"] = capture(page, output, key)
    return facts


def run_consent_scenes(page, port, output, result):
    scenes = (
        ("update-consent", "async () => { window.installationHarness.show('light', {}, 2); }"),
        ("install-consent", "async () => { window.installationHarness.show('light'); }"),
        ("process-command-consent", "async () => { window.installationHarness.showProcess('command', { command: 'fixture-agent' }); }"),
        ("process-name-consent", "async () => { window.installationHarness.showProcess('spec', { name: '긴 프로그램 이름' }); }"),
    )
    for name, show in scenes:
        for width, height in SIZES:
            key = f"{name}-{width}x{height}"
            result[key] = consent_scene(page, port, width, height, key, output, show)
            print(key, result[key]["title"], flush=True)


def run_settings_scenes(page, port, output, result):
    for width, height in SIZES:
        key = f"settings-import-failure-{width}x{height}"
        page.set_viewport_size({"width": width, "height": height})
        page.goto(
            f"http://127.0.0.1:{port}/harness.html?preview=shell-settings"
            "&link=connected&transfer-skips&fail-link",
            wait_until="load",
        )
        page.locator(".ks-shell-bar").get_by_role("button", name="설정", exact=True).click()
        window = page.get_by_test_id("system-window-settings")
        window.wait_for(timeout=20000)
        button = window.get_by_role("button", name="가져오기", exact=True)
        button.wait_for(timeout=20000)
        reset_scroll(page)
        settle(page)
        ready_text = window.inner_text()
        ready_capture = capture(page, output, f"{key}-ready")
        button.click()
        page.get_by_text(IMPORT_FAILURE, exact=False).wait_for(timeout=20000)
        reset_scroll(page)
        settle(page)
        failed_text = window.inner_text()
        notice = page.locator(".ks-shell-notice-layer")
        result[key] = {
            "success_notice_before_click": "가져오기 완료" in ready_text,
            "success_notice_after_failure": "가져오기 완료" in failed_text,
            "failure_notice": notice.inner_text(),
            "window_text": failed_text,
            "captures": [ready_capture, capture(page, output, key)],
        }
        print(key, "success_after_failure=", result[key]["success_notice_after_failure"], flush=True)

    for width, height in SIZES:
        key = f"settings-keyboard-title-{width}x{height}"
        page.set_viewport_size({"width": width, "height": height})
        page.goto(f"http://127.0.0.1:{port}/harness.html?preview=app-settings&fill-window", wait_until="load")
        button = page.get_by_role("button", name="앱 설정", exact=True)
        button.wait_for(timeout=20000)
        button.focus()
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", name="앱 설정", exact=True)
        heading.wait_for(timeout=20000)
        page.wait_for_function(
            "() => document.activeElement?.tagName === 'H2' && document.activeElement.textContent === '앱 설정'",
            timeout=20000,
        )
        settle(page)
        facts = page.evaluate(
            """() => {
              const el = document.activeElement;
              const style = getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return {
                focused: el.textContent,
                focus_visible: el.matches(':focus-visible'),
                outline_style: style.outlineStyle,
                outline_width: style.outlineWidth,
                outline_color: style.outlineColor,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              };
            }"""
        )
        clip = None
        if facts["rect"]["width"] > 0:
            left = max(0.0, facts["rect"]["x"] - 12)
            top = max(0.0, facts["rect"]["y"] - 12)
            clip = {
                "x": left,
                "y": top,
                "width": min(width - left, facts["rect"]["width"] + 24),
                "height": min(height - top, facts["rect"]["height"] + 24),
            }
        facts["captures"] = [capture(page, output, key), capture(page, output, f"{key}-crop", clip=clip)]
        result[key] = facts
        print(key, facts["focus_visible"], facts["outline_style"], facts["outline_width"], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/shell-dialogs")
    parser.add_argument("--port", type=int, default=5291)
    parser.add_argument("--label", default="after")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    result = {"label": args.label, "port": args.port, "console": []}
    browser = None
    app_server = app_log = ui_server = ui_log = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            app_server, app_log = start_server(
                ["node", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                ROOT / "app",
                args.port,
                "/harness.html",
                output / "app-server.log",
                {"NODE_ENV": "development"},
            )
            page = browser.new_page()
            page.on(
                "console",
                lambda message: result["console"].append(f"{message.type}: {message.text}")
                if message.type in ("error", "warning")
                else None,
            )
            page.on("pageerror", lambda error: result["console"].append(f"pageerror: {error}"))
            run_settings_scenes(page, args.port, output, result)
            page.close()
            stop_server(app_server, app_log)
            app_server = app_log = None

            ui_server, ui_log = start_server(
                ["node", "./harness/e2e-server.mjs"],
                ROOT / "ui",
                args.port,
                "/installation-consent.html",
                output / "ui-server.log",
                {"KS_E2E_PORT": str(args.port)},
            )
            page = browser.new_page()
            page.on(
                "console",
                lambda message: result["console"].append(f"{message.type}: {message.text}")
                if message.type in ("error", "warning")
                else None,
            )
            page.on("pageerror", lambda error: result["console"].append(f"pageerror: {error}"))
            run_consent_scenes(page, args.port, output, result)
            page.close()
            browser.close()
            browser = None
    finally:
        if browser is not None:
            browser.close()
        if app_server is not None:
            stop_server(app_server, app_log)
        if ui_server is not None:
            stop_server(ui_server, ui_log)

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
