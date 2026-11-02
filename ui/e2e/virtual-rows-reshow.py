"""실코어 쉘 회귀 시험. cargo build -p kaleidoscope-devbridge 후 python3로 실행한다.

Python Playwright가 설치된 환경에서 실행하며 1420, 1431 포트를 사용한다.
쉘을 직접 조작해 숨김/복원 뒤 읽던 행과 위치가 유지되는지 확인한다.
"""
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.request

import psutil
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]


def command(**data):
    request = urllib.request.Request(
        "http://127.0.0.1:1431/core", data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def ready(processes):
    for _ in range(100):
        assert all(process.poll() is None for process in processes), "시험 서버가 종료됨"
        try:
            with urllib.request.urlopen("http://localhost:1420/", timeout=1):
                pass
            return command(op="state.get")["snapshot"]
        except (OSError, ValueError):
            time.sleep(.2)
    raise AssertionError("시험 서버 시작 시간 초과")


def reading(locator):
    return locator.evaluate("""element => {
      const bounds = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll('[data-index]')];
      const first = rows.find(row => row.getBoundingClientRect().bottom > bounds.top + 2);
      return {top: element.scrollTop, height: element.scrollHeight,
        row: first?.getAttribute('data-index'), text: first?.textContent};
    }""")


def run(directory):
    items = [{"key": str(i), "path": f"folder/항목{i:03}", "title": f"항목{i:03}"} for i in range(100)]
    entries = [{"key": str(i), "name": "기록", "body": f"내용 {i}"} for i in range(100)]
    definition = {
        "id": "virtual-reshow-test", "name": "가상 보기 시험",
        "requires": {"blocks": 12, "modules": {}}, "permissions": [],
        "state": {"items": items, "entries": entries},
        "ui": {"type": "split", "direction": "row", "sizes": [33, 33, 34], "children": [
            {"type": "tree", "by": "path", "items": {"state": "items"}},
            {"type": "list", "items": [{"key": "a", "title": "하나"}, {"key": "b", "title": "둘"}]},
            {"type": "feed", "entries": {"state": "entries"}},
        ]},
    }
    seed = directory / "seed.json"
    seed.write_text(json.dumps(definition, ensure_ascii=False))
    processes = []
    try:
        commands = [
            [str(ROOT / "target/debug/kaleidoscope-devbridge"), "--data-dir", str(directory / "data"),
             "--port", "1431", "--seed", str(seed)],
            ["node", str(ROOT / "app/node_modules/vite/bin/vite.js"), "--host", "localhost"],
        ]
        for args in commands:
            log = (directory / f"server-{len(processes)}.log").open("w")
            processes.append(subprocess.Popen(args, cwd=ROOT / "app", stdout=log, stderr=subprocess.STDOUT))
        snapshot = ready(processes)
        desktop = snapshot["shared"]["desktops"][0]
        window = command(op="window.open", desktop_id=desktop["id"], app_id=definition["id"],
                         rect={"x": 0, "y": 0, "width": 1100, "height": 700})["window"]
        command(op="desktop.create", workspace_id=desktop["workspace_id"], name="다른 화면")
        command(op="desktop.activate", desktop_id=desktop["id"])
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto("http://localhost:1420/?core=http://127.0.0.1:1431")
            tree, feed = page.get_by_role("tree"), page.get_by_role("feed")
            tree.get_by_role("treeitem").first.click()
            page.wait_for_timeout(500)
            for kind in ["desktop", "minimize", "hidden", "shrink"]:
                for view in [tree, feed]:
                    view.evaluate("element => { element.scrollTop = 720; }")
                page.wait_for_timeout(400)
                before = [reading(view) for view in [tree, feed]]
                page.screenshot(path=str(directory / f"{kind}-before.png"))
                if kind in ["desktop", "shrink"]:
                    page.get_by_role("button", name="다른 화면", exact=True).click()
                elif kind == "minimize":
                    page.get_by_role("button", name="창 최소화", exact=True).click()
                else:
                    # keep_mounted 탭과 같은 hidden DOM 경계. 탭 구현 자체는 시험하지 않는다.
                    page.locator(".ks-window-content").evaluate("element => { element.hidden = true; }")
                page.wait_for_timeout(400)
                if kind == "shrink":
                    command(op="window.set_state", window_id=window["id"],
                            state={"items": items[:8], "entries": entries[:8]})
                if kind in ["desktop", "shrink"]:
                    page.get_by_role("button", name=desktop["name"], exact=True).click()
                elif kind == "minimize":
                    page.locator(".ks-taskbar-item").filter(has_text="가상 보기 시험").click()
                else:
                    page.locator(".ks-window-content").evaluate("element => { element.hidden = false; }")
                page.wait_for_timeout(800)
                after = [reading(view) for view in [tree, feed]]
                page.screenshot(path=str(directory / f"{kind}-after.png"))
                print(kind, json.dumps({"before": before, "after": after}, ensure_ascii=False), flush=True)
                for old, new in zip(before, after):
                    if kind == "shrink":
                        assert new["top"] == 0 and new["row"] == "0", new
                    else:
                        assert old == new, (kind, old, new)
                assert page.get_by_role("listbox").inner_text() == "하나\n둘"
            browser.close()
        print("4 passed: desktop, minimize, hidden, shrink", flush=True)
    finally:
        for process in reversed(processes):
            try:
                parent = psutil.Process(process.pid)
                for child in parent.children(recursive=True):
                    child.terminate()
                parent.terminate()
            except psutil.NoSuchProcess:
                pass
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        output = pathlib.Path(sys.argv[1]).resolve()
        output.mkdir(parents=True, exist_ok=True)
        run(output)
    else:
        with tempfile.TemporaryDirectory(prefix="ks-virtual-reshow-") as temporary:
            run(pathlib.Path(temporary))
