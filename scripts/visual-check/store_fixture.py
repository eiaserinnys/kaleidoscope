"""앱스토어 화면 검증용 가짜 스토어 서버와 표본 앱 정의.

운영 꼴 이름과 긴 주소를 쓰되, 실제 스토어에는 닿지 않도록 127.0.0.1의 임의 포트에서
`/appstore-eias/stores/stable`, `/appstore-nine-lives/stores/private` 두 갈래를 연다.
사설 주소는 쉘의 스토어 전송이 HTTPS 공개 주소만 그냥 받으므로, 화면 설정에서 주소를
넣고 「연결 허용」 동의를 거쳐야 읽힌다. 초대코드는 두 갈래 모두 같은 값을 쓴다.

스토어 파일 꼴은 crates/core/src/store/fetch.rs의 version 1 색인, 상세, manifest와 같다.
manifest의 files는 `apps/{id}/{release}/app.json` 하나뿐이고, 정의의 requires와
permissions는 manifest 값과 그대로 같아야 한다.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INVITE = "dev-invite"
STORE_A_PREFIX = "appstore-eias/stores/stable"
STORE_B_PREFIX = "appstore-nine-lives/stores/private"
PUBLISHED_AT = "2026-11-01T09:00:00Z"
REQUIRES = {"blocks": 19, "modules": {}}


def definition(app_id: str, name: str, text: str) -> dict:
    return {
        "id": app_id,
        "name": name,
        "requires": {"blocks": REQUIRES["blocks"], "modules": {}},
        "permissions": [],
        "ui": {"type": "text", "value": text},
    }


LONG_ID = "quarterly-planning-and-decisions-archive-2026-autumn"
LONG_NAME = "분기 계획과 결정과 후속 일을 한자리에 모아 두는 아주 긴 회의 기록 노트"
FILLER_CATEGORIES = ("업무", "그림", "읽기")
FILLER_APPS = [
    {"id": f"sample-app-{index:02d}", "name": f"표본 앱 {index:02d}", "release": 1,
     "category": FILLER_CATEGORIES[index % len(FILLER_CATEGORIES)], "publisher": "디렉터",
     "summary": f"표본 {index:02d}번 앱의 한 줄 설명입니다.",
     "description": f"목록이 길 때의 스크롤과 검색을 보려고 둔 표본 {index:02d}번 앱입니다."}
    for index in range(1, 31)
]

APPS_A = [
    {"id": "meeting-cards", "name": "회의 카드", "release": 1, "category": "업무", "publisher": "디렉터",
     "summary": "회의 안건과 결정을 한 창에 모읍니다.",
     "description": "회의마다 안건, 결정, 맡은 사람을 카드로 남깁니다. 끝난 회의는 접어 둡니다."},
    {"id": "sketch-notes", "name": "스케치 노트", "release": 1, "category": "그림", "publisher": "디렉터",
     "summary": "떠오른 그림과 메모를 모읍니다.",
     "description": "손으로 그린 그림과 짧은 메모를 한 자리에 놓고 봅니다."},
    {"id": LONG_ID, "name": LONG_NAME, "release": 1, "category": "업무", "publisher": "디렉터",
     "summary": "긴 이름과 긴 id로 좁은 창의 배치를 확인합니다.",
     "description": "긴 이름과 긴 id가 좁은 창에서도 넘치지 않는지 보는 표본입니다."},
    *FILLER_APPS,
]
APPS_B = [
    {"id": "meeting-cards", "name": "회의 카드 (팀)", "release": 2, "category": "업무", "publisher": "라인게임즈",
     "summary": "팀 회의록을 함께 봅니다.",
     "description": "팀이 같은 회의록을 보며 결정과 후속 일을 맞춥니다."},
    {"id": "read-later", "name": "나중에 읽기", "release": 1, "category": "읽기", "publisher": "라인게임즈",
     "summary": "나중에 읽을 글을 모아 둡니다.",
     "description": "주소와 한 줄 메모를 모아 두고 시간이 날 때 하나씩 엽니다."},
    {"id": LONG_ID, "name": LONG_NAME, "release": 1, "category": "업무", "publisher": "라인게임즈",
     "summary": "긴 이름과 긴 id로 좁은 창의 배치를 확인합니다.",
     "description": "긴 이름과 긴 id가 좁은 창에서도 넘치지 않는지 보는 표본입니다."},
]

CUSTOM_MEETING = "회의 카드 (내 판)"
CUSTOM_READING = "읽기 기록 (내 판)"
CUSTOM_SKETCH = "스케치 노트 (내 판)"
CUSTOM_DIARY = "일기 노트 (내 판)"
CUSTOM_MEETING_MODIFIED = "회의 카드 (고친 판)"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store_files(prefix: str, apps: list[dict]) -> dict[str, bytes]:
    """요청 경로(`/prefix/...`)마다 돌려줄 바이트."""
    files: dict[str, bytes] = {}
    items = []
    for app in apps:
        app_id, release = app["id"], app["release"]
        app_json = json.dumps(definition(app_id, app["name"], f"{app['name']} 앱입니다."),
                              ensure_ascii=False, indent=2).encode()
        release_prefix = f"apps/{app_id}/{release}/"
        manifest = {
            "format": 1,
            "store_app_id": app_id,
            "release": release,
            "name": app["name"],
            "summary": app["summary"],
            "description": app["description"],
            "category": app["category"],
            "publisher": app["publisher"],
            "published_at": PUBLISHED_AT,
            "icon": None,
            "screenshots": [],
            "requires": {"blocks": REQUIRES["blocks"], "modules": {}},
            "permissions": [],
            "badges": [],
            "files": {
                f"{release_prefix}app.json": {
                    "sha256": _sha256(app_json),
                    "bytes": len(app_json),
                    "format": None,
                    "source": None,
                    "license": None,
                },
            },
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode()
        detail = {
            "format": 1,
            "id": app_id,
            "name": app["name"],
            "summary": app["summary"],
            "description": app["description"],
            "category": app["category"],
            "publisher": app["publisher"],
            "release": release,
            "icon": None,
            "screenshots": [],
            "releases": [{"release": release, "published_at": PUBLISHED_AT,
                          "manifest": f"{release_prefix}manifest.json"}],
        }
        files[f"/{prefix}/{release_prefix}app.json"] = app_json
        files[f"/{prefix}/{release_prefix}manifest.json"] = manifest_bytes
        files[f"/{prefix}/apps/{app_id}/index.json"] = json.dumps(detail, ensure_ascii=False).encode()
        items.append({
            "id": app_id,
            "name": app["name"],
            "summary": app["summary"],
            "category": app["category"],
            "publisher": app["publisher"],
            "release": release,
            "icon": None,
            "badges": [],
            "requires": {"blocks": REQUIRES["blocks"], "modules": {}},
            "updated_at": PUBLISHED_AT,
        })
    index = {"format": 1, "generated_at": PUBLISHED_AT, "items": items}
    files[f"/{prefix}/index.json"] = json.dumps(index, ensure_ascii=False).encode()
    return files


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler 규약
        store = self.server.store
        store.requests.append((time.monotonic(), self.path, self.headers.get("x-kaleidoscope-invite")))
        if store.delay:
            time.sleep(store.delay)
        if self.headers.get("x-kaleidoscope-invite") != store.invite:
            self.send_response(401)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if store.fail or any(self.path.endswith(f"/apps/{app_id}/index.json")
                             for app_id in store.fail_apps):
            self.send_response(503)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = store.files.get(self.path)
        if body is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - 상위 규약
        pass


class FakeStore:
    def __init__(self, prefix: str, apps: list[dict], invite: str = INVITE):
        self.prefix = prefix
        self.invite = invite
        self.files = store_files(prefix, apps)
        self.delay = 0.0
        self.fail = False
        # 앱 상세(index.json)만 실패시킨다. 목록은 살아 있어야 전환 후보를 고를 수 있다.
        self.fail_apps: set[str] = set()
        self.requests: list[tuple[float, str, str | None]] = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.server.store = self
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}/{self.prefix}"

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def log(self) -> list[dict]:
        return [{"at": round(at, 3), "path": path, "invite": invite} for at, path, invite in self.requests]
