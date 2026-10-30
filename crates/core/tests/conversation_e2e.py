"""빈 로컬 레지스트리와 가짜 대화 제공자로 실제 코어 두 기기를 시험한다."""
import base64
import hashlib
import json
import os
import queue
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote

from storage_e2e import BIN, ROOT, call, port, read_events, request, until


class Provider:
    def __init__(self):
        self.lock = threading.Lock()
        self.bindings = {}
        self.receipts = {}
        self.posts = []
        self.events = []
        self.adoptions = []
        self.interventions = 0
        self.break_first = True
        self.fail_ids = set()
        self.drop_before = set()
        self.late_item = False
        self.late_ready = False
        self.patches = []
        self.pages = 0
        self.cursors = []
        self.reject_patch = False
        self.failed_patches = 0

    def thread(self, namespace, key, thread_id):
        return {"id": thread_id, "external": {"namespace": namespace, "key": key},
                "title": "작업", "model": {"id": "model-argon", "label": "Model"},
                "created_at": "2026-10-30T00:00:00Z", "archived": False}


def serve(provider):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, code, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def route(self):
            if self.headers.get("Authorization") != "Bearer local-test-token":
                return self.respond(401, {"error": {"code": "login_required", "message": "login"}})
            url = urlsplit(self.path)
            path = unquote(url.path).removeprefix("/api/conversations/v1")
            query = parse_qs(url.query)
            key = (query.get("namespace", [""])[0], query.get("key", [""])[0])
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            with provider.lock:
                if path == "/models":
                    return self.respond(200, {"models": [{"id": "model-argon", "label": "Model", "available": True}]})
                if path == "/threads":
                    refs = [v for (ns, _), v in provider.bindings.items() if ns == key[0]]
                    offset = int(query.get("cursor", ["0"])[0])
                    provider.pages += 1
                    provider.cursors.append(offset)
                    result = {"refs": [{k: v[k] for k in ("id", "title", "created_at", "archived")} for v in refs[offset:offset + 1]]}
                    if offset + 1 < len(refs): result["next_cursor"] = str(offset + 1)
                    return self.respond(200, result)
                if path == "/threads/by-key":
                    if self.command == "PUT":
                        thread = provider.bindings.setdefault(key, provider.thread(*key, "thread-" + key[1]))
                        return self.respond(200, {"thread": thread, "created": True, "notices": ["notice"]})
                    thread = provider.bindings.get(key)
                    return self.respond(200, {"thread": thread}) if thread else self.respond(404, {"error": {"code": "not_found", "message": "missing"}})
                if path == "/threads/by-key/adoption":
                    provider.adoptions.append(body)
                    thread = provider.bindings.setdefault(key, provider.thread(*key, body["session_id"]))
                    return self.respond(200, {"thread": thread, "created": True, "notices": []})
                parts = path.strip("/").split("/")
                if len(parts) == 2 and parts[0] == "threads":
                    thread = next((v for v in provider.bindings.values() if v["id"] == parts[1]), None)
                    if not thread:
                        return self.respond(404, {"error": {"code": "not_found", "message": "missing"}})
                    if self.command == "PATCH":
                        if provider.reject_patch:
                            provider.failed_patches += 1
                            return self.respond(503, {"error": {"code": "unavailable", "message": "test failure"}})
                        provider.patches.append((parts[1], body))
                        if "title" in body: thread["title"] = body["title"]
                        if body.get("archived"): thread["archived"] = True
                        if "model" in body: thread["model"]["id"] = body["model"]
                        return self.respond(200, {"thread": thread})
                    return self.respond(200, {"thread": thread, "busy": False, "tool": None, "current_model": thread["model"]})
                if len(parts) >= 3 and parts[0] == "threads":
                    thread_id = parts[1]
                    if parts[2] == "items" and len(parts) == 3:
                        items = [{"id": "1", "kind": "notice", "text": "notice", "at": "now", "attachments": []}]
                        items.append({"id": "legacy-share", "kind": "user",
                            "text": "오 이거 이제 보여?\n\n<kaleidoscope-share>\n옛 같이 보기 글\n</kaleidoscope-share>",
                            "at": "now", "attachments": []})
                        if provider.late_item:
                            provider.late_ready = True
                            items.append({"id": "4", "kind": "assistant", "text": "나중 답", "at": "now", "attachments": []})
                        return self.respond(200, {"items": items, "cursor": "4" if provider.late_item else "1"})
                    if parts[2] == "events":
                        cursor = self.headers.get("Last-Event-ID")
                        provider.events.append(cursor)
                        late = provider.late_ready
                        snapshot = {"kind": "snapshot", "snapshot": {"cursor": "4" if late else "2", "busy": False, "tool": None, "stream_id": None, "text": None,
                            "items": [
                                {"id": "4" if late else "2", "kind": "assistant", "text": "답", "at": "now", "attachments": []},
                                {"id": "legacy-event", "kind": "user",
                                 "text": "이전 글\n\n<kaleidoscope-share>\n옛 같이 보기 글\n</kaleidoscope-share>",
                                 "at": "now", "attachments": []},
                            ]}}
                        encoded = json.dumps(snapshot, ensure_ascii=False)
                        split = encoded.index('"snapshot"')
                        text1 = json.dumps({"kind": "text", "stream_id": "stream-1", "text": "한"}, ensure_ascii=False)
                        text2 = json.dumps({"kind": "text", "stream_id": "stream-1", "text": "한국"}, ensure_ascii=False)
                        duplicate = json.dumps({"kind": "item", "item": snapshot["snapshot"]["items"][0]}, ensure_ascii=False)
                        answer = json.dumps({"kind": "item", "item": {"id": "3", "kind": "assistant", "text": "최초 지시 답", "at": "now", "attachments": []}}, ensure_ascii=False)
                        event_id = "4" if late else "2"
                        payload = ("id: " + event_id + "\r\ndata: " + encoded[:split] + "\r\ndata: " + encoded[split:]
                                   + "\r\n\r\nid: " + event_id + "\r\ndata: " + duplicate
                                   + ("" if late else "\r\n\r\nid: 3\r\ndata: " + answer)
                                   + "\r\n\r\ndata: " + text1 + "\r\n\r\ndata: " + text2 + "\r\n\r\n").encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "text/event-stream")
                        self.send_header("Content-Length", str(len(payload)))
                        self.end_headers()
                        cut = payload.index("답".encode()) + 1
                        self.wfile.write(payload[:cut])
                        self.wfile.flush()
                        self.wfile.write(payload[cut:])
                        return
                    if parts[2] == "messages":
                        if self.command == "POST":
                            rid = body["request_id"]
                            provider.posts.append(body)
                            if rid in provider.drop_before:
                                provider.drop_before.remove(rid)
                                self.connection.shutdown(socket.SHUT_RDWR)
                                self.connection.close()
                                return
                            if rid in provider.fail_ids:
                                provider.receipts[rid] = "failed"
                                return self.respond(200, {"request_id": rid, "status": "failed", "error": {"code": "unavailable", "message": "failed"}})
                            if rid not in provider.receipts:
                                provider.receipts[rid] = "pending"
                                if provider.break_first:
                                    self.connection.shutdown(socket.SHUT_RDWR)
                                    self.connection.close()
                                    return
                            if provider.receipts[rid] != "accepted":
                                provider.interventions += 1
                                provider.receipts[rid] = "accepted"
                            return self.respond(200, {"request_id": rid, "status": provider.receipts[rid]})
                        rid = parts[3]
                        if rid not in provider.receipts:
                            return self.respond(404, {"error": {"code": "not_found", "message": "missing"}})
                        return self.respond(200, {"request_id": rid, "status": provider.receipts[rid]})
                    if parts[2] == "items" and len(parts) == 6:
                        data = b"attachment"
                        self.send_response(200)
                        self.send_header("Content-Type", "text/plain")
                        self.send_header("Content-Disposition", "attachment; filename=note.txt; filename*=UTF-8''note.txt")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                self.respond(404, {"error": {"code": "not_found", "message": path}})

        do_GET = route
        do_PUT = route
        do_POST = route
        do_PATCH = route

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run():
    provider = Provider()
    fake = serve(provider)
    fake_url = "http://127.0.0.1:" + str(fake.server_port)
    children = []
    with tempfile.TemporaryDirectory(prefix="ks-conversation-test-") as temporary:
        root = Path(temporary)
        db = root / "empty-test.db"
        server_port, p1, p2 = port(), port(), port()
        server_url = f"http://127.0.0.1:{server_port}"
        url1, url2 = f"http://127.0.0.1:{p1}", f"http://127.0.0.1:{p2}"
        env = os.environ.copy()
        env.update(KALEIDOSCOPE_BIND=f"127.0.0.1:{server_port}", KALEIDOSCOPE_DB_PATH=str(db), KALEIDOSCOPE_MCP_TOKEN="test-mcp")
        logs = (root / "services.log").open("w+")
        try:
            children.append(subprocess.Popen([str(BIN / "kaleidoscope-orchestrator")], env=env, stdout=logs, stderr=logs))
            until("임시 서버", lambda: request(server_url + "/api/health")[0] == 200)
            with sqlite3.connect(db) as conn:
                account = conn.execute("SELECT account_id FROM mcp_principal WHERE id=1").fetchone()[0]
                conn.execute("INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (account, "conversation", "oauth", fake_url, 1, "[]", "{}", "", "now"))
                for name in ("device-a", "device-b"):
                    token = "test-" + name
                    conn.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?,?,?,?,?)", (name, name, account, hashlib.sha256(token.encode()).hexdigest(), "now"))
            definition = json.loads((ROOT / "examples/workspace-pas-v2.json").read_text())
            status, response = request(server_url + "/api/device/apps", "POST", {"definition_json": json.dumps(definition, ensure_ascii=False)}, "test-device-a")
            assert status == 200, response

            def bridge(name, number, logged_in):
                data = root / name
                data.mkdir(exist_ok=True)
                (data / "link.json").write_text(json.dumps({"format": 1, "server_url": server_url, "device_id": name, "device_name": name, "token": "test-" + name}))
                if logged_in:
                    (data / "logins.json").write_text(json.dumps({"conversation": {"issuer": fake_url, "access_token": "local-test-token"}}))
                process = subprocess.Popen([str(BIN / "kaleidoscope-devbridge"), "--data-dir", str(data), "--port", str(number), "--server", server_url, "--device-name", name], env=env, stdout=logs, stderr=logs)
                children.append(process)
                return process

            first_process = bridge("device-a", p1, False)
            first = until("첫 코어 연결", lambda: (s if (s := call(url1, "state.get")["snapshot"])["link"]["state"] == "connected" and any(a["id"] == definition["id"] for a in s["shared"]["apps"]) else None))
            desktop = first["shared"]["desktops"][0]["id"]
            workspace = first["shared"]["desktops"][0]["workspace_id"]
            window = call(url1, "window.open", desktop_id=desktop, app_id=definition["id"])["window"]["id"]
            until("창 동기화", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?", (window,)).fetchone()[0])
            status, body = request(url1 + "/core", "POST", {"op": "conversation.get", "window_id": window})
            assert status == 400 and body["code"] == "login_required", body
            draft = {"op": "conversation.send", "window_id": window, "request_id": "draft-1", "text": "보존할 초안", "attachments": []}
            status, body = request(url1 + "/core", "POST", draft)
            assert status == 400 and body["code"] == "login_required", body
            assert list((root / "device-a" / "conversation-pending").glob("*.json"))
            first_process.terminate()
            first_process.wait(timeout=5)
            first_process = bridge("device-a", p1, True)
            bridge("device-b", p2, True)
            until("두 기기 연결", lambda: all(call(url, "state.get")["snapshot"]["link"]["state"] == "connected" and any(w["id"] == window for w in call(url, "state.get")["snapshot"]["shared"]["windows"]) for url in (url1, url2)))
            events = queue.Queue()
            ready = threading.Event()
            threading.Thread(target=read_events, args=(url1, events, ready), daemon=True).start()
            assert ready.wait(5)
            assert call(url1, "conversation.get", window_id=window)["thread"] is None
            draft_event = until("보존 초안 전달", lambda: (event if (not events.empty() and (event := events.get_nowait()).get("event") == "conversation.draft") else None))
            assert draft_event["request_id"] == "draft-1" and draft_event["text"] == "보존할 초안" and draft_event["failed"] is False
            revision = call(url1, "storage.write", window_id=window, entry="title_template", content="작업 {unsupported}", expected_revision=None)["revision"]
            status, invalid = request(url1 + "/core", "POST", {"op": "conversation.create", "window_id": window, "model": "model-argon"})
            assert status == 400 and invalid["code"] == "invalid_request", invalid
            call(url1, "storage.reset", window_id=window, entry="title_template", expected_revision=revision)
            results = []
            def create(url):
                results.append(call(url, "conversation.create", window_id=window, model="model-argon")["thread"]["id"])
            tasks = [threading.Thread(target=create, args=(url,)) for url in (url1, url2)]
            for task in tasks: task.start()
            for task in tasks: task.join(timeout=20)
            assert len(results) == 2 and results[0] == results[1], results
            assert len(provider.bindings) == 1
            initial_snapshots = []
            def initial_answer():
                while not events.empty():
                    event = events.get_nowait()
                    update = event.get("update", {})
                    if update.get("kind") == "snapshot":
                        initial_snapshots.append(event)
                    if initial_snapshots and update.get("kind") == "item" and update["item"]["id"] == "3":
                        return event
                return None
            assert until("생성 뒤 get 없이 첫 대화 이벤트", initial_answer, seconds=15)
            assert None in provider.events, provider.events
            legacy_event = next(item for event in initial_snapshots for item in event["update"]["snapshot"]["items"]
                                if item["id"] == "legacy-event")
            assert legacy_event["text"] == "이전 글", legacy_event
            assert not provider.posts, provider.posts
            call(url1, "conversation.send", window_id=window, request_id="draft-1", text="보존할 초안", attachments=[])
            with provider.lock:
                provider.posts.clear()
                provider.interventions = 0
            got = call(url1, "conversation.get", window_id=window)
            assert got["items"][0]["kind"] == "notice"
            assert got["items"][1]["text"] == "오 이거 이제 보여?", got["items"][1]
            assert call(url1, "conversation.history", window_id=window, before="1")["items"][0]["kind"] == "notice"
            until("SSE 재연결 cursor", lambda: "3" in provider.events, seconds=15)
            delivered = []
            while not events.empty(): delivered.append(events.get_nowait())
            items = [item["id"] for event in delivered if event.get("event") == "conversation.update"
                     for item in event["update"].get("snapshot", {}).get("items", [])]
            assert items.count("2") == 0, delivered
            assert not any(event.get("update", {}).get("kind") == "item" and event["update"]["item"]["id"] == "2" for event in delivered)
            texts = [event["update"]["text"] for event in delivered if event.get("update", {}).get("kind") == "text"]
            assert "한국" in texts and all("한국국" not in text for text in texts), texts
            second_window = call(url1, "window.open", desktop_id=desktop, app_id=definition["id"])["window"]["id"]
            with provider.lock:
                provider.late_item = True
            second_history = call(url1, "conversation.get", window_id=second_window)
            assert any(item["id"] == "4" for item in second_history["items"])
            def late_delivery():
                while not events.empty():
                    event = events.get_nowait()
                    update = event.get("update", {})
                    if update.get("kind") == "snapshot" and any(item["id"] == "4" for item in update["snapshot"]["items"]):
                        return event
                return None
            assert until("첫 창에 두 번째 창의 기록 이후 새 항목 전달", late_delivery, seconds=20)
            call(url1, "share.set", window_id=window, on=True)
            call(url1, "share.view", window_id=window, view={"text": "첫 줄\n둘째 줄", "visual": False,
                 "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}})
            upload = {"name": "note.txt", "mime": "text/plain", "data_base64": base64.b64encode(b"attachment").decode()}
            call(url1, "conversation.send", window_id=window, request_id="request-1", text="안녕", attachments=[upload])
            assert len(provider.posts) == 2 and provider.posts[0] == provider.posts[1], provider.posts
            assert provider.interventions == 1
            assert provider.posts[-1]["text"] == "안녕", provider.posts[-1]
            assert "새로 같이 봄" in provider.posts[-1]["context"] and "첫 줄" in provider.posts[-1]["context"]
            call(url1, "conversation.send", window_id=window, request_id="request-2", text="다시", attachments=[])
            assert provider.posts[-1]["text"] == "다시", provider.posts[-1]
            assert "그대로" in provider.posts[-1]["context"] and "첫 줄" not in provider.posts[-1]["context"]
            call(url1, "share.view", window_id=window, view={"text": "수정된 줄", "visual": False,
                 "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}})
            provider.fail_ids.add("failed-request")
            status, failure = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window,
                "request_id": "failed-request", "text": "실패", "attachments": []})
            assert status == 400 and failure["code"] == "server", failure
            call(url1, "conversation.send", window_id=window, request_id="request-3", text="다시", attachments=[])
            assert provider.posts[-1]["text"] == "다시", provider.posts[-1]
            assert "바뀜" in provider.posts[-1]["context"] and "수정된 줄" in provider.posts[-1]["context"]
            provider.fail_ids.add("failed-persist")
            status, failure = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window,
                "request_id": "failed-persist", "text": "실패한 초안", "attachments": [upload]})
            assert status == 400 and failure["code"] == "server", failure
            def saved_failed():
                for path in (root / "device-a" / "conversation-pending").glob("*.json"):
                    value = json.loads(path.read_text())
                    if value["request"]["request_id"] == "failed-persist":
                        return value
                return None
            failed = saved_failed()
            assert failed is not None and failed["user_text"] == "실패한 초안" and failed["user_uploads"] == [upload], failed
            assert failed["failed_reason"] == "failed", failed
            status, duplicate = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window,
                "request_id": "failed-persist", "text": "실패한 초안", "attachments": [upload]})
            assert status == 400 and duplicate["code"] == "conflict", duplicate
            first_process.terminate()
            first_process.wait(timeout=5)
            first_process = bridge("device-a", p1, True)
            until("실패 초안 복원 뒤 연결", lambda: call(url1, "state.get")["snapshot"]["link"]["state"] == "connected")
            events = queue.Queue()
            ready = threading.Event()
            threading.Thread(target=read_events, args=(url1, events, ready), daemon=True).start()
            assert ready.wait(5)
            call(url1, "conversation.get", window_id=window)
            restored = until("실패 초안 이벤트", lambda: (event if (not events.empty() and (event := events.get_nowait()).get("event") == "conversation.draft" and event["request_id"] == "failed-persist") else None))
            assert restored["failed"] is True and restored["text"] == "실패한 초안" and restored["attachments"] == [upload], restored
            call(url1, "conversation.send", window_id=window, request_id="after-failed", text="실패한 초안", attachments=[upload])
            assert saved_failed() is None, "새 요청 접수 후 실패한 초안이 남았다"
            call(url1, "share.set", window_id=window, on=True)
            call(url1, "share.view", window_id=window, view={"text": "수정된 줄", "visual": False,
                 "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}})
            provider.drop_before.add("unreceived")
            status, failure = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window,
                "request_id": "unreceived", "text": "다시 보낼 초안", "attachments": []})
            assert status == 400 and failure["code"] == "server", failure
            assert "unreceived" not in provider.receipts
            call(url1, "conversation.get", window_id=window)
            recovered = until("미접수 초안", lambda: (event if (not events.empty() and (event := events.get_nowait()).get("event") == "conversation.draft" and event["request_id"] == "unreceived") else None))
            assert recovered["text"] == "다시 보낼 초안" and recovered["failed"] is False
            call(url1, "share.view", window_id=window, view={"text": "다른 context", "visual": False,
                 "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}})
            original_posts = [post for post in provider.posts if post["request_id"] == "unreceived"]
            assert len(original_posts) == 1 and original_posts[0]["text"] == "다시 보낼 초안", original_posts
            original_context = original_posts[0]["context"]
            status, changed = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window,
                "request_id": "unreceived", "text": "다시 보낼 초안", "attachments": []})
            assert status == 400 and changed["code"] == "conflict", changed
            call(url1, "share.view", window_id=window, view={"text": "수정된 줄", "visual": False,
                 "bounds": {"x": 0, "y": 0, "width": 400, "height": 300}})
            call(url1, "conversation.send", window_id=window, request_id="unreceived", text="다시 보낼 초안", attachments=[])
            replay = [post for post in provider.posts if post["request_id"] == "unreceived"]
            assert len(replay) >= 2 and all(post == replay[0] for post in replay)
            assert replay[0]["context"] == original_context, replay
            attachment = call(url1, "conversation.attachment", window_id=window, item_id="1", attachment_id="asset-1")
            assert attachment["name"] == "note.txt" and base64.b64decode(attachment["data_base64"]) == b"attachment", attachment
            def interrupted_send():
                try:
                    call(url1, "conversation.send", window_id=window, request_id="restart-1", text="재시작", attachments=[upload])
                except Exception:
                    pass
            task = threading.Thread(target=interrupted_send)
            task.start()
            until("처리 중 영수증", lambda: provider.receipts.get("restart-1") == "pending", seconds=5)
            first_process.terminate()
            first_process.wait(timeout=5)
            task.join(timeout=5)
            assert list((root / "device-a" / "conversation-pending").glob("*.json"))
            first_process = bridge("device-a", p1, True)
            until("재시작 뒤 같은 요청 접수", lambda: provider.receipts.get("restart-1") == "accepted", seconds=20)
            replay = [p for p in provider.posts if p["request_id"] == "restart-1"]
            assert len(replay) == 2 and replay[0] == replay[1], replay
            assert replay[0]["text"] == "재시작" and "수정된 줄" in replay[0]["context"], replay
            assert provider.interventions == 6
            until("대기 파일 제거", lambda: not list((root / "device-a" / "conversation-pending").glob("*.json")))
            until("재시작한 코어 연결", lambda: call(url1, "state.get")["snapshot"]["link"]["state"] == "connected")
            first_binding = call(url1, "storage.get", window_id=window, entry="thread")["result"]["content"]
            created = call(url1, "workspace.create", name="기존 대화")
            workspace2, desktop2 = created["workspace"]["id"], created["desktop"]["id"]
            window2 = call(url1, "window.open", desktop_id=desktop2, app_id=definition["id"])["window"]["id"]
            until("새 작업 동기화", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?", (window2,)).fetchone()[0])
            old = {"connection": "conversation", "namespace": first_binding["namespace"], "external_key": workspace2,
                   "thread_id": "existing-thread", "created_at": "2026-10-30T00:00:00Z"}
            call(url1, "storage.write", window_id=window2, entry="thread", content=old, expected_revision=None)
            assert call(url1, "conversation.get", window_id=window2)["thread"]["id"] == "existing-thread"
            assert provider.adoptions[-1] == {"session_id": "existing-thread", "first_input_is_initial_instruction": True}
            provider.break_first = False
            provider.fail_ids.add("other-failed")
            status, _ = request(url1 + "/core", "POST", {"op": "conversation.send", "window_id": window2,
                "request_id": "other-failed", "text": "다른 대화", "attachments": []})
            assert status == 400
            def other_failed_exists():
                return any(json.loads(path.read_text())["request"]["request_id"] == "other-failed"
                           for path in (root / "device-a" / "conversation-pending").glob("*.json"))
            assert other_failed_exists()
            call(url1, "conversation.send", window_id=window, request_id="first-accepted", text="첫 작업", attachments=[])
            assert other_failed_exists(), "다른 대화의 실패 초안을 지웠다"
            call(url1, "conversation.send", window_id=window2, request_id="second-accepted", text="다른 대화", attachments=[])
            assert not other_failed_exists(), "같은 대화의 실패 초안이 남았다"
            with provider.lock:
                provider.bindings[(old["namespace"], workspace2)] = provider.thread(old["namespace"], workspace2, "different-thread")
            status, conflict = request(url1 + "/core", "POST", {"op": "conversation.get", "window_id": window2})
            assert status == 400 and conflict["code"] == "binding_conflict", conflict
            print("실제 코어와 가짜 제공자: 1 passed (로그인 필요, 빈 대화, 두 기기 ensure, 생성 직후 item, 다중 창 SSE·중복, 실패 초안 복원·정리, 단절·재시작 pending 재전송, 같이 보기, 첨부, adoption과 충돌)")
        except Exception:
            logs.flush()
            logs.seek(0)
            print(logs.read()[-6000:])
            raise
        finally:
            for child in reversed(children):
                if child.poll() is None: child.terminate()
            for child in reversed(children):
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
            logs.close()
            fake.shutdown()
            fake.server_close()


if __name__ == "__main__":
    run()
