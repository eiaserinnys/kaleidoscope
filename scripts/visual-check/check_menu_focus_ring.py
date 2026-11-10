#!/usr/bin/env python3
"""메뉴를 연 입력 방식에 따라 첫 항목의 초점 링이 맞는지 확인한다.

입력에 키보드로 글자를 넣은 뒤 마우스 우클릭으로 연 메뉴는 첫 항목이 초점을 가져야 하지만
(키보드 접근) 링은 그리지 않고, Shift+F10으로 연 메뉴는 첫 항목이 초점을 가지며 링을 그린다.
쓰기 입력은 초점을 받으면 브라우저가 늘 :focus-visible을 주고 스크립트 초점이 그 판정을
물려받으므로, 우클릭으로 연 메뉴가 그 링까지 물려받는지 확인한다.

  python3 scripts/visual-check/check_menu_focus_ring.py [--output 산출폴더] [--port 포트]

중립 미리보기 ?preview=data-controls에 입력 한 칸짜리 장면 정의를 주입하고 1180×720에서
마우스 우클릭 장면과 Shift+F10 장면을 잰다. 실제 개인 앱 정의는 쓰지 않는다. 기본 산출
폴더는 target/visual-check/menu-focus-ring 이고, 서버는 이 체크아웃의
ui/harness/e2e-server.mjs를 KS_E2E_PORT로 띄운다.

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
APP_ID = "data-controls"
WIDTH, HEIGHT = 1180, 720
STYLE = "body { padding: 0; } .ks-harness { display: block; height: 100vh; } .ks-harness-header, .ks-harness-dev-panel { display: none; } .ks-harness-apps.is-preview { height: 100%; }"

layout = {
    "type": "stack", "direction": "column", "gap": "small",
    "children": [
        {"type": "input", "value": {"state": "value"}, "on_change": [], "placeholder": "메모"},
        {"type": "text", "value": "본문"},
    ],
}

# 메뉴는 body로 포털되므로 창이 아니라 문서에서 첫 항목을 찾고, 그 항목이 초점과 링을 갖는지 잰다.
MENU_FOCUS_JS = """() => {
  const menu = document.querySelector('[role="menu"]');
  const items = menu ? [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')] : [];
  const first = items[0] ?? null;
  const active = document.activeElement;
  const style = first ? getComputedStyle(first) : null;
  return {
    menuOpen: Boolean(menu),
    itemCount: items.length,
    activeTag: active ? active.tagName : null,
    activeRole: active instanceof Element ? active.getAttribute('role') : null,
    activeIsFirstItem: Boolean(first) && active === first,
    focusVisible: first ? first.matches(':focus-visible') : null,
    outlineStyle: style ? style.outlineStyle : null,
    outlineWidth: style ? style.outlineWidth : null,
    boxShadow: style ? style.boxShadow : null,
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


def open_scene(page, port):
    page.set_viewport_size({"width": WIDTH, "height": HEIGHT})
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
          version.definition.state = { value: '' };
          version.definition.ui = layout;
          version.version += 1;
          const win = snapshot.shared.windows.find((w) => w.app_id === 'data-controls');
          win.app_version = version.version;
          win.state = { value: '' };
          harness.emit({ event: 'state.changed', snapshot });
        }""",
        layout,
    )
    page.add_style_tag(content=STYLE)
    page.evaluate("() => document.fonts.ready.then(() => undefined)")
    page.wait_for_timeout(300)
    return page.get_by_test_id(f"app-window-{APP_ID}")


def wait_menu(page):
    page.wait_for_selector('[role="menu"]', state="visible", timeout=30000)
    page.wait_for_function(
        """() => {
          const item = document.querySelector('[role="menu"] [role="menuitem"]:not([disabled])');
          return Boolean(item) && document.activeElement === item;
        }""",
        timeout=30000,
    )


def judge(name, measurement):
    if name == "pointer-menu":
        return {
            "first_item_focused": measurement.get("activeIsFirstItem") is True,
            "no_ring": measurement.get("focusVisible") is False,
        }
    return {
        "first_item_focused": measurement.get("activeIsFirstItem") is True,
        "ring": measurement.get("focusVisible") is True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="target/visual-check/menu-focus-ring")
    parser.add_argument("--port", type=int, default=5406)
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
            app = open_scene(page, args.port)
            field = app.locator("input[placeholder='메모']")

            # 입력에 키보드로 글자를 넣은 뒤 마우스 우클릭: 입력이 링을 그린 채 메뉴가 열린다.
            # 브라우저는 스크립트 초점이 앞선 링 상태를 물려받게 두므로, 첫 항목은 초점만 갖고 링은 없어야 한다.
            field.click()
            page.keyboard.press("a")
            field.click(button="right")
            wait_menu(page)
            measurement = page.evaluate(MENU_FOCUS_JS)
            page.screenshot(path=str(output / "pointer-menu.png"), animations="disabled")
            checks = judge("pointer-menu", measurement)
            scenes["pointer-menu"] = {"measurement": measurement, "checks": checks, "screenshot": str(output / "pointer-menu.png")}
            failed = [check for check, ok in checks.items() if not ok]
            failures.extend(f"pointer-menu.{check}" for check in failed)
            print("pointer-menu", measurement, "FAIL " + ",".join(failed) if failed else "ok")

            # 메뉴를 닫고 입력을 마우스로 눌러 초점을 둔 뒤 Shift+F10: 첫 항목이 초점과 링을 가져야 한다.
            page.keyboard.press("Escape")
            page.wait_for_selector('[role="menu"]', state="detached", timeout=30000)
            field.click()
            page.keyboard.press("Shift+F10")
            wait_menu(page)
            measurement = page.evaluate(MENU_FOCUS_JS)
            page.screenshot(path=str(output / "keyboard-menu.png"), animations="disabled")
            checks = judge("keyboard-menu", measurement)
            scenes["keyboard-menu"] = {"measurement": measurement, "checks": checks, "screenshot": str(output / "keyboard-menu.png")}
            failed = [check for check, ok in checks.items() if not ok]
            failures.extend(f"keyboard-menu.{check}" for check in failed)
            print("keyboard-menu", measurement, "FAIL " + ",".join(failed) if failed else "ok")

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
