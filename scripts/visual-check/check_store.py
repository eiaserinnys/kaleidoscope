#!/usr/bin/env python3
"""앱스토어의 커스텀 앱 분류와 상세, 스토어 판으로 바꾸기 동의, 로딩과 실패를 캡처하고 확인한다.

  python3 scripts/visual-check/check_store.py --output target/visual-check/store-custom/after
  python3 scripts/visual-check/check_store.py --root .local/tmp/ks-before-93fb333f \
      --binaries .local/tmp/ks-before-93fb333f --custom no --label before \
      --output target/visual-check/store-custom/before

가짜 스토어는 store_fixture.py가 127.0.0.1의 임의 포트에 긴 운영 꼴 주소 두 갈래로 연다.
실제 스토어가 아니라 루프백 HTTP라서 연결 동의 화면에 암호화 경고가 함께 보인다(운영 HTTPS와 다른 점).
창 크기는 1180x720과 최소 360x241이고, 화면 뷰포트는 창 너비 + 24, 높이 + 124다
(가장자리 12씩, 작업 표시줄 예약 64, 쉘 머리 막대 48). 캡처마다 창의 실제 상자를 재어 1px 안쪽인지 확인한다.
한 번의 시나리오 흐름이 상태를 이어 가므로 줄 수가 500을 넘는다(장면마다 브라우저를 새로 띄우지 않는다).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

import store_fixture as fixture

ROOT = Path(__file__).resolve().parents[2]
SIZES = ((1180, 720), (360, 241))
THEMES = ("light", "dark")
WIDE = (1280, 800)
NARROW = (520, 760)
CUSTOM = "커스텀 앱"
STATUS_OTHER = "사설 1에서 설치한 앱입니다. 스토어 판으로 바꿀 수 있습니다."
STATUS_MODIFIED = "설치 뒤 고친 앱이라 업데이트하지 않습니다"
ERROR_TEXT = "스토어가 요청을 거부했습니다. 잠시 뒤 다시 받으세요."


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


def teardown_evidence(sandbox, sb, address):
    evidence = {}
    for name, port, host in (("server", sb.server_port, "127.0.0.1"),
                             ("bridge", sb.bridge_port, "127.0.0.1"),
                             ("ui", sandbox.UI_PORT, address)):
        try:
            wait_until(lambda p=port, h=host: not sandbox.port_listeners(p, h), 15,
                       f"{name} 포트가 남아 있습니다")
            evidence[name] = "closed"
        except AssertionError:
            evidence[name] = "open"
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/store-custom")
    parser.add_argument("--label", default="after")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--binaries", type=Path)
    parser.add_argument("--custom", choices=("auto", "yes", "no"), default="auto")
    args = parser.parse_args()

    root = args.root.resolve()
    binary_dir = (args.binaries or root / "target/debug").resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    store_json = (root / "apps/store.json").read_text(encoding="utf-8")
    custom_mode = args.custom == "yes" or (args.custom == "auto" and "'__custom'" in store_json)

    cache = Path(os.environ.get("KALEIDOSCOPE_SANDBOX_CACHE") or root / "target/visual-check/.sandbox-cache")
    os.environ["KALEIDOSCOPE_SANDBOX_CACHE"] = str(cache)
    (cache / "locks").mkdir(parents=True, exist_ok=True)

    sandbox = load_sandbox()
    warm = sandbox.warm_file

    def warm_path(path):
        path = Path(path)
        if not path.exists():
            path = binary_dir / path.name
        if path.exists():
            warm(path)

    sandbox.warm_file = warm_path
    address, ui_lock = sandbox.acquire_ui_address()

    store_a = fixture.FakeStore(fixture.STORE_A_PREFIX, fixture.APPS_A, invite=fixture.INVITE)
    store_b = fixture.FakeStore(fixture.STORE_B_PREFIX, fixture.APPS_B, invite=fixture.INVITE)
    store_a.start()
    store_b.start()

    result = {
        "label": args.label,
        "mode": "custom" if custom_mode else "before",
        "root": str(root),
        "binaries": str(binary_dir),
        "output": str(output),
        "store_urls": {"a": store_a.url, "b": store_b.url},
        "invite": fixture.INVITE,
        "custom_category_supported": custom_mode,
        "captures": [],
        "settings_captures": [],
        "windows": {},
        "assertions": {},
        "console": [],
        "apps": [],
        "fake_store_requests": {},
        "teardown": {},
    }
    sb = None
    try:
        with ui_lock, tempfile.TemporaryDirectory(prefix="ks-store-visual-") as directory:
            directory = Path(directory)
            queue = directory / "pick-files.json"
            sb = sandbox.Sandbox(root, output, directory / "folder", address)
            spawn = sb._spawn

            def local_spawn(name, command, **env):
                if name in ("server", "bridge"):
                    command[0] = str(binary_dir / Path(command[0]).name)
                if name == "bridge":
                    env["KALEIDOSCOPE_DEV_PICK_FILES_FILE"] = str(queue)
                return spawn(name, command, **env)

            sb._spawn = local_spawn
            a_url, b_url = store_a.url, store_b.url
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
                    pane0 = app.locator(".ks-split-pane").nth(0)
                    pane1 = app.locator(".ks-split-pane").nth(1)
                    pane2 = app.locator(".ks-split-pane").nth(2)

                    def apps():
                        return sb.snapshot()["shared"]["apps"]

                    def app_entry(app_id):
                        return next((entry for entry in apps() if entry["id"] == app_id), None)

                    def is_modified(entry):
                        return bool(entry and entry.get("origin")
                                    and entry.get("installed_version") != entry.get("current_version"))

                    def operate():
                        page.emulate_media(color_scheme="light")
                        page.set_viewport_size({"width": 1204, "height": 844})
                        page.wait_for_timeout(150)
                        set_rect(sb, window_id, *SIZES[0])
                        page.wait_for_timeout(200)

                    def focus_pane(index):
                        split = app.locator(".ks-split").first
                        if split.evaluate("el => el.classList.contains('is-stacked')"):
                            app.locator(".ks-split-pane").nth(index).evaluate(
                                "el => el.scrollIntoView({block: 'start'})")
                            page.wait_for_timeout(120)

                    def capture(scene, pane=None):
                        for theme in THEMES:
                            for width, height in SIZES:
                                page.emulate_media(color_scheme=theme)
                                page.set_viewport_size({"width": width + 24, "height": height + 124})
                                page.wait_for_timeout(200)
                                set_rect(sb, window_id, width, height)
                                page.wait_for_timeout(160)
                                if pane is not None:
                                    focus_pane(pane)
                                # 누른 자리에 마우스가 남아 있으면 단추 강조와 풍선 도움말이 증거에 찍힌다.
                                page.mouse.move(2, 2)
                                page.wait_for_timeout(120)
                                box = app.bounding_box()
                                assert box is not None, f"{scene}: 창 상자를 재지 못했습니다"
                                assert abs(box["width"] - width) <= 1 and abs(box["height"] - height) <= 1, \
                                    f"{scene}: 창 크기 {box} != {width}x{height}"
                                stacked = app.locator(".ks-split").first.evaluate(
                                    "el => el.classList.contains('is-stacked')")
                                assert stacked == (width < 640), f"{scene}: 좁은 폭 접힘 상태가 맞지 않습니다"
                                name = f"{scene}-{theme}-{width}x{height}.png"
                                app.screenshot(path=str(output / name), animations="disabled")
                                result["captures"].append(name)
                                result["windows"][name] = {key: round(box[key]) for key in
                                                           ("x", "y", "width", "height")}
                                print(f"capture {name}", flush=True)

                    def search(text):
                        field = app.get_by_placeholder("앱 이름이나 id로 찾기")
                        field.fill(text)
                        page.wait_for_timeout(250)

                    def choose_category(title):
                        # 분류 줄의 접근 이름에는 개수(meta)가 붙으므로 row key로 고른다.
                        key = "" if title == "전체" else "__custom"
                        option = pane0.locator(f'[data-row-key="{key}"]')
                        wait_until(lambda: option.count() > 0, 20, f"{title} 분류가 없습니다")
                        option.first.click()
                        page.wait_for_timeout(250)

                    def refresh():
                        pane1.locator(".ks-data-toolbar").first.get_by_role(
                            "button", name="다시 받기").click()

                    def allow_server(url):
                        # 목록이 다시 계산되는 중에 누르면 옆 줄의 동작이 잡힐 수 있어, 원천이 쉰 뒤에 누른다.
                        def catalog_settled():
                            sources = sb.core({"op": "data.read", "window_id": window_id}) \
                                .get("view", {}).get("sources", {})
                            return sources.get("catalog", {}).get("state") == "ready"
                        wait_until(catalog_settled, 30, "스토어 목록이 아직 준비되지 않았습니다")
                        page.wait_for_timeout(300)
                        row = app.locator(f'[data-row-key="{url}"]')
                        wait_until(lambda: row.count() > 0, 20, f"{url} 연결 전 상태가 없습니다")
                        row.first.scroll_into_view_if_needed()
                        page.wait_for_timeout(200)
                        row.get_by_role("button", name="연결 허용").first.click()
                        dialog = app.locator(".ks-install-consent")
                        wait_until(lambda: dialog.count() > 0 and dialog.first.is_visible(), 20,
                                   "스토어 연결 동의 창이 없습니다")
                        text = dialog.first.inner_text()
                        for expected in ("이 스토어에 연결할까요?", url, "이 연결은 암호화되지 않습니다.",
                                         "이 PC에서 앱 목록과 설치 파일을 받도록 허용합니다."):
                            assert expected in text, f"연결 동의에 {expected!r}가 없습니다: {text!r}"
                        dialog.locator(".ks-dialog-confirm button").first.click()
                        wait_until(lambda: dialog.count() == 0 or not dialog.first.is_visible(), 20,
                                   "연결 동의 창이 닫히지 않았습니다")

                    def write_definition(app_id, name, text, slug):
                        path = directory / f"{slug}.json"
                        path.write_text(json.dumps(fixture.definition(app_id, name, text),
                                                   ensure_ascii=False, indent=2), encoding="utf-8")
                        return path

                    def import_file(path):
                        button = app.get_by_role("button", name="파일에서 가져오기")
                        wait_until(lambda: button.count() > 0 and button.first.is_visible(), 10,
                                   "파일에서 가져오기 단추가 없습니다")
                        queue.write_text(json.dumps([str(path)]), encoding="utf-8")
                        button.first.click()

                    def wait_custom_count(count):
                        wait_until(lambda: pane1.get_by_role("option").count() == count, 20,
                                   f"커스텀 앱이 {count}개가 아닙니다")

                    def confirm_install_dialog():
                        dialog = app.locator(".ks-install-consent")
                        wait_until(lambda: dialog.count() > 0 and dialog.first.is_visible(), 20,
                                   "설치 동의 창이 없습니다")
                        return dialog

                    def reopen():
                        # 새 창의 데이터 런타임은 값이 없어 처음 받는 동안 로딩 표시가 보인다.
                        nonlocal window_id
                        sb.core({"op": "window.close", "window_id": window_id})
                        app.wait_for(state="detached", timeout=15000)
                        opened = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": "store",
                                          "rect": {"x": 24, "y": 24, "width": WIDE[0], "height": WIDE[1]}})
                        if "window" not in opened:
                            raise AssertionError(opened)
                        window_id = opened["window"]["id"]
                        app.wait_for(state="visible", timeout=30000)
                        page.wait_for_timeout(150)

                    gear = app.get_by_role("button", name="앱 설정")
                    wait_until(lambda: gear.is_visible(), 30, "앱 설정 단추가 보이지 않습니다")
                    gear.click()
                    settings = app.locator(".ks-app-settings")
                    wait_until(lambda: settings.is_visible(), 20, "앱 설정 패널이 열리지 않았습니다")
                    server_input = app.get_by_label("사설 스토어 주소")
                    invite_input = app.get_by_label("초대코드")
                    add = app.get_by_role("button", name="추가", exact=True)
                    for url in (a_url, b_url):
                        server_input.fill(url)
                        invite_input.fill(fixture.INVITE)
                        wait_until(lambda: add.is_enabled(), 10, "추가 단추가 활성화되지 않았습니다")
                        add.click()
                        wait_until(lambda u=url: app.get_by_text(u, exact=True).count() > 0, 20,
                                   f"목록에 {url}이 나타나지 않았습니다")
                        wait_until(lambda: invite_input.input_value() == "", 10,
                                   "초대코드 입력칸이 비지 않았습니다")
                    stored = {
                        entry: sb.core({"op": "storage.get", "window_id": window_id, "entry": entry})
                        ["result"]["content"]
                        for entry in ("servers", "invites")
                    }
                    assert stored["servers"] == [a_url, b_url], stored["servers"]
                    assert stored["invites"] == {a_url: fixture.INVITE, b_url: fixture.INVITE}, stored["invites"]
                    device_invites = sb.snapshot()["device"].get("store_invites")
                    assert device_invites == {a_url: fixture.INVITE, b_url: fixture.INVITE}, device_invites
                    screen_text = page.inner_text("body").lower()
                    assert fixture.INVITE.lower() not in screen_text, "초대코드가 화면 글에 드러납니다"
                    input_values = app.locator("input").evaluate_all("els => els.map(e => e.value)")
                    assert all(fixture.INVITE.lower() not in str(value).lower() for value in input_values), \
                        input_values
                    result["storage"] = stored
                    result["device_store_invites"] = device_invites

                    set_rect(sb, window_id, *WIDE)
                    page.mouse.move(2, 2)
                    page.wait_for_timeout(400)
                    page.screenshot(path=str(output / "store-settings-wide.png"))
                    result["settings_captures"].append("store-settings-wide.png")
                    set_rect(sb, window_id, *NARROW)
                    page.wait_for_timeout(400)
                    page.screenshot(path=str(output / "store-settings-narrow.png"))
                    result["settings_captures"].append("store-settings-narrow.png")
                    result["assertions"]["settings_hide_invite"] = True
                    app.get_by_role("button", name="앱으로 돌아가기").click()
                    wait_until(lambda: not settings.is_visible(), 10, "앱 설정 패널이 닫히지 않았습니다")

                    operate()
                    search("meeting-cards")
                    allow_server(a_url)
                    wait_until(lambda: pane1.get_by_role("option", name="회의 카드", exact=True).count() > 0,
                               30, "사설 1 목록이 준비되지 않았습니다")
                    allow_server(b_url)
                    wait_until(lambda: pane1.get_by_role("option", name="회의 카드 (팀)", exact=True).count() > 0,
                               30, "사설 2 목록이 준비되지 않았습니다")
                    result["assertions"]["both_private_stores_ready"] = True
                    search("")
                    capture("store-base", pane=1)

                    if custom_mode:
                        operate()
                        choose_category(CUSTOM)
                        empty_row = pane1.locator('[data-row-key="__custom"]')
                        wait_until(lambda: empty_row.count() > 0, 20, "커스텀 앱 빈 상태가 없습니다")
                        assert "없음" in empty_row.first.inner_text(), empty_row.first.inner_text()
                        wait_until(lambda: app.get_by_role(
                            "button", name="파일에서 가져오기").count() > 0, 10,
                            "빈 상태에 가져오기 단추가 없습니다")
                        result["assertions"]["custom_empty_keeps_import_button"] = True
                        capture("custom-empty", pane=1)

                        operate()
                        import_file(write_definition("meeting-cards", fixture.CUSTOM_MEETING,
                                                     "내가 고쳐 쓴 회의 카드입니다.", "custom-meeting"))
                        wait_until(lambda: (entry := app_entry("meeting-cards")) is not None
                                   and entry.get("origin") is None
                                   and entry.get("name") == fixture.CUSTOM_MEETING, 30,
                                   "커스텀 회의 카드가 등록되지 않았습니다")
                        assert sb.window_of("meeting-cards") is None, "가져오기가 창을 열었습니다"
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_MEETING, exact=True).count() > 0, 20,
                            "가져온 커스텀 앱이 목록에 없습니다")
                        import_file(write_definition("read-later", fixture.CUSTOM_READING,
                                                     "내가 모은 읽기 기록입니다.", "custom-reading"))
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_READING, exact=True).count() > 0, 20,
                            "두 번째 커스텀 앱이 목록에 없습니다")
                        wait_custom_count(2)
                        result["assertions"]["import_does_not_open_window"] = True
                        result["assertions"]["custom_list_two_items"] = True
                        capture("custom-list-two", pane=1)

                        operate()
                        pane1.get_by_role("option", name=fixture.CUSTOM_READING, exact=True).click()
                        select_button = pane2.locator("button.ks-select-button")
                        wait_until(lambda: select_button.count() > 0, 20, "스토어 고르기가 없습니다")
                        wait_until(lambda: select_button.first.locator(
                            ".ks-select-choice-label").inner_text().strip() == "사설 2", 20,
                            "후보 스토어가 하나일 때 사설 2가 골라지지 않았습니다")
                        convert = pane2.get_by_role("button", name="스토어 판으로 바꾸기", exact=True)
                        wait_until(lambda: convert.count() > 0 and convert.first.is_enabled(), 20,
                                   "바꾸기 단추가 활성화되지 않았습니다")
                        result["assertions"]["one_candidate_auto_selected"] = True
                        capture("custom-detail-one", pane=2)

                        operate()
                        pane1.get_by_role("option", name=fixture.CUSTOM_MEETING, exact=True).click()
                        wait_until(lambda: select_button.first.locator(
                            ".ks-select-choice-label").inner_text().strip() == "스토어 고르기", 20,
                            "후보가 둘일 때 고르기 자리표시가 나오지 않았습니다")
                        wait_until(lambda: convert.first.is_disabled(), 20, "바꾸기 단추가 활성 상태입니다")
                        result["assertions"]["two_candidates_require_choice"] = True
                        capture("custom-detail-two", pane=2)

                        operate()
                        select_button.first.click()
                        menu = page.locator(".ks-menu")
                        wait_until(lambda: menu.count() > 0 and menu.first.is_visible(), 10,
                                   "스토어 고르기 메뉴가 없습니다")
                        labels = [page.get_by_role("menuitem").nth(index).inner_text().strip()
                                  for index in range(page.get_by_role("menuitem").count())]
                        assert "사설 1" in labels and "사설 2" in labels and "기본 앱스토어" not in labels, labels
                        window_box = app.bounding_box()
                        menu_box = menu.first.bounding_box()
                        pad = 12
                        viewport = page.viewport_size
                        left = max(0, min(window_box["x"], menu_box["x"]) - pad)
                        top = max(0, min(window_box["y"], menu_box["y"]) - pad)
                        right = min(viewport["width"], max(window_box["x"] + window_box["width"],
                                                           menu_box["x"] + menu_box["width"]) + pad)
                        bottom = min(viewport["height"], max(window_box["y"] + window_box["height"],
                                                             menu_box["y"] + menu_box["height"]) + pad)
                        page.screenshot(path=str(output / "custom-detail-two-menu-wide-light.png"), animations="disabled",
                                        clip={"x": left, "y": top, "width": right - left, "height": bottom - top})
                        result["captures"].append("custom-detail-two-menu-wide-light.png")
                        page.get_by_role("menuitem", name="사설 1", exact=True).click()
                        wait_until(lambda: menu.count() == 0 or not menu.first.is_visible(), 10,
                                   "스토어 고르기 메뉴가 닫히지 않았습니다")
                        wait_until(lambda: select_button.first.locator(
                            ".ks-select-choice-label").inner_text().strip() == "사설 1", 20,
                            "사설 1을 고른 값이 보이지 않습니다")
                        wait_until(lambda: convert.first.is_enabled(), 20, "고른 뒤에도 바꾸기 단추가 꺼져 있습니다")
                        result["assertions"]["convert_button_enabled_after_choice"] = True
                        capture("custom-detail-ready", pane=2)

                        operate()
                        convert.first.click()
                        dialog = confirm_install_dialog()
                        text = dialog.first.inner_text()
                        for expected in ("스토어 판으로 바꿀까요?", "회의 카드", "커스텀 앱에서",
                                         a_url, "1판으로", "창과 저장한 값은 유지됩니다."):
                            assert expected in text, f"바꾸기 동의에 {expected!r}가 없습니다: {text!r}"
                        app.screenshot(path=str(output / "convert-consent-wide-light.png"), animations="disabled")
                        result["captures"].append("convert-consent-wide-light.png")
                        dialog.locator(".ks-dialog-confirm button").first.click()
                        wait_until(lambda: dialog.count() == 0 or not dialog.first.is_visible(), 20,
                                   "바꾸기 동의 창이 닫히지 않았습니다")
                        wait_custom_count(1)
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_READING, exact=True).count() == 1, 20,
                            "바꾼 뒤 커스텀 목록이 갱신되지 않았습니다")
                        converted = wait_until(lambda: (lambda entry: entry if entry and entry.get("origin")
                                                        and entry["origin"]["store_url"] == a_url else None)(
                            app_entry("meeting-cards")), 20, "바꾼 앱의 출처가 사설 1이 아닙니다")
                        assert converted["name"] == "회의 카드", converted
                        result["assertions"]["convert_consent_shows_custom_origin"] = True
                        result["assertions"]["convert_replaces_custom_app"] = True

                        operate()
                        import_file(write_definition("diary-notes", fixture.CUSTOM_DIARY,
                                                     "내가 쓴 일기입니다.", "custom-diary"))
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_DIARY, exact=True).count() > 0, 20,
                            "세 번째 커스텀 앱이 목록에 없습니다")
                        wait_custom_count(2)
                        pane1.get_by_role("option", name=fixture.CUSTOM_DIARY, exact=True).click()
                        wait_until(lambda: pane2.get_by_role("button", name="지우기", exact=True).count() > 0,
                                   20, "커스텀 상세의 지우기 단추가 없습니다")
                        assert pane2.locator("button.ks-select-button").count() == 0, "후보가 없는데 고르기가 있습니다"
                        assert pane2.get_by_role("button", name="스토어 판으로 바꾸기", exact=True).count() == 0, \
                            "후보가 없는데 바꾸기 단추가 있습니다"
                        result["assertions"]["no_candidate_hides_convert"] = True
                        capture("custom-detail-none", pane=2)

                        operate()
                        choose_category("전체")
                        search("meeting-cards")
                        other = pane1.get_by_role("option", name="회의 카드 (팀)", exact=True)
                        wait_until(lambda: other.count() > 0, 20, "사설 2의 회의 카드가 없습니다")
                        other.first.click()
                        wait_until(lambda: STATUS_OTHER in pane2.inner_text(), 30,
                                   "다른 출처 설치 앱의 상태 글이 없습니다")
                        convert_button = pane2.get_by_role("button", name="스토어 판으로 바꾸기", exact=True)
                        wait_until(lambda: convert_button.count() > 0 and convert_button.first.is_enabled(), 20,
                                   "다른 출처 앱의 바꾸기 단추가 꺼져 있습니다")
                        result["assertions"]["other_origin_enables_convert"] = True
                        capture("other-origin", pane=2)

                        operate()
                        choose_category(CUSTOM)
                        search("")
                        import_file(write_definition("meeting-cards", fixture.CUSTOM_MEETING_MODIFIED,
                                                     "스토어 판을 고친 사본입니다.", "custom-meeting-modified"))
                        wait_until(lambda: is_modified(app_entry("meeting-cards")), 30,
                                   "고친 사본이 수정본으로 잡히지 않았습니다")
                        choose_category("전체")
                        search("meeting-cards")
                        source = pane1.get_by_role("option", name="회의 카드", exact=True)
                        wait_until(lambda: source.count() > 0, 20, "사설 1의 회의 카드가 없습니다")
                        source.first.click()
                        wait_until(lambda: STATUS_MODIFIED in pane2.inner_text(), 30,
                                   "고친 사본의 상태 글이 없습니다")
                        restore = pane2.get_by_role("button", name="스토어 판으로 되돌리기", exact=True)
                        wait_until(lambda: restore.count() > 0 and restore.first.is_enabled(), 20,
                                   "되돌리기 단추가 없거나 꺼져 있습니다")
                        result["assertions"]["modified_copy_offers_restore"] = True
                        capture("restore", pane=2)

                        operate()
                        store_a.delay = store_b.delay = 4.0
                        reopen()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        capture("store-loading", pane=1)
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
                        reopen()
                        choose_category(CUSTOM)
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        assert pane1.get_by_role("option").count() == 2, "로딩 중에 커스텀 목록이 사라졌습니다"
                        result["assertions"]["custom_list_survives_store_loading"] = True
                        capture("custom-loading", pane=1)
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
                        store_a.delay = store_b.delay = 0.0
                        store_a.fail = store_b.fail = True
                        reopen()
                        wait_until(lambda: pane1.inner_text().count(ERROR_TEXT) >= 2, 30,
                                   "가짜 스토어 실패 상태가 두 곳에 보이지 않습니다")
                        capture("store-failure", pane=1)
                        operate()
                        choose_category(CUSTOM)
                        assert pane1.get_by_role("option").count() == 2, "실패 중에 커스텀 목록이 사라졌습니다"
                        result["assertions"]["custom_list_survives_store_failure"] = True
                        capture("custom-failure", pane=1)
                        operate()
                        store_a.fail = store_b.fail = False
                        refresh()
                        wait_until(lambda: pane0.locator('[data-row-key=""]').count() > 0, 30,
                                   "실패를 푼 뒤 분류가 돌아오지 않았습니다")
                        choose_category("전체")
                        search("read-later")
                        wait_until(lambda: pane1.get_by_role(
                            "option", name="나중에 읽기", exact=True).count() > 0, 30,
                            "실패를 푼 뒤 사설 2 목록이 돌아오지 않았습니다")
                        search("")
                    else:
                        assert pane0.locator('[data-row-key="__custom"]').count() == 0, \
                            "이 판에 커스텀 앱 분류가 있습니다"
                        assert app.get_by_role("button", name="파일에서 가져오기").count() == 0, \
                            "이 판에 가져오기 단추가 있습니다"
                        assert app.get_by_text(CUSTOM, exact=True).count() == 0, "이 판 화면에 커스텀 앱 글이 있습니다"
                        result["assertions"]["custom_category_absent"] = True

                        operate()
                        store_a.delay = store_b.delay = 4.0
                        reopen()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        capture("store-loading", pane=1)
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
                        store_a.delay = store_b.delay = 0.0
                        store_a.fail = store_b.fail = True
                        reopen()
                        wait_until(lambda: pane1.inner_text().count(ERROR_TEXT) >= 2, 30,
                                   "가짜 스토어 실패 상태가 두 곳에 보이지 않습니다")
                        capture("store-failure", pane=1)
                        store_a.fail = store_b.fail = False
                        refresh()
                        wait_until(lambda: pane1.inner_text().count(ERROR_TEXT) == 0, 30,
                                   "스토어 실패 상태가 풀리지 않았습니다")
                        search("read-later")
                        wait_until(lambda: pane1.get_by_role(
                            "option", name="나중에 읽기", exact=True).count() > 0, 30,
                            "실패를 푼 뒤 사설 2 목록이 돌아오지 않았습니다")
                        search("")

                    result["assertions"]["window_sizes_match"] = True
                    result["assertions"]["themes_captured"] = all(
                        any(name.endswith(f"-{theme}-{width}x{height}.png") for name in result["captures"])
                        for theme in THEMES for width, height in SIZES)
                    page_errors = [line for line in sb.console if line.startswith("pageerror:")]
                    assert not page_errors, page_errors
                    result["assertions"]["no_pageerror"] = True
                    result["console"] = sb.console[-120:]
                    result["apps"] = [{key: entry.get(key) for key in
                                       ("id", "name", "origin", "installed_version", "current_version")}
                                      for entry in apps()
                                      if entry["id"] in ("meeting-cards", "read-later", "diary-notes")]
            finally:
                if browser is not None:
                    try:
                        browser.close()
                    except Exception:  # noqa: BLE001 - 이미 닫힌 화면은 정리만 건너뛴다
                        pass
                sb.stop()
                store_a.stop()
                store_b.stop()
                result["teardown"] = teardown_evidence(sandbox, sb, address)
    except Exception as exc:  # noqa: BLE001 - 실패 원인을 결과 파일에 남긴다
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["traceback"] = traceback.format_exc()[-4000:]
        if sb is not None:
            result["console"] = sb.console[-80:]
        raise
    finally:
        result["fake_store_requests"] = {"a": store_a.log(), "b": store_b.log()}
        (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"label": result["label"], "mode": result["mode"],
                      "captures": len(result["captures"]) + len(result["settings_captures"]),
                      "assertions": result["assertions"], "teardown": result["teardown"]},
                     ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
