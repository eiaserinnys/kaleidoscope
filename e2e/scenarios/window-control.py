"""실제 코어와 브라우저에서 MCP 창 읽기 및 번호 조작을 검증한다."""
import json
import re
import time
from pathlib import Path


def wait_for(predicate, message, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.1)
    raise AssertionError(message)


def number(text, label):
    matches = [int(match.group(1)) for line in text.splitlines()
               if (match := re.match(r"^\[(\d+)\] ", line)) and label in line]
    assert len(matches) == 1, (label, text)
    return matches[0]


def call(tool, args):
    result = sb.mcp.call(tool, args)
    assert not result["is_error"], result
    return result["data"]


app_id = "window-control-check"
window_id = sb.window_of(app_id)["id"]
unshared = sb.mcp.call("read_window", {"window_id": window_id})
assert unshared["is_error"] and unshared["data"]["id"] == "MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE", unshared
window = sb.window(app_id)
window.get_by_role("button", name="같이 보기", exact=True).click()
workspace = sb.snapshot()["device"]["active_workspace_id"]
wait_for(lambda: any(view["window_id"] == window_id for view in
                     call("get_shared_view", {"workspace_id": workspace})["views"]), "공유 글이 오지 않았습니다")

view = call("read_window", {"window_id": window_id, "image": False})
assert view["mode"] == "full" and view["view_id"] and "[" in view["text"], view
input_id = number(view["text"], "시험 입력")
button_id = number(view["text"], "시험 실행")
select_id = number(view["text"], "시험 선택")

other = json.loads(Path(__file__).with_name("window-control-app.json").read_text(encoding="utf-8"))
other.update(id="window-control-other", name="다른 창")
assert sb.upload_and_open(other).get("window_id")
other_input = sb.window("window-control-other").get_by_role("textbox", name="시험 입력")
other_input.fill("다른 창 초안")
other_input.focus()

for action in [
    {"kind": "type", "target": input_id, "text": "바뀐 글", "mode": "replace"},
    {"kind": "click", "target": button_id},
    {"kind": "select", "target": select_id, "choice": {"by": "value", "value": "b"}},
]:
    before = view["view_id"]
    view = call("act_window", {"window_id": window_id, "view_id": before, "action": action})
    assert view["view_id"] != before and view["mode"] in ("diff", "full", "unchanged"), view
    assert other_input.input_value() == "다른 창 초안" and other_input.evaluate("e => e === document.activeElement")

state = wait_for(lambda: sb.window_of(app_id)["state"] if sb.window_of(app_id)["state"].get("choice") == "b" else None,
                 "선택 결과가 저장되지 않았습니다")
assert state["text"] == "바뀐 글" and state["clicked"] is True, state
sb.shot("window-control-text.png")
image = sb.mcp.call("read_window", {"window_id": window_id, "image": True})
assert image["is_error"] and image["data"]["id"] == "SHELL_CALL_UNEXPECTED_FAILURE", image
assert "창 화면을 고정할 수 없습니다" in image["data"]["message"], image
print("5 passed: 공유 전 거절, 번호 읽기, 조작, 다른 창 초안과 포커스, Linux 이미지 미지원", flush=True)
