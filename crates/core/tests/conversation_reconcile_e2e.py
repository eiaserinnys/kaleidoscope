"""임시 서버와 실제 코어 둘에서 설정과 작업의 제공자 정합화를 확인한다."""
import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from conversation_e2e import Provider, serve
from storage_e2e import BIN, ROOT, call, port, request, until


def run():
    provider = Provider()
    fake = serve(provider)
    fake_url = f"http://127.0.0.1:{fake.server_port}"
    children = []
    with tempfile.TemporaryDirectory(prefix="ks-reconcile-test-") as temporary:
        root = Path(temporary)
        db = root / "empty-test.db"
        server_port, p1, p2 = port(), port(), port()
        server_url = f"http://127.0.0.1:{server_port}"
        urls = [f"http://127.0.0.1:{p1}", f"http://127.0.0.1:{p2}"]
        env = os.environ.copy()
        env.update(KALEIDOSCOPE_BIND=f"127.0.0.1:{server_port}", KALEIDOSCOPE_DB_PATH=str(db), KALEIDOSCOPE_MCP_TOKEN="test-mcp")
        logs = (root / "services.log").open("w+")
        try:
            children.append(subprocess.Popen([str(BIN / "kaleidoscope-orchestrator")], env=env, stdout=logs, stderr=logs))
            until("임시 서버", lambda: request(server_url + "/api/health")[0] == 200)
            with sqlite3.connect(db) as conn:
                account = conn.execute("SELECT account_id FROM mcp_principal WHERE id=1").fetchone()[0]
                conn.execute("INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", (account, "conversation", "oauth", fake_url, 1, "[]", "{}", "", "now"))
                for name in ("device-a", "device-b"):
                    conn.execute("INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?,?,?,?,?)", (name, name, account, hashlib.sha256(("test-" + name).encode()).hexdigest(), "now"))
            definition = json.loads((ROOT / "examples/workspace-pas-v2.json").read_text())
            next(e for e in definition["storage"]["entries"] if e["id"] == "selected_model")["key"] = "workspaces/{workspace_id}/model"
            status, response = request(server_url + "/api/device/apps", "POST", {"definition_json": json.dumps(definition, ensure_ascii=False)}, "test-device-a")
            assert status == 200, response

            def bridge(name, number, logged_in):
                data = root / name
                data.mkdir(exist_ok=True)
                (data / "link.json").write_text(json.dumps({"format": 1, "server_url": server_url, "device_id": name, "device_name": name, "token": "test-" + name}))
                login = data / "logins.json"
                if logged_in:
                    login.write_text(json.dumps({"conversation": {"issuer": fake_url, "access_token": "local-test-token"}}))
                elif login.exists():
                    login.unlink()
                process = subprocess.Popen([str(BIN / "kaleidoscope-devbridge"), "--data-dir", str(data), "--port", str(number), "--server", server_url, "--device-name", name], env=env, stdout=logs, stderr=logs)
                children.append(process)
                return process

            first_process = bridge("device-a", p1, True)
            first = until("첫 기기 연결", lambda: (s if (s := call(urls[0], "state.get")["snapshot"])["link"]["state"] == "connected" and s["shared"]["apps"] else None))
            desktop = first["shared"]["desktops"][0]["id"]
            workspace = first["shared"]["desktops"][0]["workspace_id"]
            window = call(urls[0], "window.open", desktop_id=desktop, app_id=definition["id"])["window"]["id"]
            until("배치 업로드", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?", (window,)).fetchone()[0])
            thread1 = call(urls[0], "conversation.create", window_id=window, model="model-argon")["thread"]["id"]
            created = call(urls[0], "workspace.create", name="둘째 작업")
            workspace2, desktop2 = created["workspace"]["id"], created["desktop"]["id"]
            window2 = call(urls[0], "window.open", desktop_id=desktop2, app_id=definition["id"])["window"]["id"]
            until("둘째 작업 업로드", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?", (window2,)).fetchone()[0])
            thread2 = call(urls[0], "conversation.create", window_id=window2, model="model-argon")["thread"]["id"]
            first_process.terminate(); first_process.wait(timeout=5)
            first_process = bridge("device-a", p1, False)
            until("로그인 없는 기기 연결", lambda: call(urls[0], "state.get")["snapshot"]["link"]["state"] == "connected")
            with provider.lock: provider.patches.clear()
            call(urls[0], "storage.write", window_id=window, entry="role", content="역할 {workspace.name}", expected_revision=None)
            status = until("미적용 상태", lambda: (s if (s := call(urls[0], "conversation.apply_status", window_id=window))["status"] == "unapplied" else None))
            assert status["status"] == "unapplied"
            with provider.lock: assert not provider.patches, provider.patches
            first_process.terminate(); first_process.wait(timeout=5)
            first_process = bridge("device-a", p1, True)
            bridge("device-b", p2, False)
            until("역할 두 작업 적용", lambda: all(any(i == t and b.get("instructions") == text for i, b in provider.patches) for t, text in [(thread1, "역할 작업 1"), (thread2, "역할 둘째 작업")]), seconds=30)
            until("둘째 기기 동기화", lambda: any(w["id"] == window2 for w in call(urls[1], "state.get")["snapshot"]["shared"]["windows"]))
            until("적용 완료 상태", lambda: call(urls[0], "conversation.apply_status", window_id=window)["status"] == "applied")
            time.sleep(1.5)
            with provider.lock: before_moves = provider.pages
            for x in (80, 100, 120):
                call(urls[0], "window.set_rect", window_id=window, rect={"x": x, "y": 40, "width": 600, "height": 400})
            until("창 위치 원격 반영", lambda: next((w for w in call(urls[1], "state.get")["snapshot"]["shared"]["windows"] if w["id"] == window and w["rect"]["x"] == 120), None))
            time.sleep(1.5)
            with provider.lock: assert provider.pages == before_moves, f"창 이동에 제공자 목록 {provider.pages - before_moves}회 조회"
            extra = call(urls[0], "desktop.create", workspace_id=workspace, name="빈 화면")["desktop"]["id"]
            until("데스크톱 원격 반영", lambda: any(d["id"] == extra for d in call(urls[1], "state.get")["snapshot"]["shared"]["desktops"]))
            call(urls[0], "desktop.rename", desktop_id=extra, name="이름 변경")
            call(urls[0], "desktop.delete", desktop_id=extra)
            until("데스크톱 삭제 원격 반영", lambda: not any(d["id"] == extra for d in call(urls[1], "state.get")["snapshot"]["shared"]["desktops"]))
            time.sleep(1.5)
            with provider.lock: assert provider.pages == before_moves, f"데스크톱 변경에 제공자 목록 {provider.pages - before_moves}회 조회"
            with provider.lock: patch_count_before_selected_model = len(provider.patches)
            call(urls[1], "storage.write", window_id=window2, entry="selected_model", content="model-sol", expected_revision=None)
            time.sleep(1.5)
            with provider.lock:
                assert len(provider.patches) == patch_count_before_selected_model, provider.patches
                assert all("model" not in body for _, body in provider.patches), provider.patches
            assert call(urls[0], "conversation.apply_status", window_id=window)["status"] == "applied"
            call(urls[1], "workspace.rename", workspace_id=workspace2, name="바뀐 작업")
            until("다른 기기 이름 반영", lambda: any(i == thread2 and b.get("title") == "작업 PAS · 바뀐 작업" for i, b in provider.patches))
            assert any(offset > 0 for offset in provider.cursors), "제공자 목록의 다음 페이지를 읽지 않았다"
            desktop_extra = call(urls[0], "desktop.create", workspace_id=workspace2, name="임시 데스크톱")["desktop"]["id"]
            call(urls[0], "desktop.delete", desktop_id=desktop_extra)
            until("데스크톱 삭제 동기화", lambda: not any(d["id"] == desktop_extra for d in call(urls[1], "state.get")["snapshot"]["shared"]["desktops"]))
            assert not provider.bindings[next(k for k in provider.bindings if k[1] == workspace2)]["archived"]
            call(urls[0], "window.close", window_id=window2)
            call(urls[1], "workspace.delete", workspace_id=workspace2)
            until("작업 삭제 반영", lambda: provider.bindings[next(k for k in provider.bindings if k[1] == workspace2)]["archived"], seconds=30)
            assert not provider.bindings[next(k for k in provider.bindings if k[1] == workspace)]["archived"]
            third = call(urls[0], "workspace.create", name="MCP 삭제")
            workspace3, desktop3 = third["workspace"]["id"], third["desktop"]["id"]
            window3 = call(urls[0], "window.open", desktop_id=desktop3, app_id=definition["id"])["window"]["id"]
            until("셋째 작업 업로드", lambda: sqlite3.connect(db).execute("SELECT count(*) FROM windows WHERE id=?", (window3,)).fetchone()[0])
            call(urls[0], "conversation.create", window_id=window3, model="model-argon")
            call(urls[0], "window.close", window_id=window3)
            call(urls[0], "window.close", window_id=window)
            until("모든 앱 창 닫힘", lambda: not call(urls[1], "state.get")["snapshot"]["shared"]["windows"])
            assert not provider.bindings[next(k for k in provider.bindings if k[1] == workspace3)]["archived"]
            headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Authorization": "Bearer test-mcp"}
            def mcp(payload, session=None):
                if session: headers["Mcp-Session-Id"] = session
                req = urllib.request.Request(server_url + "/mcp", data=json.dumps(payload, ensure_ascii=False).encode(), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=10) as response:
                    body = response.read().decode()
                    if "text/event-stream" in response.headers.get("Content-Type", ""):
                        body = next(line[5:].strip() for line in body.splitlines() if line.startswith("data:"))
                    return response.headers.get("Mcp-Session-Id"), json.loads(body or "{}")
            session, _ = mcp({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}})
            _, result = mcp({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "delete_workspace", "arguments": {"workspace_id": workspace3}}}, session)
            assert not result.get("error") and not result.get("result", {}).get("isError"), result
            until("MCP 삭제 반영", lambda: provider.bindings[next(k for k in provider.bindings if k[1] == workspace3)]["archived"], seconds=30)
            print("실제 코어 두 기기와 가짜 제공자 정합화: 1 passed")
        except Exception:
            logs.flush(); logs.seek(0); print(logs.read()[-6000:])
            raise
        finally:
            for child in reversed(children):
                if child.poll() is None: child.terminate()
            for child in reversed(children):
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill(); child.wait()
            logs.close(); fake.shutdown(); fake.server_close()


if __name__ == "__main__":
    run()
