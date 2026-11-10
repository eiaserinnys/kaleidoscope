#!/usr/bin/env python3
"""스토어 판 전환 동의 화면 네 상태를 넓은 창과 좁은 창에서 캡처한다.

장면: 일반 설치, 커스텀 앱에서 전환, 다른 스토어에서 전환, 수정본을 되돌리기.

  python3 scripts/visual-check/check_store_replace_consent.py [--output 산출폴더] [--port 5292] [--label before|after]

이 체크아웃의 ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄워
/installation-consent.html에서 그린다. 산출물은 기본으로
target/visual-check/store-replace-consent/<label>/ 아래에 남는다.

이 스크립트는 판정하지 않고 화면 글자와 초점 상태를 result.json에 남긴다.
고치기 전(before)과 뒤(after)의 result.json을 같은 장면끼리 비교하는 것이 목적이다.
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
# 좁은 장면은 쉘 최소 창(360×241)이 그려지는 브라우저 크기다. 360×240 화면에서는 창이 최소보다 작게 그려진다.
SIZES = ((1180, 720), (384, 317))
SCENES = (
    ("install", "async () => { window.installationHarness.show('light'); }"),
    (
        "custom-to-store",
        "async () => { window.installationHarness.show('light', {}, undefined, "
        "{ replacing: true, store_url: 'https://apps.example.org/store' }); }",
    ),
    (
        "other-store-to-store",
        "async () => { window.installationHarness.show('light', {}, 2, "
        "{ replacing: true, store_url: 'https://apps.example.org/store/lg', "
        "from_origin: { store_url: 'https://old.example.org/store/eias', store_app_id: 'clock', release: 2, digest: 'old-digest' } }); }",
    ),
    (
        "modified-to-store",
        # 실제 스토어 주소 꼴의 긴 주소로, 같은 스토어에서 온 전환 줄이 호스트만 보이는지와 최소 창에서 경고가 다 보이는지 함께 본다.
        "async () => { window.installationHarness.show('light', {}, 2, "
        "{ replacing: true, modified: true, store_url: 'https://eiaserinnys.me/appstore-eias/', "
        "from_origin: { store_url: 'https://eiaserinnys.me/appstore-eias/', store_app_id: 'clock', release: 2, digest: 'old-digest' } }); }",
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


def consent_scene(page, port, width, height, key, output, show):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(f"http://127.0.0.1:{port}/installation-consent.html", wait_until="load")
    page.evaluate("async () => { await window.installationHarness.ready; }")
    page.evaluate(show)
    dialog = page.get_by_role("dialog")
    dialog.wait_for(timeout=20000)
    settle(page)
    meta = dialog.locator(".ks-install-meta")
    facts = {
        "title": dialog.locator(".ks-dialog-title").inner_text(),
        "body": dialog.locator(".ks-dialog-body").inner_text(),
        "buttons": dialog.get_by_role("button").all_inner_texts(),
        "meta": meta.all_inner_texts(),
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
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/store-replace-consent")
    parser.add_argument("--port", type=int, default=5292)
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
                for width, height in SIZES:
                    key = f"{name}-{width}x{height}"
                    result[key] = consent_scene(page, args.port, width, height, key, output, show)
                    print(key, result[key]["title"], flush=True)
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
