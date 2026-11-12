#!/usr/bin/env python3
"""앱스토어의 커스텀 앱 분류와 상세, 스토어 판으로 바꾸기 동의, 로딩과 실패를 캡처하고 확인한다.

  python3 scripts/visual-check/check_store.py --output target/visual-check/store-custom/after
  python3 scripts/visual-check/check_store.py --root .local/tmp/ks-before-main \
      --binaries .local/tmp/ks-before-main/target/debug --label before \
      --output target/visual-check/store-custom/before

가짜 스토어는 store_fixture.py가 127.0.0.1의 임의 포트에 긴 운영 꼴 주소 두 갈래로 연다.
실제 스토어가 아니라 루프백 HTTP라서 연결 동의 화면에 암호화 경고가 함께 보인다(운영 HTTPS와 다른 점).
창 크기는 1180x720과 최소 360x241이고, 화면 뷰포트는 창 너비 + 24, 높이 + 124다
(가장자리 12씩, 작업 표시줄 예약 64, 쉘 머리 막대 48). 캡처마다 창의 실제 상자를 재어 1px 안쪽인지 확인한다.
아이콘 칸(.ks-icon-tile)마다 currentColor 마스크, 그림, 기본 격자, 깨진 그림, 불러오는 중 가운데
무엇이 그려졌는지 가려 결과 JSON의 details.icon_tiles에 남긴다. 앱 아이콘 미디어(app_icon)를 아는
판에서만 기대값을 단언한다(--icons auto). 커스텀 앱 분류가 없는 판은 --custom no로 찍는다.
한 번의 시나리오 흐름이 상태를 이어 가므로 줄 수가 500을 넘는다(장면마다 브라우저를 새로 띄우지 않는다).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
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
STATUS_OTHER = "사설 1에서 설치한 앱입니다"
STATUS_MODIFIED = "설치 뒤 고친 앱이라 업데이트하지 않습니다"
ERROR_TEXT = "스토어가 요청을 거부했습니다. 잠시 뒤 다시 받으세요."
# 앱 아이콘 미디어 요청 하나만 실패시킬 때 돌려주는 오류. 코어의 자산 내려받기 실패와 같은 모양이다.
ICON_ERROR = {
    "code": "server",
    "message": "미디어 자산 다운로드 요청을 서버에 보내지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요. 자산: broken-icon",
    "id": "MEDIA_LOAD_ASSET_DOWNLOAD_SEND_FAILED",
    "details": [],
}
# 초점이 어디에 있는지, 그 조작이 어느 칸에 있고 지금 보이는지 한 번에 잰다.
ACTIVE_JS = """() => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  const pane = el.closest('.ks-split-pane');
  const parent = pane ? pane.parentElement : null;
  const panes = parent ? [...parent.children].filter((child) => child.classList && child.classList.contains('ks-split-pane')) : [];
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const dialog = el.closest('.ks-dialog');
  return {
    tag: el.tagName,
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label'),
    text: (el.innerText || '').trim().slice(0, 80),
    pane: pane ? panes.indexOf(pane) : -1,
    in_dialog: Boolean(dialog),
    dialog_role: dialog ? dialog.getAttribute('role') : null,
    visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0,
    hidden_ancestor: Boolean(el.closest('[hidden], [inert], [aria-hidden="true"]')),
    tab_index: el.tabIndex,
  };
}"""
# 최소 창에서 가로로 넘치는 칸과 상세 칸 밖으로 나가거나 겹치는 단추를 찾는다.
OVERFLOW_JS = """(root) => {
  const box = (el) => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}; };
  // 창 바깥 상자(.ks-window)는 크기 조절 손잡이를 일부러 밖으로 내놓아 overflow가 늘 크다.
  // 내용이 실제로 넘치는지는 내용을 자르는 틀과 그 안쪽에서 잰다.
  const targets = [root.querySelector('.ks-window-frame'), root.querySelector('.ks-window-content'),
    ...root.querySelectorAll('.ks-data-window-body, .ks-split, .ks-split-pane, .ks-data-toolbar, .ks-list, .ks-properties, .ks-data-stack')].filter(Boolean);
  const overflow = targets
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => ({tag: el.tagName, className: String(el.className), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth}));
  const panes = [...root.querySelectorAll('.ks-split-pane')];
  const pane = panes[panes.length - 1];
  const paneBox = pane ? pane.getBoundingClientRect() : null;
  const buttons = pane ? [...pane.querySelectorAll('button')].filter((el) => {
    const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }) : [];
  const outside = buttons
    .map((el) => ({label: el.getAttribute('aria-label') || (el.innerText || '').trim(), ...box(el)}))
    .filter((item) => !paneBox || item.left < paneBox.left - 1 || item.right > paneBox.right + 1);
  const overlaps = [];
  for (let first = 0; first < buttons.length; first += 1) {
    for (let second = first + 1; second < buttons.length; second += 1) {
      const a = buttons[first].getBoundingClientRect(); const b = buttons[second].getBoundingClientRect();
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > 1 && height > 1) overlaps.push([
        buttons[first].getAttribute('aria-label') || (buttons[first].innerText || '').trim(),
        buttons[second].getAttribute('aria-label') || (buttons[second].innerText || '').trim(),
      ]);
    }
  }
  return {overflow, outside, overlaps};
}"""
# 긴 주소가 들어간 동의 창이 최소 창에서 넘치는지 잰다.
CONSENT_JS = """() => {
  const dialog = document.querySelector('.ks-install-consent .ks-dialog');
  if (!dialog) return null;
  const box = (el) => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}; };
  const overflow = [dialog, ...dialog.querySelectorAll('.ks-dialog-body, .ks-dialog-title')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => ({tag: el.tagName, className: String(el.className), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth}));
  const rect = dialog.getBoundingClientRect();
  const buttons = [...dialog.querySelectorAll('.ks-dialog-actions button')].map((el) => ({label: el.getAttribute('aria-label') || (el.innerText || '').trim(), ...box(el)}));
  const outside = buttons.filter((item) => item.left < rect.left - 1 || item.right > rect.right + 1);
  return {rect: box(dialog), viewport: {width: window.innerWidth, height: window.innerHeight}, overflow, buttons, outside};
}"""
LIST_SCROLL_JS = """(pane) => {
  const list = pane.querySelector('.ks-list');
  if (!list) return null;
  const box = list.getBoundingClientRect();
  // 창 폭이 바뀌면 줄 높이가 달라져 scrollTop만으로는 같은 자리인지 알 수 없다.
  // 화면 맨 위에 걸친 항목과 그 항목이 목록 위에서 떨어진 거리를 함께 남긴다.
  const visible = [...list.querySelectorAll('[data-row-key][role="option"]')].map((node) => {
    const rect = node.getBoundingClientRect();
    return {key: node.getAttribute('data-row-key'), title: node.getAttribute('aria-label'),
            top: Math.round(rect.top - box.top), bottom: Math.round(rect.bottom - box.top)};
  }).filter((item) => item.bottom > 0 && item.top < box.height).sort((a, b) => a.top - b.top);
  return {top: list.scrollTop, height: list.scrollHeight, client: list.clientHeight,
          first: visible.length ? visible[0] : null, rows: visible};
}"""
# 가상 목록의 이어진 줄 상자와, 아이콘 줄 안 항목들의 위 끝을 잰다.
# 줄 높이를 잘못 기억하면 다음 줄이 앞 줄의 아래 끝을 파고들고, 격자 열 수가 묶음과
# 어긋나면 한 줄의 항목이 두 줄로 접혀 위 끝이 갈린다.
ROW_GEOMETRY_JS = """(pane) => {
  const list = pane.querySelector('.ks-list');
  if (!list) return null;
  const rows = [...list.querySelectorAll('[data-index]')].map((row) => {
    const rect = row.getBoundingClientRect();
    const tiles = [...row.querySelectorAll(':scope > .ks-icon-tile')].map((tile) => {
      const tileRect = tile.getBoundingClientRect();
      return {top: tileRect.top, bottom: tileRect.bottom, height: tileRect.height};
    });
    return {index: Number(row.getAttribute('data-index')), top: rect.top, bottom: rect.bottom, tiles};
  });
  return rows.sort((a, b) => a.index - b.index);
}"""
# 아이콘 칸마다 지금 무엇이 그려졌는지 가른다. currentColor 마스크(mask), 그림(image),
# 기본 격자(default-grid), 깨진 그림 표시(image-off), 아직 불러오는 중(loading), 그 밖(other).
# 실패한 앱 아이콘 칸과 아이콘 없는 칸을 견주려고 그림 요소의 상자, 색, 바탕, title도 잰다.
ICON_TILES_JS = """(pane) => [...pane.querySelectorAll('.ks-icon-tile')]
  .filter((tile) => !tile.classList.contains('ks-icon-tile-skeleton'))
  .map((tile) => {
    const icon = tile.querySelector('.ks-icon-tile-icon');
    const name = (tile.getAttribute('aria-label') || '').trim();
    const thumb = tile.querySelector('.ks-media-thumbnail');
    const drawn = icon && icon.querySelector('.ks-app-icon, svg, .ks-icon-skeleton-icon');
    const box = (el) => { if (!el) return null; const rect = el.getBoundingClientRect();
      return {x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10,
              w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10}; };
    let kind = 'other';
    if (icon && icon.querySelector('.ks-icon-skeleton-icon')) kind = 'loading';
    else if (icon && icon.querySelector('span.ks-app-icon')) kind = 'mask';
    else if (icon && icon.querySelector('img.ks-app-icon')) kind = 'image';
    else if (icon && icon.querySelector('svg.lucide-layout-grid')) kind = 'default-grid';
    else if (icon && icon.querySelector('.lucide-image-off')) kind = 'image-off';
    return {
      name, kind,
      thumb_class: thumb ? thumb.className : null,
      thumb_title: thumb ? thumb.getAttribute('title') : null,
      icon_box: box(icon), drawn: box(drawn),
      drawn_color: drawn ? getComputedStyle(drawn).color : null,
      drawn_bg: drawn ? getComputedStyle(drawn).backgroundColor : null,
    };
  })"""


def row_overlaps(rows, tolerance=0.5):
    """이어진 가상 줄의 아래 끝이 다음 줄의 위 끝을 넘는 쌍."""
    return [(first["index"], second["index"], round(first["bottom"] - second["top"], 1))
            for first, second in zip(rows, rows[1:]) if first["bottom"] - second["top"] > tolerance]


def grid_rows_misaligned(rows, tolerance=0.5):
    """한 가상 줄 안에서 항목들의 위 끝이 어긋난 줄. 격자가 두 줄로 접힌 경우."""
    return [row["index"] for row in rows
            if row["tiles"] and
            max(tile["top"] for tile in row["tiles"]) - min(tile["top"] for tile in row["tiles"]) > tolerance]


# 분류별로 목록이 시작하는 높이. 위 도구 막대 높이가 달라지면 값이 갈린다.
LIST_TOP_JS = """(pane) => {
  const list = pane.querySelector('.ks-list');
  const paneBox = pane.getBoundingClientRect();
  return list ? Math.round((list.getBoundingClientRect().top - paneBox.top) * 10) / 10 : null;
}"""
# 가운데 쌓기 빈 상태의 상자. 글과 칸의 가운데가 맞는지 잰다.
EMPTY_STATE_JS = """(pane) => {
  const stack = pane.querySelector('.ks-data-stack.is-center');
  const text = stack ? stack.querySelector('.ks-data-text') : null;
  if (!text) return null;
  const box = (el) => { const r = el.getBoundingClientRect();
    return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; };
  const toolbar = pane.querySelector('.ks-data-toolbar');
  // 칸에 안쪽 여백이 있으면 내용 상자는 칸 상자보다 작다. 쌓기는 내용 상자를 다 채운다.
  const container = stack.parentElement.closest('.ks-data-stack.is-column') || stack.parentElement;
  return {pane: box(pane), container: box(container), stack: box(stack), text: box(text),
          toolbarBottom: toolbar ? toolbar.getBoundingClientRect().bottom : null};
}"""
# 상세 칸의 바닥 도구 막대와 강조 단추. 이름표가 없으면 안쪽 글을 읽는다.
DETAIL_ACTIONS_JS = """(pane) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const label = (el) => (el.getAttribute('aria-label') || (el.innerText || '')).trim();
  const toolbars = [...pane.querySelectorAll('.ks-data-toolbar')]
    .filter((el) => visible(el) && el.querySelector('button'))
    .map((el) => [...el.querySelectorAll('button')].filter(visible).map(label));
  const emphasis = [...pane.querySelectorAll('button.ks-button-emphasis')].filter(visible).map(label);
  return {toolbars, emphasis};
}"""


def empty_state_centered(facts, tolerance=2.0):
    """빈 상태 글이 칸 가운데에 있고, 남는 높이를 다 쓰는지."""
    if not facts or facts["toolbarBottom"] is None:
        return False
    container_mid = (facts["container"]["left"] + facts["container"]["right"]) / 2
    text_mid = (facts["text"]["left"] + facts["text"]["right"]) / 2
    stack_mid = (facts["stack"]["top"] + facts["stack"]["bottom"]) / 2
    text_mid_y = (facts["text"]["top"] + facts["text"]["bottom"]) / 2
    return (abs(text_mid - container_mid) <= tolerance
            and abs(text_mid_y - stack_mid) <= tolerance
            and facts["stack"]["top"] >= facts["toolbarBottom"] - 1
            and facts["stack"]["bottom"] >= facts["container"]["bottom"] - 1)


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
    parser.add_argument("--icons", choices=("auto", "yes", "no"), default="auto")
    args = parser.parse_args()

    root = args.root.resolve()
    binary_dir = (args.binaries or root / "target/debug").resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    store_json = (root / "apps/store.json").read_text(encoding="utf-8")
    custom_mode = args.custom == "yes" or (args.custom == "auto" and "'__custom'" in store_json)
    # 다른 앱의 아이콘 미디어(AppIconMediaRef)를 아는 판인지는 생성된 계약 타입으로 가른다.
    contract = (root / "ui/src/contract/contract.ts").read_text(encoding="utf-8")
    icons_mode = args.icons == "yes" or (args.icons == "auto" and "AppIconMediaRef" in contract)

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
        "app_icon_media_supported": icons_mode,
        "captures": [],
        "settings_captures": [],
        "windows": {},
        "assertions": {},
        "details": {},
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
                if custom_mode:
                    # 커스텀 앱이 선언한 아이콘 자산은 가져오기 전에 계정에 올려 둔다.
                    for asset_id, svg in ((fixture.MEETING_ICON, fixture.CURRENT_COLOR_ICON),
                                          (fixture.READING_ICON, fixture.FIXED_COLOR_ICON)):
                        uploaded = sb.mcp.call("upload_asset", {
                            "id": asset_id, "version": 1, "format": "svg",
                            "sha256": hashlib.sha256(svg).hexdigest(),
                            "source": f"store_fixture.py#{asset_id}",
                            "license": "MIT",
                            "data_base64": base64.b64encode(svg).decode("ascii"),
                        })
                        assert not uploaded["is_error"], uploaded["text"]
                    result["details"]["uploaded_icons"] = [fixture.MEETING_ICON, fixture.READING_ICON]
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

                    def capture(scene, pane=None, check=None):
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
                                if check is not None:
                                    check(theme, width, height)
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

                    def hold_stores():
                        store_a.gate.clear()
                        store_b.gate.clear()

                    def release_stores():
                        store_a.gate.set()
                        store_b.gate.set()

                    def check_store_loading(scene):
                        # 장마다 로딩 표시가 남아 있는지 본다. 없으면 로딩 장면이 이미 받은 목록으로 찍힌 것이다.
                        def check(theme, width, height):
                            assert page.locator(".ks-data-view.is-loading").count() > 0, \
                                f"{scene} {theme} {width}x{height}: 찍는 순간 로딩 표시가 없습니다"
                            result["assertions"][f"{scene.replace('-', '_')}_state"] = True
                        return check

                    def capture_icons(scene, expected, assertion, extra=None):
                        def check(theme, width, height):
                            # 좁은 창에서는 그 밖의 스토어 묶음을 화면에 들여 팀 안내서 칸이 캡처에 보이게 한다.
                            if scene == "other-stores" and width < 640:
                                pane1.get_by_role("option", name="팀 안내서", exact=True).first.evaluate(
                                    "el => el.scrollIntoView({block: 'end'})")
                                page.wait_for_timeout(200)
                            deadline = time.monotonic() + 20
                            while True:
                                facts = pane1.evaluate(ICON_TILES_JS)
                                kinds = {fact["name"]: fact["kind"] for fact in facts}
                                settled = not any(kind == "loading" for kind in kinds.values())
                                matched = all(kinds.get(name) == kind for name, kind in expected.items())
                                if (settled and matched) or time.monotonic() >= deadline:
                                    break
                                time.sleep(0.1)
                            result["details"].setdefault("icon_tiles", {})[
                                f"{scene}-{theme}-{width}x{height}"] = facts
                            if icons_mode and expected:
                                wrong = {name: kinds.get(name) for name, kind in expected.items()
                                         if kinds.get(name) != kind}
                                assert not wrong, \
                                    f"{scene} {theme} {width}x{height}: 아이콘 칸이 기대 {expected}와 다릅니다: " \
                                    f"{wrong} / 전체 {facts}"
                                result["assertions"][assertion] = True
                            if extra is not None:
                                extra(facts, kinds, theme, width, height)
                        capture(scene, pane=1, check=check)

                    def search(text):
                        field = app.get_by_placeholder("앱 이름이나 id로 찾기")
                        field.fill(text)
                        page.wait_for_timeout(250)

                    def choose_category(title):
                        # 분류 줄의 접근 이름에는 개수(meta)가 붙으므로 row key로 고른다.
                        key = {"전체": "", CUSTOM: "__custom", "설치됨": "__installed"}[title]
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

                    def write_definition(app_id, name, text, slug, icon=None):
                        path = directory / f"{slug}.json"
                        path.write_text(json.dumps(fixture.definition(app_id, name, text, icon),
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

                    def check_detail_actions(theme, width, height, primary, delete_and_convert=False):
                        actions = pane2.evaluate(DETAIL_ACTIONS_JS)
                        assert len(actions["toolbars"]) <= 2, \
                            f"상세 {theme} {width}x{height}: 바닥 도구 막대가 둘을 넘습니다: {actions['toolbars']}"
                        if delete_and_convert:
                            same = [labels for labels in actions["toolbars"]
                                    if "지우기" in labels and "스토어 판으로 바꾸기" in labels]
                            assert len(same) == 1, \
                                f"상세 {theme} {width}x{height}: 지우기와 바꾸기가 같은 막대에 있지 않습니다: {actions['toolbars']}"
                            result["assertions"]["delete_and_convert_same_toolbar"] = True
                        assert actions["emphasis"] == [primary], \
                            f"상세 {theme} {width}x{height}: 강조 단추가 {primary!r} 하나가 아닙니다: {actions['emphasis']}"
                        result["assertions"]["detail_bottom_toolbars_at_most_two"] = True
                        result["assertions"]["detail_single_primary"] = True

                    def confirm_install_dialog():
                        dialog = app.locator(".ks-install-consent")
                        wait_until(lambda: dialog.count() > 0 and dialog.first.is_visible(), 20,
                                   "설치 동의 창이 없습니다")
                        return dialog

                    def active_info():
                        return page.evaluate(ACTIVE_JS)

                    def assert_focused(locator, message):
                        assert locator.first.evaluate("el => document.activeElement === el"), \
                            f"{message}: {active_info()}"

                    def assert_dialog_first_action(dialog, message):
                        first_action = dialog.locator(".ks-dialog-actions > button").first
                        wait_until(lambda: first_action.count() > 0, 10, f"{message}: 동작 단추가 없습니다")
                        assert_focused(first_action, message)

                    def assert_content_focus(message):
                        inside = app.evaluate(
                            "(root) => Boolean(document.activeElement) && root.contains(document.activeElement)"
                            " && Boolean(document.activeElement.closest('.ks-data-window-body'))")
                        assert inside, f"{message}: {active_info()}"

                    def close_menu(menu):
                        wait_until(lambda: menu.count() == 0 or not menu.first.is_visible(), 10,
                                   "메뉴가 닫히지 않았습니다")

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
                        empty_text = pane1.get_by_text("커스텀 앱이 없습니다.", exact=True)
                        wait_until(lambda: empty_text.count() > 0, 20, "커스텀 앱 빈 상태가 없습니다")
                        assert pane1.get_by_role("option").count() == 0, "빈 커스텀 목록에 항목이 있습니다"
                        wait_until(lambda: app.get_by_role(
                            "button", name="파일에서 가져오기").count() > 0, 10,
                            "빈 상태에 가져오기 단추가 없습니다")
                        result["assertions"]["custom_empty_keeps_import_button"] = True

                        def check_empty_center(theme, width, height):
                            facts = pane1.evaluate(EMPTY_STATE_JS)
                            assert empty_state_centered(facts), \
                                f"custom-empty {theme} {width}x{height}: 빈 상태가 칸 가운데가 아닙니다: {facts}"
                            result["details"]["custom_empty"] = facts
                            result["assertions"]["custom_empty_centered"] = True

                        capture("custom-empty", pane=1, check=check_empty_center)

                        operate()
                        import_file(write_definition("meeting-cards", fixture.CUSTOM_MEETING,
                                                     "내가 고쳐 쓴 회의 카드입니다.", "custom-meeting",
                                                     fixture.MEETING_ICON))
                        wait_until(lambda: (entry := app_entry("meeting-cards")) is not None
                                   and entry.get("origin") is None
                                   and entry.get("name") == fixture.CUSTOM_MEETING, 30,
                                   "커스텀 회의 카드가 등록되지 않았습니다")
                        assert sb.window_of("meeting-cards") is None, "가져오기가 창을 열었습니다"
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_MEETING, exact=True).count() > 0, 20,
                            "가져온 커스텀 앱이 목록에 없습니다")
                        import_file(write_definition("read-later", fixture.CUSTOM_READING,
                                                     "내가 모은 읽기 기록입니다.", "custom-reading",
                                                     fixture.READING_ICON))
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.CUSTOM_READING, exact=True).count() > 0, 20,
                            "두 번째 커스텀 앱이 목록에 없습니다")
                        wait_custom_count(2)
                        result["assertions"]["import_does_not_open_window"] = True
                        result["assertions"]["custom_list_two_items"] = True
                        capture_icons("custom-list-two",
                                      {fixture.CUSTOM_MEETING: "mask", fixture.CUSTOM_READING: "image"},
                                      "custom_list_shows_app_icons")

                        # 커스텀 분류도 다른 분류와 같은 높이에서 목록이 시작해야 한다.
                        # 가져오기 단추를 따로 선 막대에 두면 목록이 49px 내려간다.
                        operate()
                        choose_category("전체")
                        search("")
                        page.wait_for_timeout(300)
                        store_top = pane1.evaluate(LIST_TOP_JS)
                        choose_category(CUSTOM)
                        page.wait_for_timeout(300)
                        custom_top = pane1.evaluate(LIST_TOP_JS)
                        assert store_top is not None and custom_top is not None \
                            and abs(store_top - custom_top) <= 1, \
                            f"커스텀 목록 시작 높이가 다른 분류와 다릅니다: 전체 {store_top}, 커스텀 {custom_top}"
                        result["details"]["list_top"] = {"store": store_top, "custom": custom_top}
                        result["assertions"]["custom_list_top_matches_store"] = True

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
                        capture("custom-detail-one", pane=2,
                                check=lambda theme, width, height: check_detail_actions(
                                    theme, width, height, "스토어 판으로 바꾸기", delete_and_convert=True))

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
                        capture_icons("custom-list-mixed",
                                      {fixture.CUSTOM_READING: "image",
                                       fixture.CUSTOM_DIARY: "default-grid"},
                                      "iconless_custom_app_keeps_default_grid")
                        pane1.get_by_role("option", name=fixture.CUSTOM_DIARY, exact=True).click()
                        wait_until(lambda: pane2.get_by_role("button", name="지우기", exact=True).count() > 0,
                                   20, "커스텀 상세의 지우기 단추가 없습니다")
                        assert pane2.locator("button.ks-select-button").count() == 0, "후보가 없는데 고르기가 있습니다"
                        assert pane2.get_by_role("button", name="스토어 판으로 바꾸기", exact=True).count() == 0, \
                            "후보가 없는데 바꾸기 단추가 있습니다"
                        result["assertions"]["no_candidate_hides_convert"] = True
                        capture("custom-detail-none", pane=2,
                                check=lambda theme, width, height: check_detail_actions(
                                    theme, width, height, "열기"))

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
                        capture("other-origin", pane=2,
                                check=lambda theme, width, height: check_detail_actions(
                                    theme, width, height, "스토어 판으로 바꾸기", delete_and_convert=True))

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
                        capture("restore", pane=2,
                                check=lambda theme, width, height: check_detail_actions(
                                    theme, width, height, "스토어 판으로 되돌리기"))

                        operate()
                        hold_stores()
                        reopen()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        capture("store-loading", pane=1, check=check_store_loading("store-loading"))
                        release_stores()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
                        hold_stores()
                        reopen()
                        choose_category(CUSTOM)
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        assert pane1.get_by_role("option").count() == 2, "로딩 중에 커스텀 목록이 사라졌습니다"
                        result["assertions"]["custom_list_survives_store_loading"] = True
                        capture("custom-loading", pane=1, check=check_store_loading("custom-loading"))
                        release_stores()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
                        store_a.fail = store_b.fail = True
                        reopen()
                        wait_until(lambda: pane1.inner_text().count(ERROR_TEXT) >= 2, 30,
                                   "가짜 스토어 실패 상태가 두 곳에 보이지 않습니다")
                        retry_buttons = pane1.get_by_role("button", name="다시 받기", exact=True).count()
                        assert retry_buttons >= 3, \
                            f"스토어 실패 화면에 다시 받기 길이 모자랍니다: {retry_buttons}개"
                        result["details"]["store_failure_retry_buttons"] = retry_buttons
                        result["assertions"]["store_failure_has_retry"] = True

                        def check_store_failure_rows(theme, width, height):
                            rows = pane1.evaluate(ROW_GEOMETRY_JS)
                            assert rows, f"store-failure {theme} {width}x{height}: 가상 목록 줄을 재지 못했습니다"
                            overlaps = row_overlaps(rows)
                            assert not overlaps, \
                                f"store-failure {theme} {width}x{height}: 이어진 줄이 겹칩니다: {overlaps}"
                            misaligned = grid_rows_misaligned(rows)
                            assert not misaligned, \
                                f"store-failure {theme} {width}x{height}: 격자 한 줄의 항목이 같은 높이에 있지 않습니다: {misaligned}"
                            result["assertions"]["store_failure_rows_do_not_overlap"] = True
                            result["assertions"]["store_failure_grid_rows_aligned"] = True

                        capture("store-failure", pane=1, check=check_store_failure_rows)

                        # 캡처는 360×241에서 끝난다. 좁은 창에서 1180×720으로 돌아온 뒤에도
                        # 앞 줄의 아래 끝이 다음 줄을 넘지 않고 격자 한 줄이 펴지는지 다시 잰다.
                        page.emulate_media(color_scheme="light")
                        page.set_viewport_size({"width": SIZES[0][0] + 24, "height": SIZES[0][1] + 124})
                        page.wait_for_timeout(200)
                        set_rect(sb, window_id, *SIZES[0])
                        page.wait_for_timeout(160)
                        focus_pane(1)
                        page.mouse.move(2, 2)
                        page.wait_for_timeout(120)
                        resized_rows = pane1.evaluate(ROW_GEOMETRY_JS)
                        assert resized_rows, "store-failure 크기 바꾸기 뒤 가상 목록 줄을 재지 못했습니다"
                        resized_overlaps = row_overlaps(resized_rows)
                        assert not resized_overlaps, \
                            f"store-failure 크기 바꾸기 뒤 이어진 줄이 겹칩니다: {resized_overlaps}"
                        resized_misaligned = grid_rows_misaligned(resized_rows)
                        assert not resized_misaligned, \
                            f"store-failure 크기 바꾸기 뒤 격자 한 줄의 항목이 같은 높이에 있지 않습니다: {resized_misaligned}"
                        result["assertions"]["store_failure_resized_rows_do_not_overlap"] = True
                        result["assertions"]["store_failure_resized_grid_rows_aligned"] = True
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

                        # §0 14~18: 초점, Tab, 최소 폭, 실패, 크기 바꾸기.
                        # 장면마다 필요한 상태만 만들고 그 밖의 조합은 늘리지 않는다.
                        operate()
                        choose_category(CUSTOM)
                        search("")
                        import_file(write_definition(fixture.LONG_ID, fixture.LONG_NAME,
                                                     "긴 이름과 긴 id를 가진 표본입니다.", "custom-long"))
                        wait_until(lambda: pane1.get_by_role(
                            "option", name=fixture.LONG_NAME, exact=True).count() > 0, 30,
                            "긴 이름 커스텀 앱이 목록에 없습니다")
                        wait_custom_count(3)
                        long_row = pane1.get_by_role("option", name=fixture.LONG_NAME, exact=True)
                        long_row.first.click()
                        select_button = pane2.locator("button.ks-select-button")
                        convert = pane2.get_by_role("button", name="스토어 판으로 바꾸기", exact=True)
                        wait_until(lambda: select_button.count() > 0, 30, "긴 앱의 스토어 고르기가 없습니다")

                        # §0 16: 360x241에서 긴 이름, 긴 id, 긴 주소 동의 창이 가로로 넘치지 않는지 잰다.
                        page.emulate_media(color_scheme="light")
                        page.set_viewport_size({"width": SIZES[1][0] + 24, "height": SIZES[1][1] + 124})
                        page.wait_for_timeout(200)
                        set_rect(sb, window_id, *SIZES[1])
                        page.wait_for_timeout(250)
                        focus_pane(2)
                        page.wait_for_timeout(200)
                        narrow = app.evaluate(OVERFLOW_JS)
                        result["details"]["narrow_long_name"] = narrow
                        assert not narrow["overflow"], f"최소 폭에서 가로로 넘칩니다: {narrow['overflow']}"
                        assert not narrow["outside"], \
                            f"최소 폭에서 단추가 상세 칸 밖으로 나갑니다: {narrow['outside']}"
                        assert not narrow["overlaps"], f"최소 폭에서 단추가 겹칩니다: {narrow['overlaps']}"
                        result["assertions"]["narrow_no_horizontal_overflow"] = True
                        page.mouse.move(2, 2)
                        app.screenshot(path=str(output / "narrow-long-name-light-360x241.png"),
                                       animations="disabled")
                        result["captures"].append("narrow-long-name-light-360x241.png")
                        print("capture narrow-long-name-light-360x241.png", flush=True)

                        select_button.first.click()
                        menu = page.locator(".ks-menu")
                        wait_until(lambda: menu.count() > 0 and menu.first.is_visible(), 10,
                                   "스토어 고르기 메뉴가 없습니다")
                        page.get_by_role("menuitem", name="사설 1", exact=True).click()
                        wait_until(lambda: convert.first.is_enabled(), 20,
                                   "최소 폭에서 후보를 골라도 바꾸기 단추가 꺼져 있습니다")
                        convert.first.click()
                        consent = confirm_install_dialog()
                        page.wait_for_timeout(250)
                        consent_text = consent.first.inner_text()
                        assert a_url in consent_text, f"동의 창에 긴 주소가 없습니다: {consent_text!r}"
                        dialog_facts = app.evaluate(CONSENT_JS)
                        result["details"]["narrow_consent"] = dialog_facts
                        assert dialog_facts is not None, "동의 창 상자를 재지 못했습니다"
                        consent_rect = dialog_facts["rect"]
                        assert consent_rect["left"] >= -1 and \
                            consent_rect["right"] <= dialog_facts["viewport"]["width"] + 1, \
                            f"동의 창이 화면 밖으로 나갑니다: {consent_rect}"
                        assert not dialog_facts["overflow"], \
                            f"동의 창 안에서 가로로 넘칩니다: {dialog_facts['overflow']}"
                        assert not dialog_facts["outside"], \
                            f"동의 창 단추가 창 밖으로 나갑니다: {dialog_facts['outside']}"
                        result["assertions"]["narrow_consent_no_overflow"] = True
                        app.screenshot(path=str(output / "narrow-consent-light-360x241.png"),
                                       animations="disabled")
                        result["captures"].append("narrow-consent-light-360x241.png")
                        print("capture narrow-consent-light-360x241.png", flush=True)
                        assert_dialog_first_action(consent, "바꾸기 동의 창의 첫 동작에 초점이 없습니다")
                        result["assertions"]["focus_convert_consent_first_action"] = True
                        page.keyboard.press("Escape")
                        wait_until(lambda: consent.count() == 0 or not consent.first.is_visible(), 20,
                                   "바꾸기 동의 창이 Esc로 닫히지 않았습니다")
                        assert_focused(convert, "동의 창을 Esc로 닫은 뒤 초점이 바꾸기 단추로 돌아오지 않았습니다")
                        assert app_entry(fixture.LONG_ID) is not None and \
                            app_entry(fixture.LONG_ID).get("origin") is None, \
                            "동의를 취소했는데 앱이 바뀌었습니다"
                        result["assertions"]["focus_convert_consent_esc_returns"] = True

                        # §0 14: 스토어 고르기 메뉴를 Esc로 닫으면 고르기 단추로 초점이 돌아온다.
                        operate()
                        select_button.first.focus()
                        select_button.first.click()
                        wait_until(lambda: menu.count() > 0 and menu.first.is_visible(), 10,
                                   "스토어 고르기 메뉴가 없습니다")
                        page.keyboard.press("Escape")
                        close_menu(menu)
                        assert_focused(select_button, "고르기 메뉴를 Esc로 닫은 뒤 초점이 돌아오지 않았습니다")
                        wait_custom_count(3)
                        result["assertions"]["focus_select_esc_returns"] = True

                        # §0 17: 전환 후보를 고른 뒤 상세 요청이 실패하면 안내와 다시 받기가 보이고,
                        # 도구 막대의 다시 받기로 회복하면 바꾸기 단추가 다시 켜진다.
                        operate()
                        store_a.fail_apps = {fixture.LONG_ID}
                        pane1.get_by_role("option", name=fixture.CUSTOM_READING, exact=True).click()
                        page.wait_for_timeout(200)
                        long_row.first.click()
                        # 바꿀 스토어를 이 장면에서 직접 고른다. 앞 장면이 남긴 상태에 기대지 않는다.
                        select_button.first.click()
                        wait_until(lambda: menu.count() > 0 and menu.first.is_visible(), 10,
                                   "전환 실패 장면의 스토어 고르기 메뉴가 없습니다")
                        page.get_by_role("menuitem", name="사설 1", exact=True).click()
                        failure = pane2.locator(".ks-data-state").filter(has_text=ERROR_TEXT)
                        wait_until(lambda: failure.count() > 0, 30,
                                   "전환 상세 실패 안내가 보이지 않습니다")
                        failure_text = failure.first.inner_text()
                        assert "STORECLIENT_FETCH_HTTP_REJECTED" in failure_text, failure_text
                        assert failure.first.get_by_role(
                            "button", name="다시 받기", exact=True).count() == 1, \
                            "전환 실패 안내에 다시 받기가 없습니다"
                        assert convert.first.is_disabled(), "전환 상세가 실패했는데 바꾸기 단추가 켜져 있습니다"
                        result["details"]["convert_failure"] = failure_text
                        result["assertions"]["convert_failure_shows_notice"] = True
                        capture("convert-failure", pane=2)
                        operate()
                        store_a.fail_apps = set()
                        refresh()
                        wait_until(lambda: pane2.locator(".ks-data-state").filter(
                            has_text=ERROR_TEXT).count() == 0, 30,
                            "다시 받은 뒤에도 전환 실패 안내가 남아 있습니다")
                        wait_until(lambda: convert.first.is_enabled(), 20,
                                   "다시 받은 뒤에도 바꾸기 단추가 꺼져 있습니다")
                        result["assertions"]["convert_retry_recovers"] = True

                        # §0 18: 커스텀 상세를 연 채 목록만 길게 만들고, 1180 -> 360 -> 1180으로
                        # 크기를 바꾸며 목록 스크롤이 남는지, 메뉴가 옛 자리에 남지 않는지 잰다.
                        operate()
                        choose_category("전체")
                        search("")
                        wait_until(lambda: pane1.get_by_role("option").count() > 10, 30,
                                   "스크롤할 만큼 목록이 길지 않습니다")
                        page.wait_for_timeout(300)
                        initial_scroll = pane1.evaluate(LIST_SCROLL_JS)
                        assert initial_scroll and initial_scroll["height"] > initial_scroll["client"] + 20, \
                            f"목록이 스크롤되지 않습니다: {initial_scroll}"
                        pane1.evaluate("(pane) => { const list = pane.querySelector('.ks-list');"
                                       " if (list) list.scrollTop = 240; }")
                        page.wait_for_timeout(200)
                        before_scroll = pane1.evaluate(LIST_SCROLL_JS)
                        assert before_scroll["top"] > 100, f"목록 스크롤을 옮기지 못했습니다: {before_scroll}"
                        select_button.first.click()
                        wait_until(lambda: menu.count() > 0 and menu.first.is_visible(), 10,
                                   "크기 바꾸기 전 스토어 고르기 메뉴가 없습니다")
                        wide_menu = menu.first.bounding_box()
                        page.emulate_media(color_scheme="light")
                        page.set_viewport_size({"width": SIZES[1][0] + 24, "height": SIZES[1][1] + 124})
                        page.wait_for_timeout(200)
                        set_rect(sb, window_id, *SIZES[1])
                        page.wait_for_timeout(400)
                        narrow_menu = menu.first.bounding_box()
                        assert narrow_menu is not None, "크기를 바꾸는 동안 스토어 고르기 메뉴가 사라졌습니다"
                        viewport = page.viewport_size
                        assert narrow_menu["x"] >= -1 and \
                            narrow_menu["x"] + narrow_menu["width"] <= viewport["width"] + 1 and \
                            narrow_menu["y"] >= -1 and \
                            narrow_menu["y"] + narrow_menu["height"] <= viewport["height"] + 1, \
                            f"메뉴가 화면 밖 옛 자리에 남았습니다: {narrow_menu} (화면 {viewport})"
                        assert wide_menu is not None and abs(narrow_menu["x"] - wide_menu["x"]) > 10, \
                            f"메뉴가 옛 좌표에 그대로 있습니다: 넓을 때 {wide_menu}, 좁을 때 {narrow_menu}"
                        result["details"]["resize_menu"] = {"wide": wide_menu, "narrow": narrow_menu}
                        result["assertions"]["resize_menu_anchor_fresh"] = True
                        stacked_narrow = app.locator(".ks-split").first.evaluate(
                            "el => el.classList.contains('is-stacked')")
                        assert stacked_narrow, "최소 폭에서 칸이 세로로 접히지 않았습니다"
                        result["assertions"]["resize_reflows_360"] = True
                        page.mouse.move(2, 2)
                        page.screenshot(path=str(output / "resize-menu-open-360x241.png"),
                                        animations="disabled")
                        result["captures"].append("resize-menu-open-360x241.png")
                        print("capture resize-menu-open-360x241.png", flush=True)
                        page.keyboard.press("Escape")
                        close_menu(menu)
                        assert_focused(select_button, "크기를 바꾼 뒤 메뉴를 닫아도 초점이 돌아오지 않았습니다")
                        narrow_scroll = pane1.evaluate(LIST_SCROLL_JS)
                        page.set_viewport_size({"width": SIZES[0][0] + 24, "height": SIZES[0][1] + 124})
                        page.wait_for_timeout(200)
                        set_rect(sb, window_id, *SIZES[0])
                        page.wait_for_timeout(400)
                        stacked_back = app.locator(".ks-split").first.evaluate(
                            "el => el.classList.contains('is-stacked')")
                        assert not stacked_back, "넓은 폭에서 칸이 세로로 접힌 채입니다"
                        back_scroll = pane1.evaluate(LIST_SCROLL_JS)
                        result["details"]["resize_scroll"] = {
                            "before": before_scroll, "narrow": narrow_scroll, "back": back_scroll}
                        assert back_scroll and back_scroll["height"] > back_scroll["client"], \
                            f"돌아온 넓은 폭에서 목록이 스크롤되지 않습니다: {back_scroll}"
                        assert before_scroll["first"] and back_scroll["first"], \
                            f"목록의 보던 자리를 재지 못했습니다: {before_scroll} -> {back_scroll}"
                        # 줄 높이가 창 폭에 따라 달라지므로 scrollTop과 맨 위 줄은 그대로일 수 없다.
                        # 보던 항목이 돌아온 폭의 화면 안에 남아 있는지로 견준다.
                        before_key = before_scroll["first"]["key"]
                        back_keys = {row["key"] for row in back_scroll["rows"]}
                        assert before_key in back_keys, \
                            "크기를 바꾸는 동안 목록의 보던 항목이 화면 밖으로 밀려났습니다: " \
                            f"{before_scroll['first']} -> {back_scroll['rows'][:3]}"
                        # 같은 폭으로 돌아왔으면 줄 높이 기억도 처음과 같아야 전체 높이가 같다.
                        assert back_scroll["height"] == before_scroll["height"], \
                            "돌아온 목록의 전체 높이가 처음과 다릅니다. 줄 높이 기억이 어긋났습니다: " \
                            f"{before_scroll['height']} -> {back_scroll['height']}"
                        assert narrow_scroll["top"] > 100, \
                            f"최소 폭에서 목록이 맨 위로 돌아갔습니다: {narrow_scroll}"
                        assert back_scroll["first"]["top"] < 0 < back_scroll["first"]["bottom"], \
                            f"돌아온 넓은 폭에서 맨 위 줄이 목록 위에 걸쳐 있지 않습니다: {back_scroll}"
                        assert back_scroll["top"] > 100, \
                            f"돌아온 넓은 폭에서 목록이 맨 위로 돌아갔습니다: {back_scroll}"
                        result["assertions"]["resize_keeps_list_scroll"] = True
                        result["assertions"]["resize_reflows_1180"] = True
                        app.screenshot(path=str(output / "resize-list-scroll-1180x720.png"),
                                       animations="disabled")
                        result["captures"].append("resize-list-scroll-1180x720.png")
                        print("capture resize-list-scroll-1180x720.png", flush=True)

                        # §0 14: 파일 고르기를 취소하면 가져오기 단추로 초점이 돌아오고 앱은 그대로다.
                        operate()
                        choose_category(CUSTOM)
                        search("")
                        import_button = app.get_by_role("button", name="파일에서 가져오기")
                        wait_until(lambda: import_button.count() > 0 and import_button.first.is_visible(), 10,
                                   "파일에서 가져오기 단추가 없습니다")
                        import_button.first.focus()
                        queue.write_text("[]", encoding="utf-8")
                        import_button.first.click()
                        page.wait_for_timeout(700)
                        wait_custom_count(3)
                        assert_focused(import_button, "파일 고르기를 취소한 뒤 초점이 가져오기 단추로 돌아오지 않았습니다")
                        result["assertions"]["focus_import_cancel_returns"] = True

                        # §0 14: 지우기 확인 창은 첫 동작(취소)에 초점을 두고, Esc로 닫으면 지우기로 돌아온다.
                        long_row.first.click()
                        delete_button = pane2.get_by_role("button", name="지우기", exact=True)
                        wait_until(lambda: delete_button.count() > 0 and delete_button.first.is_enabled(), 20,
                                   "커스텀 상세의 지우기 단추가 없습니다")
                        delete_button.first.click()
                        delete_dialog = app.locator(".ks-dialog")
                        wait_until(lambda: delete_dialog.count() > 0 and delete_dialog.first.is_visible(), 20,
                                   "지우기 확인 창이 없습니다")
                        assert_dialog_first_action(delete_dialog, "지우기 확인 창의 첫 동작에 초점이 없습니다")
                        result["assertions"]["focus_delete_dialog_first_action"] = True
                        page.keyboard.press("Escape")
                        wait_until(lambda: delete_dialog.count() == 0 or not delete_dialog.first.is_visible(), 20,
                                   "지우기 확인 창이 Esc로 닫히지 않았습니다")
                        assert_focused(delete_button, "지우기 확인 창을 닫은 뒤 초점이 지우기로 돌아오지 않았습니다")
                        wait_custom_count(3)
                        assert app.get_by_role("button", name="지우기", exact=True).count() > 0, \
                            "Esc로 닫은 뒤 창 내용이 그대로이지 않습니다"
                        result["assertions"]["focus_delete_esc_returns"] = True
                        result["assertions"]["dialog_esc_keeps_window"] = True
                        # 확인을 누른 뒤에는 고른 앱과 단추가 사라지므로 창 앞이 아니라 내용 안에 초점이 남아야 한다.
                        delete_button.first.click()
                        wait_until(lambda: delete_dialog.count() > 0 and delete_dialog.first.is_visible(), 20,
                                   "지우기 확인 창이 없습니다")
                        delete_dialog.locator(".ks-dialog-confirm button").first.click()
                        wait_custom_count(2)
                        wait_until(lambda: app_entry(fixture.LONG_ID) is None, 20,
                                   "지운 커스텀 앱이 남아 있습니다")
                        page.wait_for_timeout(500)
                        assert_content_focus("앱을 지운 뒤 초점이 내용 밖으로 사라졌습니다")
                        result["details"]["focus_after_delete"] = active_info()
                        result["assertions"]["focus_delete_confirm_stays_in_content"] = True

                        # §0 15: Tab 순서가 분류 목록 -> 커스텀 목록 -> 상세 동작이고,
                        # 숨은 조작은 초점을 받지 않는다. Esc로 연 창은 그대로 둔다.
                        pane1.get_by_role("option", name=fixture.CUSTOM_READING, exact=True).click()
                        wait_until(lambda: pane2.get_by_role("button", name="지우기", exact=True).count() > 0,
                                   20, "커스텀 상세의 지우기 단추가 없습니다")
                        category_option = pane0.locator('[data-row-key="__custom"]')
                        wait_until(lambda: category_option.count() > 0, 10, "커스텀 분류 줄이 없습니다")
                        category_option.first.focus()
                        page.wait_for_timeout(100)
                        tab_records = [active_info()]
                        for _ in range(40):
                            page.keyboard.press("Tab")
                            page.wait_for_timeout(60)
                            if not app.evaluate("(root) => root.contains(document.activeElement)"):
                                break
                            tab_records.append(active_info())
                        result["details"]["tab_order"] = [
                            {key: record.get(key) for key in ("tag", "role", "label", "text", "pane",
                                                              "visible", "hidden_ancestor", "tab_index")}
                            for record in tab_records if record]
                        pane_records = [record["pane"] for record in tab_records
                                        if record and record["pane"] >= 0]
                        assert pane_records == sorted(pane_records), \
                            f"Tab 순서가 칸 순서와 다릅니다: {pane_records}"
                        assert 0 in pane_records and 1 in pane_records and 2 in pane_records, \
                            f"Tab이 세 칸을 모두 지나지 않았습니다: {pane_records}"
                        assert any(record and record["role"] == "option" and record["pane"] == 1
                                   for record in tab_records), "Tab이 커스텀 목록을 지나지 않았습니다"
                        assert any(record and record["pane"] == 2 and record["tag"] == "BUTTON"
                                   for record in tab_records), "Tab이 상세 동작을 지나지 않았습니다"
                        assert all(record and record["visible"] and not record["hidden_ancestor"]
                                   for record in tab_records), \
                            f"숨은 조작이 초점을 받았습니다: {result['details']['tab_order']}"
                        result["assertions"]["tab_order_category_list_detail"] = True
                        result["assertions"]["tab_order_skips_hidden"] = True

                        # §0 17: 너무 큰 파일을 가져오면 안내가 어디에 어떤 문구로 뜨는지 남긴다.
                        operate()
                        huge = write_definition("oversize-app", "너무 큰 앱", "x" * 1_100_000, "too-large")
                        import_file(huge)
                        notice = app.locator(".ks-data-window-notice .ks-notice")
                        wait_until(lambda: notice.count() > 0 and notice.first.is_visible(), 20,
                                   "너무 큰 파일 안내가 없습니다")
                        notice_text = notice.first.inner_text()
                        assert "too-large.json" in notice_text, notice_text
                        assert "큽니다" in notice_text, notice_text
                        assert "DESK_APP_IMPORT_FILE_TOO_LARGE" in notice_text, notice_text
                        assert notice.first.get_attribute("role") == "alert", notice_text
                        result["details"]["import_failure"] = notice_text
                        result["assertions"]["import_failure_too_large_notice"] = True
                        capture("import-failure-too-large", pane=1)
                        notice.locator('[aria-label="닫기"]').first.click()
                        wait_until(lambda: notice.count() == 0 or not notice.first.is_visible(), 10,
                                   "가져오기 실패 안내가 닫히지 않았습니다")

                        # 설치한 뒤 스토어 주소를 설정에서 빼면 그 앱은 「그 밖의 스토어」 묶음에 남는다.
                        # 묶음 항목도 앱 자신이 선언한 아이콘을 그려야 한다.
                        operate()
                        choose_category("전체")
                        search("팀 안내서")
                        handbook = pane1.get_by_role("option", name="팀 안내서", exact=True)
                        wait_until(lambda: handbook.count() > 0, 30, "사설 2의 팀 안내서가 없습니다")
                        handbook.first.click()
                        install = pane2.get_by_role("button", name="설치", exact=True)
                        wait_until(lambda: install.count() > 0 and install.first.is_enabled(), 30,
                                   "팀 안내서 설치 단추가 없거나 꺼져 있습니다")
                        install.first.click()
                        consent = confirm_install_dialog()
                        consent.get_by_role("button", name="허용하고 설치", exact=True).click()
                        wait_until(lambda: consent.count() == 0 or not consent.first.is_visible(), 20,
                                   "설치 동의 창이 닫히지 않았습니다")
                        wait_until(lambda: (lambda entry: entry if entry and entry.get("origin")
                                            and entry["origin"]["store_url"] == b_url else None)(
                            app_entry("team-handbook")), 30, "팀 안내서가 사설 2에서 설치되지 않았습니다")
                        search("")

                        gear.click()
                        wait_until(lambda: settings.is_visible(), 20, "앱 설정 패널이 열리지 않았습니다")
                        server_row = app.locator(f'[data-row-key="{b_url}"]')
                        wait_until(lambda: server_row.count() > 0, 20, "설정에 사설 2 주소가 없습니다")
                        # 빼기 단추는 행 요소가 아니라 그 행을 감싼 목록 항목의 형제다.
                        app.get_by_role("button", name=f"{b_url} 빼기").first.click()
                        wait_until(lambda: sb.core({"op": "storage.get", "window_id": window_id,
                                                    "entry": "servers"})["result"]["content"] == [a_url],
                                   20, "사설 2 주소를 설정에서 빼지 못했습니다")
                        app.get_by_role("button", name="앱으로 돌아가기").click()
                        wait_until(lambda: not settings.is_visible(), 10, "앱 설정 패널이 닫히지 않았습니다")

                        choose_category("설치됨")
                        wait_until(lambda: "그 밖의 스토어" in pane1.inner_text(), 30,
                                   "그 밖의 스토어 묶음이 없습니다")
                        result["details"]["other_stores_servers"] = \
                            sb.core({"op": "storage.get", "window_id": window_id,
                                     "entry": "servers"})["result"]["content"]
                        def check_other_stores_visible(facts, kinds, theme, width, height):
                            # 좁은 창에서도 팀 안내서 칸이 캡처에 들어왔는지 상자로 확인한다.
                            if width >= 640:
                                return
                            tile = pane1.get_by_role("option", name="팀 안내서", exact=True).first.bounding_box()
                            pane_box = pane1.bounding_box()
                            assert tile is not None and pane_box is not None, \
                                f"그 밖의 스토어 {theme} {width}x{height}: 팀 안내서 칸 상자를 재지 못했습니다"
                            assert tile["y"] >= pane_box["y"] - 1 and \
                                tile["y"] + tile["height"] <= pane_box["y"] + pane_box["height"] + 1, \
                                f"그 밖의 스토어 {theme} {width}x{height}: 팀 안내서 칸이 목록 밖에 있습니다: " \
                                f"{tile} (칸 {pane_box})"
                            result["details"].setdefault("other_stores_narrow_tile", {})[
                                f"{theme}-{width}x{height}"] = tile
                            result["assertions"]["other_stores_narrow_shows_team_handbook"] = True

                        capture_icons("other-stores",
                                      {"회의 카드": "default-grid", "팀 안내서": "image"},
                                      "other_stores_show_app_icons",
                                      extra=check_other_stores_visible)

                        # 설정에서 뺀 스토어의 앱 상세는 초대코드를 보내지 않은 것이라
                        # 「초대코드가 필요하다」는 코드로 안내해야 한다.
                        operate()
                        handbook_tile = pane1.get_by_role("option", name="팀 안내서", exact=True)
                        wait_until(lambda: handbook_tile.count() > 0, 20, "그 밖의 스토어의 팀 안내서 칸이 없습니다")
                        handbook_tile.first.click()
                        wait_until(lambda: "STORECLIENT_FETCH_INVITE_REQUIRED" in pane2.inner_text(), 30,
                                   "그 밖의 스토어 앱 상세에 초대코드 필요 오류가 없습니다")
                        detail_text = pane2.inner_text()
                        assert "STORECLIENT_FETCH_INVITE_INVALID" not in detail_text, detail_text
                        result["details"]["other_stores_detail"] = detail_text
                        result["assertions"]["other_stores_detail_invite_required"] = True
                        for theme in THEMES:
                            page.emulate_media(color_scheme=theme)
                            page.set_viewport_size({"width": SIZES[0][0] + 24, "height": SIZES[0][1] + 124})
                            page.wait_for_timeout(200)
                            set_rect(sb, window_id, *SIZES[0])
                            page.wait_for_timeout(250)
                            focus_pane(2)
                            page.mouse.move(2, 2)
                            page.wait_for_timeout(120)
                            name = f"other-stores-detail-invite-required-{theme}-1180x720.png"
                            app.screenshot(path=str(output / name), animations="disabled")
                            result["captures"].append(name)
                            print(f"capture {name}", flush=True)

                        # 섞인 커스텀 목록: currentColor SVG, 고정색 SVG, PNG, 아이콘 없음, 긴 이름,
                        # 아이콘을 못 받는 앱을 한 목록에 두고 아이콘 칸의 상태와 상자를 견준다.
                        operate()
                        choose_category(CUSTOM)
                        search("")
                        for asset_id, fmt, data, source in (
                                ("png-icon", "png", fixture.PNG_ICON, "store_fixture.py#png-icon"),
                                ("broken-icon", "svg", fixture.FIXED_COLOR_ICON,
                                 "store_fixture.py#broken-icon")):
                            uploaded = sb.mcp.call("upload_asset", {
                                "id": asset_id, "version": 1, "format": fmt,
                                "sha256": hashlib.sha256(data).hexdigest(),
                                "source": source, "license": "MIT",
                                "data_base64": base64.b64encode(data).decode("ascii"),
                            })
                            assert not uploaded["is_error"], uploaded["text"]
                        import_file(write_definition("palette-notes", fixture.CUSTOM_PALETTE,
                                                     "색을 골라 두는 내 판입니다.", "custom-palette",
                                                     fixture.MEETING_ICON))
                        import_file(write_definition("photo-notes", fixture.CUSTOM_PHOTO,
                                                     "사진을 모아 두는 내 판입니다.", "custom-photo", "png-icon"))
                        import_file(write_definition("broken-icon-app", fixture.CUSTOM_BROKEN,
                                                     "아이콘을 받지 못하는 내 판입니다.", "custom-broken",
                                                     "broken-icon"))
                        import_file(write_definition(fixture.LONG_ID, fixture.LONG_NAME,
                                                     "긴 이름을 가진 내 판입니다.", "custom-long-mixed",
                                                     fixture.READING_ICON))
                        for app_id in ("palette-notes", "photo-notes", "broken-icon-app", fixture.LONG_ID):
                            wait_until(lambda app_id=app_id: app_entry(app_id) is not None, 30,
                                       f"{app_id} 커스텀 앱이 등록되지 않았습니다")
                        choose_category(CUSTOM)
                        search("")
                        wait_custom_count(6)

                        held = []

                        def handle_icon(route, request):
                            try:
                                body = json.loads(request.post_data or "{}")
                            except ValueError:
                                body = {}
                            media = body.get("media") if isinstance(body, dict) else None
                            if isinstance(body, dict) and body.get("op") == "data.media" \
                                    and isinstance(media, dict) and "app_icon" in media:
                                held.append((route, media["app_icon"]))
                                return
                            route.continue_()

                        page.route(f"{sb.bridge}/core", handle_icon)
                        reopen()
                        choose_category(CUSTOM)
                        search("")
                        wait_until(lambda: len({app_id for _, app_id in held}) >= 5, 30,
                                   f"아이콘 요청이 다 오지 않았습니다: {[app_id for _, app_id in held]}")

                        def check_loading(theme, width, height):
                            facts = pane1.evaluate(ICON_TILES_JS)
                            result["details"].setdefault("icon_loading", {})[
                                f"{theme}-{width}x{height}"] = facts
                            assert any(fact["kind"] == "loading" for fact in facts), \
                                f"mixed-icons-loading {theme} {width}x{height}: 불러오는 칸이 없습니다: {facts}"
                            result["assertions"]["mixed_icons_loading_state"] = True

                        capture("mixed-icons-loading", pane=1, check=check_loading)

                        for route, app_id in held:
                            if app_id == "broken-icon-app":
                                route.fulfill(status=400, content_type="application/json",
                                              body=json.dumps(ICON_ERROR, ensure_ascii=False))
                            else:
                                route.continue_()
                        held.clear()

                        def check_icon_fallback(facts, kinds, theme, width, height):
                            by_name = {fact["name"]: fact for fact in facts}
                            failed = by_name.get(fixture.CUSTOM_BROKEN)
                            iconless = by_name.get(fixture.CUSTOM_DIARY)
                            assert failed is not None and iconless is not None, \
                                f"mixed-icons-settled {theme} {width}x{height}: 실패 칸이나 아이콘 없는 칸이 없습니다: {facts}"
                            assert failed["kind"] == "default-grid", failed
                            assert failed["thumb_class"] is None and failed["thumb_title"] is None, failed
                            assert iconless["thumb_class"] is None, iconless
                            for key in ("icon_box", "drawn"):
                                assert failed[key] is not None and iconless[key] is not None, (failed, iconless)
                                assert failed[key]["w"] == iconless[key]["w"] == 32 \
                                    and failed[key]["h"] == iconless[key]["h"] == 32, \
                                    f"mixed-icons-settled {theme} {width}x{height}: {key}가 32x32가 아닙니다: " \
                                    f"실패 {failed[key]}, 아이콘 없음 {iconless[key]}"
                            assert failed["drawn_color"] == iconless["drawn_color"], \
                                f"mixed-icons-settled {theme} {width}x{height}: 그림 색이 다릅니다: " \
                                f"실패 {failed['drawn_color']}, 아이콘 없음 {iconless['drawn_color']}"
                            assert failed["drawn_bg"] == iconless["drawn_bg"] == "rgba(0, 0, 0, 0)", \
                                f"mixed-icons-settled {theme} {width}x{height}: 그림 바탕이 투명하지 않습니다: " \
                                f"실패 {failed['drawn_bg']}, 아이콘 없음 {iconless['drawn_bg']}"
                            result["details"].setdefault("icon_fallback", {})[
                                f"{theme}-{width}x{height}"] = {"failed": failed, "iconless": iconless}
                            result["assertions"]["mixed_icon_fallback_matches_iconless"] = True

                        capture_icons("mixed-icons-settled",
                                      {fixture.CUSTOM_PALETTE: "mask",
                                       fixture.CUSTOM_READING: "image",
                                       fixture.CUSTOM_PHOTO: "image",
                                       fixture.CUSTOM_DIARY: "default-grid",
                                       fixture.CUSTOM_BROKEN: "default-grid",
                                       fixture.LONG_NAME: "image"},
                                      "mixed_icons_show_declared_icons", extra=check_icon_fallback)
                        page.unroute(f"{sb.bridge}/core", handle_icon)
                    else:
                        assert pane0.locator('[data-row-key="__custom"]').count() == 0, \
                            "이 판에 커스텀 앱 분류가 있습니다"
                        assert app.get_by_role("button", name="파일에서 가져오기").count() == 0, \
                            "이 판에 가져오기 단추가 있습니다"
                        assert app.get_by_text(CUSTOM, exact=True).count() == 0, "이 판 화면에 커스텀 앱 글이 있습니다"
                        result["assertions"]["custom_category_absent"] = True

                        operate()
                        hold_stores()
                        reopen()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() > 0, 10,
                                   "스토어 로딩 표시가 없습니다")
                        capture("store-loading", pane=1, check=check_store_loading("store-loading"))
                        release_stores()
                        wait_until(lambda: page.locator(".ks-data-view.is-loading").count() == 0, 20,
                                   "스토어 로딩이 끝나지 않았습니다")

                        operate()
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
                                      if entry["id"] in ("meeting-cards", "read-later", "diary-notes",
                                                         "team-handbook")]
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
    assertions = result["assertions"]
    print(f"{sum(1 for value in assertions.values() if value is True)}개 참 / {len(assertions)}개 단언",
          flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
