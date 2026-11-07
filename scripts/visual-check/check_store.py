#!/usr/bin/env python3
"""스토어 설정에 사설 스토어 주소와 초대코드를 넣고, 목록에는 깨끗한 주소만 보이며
초대코드가 화면 글 어디에도 드러나지 않는지 확인하고 넓은 창과 좁은 창을 캡처한다.

  python3 scripts/visual-check/check_store.py [--output 산출폴더]

기본 산출 폴더는 target/visual-check/store 이다. kaleidoscope-app 스킬의 sandbox를 빌려
현재 체크아웃의 target/debug 바이너리와 app 화면으로 띄우므로, 실행 전에
`cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge`와
`pnpm install --frozen-lockfile`이 끝나 있어야 한다.
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
STORE_URL = "https://example.com/private-store"
INVITE = "my-secret-invite"
WIDE = (1280, 800)
NARROW = (520, 760)


def load_sandbox():
    common = os.environ.get("AGENT_COMMON_FILES_DIR")
    if not common:
        sys.exit("AGENT_COMMON_FILES_DIR가 없습니다. kaleidoscope-app 스킬이 설치된 노드에서 실행하세요.")
    path = Path(common) / "skills/kaleidoscope-app/scripts/sandbox.py"
    spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def set_rect(sb, window_id, width, height):
    result = sb.core({"op": "window.set_rect", "window_id": window_id,
                      "rect": {"x": 20, "y": 20, "width": width, "height": height}})
    if "error" in result:
        raise AssertionError(result["error"])


def capture(page, output, name, captures):
    path = output / name
    page.screenshot(path=str(path))
    print(f"capture {path}", flush=True)
    captures.append(str(path))
    return str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/store")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    sandbox = load_sandbox()
    warm = sandbox.warm_file
    sandbox.warm_file = lambda path: warm(path) if Path(path).exists() else None
    address, ui_lock = sandbox.acquire_ui_address()
    result = {"store_url": STORE_URL, "invite_in_screen_text": False, "captures": []}
    with ui_lock, tempfile.TemporaryDirectory(prefix="ks-store-visual-") as directory:
        sb = sandbox.Sandbox(ROOT, output, Path(directory) / "folder", address)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                page = sb.page
                snapshot = sb.snapshot()
                workspace = snapshot["device"]["active_workspace_id"]
                desktop = snapshot["device"]["active_desktop_ids"][workspace]
                opened = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": "store",
                                  "rect": {"x": 24, "y": 24, "width": WIDE[0], "height": WIDE[1]}})
                if "window" not in opened:
                    raise AssertionError(opened)
                window_id = opened["window"]["id"]
                app = sb.window("store")
                app.wait_for(state="visible", timeout=60000)
                gear = app.get_by_role("button", name="앱 설정")
                wait_until(lambda: gear.is_visible(), 30, "앱 설정 단추가 보이지 않습니다")
                gear.click()
                settings = app.locator(".ks-app-settings")
                wait_until(lambda: settings.is_visible(), 20, "앱 설정 패널이 열리지 않았습니다")

                server_input = app.get_by_label("사설 스토어 주소")
                invite_input = app.get_by_label("초대코드")
                server_input.fill(STORE_URL)
                invite_input.fill(INVITE)
                add = app.get_by_role("button", name="추가", exact=True)
                wait_until(lambda: add.is_enabled(), 10, "추가 단추가 활성화되지 않았습니다")
                add.click()

                clean = app.get_by_text(STORE_URL, exact=True)
                wait_until(lambda: clean.count() > 0, 20, f"목록에 {STORE_URL}이 나타나지 않았습니다")
                try:
                    wait_until(lambda: invite_input.input_value() == "", 10, "초대코드 입력칸이 비지 않았습니다")
                except AssertionError:
                    current = next(w for w in sb.snapshot()["shared"]["windows"] if w["id"] == window_id)
                    raise AssertionError(
                        f"초대코드 입력칸이 비지 않았습니다: input={invite_input.input_value()!r} "
                        f"state={current['state']} console={sb.console[-5:]} "
                        f"text={app.inner_text()[:1200]!r} page={page.inner_text('body')[:1200]!r}")
                listed = clean.first.inner_text()
                assert listed == STORE_URL, listed
                result["listed_url"] = listed

                panel_text = settings.inner_text()
                window_text = app.inner_text()
                page_text = page.inner_text("body")
                input_values = app.locator("input").evaluate_all("els => els.map(e => e.value)")
                leaked = [name for name, text in
                          (("settings", panel_text), ("window", window_text), ("page", page_text))
                          if INVITE.lower() in text.lower()]
                values_leaked = [value for value in input_values if INVITE.lower() in str(value).lower()]
                assert not leaked, f"초대코드가 화면 글에 드러납니다: {leaked}"
                assert not values_leaked, f"초대코드가 입력값에 남아 있습니다: {values_leaked}"
                assert app.get_by_text(INVITE).count() == 0, "초대코드를 담은 요소가 있습니다"
                result["invite_in_screen_text"] = False
                result["input_values"] = input_values

                stored = {
                    entry: sb.core({"op": "storage.get", "window_id": window_id, "entry": entry})["result"]["content"]
                    for entry in ("servers", "invites")
                }
                assert stored["servers"] == [STORE_URL], stored["servers"]
                assert stored["invites"] == {STORE_URL: INVITE}, stored["invites"]
                device_invites = sb.snapshot()["device"].get("store_invites")
                assert device_invites == {STORE_URL: INVITE}, device_invites
                result["storage"] = stored
                result["device_store_invites"] = device_invites

                set_rect(sb, window_id, *WIDE)
                page.wait_for_timeout(400)
                capture(page, output, "store-settings-wide.png", result["captures"])
                wide_text = settings.inner_text()
                assert STORE_URL in wide_text and INVITE.lower() not in wide_text.lower(), wide_text

                set_rect(sb, window_id, *NARROW)
                page.wait_for_timeout(400)
                capture(page, output, "store-settings-narrow.png", result["captures"])
                narrow_text = settings.inner_text()
                assert STORE_URL in narrow_text and INVITE.lower() not in narrow_text.lower(), narrow_text
                result["assertions"] = {
                    "list_shows_clean_url": True,
                    "invite_absent_from_settings_window_and_page_text": True,
                    "invite_absent_from_input_values": True,
                    "servers_hold_clean_url": True,
                    "invites_hold_separate_code": True,
                    "device_state_holds_invite": True,
                    "wide_1280x800": True,
                    "narrow_520x760": True,
                }
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:  # noqa: BLE001 - 이미 닫힌 화면은 정리만 건너뛴다
                    pass
            sb.stop()

    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
