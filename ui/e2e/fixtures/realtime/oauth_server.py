"""루프백 전용 OAuth 및 WebSocket 시험 서버. 운영 인증 정보는 사용하지 않는다."""
import base64
import hashlib
import json
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

ACCESS = "fixture-access-token"
REFRESH = "fixture-refresh-token"


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.redirect = None
        self.challenge = None
        self.code_used = False
        self.issued = False
        self.received_bearers = []
        self.opened = 0
        self.closed = 0


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, status, payload=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else b""
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/.well-known/oauth-authorization-server":
            self.reply(200, {"authorization_endpoint": self.server.origin + "/authorize", "token_endpoint": self.server.origin + "/token", "registration_endpoint": self.server.origin + "/register", "code_challenge_methods_supported": ["S256"]})
        elif url.path == "/authorize":
            query = parse_qs(url.query)
            if query.get("client_id") != ["fixture-client"] or query.get("redirect_uri") != [self.server.redirect] or query.get("code_challenge_method") != ["S256"] or not query.get("code_challenge") or not query.get("state"):
                self.reply(400)
                return
            self.server.challenge = query["code_challenge"][0]
            self.reply(302, headers={"Location": self.server.redirect + "?" + urlencode({"code": "fixture-code", "state": query["state"][0]})})
        elif url.path == "/socket":
            self.websocket()
        else:
            self.reply(404)

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/register":
            body = json.loads(data)
            self.server.redirect = body["redirect_uris"][0]
            self.reply(201, {"client_id": "fixture-client"})
        elif self.path == "/token":
            form = parse_qs(data.decode())
            verifier = form.get("code_verifier", [""])[0]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            code_ok = (form.get("grant_type") == ["authorization_code"] and form.get("client_id") == ["fixture-client"] and form.get("code") == ["fixture-code"] and form.get("redirect_uri") == [self.server.redirect] and self.server.challenge == challenge and not self.server.code_used)
            refresh_ok = (form.get("grant_type") == ["refresh_token"] and form.get("client_id") == ["fixture-client"] and form.get("refresh_token") == [REFRESH])
            if not (code_ok or refresh_ok):
                self.reply(400, {"error": "invalid_grant"})
                return
            self.server.code_used = True
            self.server.issued = True
            self.reply(200, {"access_token": ACCESS, "refresh_token": REFRESH, "token_type": "Bearer", "expires_in": 3600})
        else:
            self.reply(404)

    def websocket(self):
        bearer = self.headers.get("Authorization")
        self.server.received_bearers.append(bearer)
        if not self.server.issued or bearer != f"Bearer {ACCESS}":
            self.reply(401)
            return
        accept = base64.b64encode(hashlib.sha1((self.headers["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.server.opened += 1
        self.connection.settimeout(60)
        try:
            while head := self.rfile.read(2):
                if len(head) != 2:
                    break
                opcode, masked, size = head[0] & 15, head[1] & 128, head[1] & 127
                if size == 126:
                    size = struct.unpack("!H", self.rfile.read(2))[0]
                elif size == 127:
                    size = struct.unpack("!Q", self.rfile.read(8))[0]
                mask = self.rfile.read(4) if masked else b""
                payload = self.rfile.read(size)
                if masked:
                    payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
                if opcode in (1, 2, 8, 9):
                    op = 10 if opcode == 9 else opcode
                    header = bytes([0x80 | op, size]) if size < 126 else bytes([0x80 | op, 126]) + struct.pack("!H", size)
                    self.wfile.write(header + payload)
                    self.wfile.flush()
                if opcode == 8:
                    break
        except (OSError, EOFError):
            pass
        finally:
            self.server.closed += 1
            self.close_connection = True
