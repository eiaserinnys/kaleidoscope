"""실제 코어와 브라우저에서 프로그램 단위 허용을 확인한다."""
import base64
import functools
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "ui/e2e/fixtures/process-command-grant"
OUTPUT = ROOT.parents[1] / ".local/tmp/card1017"
module_path = Path(os.environ["AGENT_COMMON_FILES_DIR"]) / "skills/kaleidoscope-app/scripts/sandbox.py"
module_spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", module_path)
sandbox = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(sandbox)
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if fn():
            return
        time.sleep(0.1)
    raise AssertionError(message)


def geometry(page):
    return page.evaluate("""() => {
      const bounds = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return { window: bounds('.ks-window'), dialog: bounds('.ks-window-consent-overlay .ks-dialog'),
        title: bounds('.ks-window-consent-overlay .ks-dialog-title'),
        body: bounds('.ks-window-consent-overlay .ks-dialog-body'),
        actions: bounds('.ks-window-consent-overlay .ks-dialog-actions') };
    }""")


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ks-command-grant-") as directory:
        folder = Path(directory)
        address, ui_lock = sandbox.acquire_ui_address()
        sb = sandbox.Sandbox(ROOT, OUTPUT, folder, address)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            source = (FIXTURE / "client.js").read_bytes()
            asset = {"id": "process-command-client", "version": 1, "format": "javascript", "sha256": hashlib.sha256(source).hexdigest(), "source": "ui/e2e/fixtures/process-command-grant/client.js", "license": "MIT", "data_base64": base64.b64encode(source).decode("ascii")}
            uploaded = sb.mcp.call("upload_asset", asset)
            assert not uploaded["is_error"], uploaded["text"]
            definition = json.loads((FIXTURE / "app.json").read_text(encoding="utf-8"))
            preview = sb.mcp.call("preview_app", {"definition": definition})
            assert not preview["is_error"], preview["text"]
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                report = sb.upload_and_open(definition)
                assert report.get("window_id") and not report.get("pick_errors"), report
                page = sb.page
                app = sb.window("process-command-fixture")
                app.get_by_role("button", name="첫 실행").click()
                dialog = app.get_by_role("dialog")
                dialog.wait_for(timeout=15000)
                assert "앞으로는 인자가 달라도 다시 묻지 않습니다." in dialog.inner_text()
                page.screenshot(path=str(OUTPUT / "command-wide.png"))
                metrics = {"wide": geometry(page)}
                page.set_viewport_size({"width": 520, "height": 680})
                sb.core({"op": "window.set_rect", "window_id": report["window_id"], "rect": {"x": 10, "y": 10, "width": 360, "height": 480}})
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUTPUT / "command-narrow.png"))
                metrics["narrow"] = geometry(page)
                (OUTPUT / "geometry.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
                dialog.get_by_role("button", name="허용").click()
                result = folder / "result.txt"
                wait_until(lambda: result.exists() and result.read_text(encoding="utf-8") == "첫 번째", 15, "첫 실행 결과 없음")
                app.get_by_role("button", name="두 번째 실행").click()
                wait_until(lambda: result.read_text(encoding="utf-8") == "두 번째", 15, "두 번째 실행 결과 없음")
                app.get_by_text("두 번째 실행됨").wait_for(timeout=15000)
                assert app.get_by_role("dialog").count() == 0, "두 번째 실행에 허용을 다시 물었습니다"
                page.screenshot(path=str(OUTPUT / "second-run.png"))
                sb.core({"op": "window.close", "window_id": report["window_id"]})
                legacy_fixture = ROOT / "ui/e2e/fixtures/process"
                legacy_source = (legacy_fixture / "client.js").read_bytes()
                legacy_asset = {"id": "process-fixture-client", "version": 1, "format": "javascript", "sha256": hashlib.sha256(legacy_source).hexdigest(), "source": "ui/e2e/fixtures/process/client.js", "license": "MIT", "data_base64": base64.b64encode(legacy_source).decode("ascii")}
                uploaded = sb.mcp.call("upload_asset", legacy_asset)
                assert not uploaded["is_error"], uploaded["text"]
                definition = json.loads((legacy_fixture / "app.json").read_text(encoding="utf-8"))
                page.set_viewport_size({"width": 1440, "height": 900})
                legacy = sb.upload_and_open(definition)
                assert legacy.get("window_id") and not legacy.get("pick_errors"), legacy
                sb.set_state(legacy["window_id"], {"command": sys.executable, "script": str(legacy_fixture / "child.py")})
                legacy_app = sb.window("process-fixture")
                legacy_app.get_by_role("button", name="실행").click()
                legacy_dialog = legacy_app.get_by_role("dialog")
                legacy_dialog.wait_for(timeout=15000)
                assert "앞으로는 인자가 달라도 다시 묻지 않습니다." not in legacy_dialog.inner_text()
                page.screenshot(path=str(OUTPUT / "spec-wide.png"))
                legacy_dialog.get_by_role("button", name="취소").click()
                print("3 passed: 첫 허용, 인자 변경 실행, 기존 명세별 화면", flush=True)
        finally:
            if browser:
                try:
                    browser.close()
                except PlaywrightError:
                    pass
            sb.stop()
            ui_lock.close()


if __name__ == "__main__":
    run()
