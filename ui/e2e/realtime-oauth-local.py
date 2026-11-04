"""실제 devbridge와 Chromium에서 격리된 OAuth 로그인과 실시간 왕복을 확인한다."""
import base64
import functools
import hashlib
import importlib.util
import json
import os
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "ui/e2e/fixtures/realtime"
OUTPUT = ROOT.parents[1] / ".local/tmp/kaleidoscope-realtime-r4"
COMMON = Path(os.environ["AGENT_COMMON_FILES_DIR"])


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sandbox = load_module("kaleidoscope_sandbox", COMMON / "skills/kaleidoscope-app/scripts/sandbox.py")
oauth = load_module("fixture_oauth", FIXTURE / "oauth_server.py")
sandbox.sweep_stale = lambda: None
json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def until(check, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError(message)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = oauth.Server()
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    sb = sandbox.Sandbox(ROOT, OUTPUT, None, "127.0.0.1")
    url_file = sb.tmp / "oauth-open-url"
    spawn = sb._spawn

    def local_spawn(name, command, **env):
        if name in ("server", "bridge"):
            command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
        if name == "bridge":
            command.extend(["--oauth-open-url-file", str(url_file)])
        return spawn(name, command, **env)

    sb._spawn = local_spawn
    browser = None
    results = {}
    try:
        assert not (sb.tmp / "core/logins.json").exists()
        sb.start()
        registered = sb.mcp.call("set_connection", {"name": "fixture-echo", "kind": "oauth", "base_url": server.origin, "writable": True, "paths": ["/socket"]})
        assert not registered["is_error"], registered["text"]
        source = (FIXTURE / "oauth-client.js").read_bytes()
        uploaded = sb.mcp.call("upload_asset", {"id": "realtime-oauth-client", "version": 1, "format": "javascript", "sha256": hashlib.sha256(source).hexdigest(), "source": "ui/e2e/fixtures/realtime/oauth-client.js", "license": "MIT", "data_base64": base64.b64encode(source).decode("ascii")})
        assert not uploaded["is_error"], uploaded["text"]
        with sync_playwright() as playwright:
            browser = sb.open_page(playwright, (1200, 800))
            page = sb.page

            report = sb.upload_and_open(json.loads((FIXTURE / "oauth-app.json").read_text(encoding="utf-8")))
            assert report.get("window_id"), report
            app = sb.window("realtime-oauth-fixture")
            until(lambda: app.inner_text().count("login_required") >= 2, 20, "로그인 필요 오류와 종료가 오지 않음")
            assert server.opened == 0 and not url_file.exists()
            results["login_required"] = "오류와 닫힘 확인"
            # 실패를 본 사람이 로그인하는 순서를 따르고 코어의 1초 실패 간격을 피한다.
            time.sleep(1.2)
            try:
                app.get_by_role("button", name="로그인").click()
                until(url_file.exists, 20, "인가 주소 파일이 생성되지 않음")
                login_page = browser.new_page()
                login_page.goto(url_file.read_text(encoding="utf-8"), wait_until="load", timeout=20000)
                login_page.close()
                until(lambda: "문자 왕복" in app.inner_text() and "0,1,255" in app.inner_text(), 20, "로그인 뒤 문자열과 바이너리 왕복 실패")
                assert server.issued and server.opened == 1
                assert server.received_bearers == [f"Bearer {oauth.ACCESS}"]
            except Exception:
                print(json.dumps({"app": app.inner_text(), "issued": server.issued, "opened": server.opened, "closed": server.closed, "bearer_count": len(server.received_bearers), "console": sb.console}), flush=True)
                page.screenshot(path=str(OUTPUT / "realtime-oauth-failure.png"))
                raise
            results["oauth_and_echo"] = "PKCE 교환, 발급 토큰의 bearer, 문자열과 바이너리 확인"
            page.screenshot(path=str(OUTPUT / "realtime-oauth.png"))
            (OUTPUT / "result.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
            print("2 passed: 로그인 필요와 닫힘, 실제 OAuth 로그인과 실시간 왕복", flush=True)
            browser.close()
            browser = None
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        try:
            sb.stop()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)


if __name__ == "__main__":
    main()
