"""임시 코어와 브라우저에서 실시간 연결을 확인한다.

cargo build -p kaleidoscope-devbridge -p kaleidoscope-orchestrator 뒤 실행한다.
운영 레지스트리와 로그인 파일은 읽지 않는다.
"""
import base64
import functools
import hashlib
import importlib.util
import json
import os
import socketserver
import struct
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "ui/e2e/fixtures/realtime"
OUTPUT = ROOT.parents[1] / ".local/tmp/kaleidoscope-realtime-r3"
COMMON = Path(os.environ["AGENT_COMMON_FILES_DIR"])
module_spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", COMMON / "skills/kaleidoscope-app/scripts/sandbox.py")
sandbox = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(sandbox)
sandbox.sweep_stale = lambda: None
json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def until(check, seconds, message):
    limit = time.monotonic() + seconds
    while time.monotonic() < limit:
        result = check()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError(message)


class Echo(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(60)
        first = self.rfile.readline().decode("ascii").strip()
        headers = {}
        while line := self.rfile.readline():
            if line == b"\r\n":
                break
            name, value = line.decode("ascii").split(":", 1)
            headers[name.lower()] = value.strip()
        if headers.get("authorization") != "Bearer fixture-secret" or not first.startswith("GET /socket "):
            self.server.rejected += 1
            self.wfile.write(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            return
        key = headers["sec-websocket-key"]
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest())
        self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        self.server.opened += 1
        try:
            while head := self.rfile.read(2):
                if len(head) != 2:
                    break
                opcode, masked, length = head[0] & 15, head[1] & 128, head[1] & 127
                if length == 126:
                    length = struct.unpack("!H", self.rfile.read(2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", self.rfile.read(8))[0]
                mask = self.rfile.read(4) if masked else b""
                payload = self.rfile.read(length)
                if masked:
                    payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
                if opcode in (1, 2, 8, 9):
                    response_opcode = 10 if opcode == 9 else opcode
                    if opcode == 8 and payload[:2] == struct.pack("!H", 3001):
                        payload = struct.pack("!H", 3002) + "서버 종료".encode("utf-8")
                    size = len(payload)
                    header = bytes([0x80 | response_opcode, size]) if size < 126 else bytes([0x80 | response_opcode, 126]) + struct.pack("!H", size)
                    self.wfile.write(header + payload)
                if opcode == 8:
                    break
        except (OSError, EOFError):
            pass
        finally:
            self.server.closed += 1


class EchoServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    opened = 0
    closed = 0
    rejected = 0


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = EchoServer(("127.0.0.1", 0), Echo)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    sb = sandbox.Sandbox(ROOT, OUTPUT, None, "127.0.0.1")
    core_dir = sb.tmp / "core"
    core_dir.mkdir(parents=True)
    (core_dir / "logins.json").write_text(json.dumps({"fixture-echo": {"issuer": "http://127.0.0.1", "access_token": "fixture-secret"}}), encoding="utf-8")
    spawn = sb._spawn

    def local_spawn(name, command, **env):
        if name in ("server", "bridge"):
            command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
        return spawn(name, command, **env)

    sb._spawn = local_spawn
    browser = None
    sessions = []
    results = {}
    try:
        sb.start()
        registered = sb.mcp.call("set_connection", {"name": "fixture-echo", "kind": "oauth", "base_url": f"http://127.0.0.1:{server.server_address[1]}", "writable": True, "paths": ["/socket"]})
        assert not registered["is_error"], registered["text"]
        source = (FIXTURE / "client.js").read_bytes()
        uploaded = sb.mcp.call("upload_asset", {"id": "realtime-fixture-client", "version": 1, "format": "javascript", "sha256": hashlib.sha256(source).hexdigest(), "source": "ui/e2e/fixtures/realtime/client.js", "license": "MIT", "data_base64": base64.b64encode(source).decode("ascii")})
        assert not uploaded["is_error"], uploaded["text"]
        with sync_playwright() as playwright:
            browser = sb.open_page(playwright, (1200, 800))
            page = sb.page

            def observe(response):
                try:
                    if response.url.endswith("/core") and response.request.post_data_json.get("op") == "connection.realtime.session" and response.ok:
                        sessions.append(response.json()["session"])
                except (AttributeError, ValueError, KeyError):
                    pass

            page.on("response", observe)
            definition = json.loads((FIXTURE / "app.json").read_text(encoding="utf-8"))
            report = sb.upload_and_open(definition)
            assert report.get("window_id"), report
            app = sb.window("realtime-fixture")
            until(lambda: "문자 왕복" in app.inner_text() and "0,1,255" in app.inner_text(), 20, "문자열과 바이트 왕복 실패")
            assert server.opened == 1 and server.rejected == 0
            results["roundtrip"] = "문자열과 바이트 원문, bearer 확인"
            frame = page.frame_locator(".ks-client-frames iframe").locator("body")
            blocked = frame.evaluate("""async (_, port) => new Promise(resolve => {
              const socket = new WebSocket(`ws://127.0.0.1:${port}/blocked`);
              socket.onopen = () => resolve(false); socket.onerror = () => resolve(true);
              setTimeout(() => resolve(false), 2000);
            })""", server.server_address[1])
            assert blocked and server.rejected == 0
            results["csp"] = "직접 WebSocket 차단"
            sb.core({"op": "window.minimize", "window_id": report["window_id"]})
            until(lambda: server.closed >= 1, 5, "최소화 뒤 서버 연결이 닫히지 않음")
            started = time.monotonic()
            sb.core({"op": "window.restore", "window_id": report["window_id"]})
            until(lambda: server.opened >= 2, 2, "복원 뒤 2초 내 다시 연결되지 않음")
            results["restore_seconds"] = round(time.monotonic() - started, 3)
            until(lambda: len(sessions) >= 1, 5, "최초 프레임 세션을 기록하지 못함")
            page.reload(wait_until="domcontentloaded")
            def reloaded():
                page.wait_for_timeout(50)
                return len(sessions) >= 2 and sessions[-1] != sessions[0] and server.opened >= 3
            until(reloaded, 20, "리로드 뒤 새 세션이 열리지 않음")
            results["reload"] = "쉘 리로드 뒤 새 세션과 연결"
            previous_session = sessions[-1]
            previous_opened, previous_closed = server.opened, server.closed
            page.frame_locator(".ks-client-frames iframe").locator("body").evaluate("() => window.location.reload()")
            page.get_by_role("button", name="다시 시작").click(timeout=10000)
            def frame_restarted():
                page.wait_for_timeout(50)
                return sessions[-1] != previous_session and server.opened > previous_opened and server.closed > previous_closed
            until(frame_restarted, 15, "프레임 리로드 뒤 이전 연결 종료와 새 세션을 확인하지 못함")
            results["frame_reload"] = "프레임 리로드 후 이전 연결 종료, 다시 시작에서 새 세션"
            until(lambda: "0,1,255" in app.inner_text(), 10, "다시 시작한 연결이 열리지 않음")
            app.get_by_role("button", name="종료 확인").click()
            until(lambda: "3002:서버 종료" in app.inner_text(), 10, "서버의 종료 코드와 사유가 전달되지 않음")
            results["server_close"] = "서버가 응답한 3002와 종료 사유 전달"
            page.screenshot(path=str(OUTPUT / "realtime-local.png"))
            (OUTPUT / "result.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
            print(json.dumps(results), flush=True)
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
