#!/usr/bin/env python3
"""초점을 쥔 글칸이 when 때문에 사라지고 같은 자리에 단추가 생길 때 초점과 스크롤을 지키는지 확인한다.

장면: 세로 쌓기(왼쪽 칸)에 칸보다 긴 목록을 두고, 그 끝에 한 상태로 갈리는 두 when을 둔다.
하나는 단추(편집 시작), 다른 하나는 focus가 걸린 글칸(이름)이다. 단추를 눌러 글칸으로 들어간 뒤
Enter와 Escape로 상태를 되돌리면 글칸이 사라지고 같은 자리에 단추가 다시 생긴다. 이때 초점은
새로 생긴 단추로 가고 스크롤은 제자리에 남아야 한다. 문서 순서의 첫 내용 초점(목록 첫 행)으로
가면 칸이 맨 위로 튄다.

  python3 scripts/visual-check/check_focus_when_swap.py [--output 산출폴더]

kaleidoscope-app 스킬의 sandbox를 빌려 실제 코어로 앱을 올린다. 실행 전에 이 체크아웃에
kaleidoscope-orchestrator와 kaleidoscope-devbridge 바이너리(target/debug 또는 체크아웃 루트)와
app의 node_modules가 있어야 한다. 넓은 창 1180×720과 분할이 위아래로 쌓이는 좁은 창 420×720에서
Enter와 Escape를 각각 확인하고, 제거와 생성이 같은 변경 알림으로 오는지도 같은 화면에서 잰다.

바닥까지 스크롤한 상태에서 두 when의 높이가 달라지면 스크롤이 줄어든 높이만큼 당겨질 수 있으므로,
그만큼의 이동만 허용하고 나머지 이동은 초점이 끌어당긴 것으로 본다.

판정이 하나라도 어긋나면 result.json과 캡처를 남긴 뒤 종료 코드 1로 끝난다.
"""
import argparse
import importlib.util
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
APP_ID = "focus-when-swap-check"
COLUMN_BELOW = 640
SIZES = ((1180, 720), (420, 720))
ROWS = [{"key": f"r{index}", "title": f"행 {index + 1:02d}"} for index in range(30)]

# 화면 안의 상태와 변경 기록을 재는 도우미. 관찰 조건은 쉘과 같게 두어 같은 알림을 센다.
HELPERS = """
(appId) => {
  const root = document.querySelector(`[data-testid="app-window-${appId}"]`);
  const describe = (node) => {
    if (!(node instanceof Element)) return node.nodeName;
    const classes = String(node.className || "").split(" ").filter(Boolean).join(".");
    return `${node.tagName.toLowerCase()}${classes ? "." + classes : ""}`;
  };
  // overflow가 hidden인 칸도 스크롤 상자라 초점에 끌려 움직인다. 그래서 넘친 칸은 overflow 값과
  // 무관하게 모두 재되, 스크롤 상자가 아닌 visible과 clip은 뺀다.
  const scrollers = () => {
    const found = [];
    const seen = new Map();
    root?.querySelectorAll("*").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.scrollHeight - node.clientHeight <= 1) return;
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "visible" || overflow === "clip") return;
      const kind = describe(node);
      const index = seen.get(kind) ?? 0;
      seen.set(kind, index + 1);
      found.push({ key: `${kind}#${index}`, node });
    });
    return found;
  };
  const read = () => scrollers().map(({ key, node }) => ({
    key,
    max: Math.round(node.scrollHeight - node.clientHeight),
    scroll: Math.round(node.scrollTop),
  }));
  window.__ksSwap = {
    root,
    batches: [],
    reset() { window.__ksSwap.batches = []; },
    scroll: read,
    scrollToEnd() {
      for (const { node } of scrollers()) node.scrollTop = node.scrollHeight - node.clientHeight;
      return read();
    },
    active() {
      const node = document.activeElement;
      if (!(node instanceof Element)) return null;
      // 글칸은 aria-label 없이 이름표로 이름이 붙는 경우가 있으므로 붙은 이름표까지 읽는다.
      const labelled = () => {
        const aria = node.getAttribute("aria-label");
        if (aria) return aria;
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
          return [...(node.labels || [])].map((label) => (label.textContent || "").trim()).find(Boolean)
            ?? node.getAttribute("placeholder");
        }
        return null;
      };
      return {
        tag: node.tagName.toLowerCase(),
        label: labelled(),
        text: (node.textContent || "").trim().slice(0, 40),
        field: node.matches("input, textarea, select, [contenteditable='true']"),
      };
    },
    stacked: () => Boolean(root?.querySelector(".ks-split")?.classList.contains("is-stacked")),
  };
  window.__ksSwap.observer?.disconnect();
  window.__ksSwap.observer = new MutationObserver((records) => {
    window.__ksSwap.batches.push(records.map((record) => ({
      type: record.type,
      target: describe(record.target),
      removed: [...record.removedNodes].map(describe),
      added: [...record.addedNodes].map(describe),
    })));
  });
  window.__ksSwap.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "inert"] });
  return true;
}
"""


