"""실제 코어와 쉘에서 앱 설정 트리, 창 제목, 저장소 자동 폼을 확인하고 캡처한다."""
import base64
import functools
import hashlib
import importlib.util
import json
import os
import re
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "ui/e2e/fixtures/settings-tree"
OUTPUT = Path("/home/eias/workspace/.local/tmp/card933/blocks-e2")
COMMON = Path(os.environ["AGENT_COMMON_FILES_DIR"])
module_path = COMMON / "skills/kaleidoscope-app/scripts/sandbox.py"
module_spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", module_path)
sandbox = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(sandbox)
json_dumps = json.dumps
sandbox.json.dumps = functools.partial(json_dumps, ensure_ascii=False)


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def save(page, name):
    path = OUTPUT / name
    page.screenshot(path=str(path))
    print(f"capture {path}", flush=True)


def counter(locator, selector):
    values = locator.locator(selector).locator(".ks-data-text").all_text_contents()
    numbers = [int(value.strip()) for value in values if re.fullmatch(r"\d+", value.strip())]
    return max(numbers) if numbers else None


def set_rect(sb, window_id, width, height):
    result = sb.core({"op": "window.set_rect", "window_id": window_id,
                      "rect": {"x": 20, "y": 20, "width": width, "height": height}})
    if "error" in result:
        raise AssertionError(result["error"])


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ks-settings-tree-") as directory:
        sb = sandbox.Sandbox(ROOT, OUTPUT, Path(directory) / "folder")
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(ROOT / "target/debug" / Path(command[0]).name)
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        result = {"assertions": [], "captures": []}
        try:
            sb.start()
            source = (FIXTURE / "client.js").read_bytes()
            uploaded = sb.mcp.call("upload_asset", {
                "id": "settings-tree-client", "version": 1, "format": "javascript",
                "sha256": hashlib.sha256(source).hexdigest(),
                "source": "ui/e2e/fixtures/settings-tree/client.js", "license": "MIT",
                "data_base64": base64.b64encode(source).decode("ascii"),
            })
            assert not uploaded["is_error"], uploaded["text"]

            definition = json.loads((FIXTURE / "app.json").read_text(encoding="utf-8"))
            report = sb.upload_and_open(definition)
            assert report.get("window_id") and report.get("upload_ok"), report
            window_id = report["window_id"]

            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                page = sb.page
                app = sb.window(definition["id"])
                wait_until(lambda: counter(app, ".ks-data-window-body") is not None, 20, "본문 client 출력이 없습니다")
                wait_until(lambda: app.get_by_role("button", name="앱 설정").is_visible(), 20, "설정 버튼이 보이지 않습니다")
                set_rect(sb, window_id, 900, 650)
                page.wait_for_timeout(300)
                save(page, "12-chat--wide.png")

                set_rect(sb, window_id, 360, 240)
                page.wait_for_timeout(300)
                save(page, "12-chat--narrow.png")
                set_rect(sb, window_id, 900, 650)
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(100)
                save(page, "12-chat--wide--dark.png")
                page.emulate_media(color_scheme="light")
                set_rect(sb, window_id, 900, 650)

                gear = app.get_by_role("button", name="앱 설정")
                gear.click()
                app.get_by_role("heading", name="앱 설정").wait_for()
                assert app.locator(".ks-data-window-body").get_attribute("hidden") is not None
                page.wait_for_timeout(300)
                save(page, "14-settings--wide.png")
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(100)
                save(page, "14-settings--wide--dark.png")
                page.emulate_media(color_scheme="light")

                set_rect(sb, window_id, 360, 240)
                page.wait_for_timeout(300)
                save(page, "14-settings--narrow.png")
                row_metrics = page.evaluate("""() => {
                  const rect = element => { const r = element.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom}; };
                  return {
                    panel: rect(document.querySelector('.ks-app-settings')),
                    selectControl: rect(document.querySelector('.ks-settings-custom .ks-select-field > :last-child')),
                    folderControl: rect(document.querySelector('.ks-settings-custom .ks-data-stack.is-row > .ks-data-stack-item:last-child')),
                    title: {clientWidth:document.querySelector('.ks-window-title').clientWidth, scrollWidth:document.querySelector('.ks-window-title').scrollWidth},
                    meta: {clientWidth:document.querySelector('.ks-window-title-meta').clientWidth, scrollWidth:document.querySelector('.ks-window-title-meta').scrollWidth}
                  };
                }""")
                (OUTPUT / "settings-layout.json").write_text(json.dumps(row_metrics, indent=2), encoding="utf-8")

                set_rect(sb, window_id, 900, 650)
                app.get_by_role("button", name="앱으로 돌아가기").click()
                wait_until(lambda: not app.locator(".ks-app-settings").is_visible(), 10, "설정 패널이 닫히지 않았습니다")
                focused = page.evaluate("document.activeElement?.getAttribute('aria-label')")
                assert focused == "앱 설정", f"뒤로 간 뒤 초점이 톱니로 돌아오지 않았습니다: {focused}"
                result["assertions"].append({"back_restores_gear_focus": focused})

                sb.set_state(window_id, {"test_controls": True})
                gear.click()
                app.get_by_role("heading", name="앱 설정").wait_for()
                tick_before = wait_until(lambda: counter(app, ".ks-settings-custom"), 10, "설정 트리의 test counter가 없습니다")
                tick_after = wait_until(
                    lambda: (value if (value := counter(app, ".ks-settings-custom")) is not None and value > tick_before else None),
                    10, "설정이 열린 동안 client 출력이 멈췄습니다",
                )
                assert app.locator(".ks-data-window-body").get_attribute("hidden") is not None
                app.get_by_role("button", name="설정 버튼 숨기기").click()
                wait_until(lambda: not app.get_by_role("button", name="앱 설정").is_visible(), 10, "available=false인데 톱니가 남았습니다")
                wait_until(lambda: not app.locator(".ks-app-settings").is_visible(), 10, "available=false인데 설정 패널이 열려 있습니다")
                app.get_by_role("button", name="설정 버튼 다시 표시").click()
                app.get_by_role("button", name="앱 설정").wait_for()
                body_after = wait_until(
                    lambda: (value if (value := counter(app, ".ks-data-window-body")) is not None and value > tick_after else None),
                    10, "설정을 닫은 뒤 본문이 새 client 출력을 표시하지 않았습니다",
                )
                result["assertions"].append({"client_continues_in_settings": {"before": tick_before, "after": tick_after},
                                             "available_hides_gear_and_closes_panel": True,
                                             "body_shows_latest_tick_after_close": body_after})
                sb.set_state(window_id, {"test_controls": False})

                sb.set_state(window_id, {"busy": True})
                gear.click()
                app.get_by_text("응답이 끝나면 바꿀 수 있습니다", exact=True).wait_for()
                for label in ["Mode", "Model", "Effort"]:
                    assert app.get_by_role("button", name=label, exact=True).is_disabled(), label
                for label in ["Fast mode", "Ultracode"]:
                    assert app.get_by_role("switch", name=label, exact=True).is_disabled(), label
                assert app.get_by_role("button", name="멈춤", exact=True).is_enabled()
                set_rect(sb, window_id, 900, 650)
                page.emulate_media(color_scheme="light")
                page.wait_for_timeout(300)
                save(page, "15-settings-locked--wide.png")
                set_rect(sb, window_id, 360, 240)
                page.wait_for_timeout(300)
                save(page, "15-settings-locked--narrow.png")
                set_rect(sb, window_id, 900, 650)
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(100)
                save(page, "15-settings-locked--wide--dark.png")
                result["assertions"].append("busy state disables Mode, Model, Effort, Fast mode and Ultracode")

                app.get_by_role("button", name="멈춤", exact=True).click()
                wait_until(lambda: not app.get_by_text("응답이 끝나면 바꿀 수 있습니다", exact=True).is_visible(), 10,
                           "멈춤 뒤 응답 중 안내가 닫히지 않았습니다")
                for label in ["Mode", "Model", "Effort"]:
                    assert app.get_by_role("button", name=label, exact=True).is_enabled(), label
                for label in ["Fast mode", "Ultracode"]:
                    assert app.get_by_role("switch", name=label, exact=True).is_enabled(), label

                long_model = "claude-opus-4-1-2025-long-model-name"
                long_folder = "kaleidoscope-workspace-with-a-very-long-project-folder-name-for-ellipsis"
                sb.set_state(window_id, {
                    "long_values": True,
                    "model": long_model,
                    "folder": long_folder,
                })
                wait_until(lambda: long_folder in app.locator(".ks-settings-custom").inner_text(),
                           10, "긴 폴더 이름이 설정 버튼에 반영되지 않았습니다")
                wait_until(lambda: app.get_by_role("button", name="Sandbox write access to network paths outside the workspace").is_visible(),
                           10, "긴 라벨의 설정 행이 보이지 않습니다")
                model_label = app.get_by_role("button", name="Model", exact=True).locator(".ks-select-choice-label")
                folder_label = app.locator(".ks-settings-custom .ks-data-button .ks-truncate-label")
                measure = "element => ({clientWidth:element.clientWidth, scrollWidth:element.scrollWidth, overflow:getComputedStyle(element).textOverflow})"
                long_metrics = {
                    "model": model_label.evaluate(measure),
                    "folder": folder_label.evaluate(measure),
                }
                assert long_model in model_label.text_content()
                assert long_folder in folder_label.text_content()
                assert long_metrics["model"]["scrollWidth"] > long_metrics["model"]["clientWidth"], long_metrics
                assert long_metrics["folder"]["scrollWidth"] > long_metrics["folder"]["clientWidth"], long_metrics
                assert long_metrics["model"]["overflow"] == "ellipsis", long_metrics
                assert long_metrics["folder"]["overflow"] == "ellipsis", long_metrics
                result["assertions"].append({"shared_ellipsis_for_long_model_and_folder": long_metrics})
                set_rect(sb, window_id, 900, 650)
                page.emulate_media(color_scheme="light")
                page.wait_for_timeout(300)
                save(page, "16-settings-long--wide.png")
                set_rect(sb, window_id, 360, 240)
                page.wait_for_timeout(300)
                save(page, "16-settings-long--narrow.png")
                set_rect(sb, window_id, 900, 650)
                page.emulate_media(color_scheme="dark")
                page.wait_for_timeout(100)
                save(page, "16-settings-long--wide--dark.png")
                result["assertions"].append({"long_toggle_label": "Allow web search while background tasks are running"})
                page.emulate_media(color_scheme="light")

                snapshot = sb.snapshot()
                workspace = snapshot["device"]["active_workspace_id"]
                desktop = snapshot["device"]["active_desktop_ids"][workspace]
                second = sb.core({"op": "window.open", "desktop_id": desktop, "app_id": definition["id"],
                                  "rect": {"x": 960, "y": 30, "width": 520, "height": 400}})
                assert "window" in second, second
                second_id = second["window"]["id"]
                sb.set_state(second_id, {"title": "두 번째 창 제목", "meta": "두 번째 창의 별도 작업 공간"})
                wait_until(lambda: "두 번째 창 제목" in page.locator(".ks-window-title").all_text_contents(), 15, "두 번째 창 제목 바인딩이 갱신되지 않았습니다")
                titles = page.locator(".ks-window-title").all_text_contents()
                metas = page.locator(".ks-window-title-meta").all_text_contents()
                assert "Claude Code" in titles and "두 번째 창 제목" in titles, titles
                assert "kaleidoscope-workspace" in metas and "두 번째 창의 별도 작업 공간" in metas, metas

                long_title = "두 번째 창에서 사용하는 매우 긴 제목 값"
                long_meta = "두 번째 창에 연결된 아주 긴 작업 공간 메타 정보 kaleidoscope workspace settings tree"
                sb.set_state(second_id, {"title": long_title, "meta": long_meta})
                wait_until(lambda: long_title in page.locator(".ks-window-title").all_text_contents(), 15, "긴 창 제목이 갱신되지 않았습니다")
                second_window = page.locator(".ks-window").filter(has=page.locator(".ks-window-title", has_text=long_title))
                set_rect(sb, second_id, 480, 320)
                page.wait_for_timeout(300)
                second_window = page.locator(".ks-window").filter(has=page.locator(".ks-window-title", has_text=long_title))
                medium_truncation = second_window.evaluate("""window => {
                  const measure = selector => { const e = window.querySelector(selector); return {clientWidth:e.clientWidth, scrollWidth:e.scrollWidth}; };
                  return {title:measure('.ks-window-title'), meta:measure('.ks-window-title-meta')};
                }""")
                assert medium_truncation["title"]["scrollWidth"] == medium_truncation["title"]["clientWidth"], medium_truncation
                assert medium_truncation["meta"]["scrollWidth"] > medium_truncation["meta"]["clientWidth"], medium_truncation
                save(page, "window-title--medium.png")

                set_rect(sb, second_id, 360, 240)
                page.wait_for_timeout(300)
                save(page, "window-title--narrow.png")
                narrow_truncation = second_window.evaluate("""window => {
                  const measure = selector => { const e = window.querySelector(selector); return {clientWidth:e.clientWidth, scrollWidth:e.scrollWidth}; };
                  return {title:measure('.ks-window-title'), meta:measure('.ks-window-title-meta')};
                }""")
                assert narrow_truncation["meta"]["scrollWidth"] > narrow_truncation["meta"]["clientWidth"], narrow_truncation
                assert narrow_truncation["title"]["scrollWidth"] > narrow_truncation["title"]["clientWidth"], narrow_truncation
                result["assertions"].append({"per_window_titles": titles, "per_window_meta": metas,
                                             "meta_truncates_first": medium_truncation,
                                             "title_truncates_after_meta": narrow_truncation})

                sb.core({"op": "window.close", "window_id": second_id})
                sb.core({"op": "window.close", "window_id": window_id})
                wait_until(lambda: sb.window_of(definition["id"]) is None, 10, "설정 시험 창이 닫히지 않았습니다")
                storage_definition = json.loads((FIXTURE / "storage-settings.json").read_text(encoding="utf-8"))
                storage_report = sb.upload_and_open(storage_definition)
                assert storage_report.get("window_id") and storage_report.get("upload_ok"), storage_report
                auto = sb.window(storage_definition["id"])
                auto.get_by_role("button", name="앱 설정").wait_for()
                page.wait_for_timeout(300)
                save(page, "storage-settings--before.png")
                auto.get_by_role("button", name="앱 설정").click()
                auto.get_by_role("heading", name="앱 설정").wait_for()
                model = auto.get_by_role("button", name="모델", exact=True)
                model.wait_for()
                toggle = auto.get_by_role("switch", name="새 세션으로 시작")
                toggle.wait_for()
                page.wait_for_timeout(300)
                save(page, "storage-settings--after.png")
                result["assertions"].append("storage presentation=settings still opens the automatic select and toggle controls")
                result["captures"] = sorted(path.name for path in OUTPUT.glob("*.png"))
                result["console"] = sb.console[-30:]
                browser.close()
                browser = None
        except Exception as error:
            result["error"] = repr(error)
            raise
        finally:
            sb.stop()
            result["logs"] = str(sb.tmp)
            result["captures"] = sorted(path.name for path in OUTPUT.glob("*.png"))
            (OUTPUT / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            if "error" not in result:
                print(f"{len(result['assertions'])} passed: settings availability, busy locks, shared ellipsis, per-window titles and legacy settings", flush=True)
            print(f"result {OUTPUT / 'result.json'}", flush=True)


if __name__ == "__main__":
    main()
