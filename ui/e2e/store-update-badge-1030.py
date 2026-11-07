"""앱스토어 아이콘 격자의 새 판 빨간 점을 실제 코어와 스토어로 확인한다.

    cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge -p kaleidoscope-store-server
    python3 ui/e2e/store-update-badge-1030.py [--output 폴더]

공개 스토어(기본)와 로컬 스토어(사설)를 함께 띄운다. 로컬 스토어에 1판을 먼저 올려 설치하고,
그 뒤 2판을 올려 `업데이트` 상태를 만든다. 아이콘 격자의 타일에만 빨간 점이 붙는지, 업데이트를
마치면 사라지는지 캡처와 좌표로 확인한다. 운영 서버와 디렉터 PC에는 닿지 않는다.
"""
import argparse
import functools
import importlib.util
import json
import os
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "ui/e2e/fixtures/install-old-release.json").read_text(encoding="utf-8"))
OUTPUT = Path(os.environ.get("SCRATCH_WORKSPACE_DIR", ROOT.parent)) / ".local/tmp/card1030/dot"
COMMON = Path(os.environ["AGENT_COMMON_FILES_DIR"])
module_spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", COMMON / "skills/kaleidoscope-app/scripts/sandbox.py")
sandbox = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(sandbox)
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

APP_NAME = FIXTURE["definition"]["name"]
STORE_WIDE = (1000, 640)
STORE_NARROW = (360, 640)


def log(message: str) -> None:
    print(message, flush=True)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def http_get(url: str, timeout: float = 5.0):
    try:
        with opener.open(url, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, OSError):
        return None


