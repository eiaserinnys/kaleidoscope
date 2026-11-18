#!/usr/bin/env python3
"""카드 #1648 읽기 실패·재시도와 폴더 작업 알림, #1668 편집기 다시 시도 실화면 검수.

python3 -P scripts/visual-check/check_1648_retry_states.py [--output 산출폴더] [--port 포트]

브라우저 시험에서 넓은 폭과 360px의 실패, 다시 읽는 로더, 목록 유지, 대상 행 아래
알림, 두 편집기의 다시 시도와 마크다운 보기 창 초점 새로고침을 캡처하고 초점, Tab,
Esc, 넘침, 다시 시도와 창 폭 변경을 검사한다.
하나라도 실패하거나 캡처가 빠지면 0이 아닌 값으로 끝난다.
"""
import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".local/visual/card1648")
    parser.add_argument("--port", type=int, default=5649)
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["KS_E2E_PORT"] = str(args.port)
    env["KS_1648_VISUAL_OUTPUT"] = str(output)
    command = ["corepack", "pnpm@10.32.1", "--dir", "ui", "e2e:netns", "retry-states-1648", "--workers=1"]
    result = subprocess.run(command, cwd=ROOT, env=env, timeout=840, check=False)
    names = [f"{width}-{state}.png" for width in (1100, 360) for state in (
        "retry", "retry-focus", "loading", "refresh", "operation", "code-error", "markdown-error",
        "markdown-file-error", "tree-root-error", "tree-child-error")]
    names += ["1100-paste-root.png", "1100-multiple-expanded.png"]
    # 카드 #1668: 두 편집기의 첫 읽기 실패와 다시 읽는 로더, 마크다운 보기 창 초점 새로고침.
    names += [f"1668-{width}-{state}.png" for width in (1100, 360) for state in (
        "code-editor-retry", "code-editor-loading", "markdown-editor-retry", "markdown-editor-loading")]
    names += ["1668-markdown-view-focus-refresh.png"]
    missing = [name for name in names if not (output / name).is_file()]
    summary = {"시험_종료코드": result.returncode, "누락_캡처": missing,
               "검사": ["누른 뒤 초점", "Tab과 Esc", "최소 폭 넘침", "오류와 다시 시도", "창 크기 변경"]}
    (output / "result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if result.returncode or missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
