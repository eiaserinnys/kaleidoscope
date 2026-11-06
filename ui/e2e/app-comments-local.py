"""실제 코어와 임시 서버에서 앱 커멘트의 저장과 답글을 확인한다."""
import base64
import copy
import functools
import hashlib
import importlib.util
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import psutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["SCRATCH_WORKSPACE_DIR"]) / ".local/tmp/card1036/impl"
SPEC = importlib.util.spec_from_file_location("sandbox", Path(os.environ["AGENT_COMMON_FILES_DIR"]) / "skills/kaleidoscope-app/scripts/sandbox.py")
sandbox = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sandbox)
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait(predicate, message, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, KeyError, ValueError):
            pass
        time.sleep(0.1)
    raise AssertionError(message)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server_port, bridge_port = port(), port()
    address = "127.0.0.79"
    server, bridge = f"http://127.0.0.1:{server_port}", f"http://127.0.0.1:{bridge_port}"
    token = secrets.token_hex(16)
    procs = []
    logs = []
    with tempfile.TemporaryDirectory(prefix="ks-comments-") as folder:
        def spawn(name, command, extra=None):
            log = open(OUT / f"{name}.log", "w", encoding="utf-8")
            logs.append(log)
            env = os.environ.copy()
            env.update(extra or {})
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            procs.append(process)
            return process

        def core(command, endpoint=bridge):
            request = urllib.request.Request(endpoint + "/core", data=json.dumps(command, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"}, method="POST")
            try:
                with opener.open(request, timeout=30) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                raise AssertionError(json.loads(error.read())) from error

        def snapshot():
            return core({"op": "state.get"})["snapshot"]

        try:
            spawn("server", [str(ROOT / "target/debug/kaleidoscope-orchestrator")], {"KALEIDOSCOPE_BIND": f"127.0.0.1:{server_port}", "KALEIDOSCOPE_DB_PATH": str(Path(folder) / "registry.db"), "KALEIDOSCOPE_MCP_TOKEN": token})
            wait(lambda: opener.open(server + "/api/health", timeout=2).status == 200, "임시 서버가 뜨지 않았습니다")
            mcp = sandbox.Mcp(server + "/mcp", token)
            spawn("bridge", [str(ROOT / "target/debug/kaleidoscope-devbridge"), "--data-dir", str(Path(folder) / "core"), "--port", str(bridge_port), "--server", server, "--device-name", "검증 기기"])
            wait(snapshot, "개발 코어가 뜨지 않았습니다")
            core({"op": "link.start"})
            pairing = wait(lambda: (lambda link: link if link["state"] == "pairing" else None)(snapshot()["link"]), "연결 코드가 나오지 않았습니다")
            assert not mcp.call("approve_device", {"code": pairing["user_code"]})["is_error"]
            wait(lambda: snapshot()["link"]["state"] == "connected", "서버 연결이 끝나지 않았습니다")
            current = snapshot()
            if not current["device"]["active_workspace_id"]:
                core({"op": "workspace.create", "name": "검증 작업"})
                current = snapshot()
            workspace = current["device"]["active_workspace_id"]
            desktop = current["device"]["active_desktop_ids"][workspace]
            source = (ROOT / "ui/e2e/fixtures/comment-receiver.js").read_bytes()
            asset = mcp.call("upload_asset", {"id": "comment-receiver", "version": 1, "format": "javascript", "sha256": hashlib.sha256(source).hexdigest(), "source": "ui/e2e/fixtures/comment-receiver.js", "license": "MIT", "data_base64": base64.b64encode(source).decode("ascii")})
            assert not asset["is_error"], asset["text"]
            receiver = {"id": "comment-receiver", "name": "시험 수신기", "requires": {"blocks": 29, "modules": {"assets": 1, "client": 6}}, "permissions": [], "state": {},
                        "assets": [{"id": "comment-receiver", "version": 1}], "client": {"runtime": "javascript", "entry": {"id": "comment-receiver", "version": 1}, "inputs": {}, "outputs": {"received": {"default": ""}}, "actions": [], "commands": {}, "state_keys": [], "storage_entries": [], "capabilities": ["receive_message"]},
                        "ui": {"type": "text", "value": {"client": "received"}}}
            uploaded = mcp.call("upload_app", {"definition": receiver})
            assert not uploaded["is_error"], uploaded["text"]
            wait(lambda: any(app["id"] == "comment-receiver" for app in snapshot()["shared"]["apps"]), "시험 수신기가 코어에 오지 않았습니다")
            core({"op": "shell.preferences.set_default", "app_id": "comment-receiver"})
            core({"op": "window.open", "desktop_id": desktop, "app_id": "comment-receiver", "rect": {"x": 700, "y": 40, "width": 360, "height": 300}})
            opened = core({"op": "window.open", "desktop_id": desktop, "app_id": "calculator", "rect": {"x": 40, "y": 40, "width": 600, "height": 500}})
            assert opened.get("window"), opened
            spawn("vite", ["corepack", "pnpm@10.32.1", "--dir", str(ROOT / "app"), "dev", "--host", address])
            wait(lambda: opener.open(f"http://{address}:1420/", timeout=2).status == 200, "개발 화면이 뜨지 않았습니다")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=[f"--host-resolver-rules=MAP localhost {address}"], ignore_default_args=["--hide-scrollbars"])
                page = browser.new_page(viewport={"width": 1100, "height": 800})
                page.add_init_script("""(() => {
                  const request = window.fetch.bind(window);
                  window.fetch = (input, init) => typeof init?.body === 'string' && init.body.includes('share.freeze')
                    ? new Promise(resolve => setTimeout(resolve, 1500)).then(() => request(input, init))
                    : request(input, init);
                })();""")
                page.goto(f"http://localhost:1420/?core={bridge}")
                app = page.get_by_test_id("app-window-calculator")
                app.wait_for(timeout=30000)
                page.get_by_test_id("app-window-comment-receiver").get_by_text("수신 준비").wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-a-idle.png"))
                app.locator(".ks-window-content button").first.click(button="right")
                page.get_by_role("menuitem", name="커멘트 달기…").wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s4-b-menu-button.png"))
                page.keyboard.press("Escape")
                app.locator(".ks-window-title").click(button="right")
                page.get_by_role("menuitem", name="커멘트", exact=True).wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s4-c-title-menu.png"))
                page.keyboard.press("Escape")
                app.get_by_role("button", name="커멘트", exact=True).click()
                target = app.locator(".ks-window-content [data-ks-block]").last
                target.wait_for(timeout=30000)
                target.hover()
                page.screenshot(path=str(OUT / "s1-b-enter.png"))
                target.click(force=True)
                composer = app.get_by_role("dialog", name="커멘트 쓰기")
                composer.wait_for(timeout=30000)
                composer.locator('[aria-busy="true"]').wait_for(timeout=30000)
                page.wait_for_timeout(100)
                hover = app.locator(".ks-comment-box.is-hover")
                assert not hover.count() or hover.evaluate("element => getComputedStyle(element).display") == "none"
                page.screenshot(path=str(OUT / "s1-c-compose-loading.png"))
                composer.get_by_role("textbox", name="커멘트").fill("계산 결과가 잘 보이게 해 주세요")
                composer.locator('[aria-busy="true"]').wait_for(state="hidden", timeout=30000)
                page.screenshot(path=str(OUT / "s1-c-compose.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-c-compose-dark.png"))
                page.emulate_media(color_scheme="light")
                composer.get_by_role("button", name="추가").click()
                wait(lambda: bool(mcp.call("list_app_comments", {"app_id": "calculator"})["data"]["items"]), "저장한 커멘트가 서버에 없습니다")
                item = mcp.call("list_app_comments", {"app_id": "calculator"})["data"]["items"][0]
                assert item["text"] == "계산 결과가 잘 보이게 해 주세요"
                app.locator(".ks-comment-title-button").click()
                page.screenshot(path=str(OUT / "s1-a-normal-drafts.png"))
                app.locator(".ks-comment-title-button").click()
                core({"op": "comment.resolve", "app_id": "calculator", "id": item["id"], "request": {"resolved": True}})
                wait(lambda: snapshot()["shared"]["app_comments"]["calculator"]["unsent_count"] == 0, "해결한 커멘트가 보내기 대상에 남았습니다")
                core({"op": "comment.resolve", "app_id": "calculator", "id": item["id"], "request": {"resolved": False}})
                wait(lambda: snapshot()["shared"]["app_comments"]["calculator"]["unsent_count"] == 1, "다시 연 커멘트가 보내기 대상으로 돌아오지 않았습니다")
                page.get_by_role("button", name="에이전트에게 보내기 1").click()
                received = page.get_by_test_id("app-window-comment-receiver").get_by_text("[앱 화면 커멘트]", exact=False)
                received.wait_for(timeout=30000)
                message = received.inner_text()
                assert item["id"] in message and "calculator" in message and "계산 결과가 잘 보이게 해 주세요" in message
                wait(lambda: mcp.call("get_app_comment", {"comment_id": item["id"]})["data"]["thread"].get("sent_at"), "보냄 상태가 서버에 저장되지 않았습니다")
                page.screenshot(path=str(OUT / "s1-h-sent.png"))
                receiver_view = page.get_by_test_id("app-window-comment-receiver")
                receiver_view.get_by_role("button", name="커멘트", exact=True).click()
                source = receiver_view.locator(".ks-data-text")
                bounds = source.bounding_box()
                assert bounds and bounds["width"] > 80
                page.mouse.move(bounds["x"] + 8, bounds["y"] + 10)
                page.mouse.down()
                page.mouse.move(bounds["x"] + min(120, bounds["width"] - 4), bounds["y"] + 10, steps=8)
                page.mouse.up()
                quote_compose = receiver_view.get_by_role("dialog", name="커멘트 쓰기")
                quote_compose.locator(".ks-html-target-name.is-quote").wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-c-compose-text.png"))
                page.keyboard.press("Escape")
                receiver_view.locator(".ks-comment-title-button").click()
                assert not mcp.call("reply_app_comment", {"comment_id": item["id"], "text": "확인했습니다"})["is_error"]
                wait(lambda: snapshot()["shared"]["app_comments"]["calculator"]["unread_reply_count"] == 1, "답변 알림이 코어에 오지 않았습니다")
                app.locator(".ks-comment-title-button").click()
                page.screenshot(path=str(OUT / "s1-a-normal-reply.png"))
                app.locator(".ks-comment-title-button").click()
                page.get_by_role("button", name="커멘트 목록 1개").click()
                page.get_by_text("답변 도착").wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-e-rail.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-e-rail-dark.png"))
                page.emulate_media(color_scheme="light")
                page.get_by_role("button", name="커멘트 목록 1개").click()
                pin = app.get_by_role("button", name="커멘트 1", exact=True)
                pin.click()
                reply_input = app.get_by_role("textbox", name="답글")
                reply_input.fill("추가로 확인해 주세요")
                page.wait_for_function("element => getComputedStyle(element).display === 'none'", arg=app.locator(".ks-comment-box.is-selected").element_handle())
                page.screenshot(path=str(OUT / "s1-d-thread.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-d-thread-dark.png"))
                page.emulate_media(color_scheme="light")
                core({"op": "window.set_rect", "window_id": opened["window"]["id"], "rect": {"x": 40, "y": 40, "width": 360, "height": 250}})
                page.wait_for_function("""() => document.querySelector('[data-testid="app-window-calculator"] .ks-window-content')?.getBoundingClientRect().width <= 360""")
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT / "thread-after-resize.png"))
                page.wait_for_function("""() => {
                  const box = document.querySelector('[data-testid="app-window-calculator"] .ks-comment-thread');
                  const content = box?.closest('.ks-window')?.querySelector('.ks-window-content');
                  if (!box || !content) return false;
                  const a = box.getBoundingClientRect(), b = content.getBoundingClientRect();
                  return b.width <= 360 && b.height <= 210 && a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right;
                }""")
                core({"op": "window.set_rect", "window_id": opened["window"]["id"], "rect": {"x": 40, "y": 40, "width": 600, "height": 500}})
                page.wait_for_function("""() => document.querySelector('[data-testid="app-window-calculator"] .ks-window-content')?.getBoundingClientRect().width >= 590""")
                app.locator(".ks-window-titlebar").click(position={"x": 50, "y": 10})
                pin.click()
                reply_input = app.get_by_role("textbox", name="답글")
                assert reply_input.input_value() == "추가로 확인해 주세요"
                reply_input.press("Enter")
                page.get_by_test_id("app-window-comment-receiver").get_by_text("[앱 화면 커멘트 답글]", exact=False).wait_for(timeout=30000)
                page.get_by_role("button", name="커멘트 목록 1개").click()
                assert not mcp.call("resolve_app_comment", {"comment_id": item["id"], "resolved": True})["is_error"]
                wait(lambda: snapshot()["shared"]["app_comments"]["calculator"]["open_count"] == 0, "해결 상태가 코어에 오지 않았습니다")
                app.get_by_text("해결됨", exact=True).wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-f-resolved.png"))
                app.locator(".ks-comment-title-button").click()
                assert not mcp.call("reply_app_comment", {"comment_id": item["id"], "text": "해결 후 답변"})["is_error"]
                wait(lambda: snapshot()["shared"]["app_comments"]["calculator"]["unread_reply_count"] == 1, "해결된 커멘트의 답변 알림이 오지 않았습니다")
                app.get_by_role("button", name="커멘트, 답변 1개 도착").wait_for(timeout=30000)
                app.locator(".ks-comment-title-button").click()
                page.get_by_role("button", name="커멘트 목록 0개").click()
                app.get_by_text("답변 도착", exact=True).wait_for(timeout=30000)
                assert app.get_by_role("button", name="해결됨 1").get_attribute("aria-expanded") == "true"
                second_port = port()
                second = f"http://127.0.0.1:{second_port}"
                spawn("bridge-second", [str(ROOT / "target/debug/kaleidoscope-devbridge"), "--data-dir", str(Path(folder) / "core-second"), "--port", str(second_port), "--server", server, "--device-name", "두 번째 기기"])
                wait(lambda: core({"op": "state.get"}, second), "두 번째 코어가 뜨지 않았습니다")
                core({"op": "link.start"}, second)
                second_pairing = wait(lambda: (lambda link: link if link["state"] == "pairing" else None)(core({"op": "state.get"}, second)["snapshot"]["link"]), "두 번째 연결 코드가 나오지 않았습니다")
                assert not mcp.call("approve_device", {"code": second_pairing["user_code"]})["is_error"]
                wait(lambda: core({"op": "state.get"}, second)["snapshot"]["link"]["state"] == "connected", "두 번째 코어가 연결되지 않았습니다")
                same = core({"op": "comment.get", "app_id": "calculator", "id": item["id"]}, second)["thread"]
                assert same["resolved"] and all(any(reply["text"] == text for reply in same["replies"]) for text in ["확인했습니다", "추가로 확인해 주세요", "해결 후 답변"]) and same.get("sent_at")
                base = "https://raw.githubusercontent.com/eiaserinnys/kaleidoscope-appstore/main/apps/reader/"
                with urllib.request.urlopen(base + "app.json", timeout=30) as response:
                    reader = json.load(response)
                with urllib.request.urlopen(base + "assets/icon.svg", timeout=30) as response:
                    icon = response.read()
                reader_icon = mcp.call("upload_asset", {"id": "reader-icon", "version": 2, "format": "svg", "sha256": hashlib.sha256(icon).hexdigest(), "source": base + "assets/icon.svg", "license": "MIT", "data_base64": base64.b64encode(icon).decode("ascii")})
                assert not reader_icon["is_error"], reader_icon["text"]
                uploaded = mcp.call("upload_app", {"definition": reader})
                assert not uploaded["is_error"], uploaded["text"]
                wait(lambda: any(app["id"] == "reader" for app in snapshot()["shared"]["apps"]), "해커뉴스 앱이 코어에 오지 않았습니다")
                reader_window = core({"op": "window.open", "desktop_id": desktop, "app_id": "reader", "rect": {"x": 56, "y": 40, "width": 980, "height": 620}})["window"]
                reader_id = reader_window["id"]
                reader_view = page.get_by_test_id("app-window-reader")
                reader_view.wait_for(timeout=30000)
                row = reader_view.locator('.ks-table-row[data-ks-comment-key]').nth(1)
                row.wait_for(timeout=60000)
                page.screenshot(path=str(OUT / "s1-a-normal.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-a-normal-dark.png"))
                page.emulate_media(color_scheme="light")
                reader_view.get_by_role("button", name="커멘트", exact=True).click()
                page.screenshot(path=str(OUT / "s1-b-mode.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-b-mode-dark.png"))
                page.emulate_media(color_scheme="light")
                reader_view.get_by_role("button", name="커멘트", exact=True).click()
                row.click(button="right")
                page.get_by_role("menuitem", name="커멘트 달기…").wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s4-a-menu-row.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s4-a-menu-row-dark.png"))
                page.emulate_media(color_scheme="light")
                page.get_by_role("menuitem", name="커멘트 달기…").click()
                reader_compose = reader_view.get_by_role("dialog", name="커멘트 쓰기")
                reader_compose.get_by_role("textbox", name="커멘트").fill("이 행의 글을 확인해 주세요")
                reader_compose.get_by_role("button", name="추가").click()
                reader_item = wait(lambda: (mcp.call("list_app_comments", {"app_id": "reader"})["data"]["items"] or [None])[0], "행 커멘트가 저장되지 않았습니다")
                assert reader_item["anchor"]["kind"] == "row" and reader_item["anchor"].get("row_identity") is not None
                bubble = reader_view.get_by_role("button", name="커멘트 1", exact=True)
                bubble.wait_for(timeout=30000)
                table = reader_view.locator(".ks-table-scroll")
                table.evaluate("element => { element.scrollTop = element.scrollHeight; }")
                bubble.wait_for(state="hidden", timeout=30000)
                page.screenshot(path=str(OUT / "s1-i-scroll.png"))
                page.get_by_role("button", name="커멘트 목록 1개").click()
                reader_view.get_by_text("이 행의 글을 확인해 주세요").wait_for(timeout=30000)
                reader_view.locator('[title="지금 화면에 없음"]').wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-k-away.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-k-away-dark.png"))
                page.emulate_media(color_scheme="light")
                table.evaluate("element => { element.scrollTop = 0; }")
                bubble.wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-e-reader.png"))
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(200)
                core({"op": "window.set_rect", "window_id": reader_id, "rect": {"x": 56, "y": 40, "width": 360, "height": 500}})
                wait(lambda: next(window for window in snapshot()["shared"]["windows"] if window["id"] == reader_id)["rect"]["width"] == 360, "좁은 창 크기가 저장되지 않았습니다")
                page.wait_for_timeout(200)
                sizes = reader_view.evaluate("""element => {
                  const rail = element.querySelector('.ks-comment-rail').getBoundingClientRect();
                  const body = element.querySelector('.ks-window-content').getBoundingClientRect();
                  const bar = element.querySelector('.ks-comment-bar').getBoundingClientRect();
                  const win = element.getBoundingClientRect();
                  return { rail: { left: rail.left, right: rail.right, width: rail.width }, body: { left: body.left, right: body.right, width: body.width }, barRight: bar.right, windowRight: win.right };
                }""")
                assert abs(sizes["rail"]["width"] - sizes["body"]["width"]) <= 2, sizes
                assert abs(sizes["rail"]["left"] - sizes["body"]["left"]) <= 1 and abs(sizes["rail"]["right"] - sizes["body"]["right"]) <= 1, sizes
                assert abs(sizes["barRight"] - sizes["windowRight"]) <= 1, sizes
                print(f"좁은 창 정렬: {sizes}", flush=True)
                page.screenshot(path=str(OUT / "s5-e-narrow-rail-dark.png"))
                page.emulate_media(color_scheme="light")
                page.wait_for_timeout(100)
                page.screenshot(path=str(OUT / "s5-e-narrow-rail.png"))
                page.get_by_role("button", name="커멘트 목록 1개").click()
                page.screenshot(path=str(OUT / "s5-c-narrow.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s5-c-narrow-dark.png"))
                page.emulate_media(color_scheme="light")
                reader_view.locator(".ks-comment-title-button").click()
                page.screenshot(path=str(OUT / "s1-a-normal-min.png"))
                reader_view.locator(".ks-comment-title-button").click()
                row.click(force=True)
                narrow_compose = reader_view.get_by_role("dialog", name="커멘트 쓰기")
                narrow_compose.wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s5-d-narrow-compose.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s5-d-narrow-compose-dark.png"))
                page.emulate_media(color_scheme="light")
                core({"op": "window.set_rect", "window_id": reader_id, "rect": {"x": 56, "y": 40, "width": 360, "height": 250}})
                page.wait_for_function("""() => {
                  const box = document.querySelector('[role="dialog"][aria-label="커멘트 쓰기"]');
                  const content = box?.closest('.ks-window')?.querySelector('.ks-window-content');
                  if (!box || !content) return false;
                  const a = box.getBoundingClientRect(), b = content.getBoundingClientRect();
                  return b.width <= 360 && b.height <= 210 && a.top >= b.top && a.bottom <= b.bottom && a.left >= b.left && a.right <= b.right;
                }""")
                page.screenshot(path=str(OUT / "s5-g-minheight.png"))
                page.keyboard.press("Escape")
                reader_view.get_by_role("button", name="창 최대화").click()
                page.screenshot(path=str(OUT / "s5-f-maximized.png"))
                reader_view.get_by_role("button", name="이전 크기로 복원").click()
                core({"op": "window.set_rect", "window_id": reader_id, "rect": {"x": 56, "y": 40, "width": 980, "height": 620}})

                def table_parent(value):
                    if isinstance(value, dict):
                        children = value.get("children")
                        if value.get("type") == "split" and isinstance(children, list) and any(child.get("type") == "table" for child in children):
                            return value
                        for child in value.values():
                            found = table_parent(child)
                            if found:
                                return found
                    if isinstance(value, list):
                        for child in value:
                            found = table_parent(child)
                            if found:
                                return found
                    return None

                def publish(definition):
                    old = next(window["app_version"] for window in snapshot()["shared"]["windows"] if window["id"] == reader_id)
                    result = mcp.call("upload_app", {"definition": definition})
                    assert not result["is_error"], result["text"]
                    wait(lambda: next(window["app_version"] for window in snapshot()["shared"]["windows"] if window["id"] == reader_id) > old, "새 판이 창에 반영되지 않았습니다")
                    reader_view.get_by_role("button", name="커멘트 목록 1개").click()
                    reader_view.get_by_text("이 행의 글을 확인해 주세요").wait_for(timeout=30000)

                changed = copy.deepcopy(reader)
                table_parent(changed["ui"])["children"][0]["columns"][0]["label"] = "추천"
                publish(changed)
                assert not reader_view.get_by_text("제자리 없음", exact=True).count()
                publish(reader)
                inserted = copy.deepcopy(reader)
                parent = table_parent(inserted["ui"])
                parent["children"].insert(0, {"type": "text", "value": "추가된 블록"})
                parent["sizes"] = [10, 45, 45]
                publish(inserted)
                reader_view.get_by_text("옮겨 찾음", exact=False).wait_for(timeout=30000)
                removed = copy.deepcopy(inserted)
                parent = table_parent(removed["ui"])
                parent["children"].pop(1)
                parent["sizes"] = [10, 90]
                publish(removed)
                reader_view.get_by_text("제자리 없음", exact=True).wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-g-orphan.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s1-g-orphan-dark.png"))
                page.emulate_media(color_scheme="light")
                reader_view.get_by_text("이 행의 글을 확인해 주세요").click()
                page.screenshot(path=str(OUT / "s1-g-orphan-open.png"))
                publish(reader)
                page.get_by_role("button", name="커멘트 목록 1개").click()
                for index in range(12):
                    actual_row = reader_view.locator('.ks-table-row[data-ks-comment-key]').nth(index)
                    key = json.loads(actual_row.get_attribute("data-ks-comment-key"))
                    anchor = copy.deepcopy(reader_item["anchor"])
                    anchor["row_identity"] = key
                    anchor["element"]["description"] = " ".join(actual_row.inner_text().split())[:200]
                    request = {"id": str(uuid.uuid4()), "anchor": anchor, "text": f"{index + 1}행을 확인해 주세요", "origin": reader_item["origin"], "created_app_version": reader_item["created_app_version"], "created_definition_digest": reader_item["created_definition_digest"], "created_shell_version": reader_item["created_shell_version"], "source_window_id": reader_id}
                    core({"op": "comment.create", "app_id": "reader", "request": request})
                wait(lambda: snapshot()["shared"]["app_comments"]["reader"]["open_count"] == 13, "여러 행의 커멘트가 저장되지 않았습니다")
                reader_view.locator(".ks-comment-pin:not(.is-rail)").nth(5).wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s1-j-many.png"))
                reader_view.locator(".ks-comment-pin.is-cluster").first.click()
                page.screenshot(path=str(OUT / "s1-j-cluster.png"))
                page.keyboard.press("Escape")
                core({"op": "window.raise", "window_id": opened["window"]["id"]})
                page.screenshot(path=str(OUT / "s5-b-under.png"))
                core({"op": "window.raise", "window_id": reader_id})
                page.screenshot(path=str(OUT / "s5-a-overlap.png"))
                reader_view.get_by_role("button", name="같이 보기", exact=True).click()
                page.screenshot(path=str(OUT / "s5-h-share-ring.png"))
                reader_view.get_by_role("button", name="같이 보기 끄기").click()
                canvas_source = (ROOT / "examples/surface-gallery.js").read_bytes()
                asset = mcp.call("upload_asset", {"id": "surface-gallery", "version": 1, "format": "javascript", "sha256": hashlib.sha256(canvas_source).hexdigest(), "source": "examples/surface-gallery.js", "license": "MIT", "data_base64": base64.b64encode(canvas_source).decode("ascii")})
                assert not asset["is_error"], asset["text"]
                canvas_definition = json.loads((ROOT / "examples/surface-gallery.json").read_text(encoding="utf-8"))
                uploaded = mcp.call("upload_app", {"definition": canvas_definition})
                assert not uploaded["is_error"], uploaded["text"]
                wait(lambda: any(app["id"] == "surface-gallery" for app in snapshot()["shared"]["apps"]), "캔버스 앱이 코어에 오지 않았습니다")
                canvas_window = core({"op": "window.open", "desktop_id": desktop, "app_id": "surface-gallery", "rect": {"x": 60, "y": 40, "width": 700, "height": 600}})["window"]
                canvas_app = page.get_by_test_id("app-window-surface-gallery").filter(has=page.locator(f'.ks-data-window[data-window-id="{canvas_window["id"]}"]'))
                canvas_app.get_by_role("button", name="첫 번째", exact=True).click(timeout=30000)
                surface = canvas_app.locator('[data-ks-block-type="canvas"]').first
                surface.wait_for(timeout=30000)
                canvas_app.get_by_role("button", name="커멘트", exact=True).click()
                surface.click(position={"x": 40, "y": 40})
                canvas_compose = canvas_app.get_by_role("dialog", name="커멘트 쓰기")
                canvas_compose.get_by_role("textbox", name="커멘트").fill("이 자리를 확인해 주세요")
                page.screenshot(path=str(OUT / "s2-b-compose.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s2-b-compose-dark.png"))
                page.emulate_media(color_scheme="light")
                canvas_compose.get_by_role("button", name="추가").click()
                point = wait(lambda: (mcp.call("list_app_comments", {"app_id": "surface-gallery"})["data"]["items"] or [None])[0], "캔버스 커멘트가 저장되지 않았습니다")
                assert point["anchor"]["kind"] == "point" and point["anchor"].get("frame_rel"), point["anchor"]
                canvas_app.get_by_role("button", name="커멘트 1", exact=True).wait_for(timeout=30000)
                page.screenshot(path=str(OUT / "s2-a-mode.png"))
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(OUT / "s2-a-mode-dark.png"))
                page.emulate_media(color_scheme="light")
                core({"op": "window.set_rect", "window_id": canvas_window["id"], "rect": {"x": 60, "y": 40, "width": 360, "height": 500}})
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT / "s2-c-mode-min.png"))
                for kind, blocks in [("sandbox", 11), ("html_view", 6)]:
                    app_id = f"comment-{kind.replace('_', '-')}-probe"
                    frame_block = {"type": kind, "value": '<div id="comment-target">프레임 내용</div>'}
                    if kind == "sandbox":
                        frame_block["title"] = "격리된 내용"
                    definition = {"id": app_id, "name": "프레임 검사", "requires": {"blocks": blocks, "modules": {}}, "permissions": [], "state": {},
                                  "ui": frame_block}
                    uploaded = mcp.call("upload_app", {"definition": definition, "open": False})
                    assert not uploaded["is_error"], uploaded["text"]
                    wait(lambda: any(entry["id"] == app_id for entry in snapshot()["shared"]["apps"]), "프레임 앱이 코어에 오지 않았습니다")
                    frame_window = core({"op": "window.open", "desktop_id": desktop, "app_id": app_id, "rect": {"x": 60, "y": 40, "width": 500, "height": 400}})["window"]
                    frame_app = page.get_by_test_id(f"app-window-{app_id}").filter(has=page.locator(f'.ks-data-window[data-window-id="{frame_window["id"]}"]'))
                    frame_app.frame_locator("iframe").locator("#comment-target").click(button="right", timeout=30000)
                    page.get_by_role("menuitem", name="커멘트 달기…").click(timeout=30000)
                    frame_compose = frame_app.get_by_role("dialog", name="커멘트 쓰기")
                    frame_compose.get_by_role("textbox", name="커멘트").fill("이 프레임 위치를 확인해 주세요")
                    page.screenshot(path=str(OUT / f"frame-{kind}-context.png"))
                    frame_compose.get_by_role("button", name="추가").click()
                    frame_comment = wait(lambda: (mcp.call("list_app_comments", {"app_id": app_id})["data"]["items"] or [None])[0], "프레임 커멘트가 저장되지 않았습니다")
                    assert frame_comment["anchor"]["kind"] == "point" and frame_comment["anchor"].get("frame_rel"), frame_comment["anchor"]
                print("실제 격리 프레임: 샌드박스와 HTML의 빈 곳 우클릭 및 좌표 저장 확인")
                print("실제 캔버스: 프레임 좌표 저장과 말풍선 확인")
                print("실제 해커뉴스 행: 원래 자리, 제목 수정, 앞 삽입 이동, 블록 삭제 확인")
                print("실제 서버와 두 코어: 저장, 전송 접수와 보냄 표시, MCP 답글, 해결, 두 번째 기기 확인")
                browser.close()
        finally:
            for proc in reversed(procs):
                try:
                    parent = psutil.Process(proc.pid)
                    for child in parent.children(recursive=True):
                        child.terminate()
                    parent.terminate()
                except psutil.NoSuchProcess:
                    pass
            for proc in procs:
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            for log in logs:
                log.close()


if __name__ == "__main__":
    main()
