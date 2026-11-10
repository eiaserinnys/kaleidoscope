#!/usr/bin/env python3
"""MCP가 시작한 쉘 전체 설치 동의를 두 크기와 라이트·다크 테마에서 캡처한다.

장면: 새 설치, 고친 판에서 같은 스토어의 스토어 판으로 전환(수정본 경고 포함).

  python3 scripts/visual-check/check_store_update_shell_consent.py [--output 산출폴더] [--port 5293] [--label after]

이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄워
/installation-consent.html?shell=1에서 쉘 막대와 데스크톱 위에 그린다. 쉘 전체 동의는
창이 아니라 쉘에 뜨므로 크기는 넓은 창 1180×720과 쉘 최소 창 960×600을 쓰고,
테마는 라이트와 다크를 모두 찍는다. 산출물은 기본으로
target/visual-check/store-update-shell-consent/<label>/ 아래에 남는다.

이 스크립트는 판정하지 않고 화면 글자, 경고 문장이 화면 안에 다 보이는지, 넘친 요소를
result.json에 남긴다.
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
# 쉘 전체 동의는 창 폭이 아니라 쉘 폭을 따른다. 좁은 장면은 tauri.conf.json의 쉘 최소 창이다.
SIZES = ((1180, 720), (960, 600))
THEMES = ("light", "dark")
SCENES = (
    (
        "install",
        "async () => { window.installationHarness.showShell('heavy', {}, undefined, "
        "{ store_url: 'https://eiaserinnys.me/appstore-eias/' }); }",
    ),
    (
        "transition",
        "async () => { window.installationHarness.showShell('heavy', {}, 2, "
        "{ replacing: true, modified: true, store_url: 'https://eiaserinnys.me/appstore-eias/', "
        "from_origin: { store_url: 'https://eiaserinnys.me/appstore-eias/', store_app_id: 'research-desk', release: 2, digest: 'old-digest' } }); }",
    ),
)


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


def capture(page, output, key):
    path = output / f"{key}.png"
    page.screenshot(path=str(path), animations="disabled")
    return str(path)


def shell_scene(page, port, width, height, theme, key, output, show):
    page.emulate_media(color_scheme=theme)
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/installation-consent.html?shell=1", wait_until="load")
    page.evaluate("async () => { await window.installationHarness.ready; }")
    page.evaluate(show)
    dialog = page.get_by_role("dialog")
    dialog.wait_for(timeout=20000)
    settle(page)
    facts = {
        "theme": theme,
        "title": dialog.locator(".ks-dialog-title").inner_text(),
        "body": dialog.locator(".ks-dialog-body").inner_text(),
        "buttons": dialog.get_by_role("button").all_inner_texts(),
        "meta": dialog.locator(".ks-install-meta").all_inner_texts(),
        "dialog_rect": page.evaluate(
            "() => { const el = document.querySelector('.ks-install-consent'); if (!el) return null;"
            " const rect = el.getBoundingClientRect();"
            " return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight,"
            " visible: rect.top >= 0 && rect.bottom <= window.innerHeight }; }"
        ),
        "warning": page.evaluate(
            "() => { const el = document.querySelector('.ks-install-consent .ks-install-sentence.is-warning');"
            " if (!el) return null; const rect = el.getBoundingClientRect();"
            " return { text: el.textContent, top: rect.top, bottom: rect.bottom,"
            " viewport: window.innerHeight, visible: rect.top >= 0 && rect.bottom <= window.innerHeight }; }"
        ),
        "body_scroll": page.evaluate(
            "() => { const el = document.querySelector('.ks-install-consent .ks-dialog-body');"
            " return el ? { client: el.clientHeight, scroll: el.scrollHeight } : null; }"
        ),
        "overflows": page.evaluate(
            "() => Array.from(document.querySelectorAll('.ks-install-consent .ks-dialog-body *'))"
            ".filter((el) => el.scrollWidth > el.clientWidth + 1)"
            ".map((el) => el.className || el.tagName)"
        ),
    }
    facts["capture"] = capture(page, output, key)
    return facts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/store-update-shell-consent")
    parser.add_argument("--port", type=int, default=5293)
    parser.add_argument("--label", default="after")
    args = parser.parse_args()
    output = (args.output / args.label).resolve()
    output.mkdir(parents=True, exist_ok=True)

    result = {"label": args.label, "port": args.port, "console": []}
    browser = None
    ui_server = ui_log = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
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
            for name, show in SCENES:
                for theme in THEMES:
                    for width, height in SIZES:
                        key = f"{name}-{theme}-{width}x{height}"
                        result[key] = shell_scene(page, args.port, width, height, theme, key, output, show)
                        warning = result[key]["warning"]
                        print(key, result[key]["title"], "warning visible:", warning and warning["visible"], flush=True)
            page.close()
            browser.close()
            browser = None
    finally:
        if browser is not None:
            browser.close()
        if ui_server is not None:
            stop_server(ui_server, ui_log)

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
