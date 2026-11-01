"""워커가 선언된 다른 앱의 동작과 저장 항목을 호출한다."""
import json
import os
import urllib.error
import urllib.request


def _request(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        os.environ["KALEIDOSCOPE_WORKER_API_URL"], data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["KALEIDOSCOPE_WORKER_TOKEN"]},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)["result"]
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode("utf-8", errors="replace")) from error


def call_app(app_id, action, args=None, workspace_id=None):
    return _request({"kind": "call", "app_id": app_id, "action": action, "args": args, "workspace_id": workspace_id})


def read_app_storage(app_id, entry_id, workspace_id=None):
    return _request({"kind": "read", "app_id": app_id, "entry_id": entry_id, "workspace_id": workspace_id})
