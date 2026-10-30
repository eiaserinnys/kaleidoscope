"""로컬 임시 서버와 코어 두 기기의 저장소 계약을 확인한다.

먼저 cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge를 실행한다.
"""
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
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BIN = ROOT / "target" / "debug"


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(url, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def until(description, predicate, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.1)
    raise AssertionError("시간 초과: " + description)


def call(url, op, **arguments):
    status, body = request(url + "/core", "POST", {"op": op, **arguments})
    if status != 200:
        raise AssertionError((op, status, body))
    return body


def read_events(url, events, ready):
    try:
        with urllib.request.urlopen(url + "/events", timeout=30) as stream:
            ready.set()
            for line in stream:
                if line.startswith(b"data: "):
                    events.put(json.loads(line[6:]))
    except OSError:
        pass


def run():
    children = []
    with tempfile.TemporaryDirectory(prefix="ks-storage-test-") as temporary:
        root = Path(temporary)
        db = root / "empty-test.db"
        assert not db.exists()
        files = root / "files"
        files.mkdir()
        (files / "one.json").write_text('{"title":"One"}')
        (files / "two.json").write_text('{"title":"Two"}')
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
                assert conn.execute("SELECT count(*) FROM devices").fetchone()[0] == 0
                account = conn.execute("SELECT account_id FROM mcp_principal WHERE id=1").fetchone()[0]
                for name in ("device-a", "device-b"):
                    token = "test-" + name
                    conn.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?,?,?,?,?)", (name, name, account, hashlib.sha256(token.encode()).hexdigest(), "now"))
            definition = {
                "id":"storage-e2e", "name":"Storage E2E", "requires":{"blocks":6,"modules":{"files":1,"storage":1}},
                "permissions":[{"module":"files","id":"docs","access":"read","label":"문서"}], "state":{"seen":None},
                "storage":{"entries":[{"id":"path","key":"workspaces/{workspace_id}/path","kind":"json","schema":{"type":"string"},"default":"one.json","label":"경로","presentation":"hidden"}]},
                "sources":{"file":{"kind":"file","permission":"docs","path":{"expr":"$storage.path"}}},
                "ui":{"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$storage.path"}},{"type":"text","value":{"expr":"$data.file.title"}},{"type":"button","label":"저장","on_click":[{"set_storage":{"entry":"path","value":"two.json"}},{"set_state":"seen","value":{"expr":"$storage.path"}}]}]}}
            status, body = request(server_url + "/api/device/apps", "POST", {"definition_json":json.dumps(definition,ensure_ascii=False)}, "test-device-a")
            assert status == 200, body
            def start_bridge(name, number):
                data_dir = root / name
                data_dir.mkdir()
                (data_dir / "link.json").write_text(json.dumps({"format":1,"server_url":server_url,"device_id":name,"device_name":name,"token":"test-"+name}))
                bridge_env = env.copy()
                bridge_env["KALEIDOSCOPE_DEV_PICK"] = str(files)
                children.append(subprocess.Popen([str(BIN / "kaleidoscope-devbridge"),"--data-dir",str(data_dir),"--port",str(number),"--server",server_url,"--device-name",name], env=bridge_env, stdout=logs, stderr=logs))
            start_bridge("device-a", p1)
            first = until("첫 코어 연결", lambda: (s if (s := call(url1,"state.get")["snapshot"])["link"]["state"] == "connected" and any(a["id"] == "storage-e2e" for a in s["shared"]["apps"]) else None))
            desktop = first["shared"]["desktops"][0]["id"]
            workspace = first["shared"]["desktops"][0]["workspace_id"]
            window = call(url1,"window.open", desktop_id=desktop, app_id="storage-e2e")["window"]["id"]
            until("첫 창의 서버 동기화", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?",(window,)).fetchone()[0])
            call(url1,"files.pick_folder",window_id=window,permission="docs")
            start_bridge("device-b", p2)
            until("둘째 코어에 같은 창", lambda: any(w["id"] == window for w in call(url2,"state.get")["snapshot"]["shared"]["windows"]))
            call(url2,"files.pick_folder",window_id=window,permission="docs")
            events = queue.Queue()
            ready = threading.Event()
            threading.Thread(target=read_events,args=(url2,events,ready),daemon=True).start()
            assert ready.wait(5), "이벤트 연결 실패"
            first_read = call(url1,"storage.get",window_id=window,entry="path")["result"]
            assert first_read["content"] == "one.json" and not first_read["exists"] and first_read["revision"] is None, first_read
            created = call(url1,"storage.write",window_id=window,entry="path",content="two.json",expected_revision=None)["revision"]
            status, conflict = request(url1+"/core","POST",{"op":"storage.write","window_id":window,"entry":"path","content":"one.json","expected_revision":None})
            assert status == 400 and conflict["code"] == "conflict" and f"current_revision={created}" in conflict["details"], conflict
            assert call(url1,"storage.reset",window_id=window,entry="path",expected_revision=created)["revision"] is None
            def data_value(url, index):
                view = call(url,"data.attach",window_id=window)["view"]
                return view["values"].get(f"/ui/children/{index}/value",{}).get("value")
            until("기본값 및 원천 읽기", lambda: data_value(url1, 1) == "One" and data_value(url2, 1) == "One")
            call(url1,"data.act",window_id=window,pointer="/ui/children/2/on_click",event=None,item=None)
            assert call(url1,"state.get")["snapshot"]["shared"]["windows"][0]["state"]["seen"] == "two.json"
            until("둘째 기기 원격 반영", lambda: data_value(url2,0) == "two.json" and data_value(url2,1) == "Two")
            seen = []
            while not events.empty(): seen.append(events.get_nowait())
            assert any(e.get("event") == "storage.update" and e.get("window_id") == window for e in seen), seen
            assert any(e.get("event") == "data.update" and e.get("window_id") == window for e in seen), seen
            assert workspace == first["device"]["active_workspace_id"]
            print("실제 서버 + 실제 코어 두 기기: 1 passed (기본값, CAS, 충돌, reset, 동작 순서, 원격 이벤트와 원천 재계획)")
        except Exception:
            logs.flush(); logs.seek(0)
            print(logs.read()[-5000:])
            raise
        finally:
            for child in reversed(children): child.terminate()
            for child in reversed(children):
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
            logs.close()


if __name__ == "__main__":
    run()