def wait_until(check, timeout: float, message: str, step: float = 0.2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = check()
        except Exception:  # noqa: BLE001 - 화면이 뜨는 중에는 요소 조회가 던질 수 있다
            value = None
        if value:
            return value
        time.sleep(step)
    raise AssertionError(message)


def png_1x1() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack("!IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + chunk(b"IEND", b"")


def multipart(files: dict[str, bytes]) -> tuple[bytes, str]:
    boundary = f"----ks1030{uuid.uuid4().hex}"
    parts = []
    for name, data in files.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode("utf-8"))
        parts.append(data)
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def publish(base: str, summary: str) -> dict:
    metadata = dict(FIXTURE["metadata"])
    metadata["summary"] = summary
    files = {
        "app.json": json.dumps(FIXTURE["definition"], ensure_ascii=False).encode("utf-8"),
        "store.json": json.dumps(metadata, ensure_ascii=False).encode("utf-8"),
        "assets/icon.svg": FIXTURE["icon"].encode("utf-8"),
        "screenshots/1.png": png_1x1(),
    }
    body, content_type = multipart(files)
    request = urllib.request.Request(base + "/publish", data=body, headers={"Content-Type": content_type}, method="POST")
    with opener.open(request, timeout=30) as response:
        return json.load(response)


def start_store_server(directory: Path, output: Path) -> tuple[subprocess.Popen, str]:
    port = free_port()
    log_file = open(output / "store-server.log", "w", encoding="utf-8")
    process = subprocess.Popen(
        [str(ROOT / "target/debug/kaleidoscope-store-server"), "--bind", f"127.0.0.1:{port}", "--data-dir", str(directory)],
        cwd=str(ROOT), stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    wait_until(lambda: http_get(base + "/index.json"), 20, "로컬 스토어 서버가 응답하지 않습니다")
    return process, base


TILE_METRICS = """(name) => {
  const tiles = [...document.querySelectorAll('.ks-icon-tile')];
  const tile = tiles.find((element) => element.querySelector('.ks-icon-tile-name')?.textContent.trim() === name);
  if (!tile) return null;
  const dot = tile.querySelector('.ks-badge.is-count.is-dot');
  const anchor = tile.querySelector('.ks-icon-tile-icon');
  const plain = tiles.find((element) => element !== tile && !element.querySelector('.is-dot'));
  const box = tile.getBoundingClientRect();
  const icon = anchor.getBoundingClientRect();
  const badge = dot ? dot.getBoundingClientRect() : null;
  return {
    dot: Boolean(dot),
    dotText: dot ? dot.textContent : null,
    iconRight: icon.right, iconTop: icon.top, iconBottom: icon.bottom,
    dotCenterX: badge ? badge.x + badge.width / 2 : null,
    dotCenterY: badge ? badge.y + badge.height / 2 : null,
    dotWidth: badge ? badge.width : null,
    tileHeight: box.height,
    plainTileHeight: plain ? plain.getBoundingClientRect().height : null,
  };
}"""

LAUNCHER_DOTS = """() => [...document.querySelectorAll('.ks-app-launcher .ks-icon-tile')].map((tile) => ({
  name: tile.querySelector('.ks-icon-tile-name')?.textContent.trim() ?? '',
  dot: Boolean(tile.querySelector('.is-dot')),
}))"""


def main() -> int:
    global OUTPUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    OUTPUT = parser.parse_args().output
    OUTPUT.mkdir(parents=True, exist_ok=True)
    result: dict = {"assertions": [], "captures": [], "metrics": {}}

    def check(name: str, passed: bool, detail=None) -> None:
        result["assertions"].append({"name": name, "pass": bool(passed), "detail": detail})
        log(f"{'통과' if passed else '실패'} {name} {detail if detail is not None else ''}")
        if not passed:
            raise AssertionError(f"{name}: {detail}")

    with tempfile.TemporaryDirectory(prefix="ks-store-dot-") as directory:
        temp = Path(directory)
        store_process, store_base = start_store_server(temp / "store", OUTPUT)
        result["store_server"] = store_base
        browser = None
        ui_lock = None
        sb = None
        failure = None
        try:
            first = publish(store_base, FIXTURE["metadata"]["summary"])
            check("로컬 스토어 1판 발행", first.get("release") == 1, first)

            address, ui_lock = sandbox.acquire_ui_address()
            sb = sandbox.Sandbox(ROOT, OUTPUT, None, address)
            spawn = sb._spawn

            def local_spawn(name, command, **env):
                if name in ("server", "bridge"):
                    command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
                return spawn(name, command, **env)

            def warm(path: Path):
                target = ROOT / "target/debug" / Path(path).name
                if not target.exists():
                    return
                with target.open("rb") as source:
                    while source.read(1024 * 1024):
                        pass

            sb._spawn = local_spawn
            sandbox.warm_file = warm
            sb.start()

            snapshot = sb.snapshot()
            if not snapshot["device"]["active_workspace_id"]:
                created = sb.core({"op": "workspace.create", "name": "새 판 표시 검증"})
                check("작업 공간 만들기", "error" not in created, created)
                snapshot = sb.snapshot()
            workspace = snapshot["device"]["active_workspace_id"]
            desktop = snapshot["device"]["active_desktop_ids"][workspace]
            opened = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": "store",
                              "rect": {"x": 20, "y": 20, "width": STORE_WIDE[0], "height": STORE_WIDE[1]}})
            check("앱스토어 창 열기", "error" not in opened, opened)
            window = wait_until(lambda: sb.window_of("store"), 30, "앱스토어 창이 상태에 없습니다")
            store_window = window["id"]

            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                page = sb.page
                store = sb.window("store")

                def row(title: str):
                    return store.get_by_role("option", name=title, exact=True)

                def tile(name: str):
                    return store.locator(".ks-icon-tile", has_text=name)

                def shot(name: str, windowed: bool = True) -> None:
                    page.wait_for_timeout(400)
                    path = OUTPUT / name
                    (store if windowed else page).screenshot(path=str(path))
                    result["captures"].append(str(path))
                    log(f"찍음 {path}")

                def set_rect(width: int, height: int) -> None:
                    response = sb.core({"op": "window.set_rect", "window_id": store_window,
                                        "rect": {"x": 20, "y": 20, "width": width, "height": height}})
                    if "error" in response:
                        raise AssertionError(response["error"])
                    page.wait_for_timeout(300)

                def clear_selection() -> None:
                    sb.set_state(store_window, {"selected": None, "selected_name": "", "selected_store": None, "selected_key": None})
                    page.wait_for_timeout(300)

                def refresh() -> None:
                    response = sb.core({"op": "data.refresh", "window_id": store_window})
                    if "error" in response:
                        raise AssertionError(response["error"])

                def metrics(name: str) -> dict:
                    value = page.evaluate(TILE_METRICS, name)
                    result["metrics"].setdefault(name, []).append(value)
                    return value

                wait_until(lambda: row("전체").count() > 0, 60, "앱스토어 분류 목록이 보이지 않습니다")
                wait_until(lambda: store.locator(".ks-icon-tile").count() > 0, 60, "공개 스토어 앱이 보이지 않습니다")
                public_tiles = store.locator(".ks-icon-tile").all_text_contents()
                check("공개 스토어 앱 목록", len(public_tiles) >= 3, public_tiles[:6])

                written = sb.core({"op": "storage.write", "window_id": store_window, "entry": "servers", "content": [store_base]})
                check("사설 스토어 주소 저장", "error" not in written, written)
                refresh()

                allow = store.get_by_role("button", name="연결 허용")
                wait_until(lambda: allow.count() > 0, 30, "사설 스토어 연결 허용 버튼이 없습니다")
                allow.first.click()
                consent = store.get_by_role("dialog")
                wait_until(lambda: consent.count() > 0, 15, "스토어 연결 동의 창이 열리지 않았습니다")
                consent.get_by_role("button", name="연결 허용").click()

                wait_until(lambda: tile(APP_NAME).count() > 0, 60, "사설 스토어 앱 타일이 보이지 않습니다")
                before_install = metrics(APP_NAME)
                check("1판 설치 전에는 점이 없다", before_install and before_install["dot"] is False, before_install)

                tile(APP_NAME).first.click()
                install = store.get_by_role("button", name="설치", exact=True)
                wait_until(lambda: install.count() > 0 and install.first.is_enabled(), 60, "설치 버튼이 눌리지 않습니다")
                install.first.click()
                consent = store.get_by_role("dialog")
                wait_until(lambda: consent.count() > 0, 15, "설치 동의 창이 열리지 않았습니다")
                consent.get_by_role("button", name="허용하고 설치").click()
                wait_until(lambda: store.get_by_role("button", name="설치됨", exact=True).count() > 0, 90, "1판 설치가 끝나지 않았습니다")
                installed = metrics(APP_NAME)
                check("1판 설치만으로는 점이 없다", installed and installed["dot"] is False, installed)

                second = publish(store_base, FIXTURE["next_summary"])
                check("로컬 스토어 2판 발행", second.get("release") == 2, second)
                refresh()
                wait_until(lambda: (page.evaluate(TILE_METRICS, APP_NAME) or {}).get("dot"), 60, "새 판 점이 나타나지 않았습니다")

                clear_selection()
                row("전체").click()
                page.wait_for_timeout(300)

                wide = metrics(APP_NAME)
                result["metrics"]["before"] = wide
                check("점은 아이콘 오른쪽 위 모서리에 붙는다",
                      abs(wide["dotCenterX"] - wide["iconRight"]) <= 1 and abs(wide["dotCenterY"] - wide["iconTop"]) <= 1,
                      {key: wide[key] for key in ("dotCenterX", "dotCenterY", "iconRight", "iconTop")})
                check("점이 아이콘 타일 높이를 바꾸지 않는다",
                      abs(wide["tileHeight"] - installed["tileHeight"]) <= 0.5
                      and wide["plainTileHeight"] is not None and abs(wide["tileHeight"] - wide["plainTileHeight"]) <= 1,
                      {"tileHeight": wide["tileHeight"], "installedHeight": installed["tileHeight"],
                       "plainTileHeight": wide["plainTileHeight"]})
                check("점에는 글자가 없다", wide["dotText"] == "", wide["dotText"])
                shot("store-all-1000.png")

                page.emulate_media(color_scheme="dark")
                shot("store-all-1000-dark.png")
                page.emulate_media(color_scheme="light")

                set_rect(*STORE_NARROW)
                tile(APP_NAME).first.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
                narrow = metrics(APP_NAME)
                result["metrics"]["before-narrow"] = narrow
                check("좁은 폭에서도 점이 같은 자리에 붙는다",
                      abs(narrow["dotCenterX"] - narrow["iconRight"]) <= 1 and abs(narrow["dotCenterY"] - narrow["iconTop"]) <= 1,
                      {key: narrow[key] for key in ("dotCenterX", "dotCenterY", "iconRight", "iconTop")})
                shot("store-all-360.png")
                set_rect(*STORE_WIDE)

                row("업데이트").click()
                wait_until(lambda: tile(APP_NAME).count() > 0, 30, "업데이트 탭에 앱이 없습니다")
                shot("store-updates-1000.png")
                set_rect(*STORE_NARROW)
                tile(APP_NAME).first.scroll_into_view_if_needed()
                shot("store-updates-360.png")
                set_rect(*STORE_WIDE)

                row("설치됨").click()
                wait_until(lambda: tile(APP_NAME).count() > 0, 30, "설치됨 탭에 앱이 없습니다")
                installed_tab = metrics(APP_NAME)
                result["metrics"]["before-installed"] = installed_tab
                check("설치됨 탭에도 새 판 점이 붙는다", installed_tab and installed_tab["dot"] is True, installed_tab)
                shot("store-installed-1000.png")

                row("전체").click()
                tile(APP_NAME).first.click()
                update = store.get_by_role("button", name="업데이트", exact=True)
                wait_until(lambda: update.count() > 0 and update.first.is_enabled(), 60, "업데이트 버튼이 눌리지 않습니다")
                update.first.click()
                wait_until(lambda: store.get_by_role("button", name="설치됨", exact=True).count() > 0, 120, "업데이트가 끝나지 않았습니다")
                page.wait_for_timeout(600)

                clear_selection()
                row("전체").click()
                page.wait_for_timeout(400)
                updated = metrics(APP_NAME)
                result["metrics"]["after"] = updated
                check("업데이트를 마치면 점이 사라진다", updated and updated["dot"] is False, updated)
                shot("store-updated-all-1000.png")

                row("설치됨").click()
                wait_until(lambda: tile(APP_NAME).count() > 0, 30, "업데이트 뒤 설치됨 탭에 앱이 없습니다")
                after_installed = metrics(APP_NAME)
                check("업데이트 뒤 설치됨 탭에도 점이 없다", after_installed and after_installed["dot"] is False, after_installed)
                shot("store-updated-installed-1000.png")

                row("업데이트").click()
                page.wait_for_timeout(400)
                check("업데이트를 마치면 업데이트 탭이 빈다", tile(APP_NAME).count() == 0, tile(APP_NAME).count())
                shot("store-updated-updates-1000.png")

                row("전체").click()
                page.wait_for_timeout(300)
                page.get_by_role("button", name="앱 열기").click()
                wait_until(lambda: page.locator(".ks-app-launcher .ks-icon-tile").count() > 0, 20, "앱 열기가 열리지 않았습니다")
                launcher = page.evaluate(LAUNCHER_DOTS)
                check("앱 열기 타일에는 점이 없다", launcher and not any(item["dot"] for item in launcher), launcher[:4])
                shot("launcher-1030.png", windowed=False)
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)

                result["console"] = sb.console[-30:]
                result["window_state"] = sb.window_of("store")
        except BaseException as error:  # noqa: BLE001 - 실패해도 결과와 화면을 남긴다
            failure = error
            try:
                if sb is not None and sb.page is not None:
                    sb.page.screenshot(path=str(OUTPUT / "failure.png"))
                    result["captures"].append(str(OUTPUT / "failure.png"))
            except Exception:  # noqa: BLE001
                pass
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:  # noqa: BLE001
                    pass
            if sb is not None:
                try:
                    sb.stop()
                except Exception:  # noqa: BLE001
                    pass
            if ui_lock is not None:
                ui_lock.close()
            store_process.terminate()
            try:
                store_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                store_process.kill()
        result["failure"] = None if failure is None else f"{type(failure).__name__}: {failure}"
        (OUTPUT / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"결과 {OUTPUT / 'result.json'}")
        if failure is not None:
            log(f"실패 {result['failure']}")
            return 1
    failures = [item for item in result["assertions"] if not item["pass"]]
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
