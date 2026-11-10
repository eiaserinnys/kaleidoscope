#!/usr/bin/env python3
"""머리 막대 오른쪽의 서버 단추를 연결 상태마다 넓은 창과 최소 창에서 캡처한다.

장면: 내 PC 서버 연결(embedded), 원격 서버 연결(connected), 내 PC 서버 연결 중
(embedded-offline), 원격 오프라인(offline), 페어링 코드(pairing), 연결 해제(unlinked).

  python3 scripts/visual-check/check_shell_header.py [--output 산출폴더] [--port 5297] [--label after]

app의 vite 개발 서버를 /harness.html?link=...에 띄워 그린다. 창 폭마다 상태를 모두 찍고,
단추의 이름·모드·그림·점 색·좌표와 톱니 단추의 좌표를 result.json에 남긴다.
이 스크립트는 판정하지 않는다. 고치기 전과 뒤의 result.json과 캡처를 같은 장면끼리 비교하는 것이 목적이다.
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
STATES = (
    ("embedded", "link=embedded"),
    ("connected", "link=connected"),
    ("embedded-offline", "link=embedded-offline"),
    ("offline", "link=offline"),
    ("pairing", "link=pairing"),
    ("unlinked", ""),
)

MEASURE = """() => {
  const bar = document.querySelector('.ks-shell-bar');
  const actions = bar.querySelector('.ks-shell-actions');
  const rect = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  };
  const server = bar.querySelector('.shell-link-button');
  const gear = actions.querySelector('button[aria-label="설정"]');
  const dot = server.querySelector('.shell-server-dot');
  const svg = server.querySelector('svg');
  return {
    labels: [...actions.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    server: server ? {
      label: server.getAttribute('aria-label'),
      title: server.getAttribute('title'),
      mode: server.getAttribute('data-server-mode'),
      button_class: server.className,
      text: server.innerText.trim(),
      rect: rect(server),
    } : null,
    gear: gear ? { rect: rect(gear) } : null,
    icon_class: svg ? svg.getAttribute('class') : null,
    icon_rect: rect(svg),
    dot: dot ? { class: dot.className, color: getComputedStyle(dot).backgroundColor, rect: rect(dot), shadow: getComputedStyle(dot).boxShadow } : null,
    bar: { rect: rect(bar), scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth, scrollHeight: bar.scrollHeight, clientHeight: bar.clientHeight },
    actions: rect(actions),
  };
}"""


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


def capture(page, output, key, clip=None):
    path = output / f"{key}.png"
    page.screenshot(path=str(path), animations="disabled", clip=clip)
    return str(path)


def header_scene(page, port, width, height, query, key, output):
    page.set_viewport_size({"width": width, "height": height})
    url = f"http://127.0.0.1:{port}/harness.html" + (f"?{query}" if query else "")
    page.goto(url, wait_until="load")
    page.locator(".ks-shell-bar").wait_for(timeout=20000)
    page.locator(".ks-shell-bar .shell-link-button").wait_for(timeout=20000)
    settle(page)
    facts = page.evaluate(MEASURE)
    bar = facts["bar"]["rect"]
    clip = {"x": 0, "y": 0, "width": width, "height": min(height, max(1, int(bar["bottom"]) + 4))}
    facts["captures"] = [capture(page, output, key), capture(page, output, f"{key}-header", clip=clip)]
    server, gear = facts["server"], facts["gear"]
    if server and gear:
        server_rect, gear_rect = server["rect"], gear["rect"]
        facts["align"] = {
            "top_diff": round(abs(server_rect["y"] - gear_rect["y"]), 2),
            "height_diff": round(abs(server_rect["height"] - gear_rect["height"]), 2),
            "width_diff": round(abs(server_rect["width"] - gear_rect["width"]), 2),
            "gap_to_gear": round(gear_rect["x"] - server_rect["right"], 2),
            "right_inset": round(width - gear_rect["right"], 2),
        }
    return facts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/shell-header")
    parser.add_argument("--port", type=int, default=5297)
    parser.add_argument("--label", default="after")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    result = {"label": args.label, "port": args.port, "console": []}
    app_server = app_log = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
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
                for width, height in SIZES:
                    for state, query in STATES:
                        key = f"shell-header-{state}-{width}x{height}"
                        result[key] = header_scene(page, args.port, width, height, query, key, output)
                        server = result[key]["server"] or {}
                        dot = result[key]["dot"] or {}
                        print(key, server.get("mode"), result[key]["icon_class"], dot.get("color"), flush=True)
                page.close()
            finally:
                browser.close()
    finally:
        if app_server is not None:
            stop_server(app_server, app_log)

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT", output / "result.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
