"""실제 코어와 브라우저에서 process 프레임 리로드와 역압을 확인한다.

실행 전 cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge가 필요하다.
로컬 시험 쉘의 임시 서버와 기기를 사용한다.
"""
import base64
import functools
import hashlib
import importlib.util
import json
import os
import signal
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, sync_playwright
import psutil

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "ui/e2e/fixtures/process"
COMMON = Path(os.environ["AGENT_COMMON_FILES_DIR"])
module_path = COMMON / "skills/kaleidoscope-app/scripts/sandbox.py"
module_spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", module_path)
sandbox = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(sandbox)
sandbox.json.dumps = functools.partial(json.dumps, ensure_ascii=False)


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def values(page):
    items = page.get_by_test_id("app-window-process-fixture").locator(".ks-data-text").all_text_contents()
    if len(items) != 5:
        return None
    try:
        return {"status": items[0], "number": int(items[1]), "pid": items[2], "partial": int(items[3]), "error": items[4]}
    except ValueError:
        return None


def progress(path):
    try:
        return int(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return 0


def wait_script(page):
    frame = page.frame_locator(".ks-client-frames iframe").locator("body")
    wait_until(lambda: frame.evaluate("() => window.kaleidoscope?.inputs?.script?.value") == str(FIXTURE / "child.py"), 15, "클라이언트 입력이 갱신되지 않았습니다")


def stopped(pids):
    for pid in pids:
        try:
            if psutil.Process(pid).status() != psutil.STATUS_ZOMBIE:
                return False
        except psutil.NoSuchProcess:
            continue
    return True


def describe_processes(pids):
    for pid in pids:
        try:
            process = psutil.Process(pid)
            print(f"프로세스 pid={pid} status={process.status()} ppid={process.ppid()} pgid={os.getpgid(pid)} cmdline={process.cmdline()}", flush=True)
        except (psutil.NoSuchProcess, ProcessLookupError):
            print(f"프로세스 pid={pid} 종료됨", flush=True)


def geometry(page):
    return page.evaluate("""() => {
      const bounds = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      return { window: bounds('.ks-window'), overlay: bounds('.ks-window-consent-overlay'),
        dialog: bounds('.ks-window-consent-overlay .ks-dialog'), title: bounds('.ks-window-consent-overlay .ks-dialog-title'),
        command: bounds('.ks-window-consent-overlay .ks-process-command'), environment: bounds('.ks-window-consent-overlay .ks-process-env'),
        actions: bounds('.ks-window-consent-overlay .ks-dialog-actions'),
        cancel: bounds('.ks-window-consent-overlay .ks-dialog-actions button:first-child'),
        allow: bounds('.ks-window-consent-overlay .ks-dialog-confirm button') };
    }""")


def run():
    output = ROOT.parents[1] / ".local/tmp/card933/process"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ks-process-test-") as directory:
        folder = Path(directory) / "한글 작업 폴더"
        folder.mkdir()
        sb = sandbox.Sandbox(ROOT, output, folder)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            source = (FIXTURE / "client.js").read_bytes()
            asset = {"id": "process-fixture-client", "version": 1, "format": "javascript", "sha256": hashlib.sha256(source).hexdigest(), "source": "ui/e2e/fixtures/process/client.js", "license": "MIT", "data_base64": base64.b64encode(source).decode("ascii")}
            uploaded = sb.mcp.call("upload_asset", asset)
            assert not uploaded["is_error"], uploaded["text"]
            definition = json.loads((FIXTURE / "app.json").read_text(encoding="utf-8"))
            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                report = sb.upload_and_open(definition)
                assert report.get("window_id") and not report.get("pick_errors"), report
                sb.set_state(report["window_id"], {"command": sys.executable, "script": str(FIXTURE / "child.py")})
                page = sb.page
                wait_script(page)
                app = sb.window("process-fixture")
                app.get_by_role("button", name="실행").click()
                dialog = app.get_by_role("dialog")
                dialog.wait_for()
                page.screenshot(path=str(output / "permission-wide-light.png"))
                metrics = {"wide_light": geometry(page)}
                page.set_viewport_size({"width": 1920, "height": 1080})
                page.screenshot(path=str(output / "permission-xl-light.png"))
                page.set_viewport_size({"width": 1440, "height": 900})
                page.emulate_media(color_scheme="dark")
                page.screenshot(path=str(output / "permission-wide-dark.png"))
                page.set_viewport_size({"width": 520, "height": 680})
                sb.core({"op": "window.set_rect", "window_id": report["window_id"], "rect": {"x": 10, "y": 10, "width": 360, "height": 480}})
                page.wait_for_timeout(200)
                page.screenshot(path=str(output / "permission-narrow-dark.png"))
                metrics["narrow_dark"] = geometry(page)
                page.emulate_media(color_scheme="light")
                page.screenshot(path=str(output / "permission-narrow-light.png"))
                (output / "permission-metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
                page.set_viewport_size({"width": 1440, "height": 900})
                sb.core({"op": "window.set_rect", "window_id": report["window_id"], "rect": {"x": 12, "y": 12, "width": 1100, "height": 700}})
                dialog.get_by_role("button", name="취소").click()
                wait_until(lambda: values(page) and values(page)["status"] == "취소됨", 10, "취소 결과 없음")
                assert progress(folder / "progress.txt") == 0
                app.get_by_role("button", name="실행").click()
                app.get_by_role("dialog").get_by_role("button", name="허용").click()
                before = wait_until(lambda: (v if (v := values(page)) and v["number"] > 1000 and v["partial"] > 0 else None), 30, "부분 줄 체크포인트 없음")
                assert not before["error"], before
                running_pids = [int(value) for value in (folder / "pids.txt").read_text().split()]
                sb.core({"op":"window.minimize", "window_id":report["window_id"]})
                assert all(psutil.pid_exists(pid) and psutil.Process(pid).status() != psutil.STATUS_ZOMBIE for pid in running_pids), "최소화할 때 프로세스가 끝났습니다"
                sb.core({"op":"window.restore", "window_id":report["window_id"]})
                current = sb.snapshot()
                workspace = current["device"]["active_workspace_id"]
                original_desktop = current["device"]["active_desktop_ids"][workspace]
                other_desktop = sb.core({"op":"desktop.create", "workspace_id":workspace, "name":"다른 화면"})["desktop"]["id"]
                assert all(psutil.pid_exists(pid) and psutil.Process(pid).status() != psutil.STATUS_ZOMBIE for pid in running_pids), "다른 데스크톱을 열 때 프로세스가 끝났습니다"
                sb.core({"op":"desktop.activate", "desktop_id":original_desktop})
                other_window = sb.core({"op":"window.open", "desktop_id":original_desktop, "app_id":"md-editor", "rect":{"x":30,"y":30,"width":450,"height":500}})["window"]["id"]
                sb.core({"op":"window.close", "window_id":other_window})
                assert all(psutil.pid_exists(pid) and psutil.Process(pid).status() != psutil.STATUS_ZOMBIE for pid in running_pids), "다른 창을 조작할 때 프로세스가 끝났습니다"
                sb.core({"op":"desktop.delete", "desktop_id":other_desktop})
                before = wait_until(lambda: (v if (v := values(page)) and v["number"] > before["number"] and v["partial"] > 0 else None), 30, "복원 후 출력이 멈췄습니다")
                page.reload(wait_until="domcontentloaded")
                resumed = wait_until(lambda: (v if (v := values(page)) and v["number"] > before["number"] and v["pid"] else None), 30, "리로드 후 재연결 실패")
                assert resumed["pid"] == before["pid"] and not resumed["error"], (before, resumed)
                print(f"리로드: pid={before['pid']}, 줄={before['number']}→{resumed['number']}, 미완성={before['partial']}바이트", flush=True)
                (folder / "pause").touch()
                paused = wait_until(lambda: int((folder / "paused.txt").read_text()) if (folder / "paused.txt").exists() else None, 10, "출력 일시 정지 실패")
                wait_until(lambda: (v if (v := values(page)) and v["number"] >= paused - 1 else None), 15, "프레임이 이전 출력을 다 읽지 못했습니다")
                page.locator(".ks-client-frames iframe").evaluate("frame => frame.remove()")
                starting = paused
                (folder / "burst").touch()
                (folder / "pause").unlink()
                last = starting
                stable_since = time.monotonic()
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    current = progress(folder / "progress.txt")
                    if current != last:
                        last = current
                        stable_since = time.monotonic()
                    if current > starting and time.monotonic() - stable_since > 2:
                        break
                    time.sleep(0.2)
                written = sum(len(f"{before['pid']}|{number}|") + 181 for number in range(starting, last))
                print(f"프레임 부재 중 출력: {written}바이트, 줄={starting}→{last}", flush=True)
                assert written >= 8 * 1024 * 1024, {"start": starting, "end": last, "bytes": written}
                retry = app.get_by_role("button", name="다시 시작")
                retry.wait_for(timeout=30000)
                retry.click()
                restored = wait_until(lambda: (v if (v := values(page)) and v["number"] >= last and v["pid"] else None), 90, "ping 실패 뒤 재연결 실패")
                assert restored["pid"] == before["pid"] and not restored["error"], (before, restored)
                wait_until(lambda: progress(folder / "progress.txt") > last, 15, "재연결 뒤 자식 출력이 다시 시작되지 않았습니다")
                page.set_viewport_size({"width": 520, "height": 680})
                page.screenshot(path=str(output / "restored-narrow-light.png"))
                pids = [int(value) for value in (folder / "pids.txt").read_text().split()]
                app.get_by_role("button", name="창 닫기").click()
                try:
                    wait_until(lambda: stopped(pids), 15, "창을 닫은 뒤 프로세스 트리가 남았습니다")
                except AssertionError:
                    describe_processes(pids)
                    raise
                snapshot = sb.snapshot()
                workspace = snapshot["device"]["active_workspace_id"]
                desktop = snapshot["device"]["active_desktop_ids"][workspace]
                opened = sb.core({"op":"window.open", "desktop_id":desktop, "app_id":"process-fixture", "rect":{"x":10,"y":10,"width":450,"height":500}})["window"]
                sb.core({"op":"files.pick_folder", "window_id":opened["id"], "permission":"work"})
                sb.set_state(opened["id"], {"command":sys.executable, "script":str(FIXTURE / "child.py")})
                (folder / "pids.txt").unlink()
                wait_script(page)
                app.get_by_role("button", name="실행").click()
                new_pids = wait_until(lambda: [int(value) for value in (folder / "pids.txt").read_text().split()] if (folder / "pids.txt").exists() else None, 15, "두 번째 실행이 시작되지 않았습니다")
                assert not app.get_by_role("dialog").count(), "같은 실행 명세를 다시 물었습니다"
                os.kill(sb.procs[1].pid, signal.SIGINT)
                sb.procs[1].wait(timeout=20)
                wait_until(lambda: stopped(new_pids), 15, "쉘을 종료한 뒤 프로세스 트리가 남았습니다")
                print("5 passed: 허용 취소, 페이지 리로드, ping 실패와 8MiB 역압, 창 닫기, 쉘 종료", flush=True)
                browser.close()
                browser = None
        finally:
            if browser:
                try:
                    browser.close()
                except PlaywrightError:
                    pass
            try:
                if len(sb.procs) > 1 and sb.procs[1].poll() is None:
                    os.kill(sb.procs[1].pid, signal.SIGINT)
                    sb.procs[1].wait(timeout=20)
            finally:
                sb.stop()


if __name__ == "__main__":
    run()