def load_sandbox():
    common = os.environ.get("AGENT_COMMON_FILES_DIR")
    if not common:
        sys.exit("AGENT_COMMON_FILES_DIR가 없습니다. kaleidoscope-app 스킬이 설치된 노드에서 실행하세요.")
    path = Path(common) / "skills/kaleidoscope-app/scripts/sandbox.py"
    spec = importlib.util.spec_from_file_location("kaleidoscope_sandbox", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def definition():
    enter_edit = [{"set_state": "idle", "value": False}, {"set_state": "editing", "value": True}]
    leave_edit = [{"set_state": "editing", "value": False}, {"set_state": "idle", "value": True}]
    return {
        "id": APP_ID,
        "name": "초점 교체 확인",
        "requires": {"blocks": 40, "modules": {}},
        "permissions": [],
        "state": {"rows": ROWS, "idle": True, "editing": False, "name": ""},
        "ui": {"type": "split", "direction": "row", "column_below": COLUMN_BELOW, "sizes": [58, 42], "children": [
            {"type": "stack", "direction": "column", "children": [
                {"type": "list", "items": {"state": "rows"}},
                {"type": "when", "value": {"state": "idle"}, "child": {
                    "type": "button", "label": "편집 시작", "on_click": enter_edit,
                }},
                {"type": "when", "value": {"state": "editing"}, "child": {
                    "type": "input", "label": "이름", "value": {"state": "name"},
                    "on_change": {"set_state": "name"}, "focus": {"state": "editing"},
                    "on_submit": leave_edit, "on_cancel": leave_edit,
                }},
            ]},
            {"type": "stack", "direction": "column", "children": [
                {"type": "text", "value": "옆 칸"},
            ]},
        ]},
    }


def wait_until(fn, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError(message)


def set_rect(sb, window_id, width, height):
    result = sb.core({"op": "window.set_rect", "window_id": window_id,
                      "rect": {"x": 20, "y": 20, "width": width, "height": height}})
    if "error" in result:
        raise AssertionError(result["error"])


def capture(page, output, name, captures):
    path = output / name
    page.screenshot(path=str(path))
    print(f"capture {path}", flush=True)
    captures.append(str(path))


def check_scroll(before, after):
    """바닥에서 내용이 줄어든 만큼만 당겨진 이동을 허용하고 나머지는 초점이 끌어당긴 것으로 본다."""
    if not before:
        return False, [{"result": "스크롤할 칸이 없어 재현 조건이 서지 않았습니다"}]
    later = {item["key"]: item for item in after}
    notes = []
    ok = True
    for item in before:
        match = later.get(item["key"])
        if match is None:
            notes.append({"key": item["key"], "result": "사라짐", "ok": False})
            ok = False
            continue
        shrink = max(0, item["max"] - match["max"])
        delta = item["scroll"] - match["scroll"]
        passed = -2 <= delta <= shrink + 2
        notes.append({"key": item["key"], "before": item["scroll"], "after": match["scroll"],
                      "shrink": shrink, "delta": delta, "ok": passed})
        ok = ok and passed
    return ok, notes


def run_split(sb, page, app, window_id, output, width, height, captures):
    """생김과 사라짐이 두 번의 변경 알림으로 나뉘어 와도 초점을 지키는지 확인한다.

    첫 알림에는 같은 자리에 단추가 생기고 글칸은 아직 살아 있으며, 다음 알림에서 글칸만 사라진다.
    교체 판정이 「이번 알림에 생긴 노드」만 보면 첫 알림의 단추를 못 찾아 첫 목록 행으로 간다.
    """
    size = f"{width}x{height}"
    sb.set_state(window_id, {"idle": True, "editing": False, "name": ""})
    start = app.get_by_role("button", name="편집 시작")
    start.wait_for(state="visible", timeout=15_000)
    page.wait_for_timeout(200)
    start.click()
    field = app.get_by_role("textbox", name="이름")
    field.wait_for(state="visible", timeout=15_000)
    wait_until(lambda: (page.evaluate("window.__ksSwap.active()") or {}).get("label") == "이름",
               10, "글칸이 초점을 받지 않았습니다")
    page.evaluate("window.__ksSwap.scrollToEnd()")
    page.wait_for_timeout(200)
    before = page.evaluate("window.__ksSwap.scroll()")
    active_before = page.evaluate("window.__ksSwap.active()")
    stacked = page.evaluate("window.__ksSwap.stacked()")
    capture(page, output, f"split-before-{size}.png", captures)

    page.evaluate("window.__ksSwap.reset()")
    # 첫 알림: 단추가 생기고 글칸은 아직 살아 있다.
    first = sb.core({"op": "window.patch_state", "window_id": window_id, "patch": {"idle": True}})
    if "error" in first:
        raise AssertionError(first["error"])
    app.get_by_role("button", name="편집 시작").wait_for(state="visible", timeout=15_000)
    page.wait_for_timeout(300)
    still_focused = page.evaluate("window.__ksSwap.active()")
    # 다음 알림: 글칸만 사라진다.
    second = sb.core({"op": "window.patch_state", "window_id": window_id, "patch": {"editing": False}})
    if "error" in second:
        raise AssertionError(second["error"])
    wait_until(lambda: (page.evaluate("window.__ksSwap.active()") or {}).get("label") == "편집 시작",
               10, "나뉜 알림에서 초점이 새 단추로 가지 않았습니다")
    page.wait_for_timeout(400)
    active_after = page.evaluate("window.__ksSwap.active()")
    after = page.evaluate("window.__ksSwap.scroll()")
    batches = page.evaluate("window.__ksSwap.batches")
    capture(page, output, f"split-after-{size}.png", captures)

    added_batch = next((index for index, batch in enumerate(batches)
                        if any("ks-data-button" in node for record in batch for node in record["added"])), None)
    removed_batch = next((index for index, batch in enumerate(batches)
                          if any("ks-input-field" in node for record in batch for node in record["removed"])), None)
    focus_ok = bool(active_after) and active_after["tag"] == "button" and active_after["label"] == "편집 시작"
    split_ok = (len(batches) >= 2 and added_batch is not None and removed_batch is not None
                and added_batch < removed_batch)
    scroll_ok, scroll_notes = check_scroll(before, after)
    expected_stacked = width < COLUMN_BELOW
    stacked_ok = stacked == expected_stacked
    return {
        "size": size,
        "action": "split",
        "key": "두 알림",
        "stacked": stacked,
        "stacked_ok": stacked_ok,
        "focus_before": active_before,
        "focus_after": active_after,
        "focus_ok": focus_ok,
        "split_still_focused": still_focused,
        "batches": batches,
        "added_batch": added_batch,
        "removed_batch": removed_batch,
        "split_ok": split_ok,
        "scroll": scroll_notes,
        "scroll_ok": scroll_ok,
        "ok": focus_ok and split_ok and scroll_ok and stacked_ok,
    }


def run_action(sb, page, app, window_id, output, width, height, action, captures):
    size = f"{width}x{height}"
    sb.set_state(window_id, {"idle": True, "editing": False, "name": ""})
    start = app.get_by_role("button", name="편집 시작")
    start.wait_for(state="visible", timeout=15_000)
    page.wait_for_timeout(200)
    start.click()
    field = app.get_by_role("textbox", name="이름")
    field.wait_for(state="visible", timeout=15_000)
    wait_until(lambda: (page.evaluate("window.__ksSwap.active()") or {}).get("label") == "이름",
               10, "글칸이 초점을 받지 않았습니다")
    page.evaluate("window.__ksSwap.scrollToEnd()")
    page.wait_for_timeout(200)
    before = page.evaluate("window.__ksSwap.scroll()")
    active_before = page.evaluate("window.__ksSwap.active()")
    stacked = page.evaluate("window.__ksSwap.stacked()")
    capture(page, output, f"{action}-before-{size}.png", captures)

    page.evaluate("window.__ksSwap.reset()")
    key = "Enter" if action == "enter" else "Escape"
    page.keyboard.press(key)
    app.get_by_role("button", name="편집 시작").wait_for(state="visible", timeout=15_000)
    page.wait_for_timeout(400)
    active_after = page.evaluate("window.__ksSwap.active()")
    after = page.evaluate("window.__ksSwap.scroll()")
    batches = page.evaluate("window.__ksSwap.batches")
    capture(page, output, f"{action}-after-{size}.png", captures)

    added = [node for batch in batches for record in batch for node in record["added"]]
    removed = [node for batch in batches for record in batch for node in record["removed"]]
    focus_ok = bool(active_after) and active_after["tag"] == "button" and active_after["label"] == "편집 시작"
    batch_ok = (len(batches) == 1
                and any("ks-data-button" in node for node in added)
                and any("ks-input-field" in node for node in removed))
    scroll_ok, scroll_notes = check_scroll(before, after)
    expected_stacked = width < COLUMN_BELOW
    stacked_ok = stacked == expected_stacked
    return {
        "size": size,
        "action": action,
        "key": key,
        "stacked": stacked,
        "stacked_ok": stacked_ok,
        "focus_before": active_before,
        "focus_after": active_after,
        "focus_ok": focus_ok,
        "batches": batches,
        "batch_ok": batch_ok,
        "scroll": scroll_notes,
        "scroll_ok": scroll_ok,
        "ok": focus_ok and batch_ok and scroll_ok and stacked_ok,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "target/visual-check/focus-when-swap")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    sandbox = load_sandbox()
    warm = sandbox.warm_file
    sandbox.warm_file = lambda path: warm(path) if Path(path).exists() else None

    def binary(name):
        for candidate in (ROOT / "target/debug" / name, ROOT / name):
            if candidate.is_file():
                return candidate
        sys.exit(f"{name}이 없습니다. `cargo build -p kaleidoscope-orchestrator -p kaleidoscope-devbridge` 뒤 다시 실행하세요.")

    (sandbox.CACHE / "locks").mkdir(parents=True, exist_ok=True)
    address, ui_lock = sandbox.acquire_ui_address()
    app_definition = definition()
    result = {"app": APP_ID, "root": str(ROOT), "definition": app_definition, "checks": [], "captures": []}
    with ui_lock, tempfile.TemporaryDirectory(prefix="ks-focus-when-swap-") as directory:
        sb = sandbox.Sandbox(ROOT, output, Path(directory) / "folder", address)
        spawn = sb._spawn

        def local_spawn(name, command, **env):
            if name in ("server", "bridge"):
                command[0] = str(binary(Path(command[0]).name))
            return spawn(name, command, **env)

        sb._spawn = local_spawn
        browser = None
        try:
            sb.start()
            report = sb.upload_and_open(app_definition)
            result["upload"] = report
            if not report.get("window_id") or not report.get("upload_ok"):
                raise AssertionError(f"앱을 올리거나 열지 못했습니다: {report}")
            window_id = report["window_id"]

            with sync_playwright() as playwright:
                browser = sb.open_page(playwright, (1440, 900))
                page = sb.page
                result["ui_source"] = {"root": str(ROOT), "css": sb.ui_css()}
                app = sb.window(APP_ID)
                app.wait_for(state="visible", timeout=60_000)
                page.evaluate(HELPERS, APP_ID)

                for width, height in SIZES:
                    set_rect(sb, window_id, width, height)
                    page.wait_for_timeout(500)
                    for action in ("enter", "escape"):
                        result["checks"].append(run_action(sb, page, app, window_id, output, width, height, action, result["captures"]))
                    result["checks"].append(run_split(sb, page, app, window_id, output, width, height, result["captures"]))
        except Exception:  # noqa: BLE001 - 판정 실패도 결과와 캡처를 남긴다
            result["error"] = traceback.format_exc()[-3000:]
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:  # noqa: BLE001 - 이미 닫힌 화면은 정리만 건너뛴다
                    pass
            sb.stop()
            result["console"] = sb.console[-20:]
            result["logs"] = str(sb.logs)

    failed = [check for check in result["checks"] if not check["ok"]]
    result["ok"] = bool(result["checks"]) and not failed and "error" not in result
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": result["ok"], "checks": [
        {"size": check["size"], "action": check["action"], "focus_ok": check["focus_ok"],
         "batch_ok": check.get("batch_ok"), "split_ok": check.get("split_ok"),
         "scroll_ok": check["scroll_ok"], "stacked_ok": check["stacked_ok"]}
        for check in result["checks"]], "error": result.get("error")}, ensure_ascii=False, indent=2), flush=True)
    print(f"result {output / 'result.json'}", flush=True)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
